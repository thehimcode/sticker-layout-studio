import { CancelledError } from './cutline-service.js';
import { drawArtwork, drawMarks } from '../render/page-render.js';
import { deflate, toBase64 } from '../export/binary.js';
import { setJpegDpi, setPngDpi } from '../export/image-dpi.js';
import { buildPdf } from '../export/pdf.js';
import { combinedSvg, cutSvg } from '../export/svg-export.js';
import { makeZip } from '../export/zip.js';
import { fileName, rasterSize, safeName } from '../export/preflight.js';

/**
 * ส่งออกไฟล์ (FR-07) จากเอกสารที่ยืนยันแล้วใน Editor เท่านั้น ไม่มีการจัดเรียงใหม่ (FR-07.7)
 * ภาพพิมพ์วาดด้วย page-render ตัวเดียวกับหน้าจอ เส้นตัดใช้ placementMatrix ชุดเดียวกัน
 */

const blobOf = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('สร้างไฟล์ภาพไม่สำเร็จ หน่วยความจำอาจไม่พอ'))), type, quality);
});
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** แถวพิกเซล RGB ทีละช่วง ไม่ดึงทั้งภาพครั้งเดียว ลดหน่วยความจำของหน้าใหญ่ */
async function* rgbRows(ctx, width, height, band = 256) {
  for (let y = 0; y < height; y += band) {
    const h = Math.min(band, height - y);
    const rgba = ctx.getImageData(0, y, width, h).data;
    const rgb = new Uint8Array(width * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    yield rgb;
  }
}

function whiteBehind(ctx, width, height) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * คืน { files: [{ name, data, type }], bundle: { name, blob } }
 * bundle เป็นไฟล์เดียวถ้ามีไฟล์เดียว ถ้ามากกว่านั้นรวมเป็น Zip
 */
export async function exportDocument({ doc, assets, options, onProgress = () => {}, isCancelled = () => false }) {
  const base = safeName(doc.name);
  const marks = doc.marks ?? [];
  const printMarks = options.includeMarks && marks.length > 0;
  const printKind = printMarks ? 'print-marks' : 'print';
  const needRaster = options.png || options.jpg || options.pdf || options.combinedSvg;
  const { width, height } = rasterSize(doc.paper, options.dpi);
  const files = [];
  const pdfPages = [];
  const steps = doc.pages.length + 1;
  const check = () => { if (isCancelled()) throw new CancelledError(); };

  for (const [index, page] of doc.pages.entries()) {
    check();
    onProgress(index / steps, `หน้า ${index + 1}/${doc.pages.length}`);
    if (needRaster) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: options.pdf });
      if (!ctx) throw new Error('สร้างภาพขนาดนี้ไม่ได้ ลด DPI แล้วลองใหม่');
      try {
        // 1 หน่วยของ ctx = 1 มม. ภาพเต็มหน้าพอดีทั้งสองแกน
        ctx.setTransform(width / doc.paper.widthMm, 0, 0, height / doc.paper.heightMm, 0, 0);
        drawArtwork(ctx, doc, page.id, assets, { placeholder: null });
        if (options.combinedSvg) {
          const art = await bytesOf(await blobOf(canvas, 'image/png'));
          check();
          const href = `data:image/png;base64,${toBase64(setPngDpi(art, options.dpi))}`;
          const svg = combinedSvg(doc, page.id, { artworkHref: href, includeMarks: options.includeMarks });
          files.push({ name: fileName(base, index, 'combined', 'svg'), data: new TextEncoder().encode(svg), type: 'image/svg+xml' });
        }
        if (printMarks) drawMarks(ctx, marks);
        if (options.png) {
          if (options.pngBackground === 'white') whiteBehind(ctx, width, height);
          const png = setPngDpi(await bytesOf(await blobOf(canvas, 'image/png')), options.dpi);
          files.push({ name: fileName(base, index, printKind, 'png'), data: png, type: 'image/png' });
          check();
        }
        if (options.jpg || options.pdf) whiteBehind(ctx, width, height);
        if (options.jpg) {
          const jpg = setJpegDpi(await bytesOf(await blobOf(canvas, 'image/jpeg', 0.95)), options.dpi);
          files.push({ name: fileName(base, index, printKind, 'jpg'), data: jpg, type: 'image/jpeg' });
          check();
        }
        if (options.pdf) {
          const deflated = await deflate(rgbRows(ctx, width, height));
          pdfPages.push({ widthMm: doc.paper.widthMm, heightMm: doc.paper.heightMm, image: { width, height, deflated } });
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    if (options.cutSvg) {
      const svg = cutSvg(doc, page.id, { marks: options.marksInCutSvg });
      files.push({ name: fileName(base, index, 'cut', 'svg'), data: new TextEncoder().encode(svg), type: 'image/svg+xml' });
    }
  }
  check();
  if (pdfPages.length) {
    onProgress(doc.pages.length / steps, 'กำลังสร้าง PDF');
    const pdf = buildPdf(pdfPages, { title: doc.name });
    files.push({ name: fileName(base, null, printKind, 'pdf'), data: pdf, type: 'application/pdf' });
  }
  if (!files.length) throw new Error('ไม่มีไฟล์ให้ส่งออก');
  onProgress(1, 'เสร็จแล้ว');
  const bundle = files.length === 1
    ? { name: files[0].name, blob: new Blob([files[0].data], { type: files[0].type }) }
    : { name: `${base}.zip`, blob: new Blob([makeZip(files)], { type: 'application/zip' }) };
  return { files, bundle };
}

export function download({ name, blob }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
