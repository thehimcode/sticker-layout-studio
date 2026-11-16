import { placementMatrix } from '../core/geometry.js';
import { getMaster, placedInstances } from '../core/document.js';
import { cutlineData } from '../core/contour/svg.js';
import { markMatrix, markPaint, markPathData } from '../core/marks.js';

/**
 * วาดหน้ากระดาษในพิกัด มม. ใช้ร่วมกันระหว่าง Editor และการส่งออก (ARCHITECTURE ข้อ 1)
 * ผู้เรียกตั้ง ctx ให้ 1 หน่วยเท่ากับ 1 มม. แล้วฟังก์ชันนี้ใช้ placementMatrix ชุดเดียวกับทุกปลายทาง
 * ไม่มีการจัดเรียงใหม่ในขั้นตอนนี้ (FR-07.7)
 */

const pathCache = new WeakMap();
const markCache = new WeakMap();

export function cutlinePath(cutline) {
  let path = pathCache.get(cutline);
  if (!path) {
    path = new Path2D(cutlineData(cutline));
    pathCache.set(cutline, path);
  }
  return path;
}

function markPath(mark) {
  let path = markCache.get(mark);
  if (!path) {
    path = new Path2D(markPathData(mark));
    markCache.set(mark, path);
  }
  return path;
}

/** เส้นตัดที่พร้อมใช้: มีเส้นและไม่ได้รอคำนวณใหม่หลังแก้ขนาด */
export const usableCutline = (master) => Boolean(
  master.cutline && !master.cutline.stale && master.cutline.closedPaths?.length,
);

/** ภาพพื้นทึบ (โหมดสีพื้นหลัง) ต้องตัดตามเส้นตัด ไม่ให้พื้นหลังทับชิ้นข้างเคียง */
export const clipsToCutline = (master) => master.cutlineConfig?.maskMode === 'color' && usableCutline(master);

/**
 * Bleed: ยืดพิกเซลแถวขอบของภาพออกไป bleedMm ทุกด้าน (Edge Extension)
 * ภาพที่ขอบโปร่งใสจะไม่เห็นผล เพราะพิกเซลขอบไม่มีสี
 */
function drawWithBleed(ctx, bitmap, w, h, b) {
  const bw = bitmap.width;
  const bh = bitmap.height;
  if (b > 0) {
    ctx.drawImage(bitmap, 0, 0, bw, 1, 0, -b, w, b);
    ctx.drawImage(bitmap, 0, bh - 1, bw, 1, 0, h, w, b);
    ctx.drawImage(bitmap, 0, 0, 1, bh, -b, 0, b, h);
    ctx.drawImage(bitmap, bw - 1, 0, 1, bh, w, 0, b, h);
    ctx.drawImage(bitmap, 0, 0, 1, 1, -b, -b, b, b);
    ctx.drawImage(bitmap, bw - 1, 0, 1, 1, w, -b, b, b);
    ctx.drawImage(bitmap, 0, bh - 1, 1, 1, -b, h, b, b);
    ctx.drawImage(bitmap, bw - 1, bh - 1, 1, 1, w, h, b, b);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
}

/** วาดภาพทุกชิ้นของหน้า ตามลำดับชั้นในเอกสาร */
export function drawArtwork(ctx, doc, pageId, assets, { placeholder = '#e9eeeb' } = {}) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const instance of placedInstances(doc, pageId)) {
    const master = getMaster(doc, instance.masterId);
    const { widthMm, heightMm } = master.desiredSizeMm;
    ctx.save();
    ctx.transform(...placementMatrix(instance.transform, master.desiredSizeMm));
    if (clipsToCutline(master)) ctx.clip(cutlinePath(master.cutline));
    const bitmap = assets.get(master.originalAsset.assetId);
    if (bitmap) drawWithBleed(ctx, bitmap, widthMm, heightMm, master.bleedMm ?? 0);
    else if (placeholder) {
      ctx.fillStyle = placeholder;
      ctx.fillRect(0, 0, widthMm, heightMm);
    }
    ctx.restore();
  }
}

/** เส้นตัดของหน้า ความหนาเส้นเป็นหน่วยของ ctx ปัจจุบัน */
export function drawCutlines(ctx, doc, pageId, { color, width }) {
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  for (const instance of placedInstances(doc, pageId)) {
    const master = getMaster(doc, instance.masterId);
    if (!usableCutline(master)) continue;
    ctx.save();
    ctx.transform(...placementMatrix(instance.transform, master.desiredSizeMm));
    ctx.stroke(cutlinePath(master.cutline));
    ctx.restore();
  }
}

/** Registration Marks ตามสีและขนาดจริง (มม.) */
export function drawMarks(ctx, marks) {
  for (const mark of marks) {
    const paint = markPaint(mark);
    const path = markPath(mark);
    ctx.save();
    ctx.transform(...markMatrix(mark));
    if (paint.fill !== 'none') {
      ctx.fillStyle = paint.fill;
      ctx.fill(path);
    }
    if (paint.stroke !== 'none' && paint.lineMm > 0) {
      ctx.strokeStyle = paint.stroke;
      ctx.lineWidth = paint.lineMm;
      ctx.stroke(path);
    }
    ctx.restore();
  }
}
