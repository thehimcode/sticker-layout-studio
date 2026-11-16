import { boundsOf, instancesOf, placedInstances } from '../core/document.js';
import { rectContains } from '../core/geometry.js';
import { markFrame } from '../core/marks.js';
import { printableArea } from '../core/paper.js';
import { effectiveDpi } from '../core/units.js';
import { validateDocument } from '../core/validate.js';

/**
 * ตัวเลือกส่งออก (SRS ข้อ 5 ExportSettings) เก็บใน doc.settings.export
 * print: png | jpg | pdf (ไม่มีเส้นตัด), cutSvg, combinedSvg
 */
export const DPI_CHOICES = Object.freeze([150, 300, 600]);
export const DEFAULT_EXPORT = Object.freeze({
  dpi: 300,
  png: true,
  jpg: false,
  pdf: false,
  cutSvg: true,
  combinedSvg: false,
  pngBackground: 'transparent',
  includeMarks: true,
  marksInCutSvg: 'reference',
  multiPageNaming: 'page-number',
});

export const exportSettingsOf = (doc) => ({ ...DEFAULT_EXPORT, ...(doc.settings.export ?? {}) });

/** ขีดจำกัด Canvas ของเบราว์เซอร์ (Chromium) ด้านละ 32767 px และพื้นที่ราว 268 ล้านพิกเซล */
export const CANVAS_MAX_SIDE = 32767;
export const CANVAS_MAX_PIXELS = 268_000_000;
/** เกินนี้เตือนว่าใช้หน่วยความจำมาก (RGBA 4 ไบต์ต่อพิกเซล ≈ 400 MB) */
export const PIXELS_WARN = 100_000_000;
export const LOW_DPI = 150;

export function rasterSize(paper, dpi) {
  return {
    width: Math.round((paper.widthMm * dpi) / 25.4),
    height: Math.round((paper.heightMm * dpi) / 25.4),
  };
}

const anyPrint = (o) => o.png || o.jpg || o.pdf || o.combinedSvg;

/**
 * ตรวจก่อนส่งออก (FR-07.8) คืนรายการ { level: 'error' | 'warning' | 'ok', topic, text }
 * error = ส่งออกแล้วงานเสียแน่ (ทับกัน ล้น ทับ Keep-out ภาพใหญ่เกิน Canvas) ต้องยืนยันก่อนส่งออก
 */
export function preflight(doc, options) {
  const o = { ...DEFAULT_EXPORT, ...options };
  const issues = validateDocument(doc);
  const out = [];
  const add = (level, topic, text) => out.push({ level, topic, text });
  const { paper } = doc;
  const placed = placedInstances(doc);

  add('ok', 'ขนาดจริง', `กระดาษ ${paper.widthMm} × ${paper.heightMm} มม. ${doc.pages.length} หน้า ไฟล์ทุกไฟล์ใช้ขนาดนี้`);

  if (!o.png && !o.jpg && !o.pdf && !o.cutSvg && !o.combinedSvg) add('error', 'ไฟล์', 'ยังไม่ได้เลือกชนิดไฟล์ที่จะส่งออก');
  if (!placed.length) add('error', 'ชิ้นงาน', 'ยังไม่มีชิ้นงานบนกระดาษ');

  const counts = doc.masters
    .filter((m) => m.quantity > 0)
    .map((m) => {
      const n = instancesOf(doc, m.id).filter((i) => i.placementStatus === 'placed').length;
      return `${m.name} ${n}/${m.quantity}`;
    });
  if (issues.unplaced) add('warning', 'จำนวน', `ยังวางไม่ได้ ${issues.unplaced} ชิ้น จะไม่อยู่ในไฟล์ (${counts.join(', ')})`);
  else if (placed.length) add('ok', 'จำนวน', `ทุกชิ้นอยู่ในไฟล์ (${counts.join(', ')})`);

  const area = printableArea(paper);
  if (issues.outside.size) add('error', 'Margins', `${issues.outside.size} ชิ้นล้นพื้นที่วางงาน (ขอบ ${paper.marginsMm.top}/${paper.marginsMm.right}/${paper.marginsMm.bottom}/${paper.marginsMm.left} มม.)`);
  else add('ok', 'Margins', `ทุกชิ้นอยู่ในพื้นที่ ${Math.round(area.width * 10) / 10} × ${Math.round(area.height * 10) / 10} มม.`);
  if (issues.oversized.size) add('error', 'ขนาด', `${issues.oversized.size} แบบใหญ่เกินพื้นที่วางงาน`);

  if (issues.overlapping.size) add('error', 'Overlap', `${issues.overlapping.size} ชิ้นทับกัน`);
  else add('ok', 'Overlap', 'ไม่มีชิ้นงานทับกัน');
  if (issues.tooClose.size) add('warning', 'Spacing', `${issues.tooClose.size} ชิ้นห่างกันน้อยกว่า ${doc.settings.spacingMm} มม.`);
  else add('ok', 'Spacing', `ระยะห่างทุกคู่ไม่น้อยกว่า ${doc.settings.spacingMm} มม. (วัดจาก${doc.settings.spacingMode === 'image' ? 'ขอบภาพ' : 'เส้นตัด'})`);
  if (issues.inKeepout.size) add('error', 'Keep-out', `${issues.inKeepout.size} ชิ้นทับพื้นที่ห้ามวางหรือพื้นที่สงวนของมาร์ค`);
  else add('ok', 'Keep-out', 'ไม่มีชิ้นงานทับพื้นที่ห้ามวาง');

  const low = doc.masters.filter((m) => m.quantity > 0
    && effectiveDpi(m.naturalSize.widthPx, m.desiredSizeMm.widthMm) < LOW_DPI);
  if (low.length) add('warning', 'DPI', `ภาพความละเอียดต่ำกว่า ${LOW_DPI} DPI เมื่อพิมพ์: ${low.map((m) => `${m.name} ${Math.round(effectiveDpi(m.naturalSize.widthPx, m.desiredSizeMm.widthMm))} DPI`).join(', ')}`);
  else add('ok', 'DPI', `ภาพทุกแบบละเอียดอย่างน้อย ${LOW_DPI} DPI เมื่อพิมพ์`);

  if (anyPrint(o)) {
    const { width, height } = rasterSize(paper, o.dpi);
    const pixels = width * height;
    if (width > CANVAS_MAX_SIDE || height > CANVAS_MAX_SIDE || pixels > CANVAS_MAX_PIXELS) {
      add('error', 'หน่วยความจำ', `${o.dpi} DPI ได้ภาพ ${width} × ${height} px เกินที่เบราว์เซอร์สร้างได้ ลด DPI หรือแบ่งกระดาษ`);
    } else if (pixels > PIXELS_WARN) {
      add('warning', 'หน่วยความจำ', `${o.dpi} DPI ได้ภาพ ${width} × ${height} px ใช้หน่วยความจำราว ${Math.round((pixels * 4) / 1e6)} MB ต่อหน้า อาจช้าหรือไม่สำเร็จ`);
    } else add('ok', 'ไฟล์ภาพ', `${o.dpi} DPI ได้ภาพ ${width} × ${height} px ต่อหน้า`);
  }

  if (o.cutSvg || o.combinedSvg) {
    const used = doc.masters.filter((m) => placed.some((i) => i.masterId === m.id));
    const stale = used.filter((m) => m.cutline?.stale);
    const none = used.filter((m) => !m.cutline || !m.cutline.closedPaths?.length);
    if (stale.length) add('error', 'เส้นตัด', `เส้นตัดรอคำนวณใหม่หลังแก้ขนาด: ${stale.map((m) => m.name).join(', ')}`);
    if (none.length) add('warning', 'เส้นตัด', `ไม่มีเส้นตัด จะไม่ถูกตัด: ${none.map((m) => m.name).join(', ')}`);
    if (!stale.length && !none.length && used.length) add('ok', 'เส้นตัด', 'ทุกแบบมีเส้นตัดพร้อมใช้');
  }

  const marks = doc.marks ?? [];
  const wantsMarks = (o.includeMarks && anyPrint(o)) || (o.cutSvg && o.marksInCutSvg === 'reference');
  if (issues.marksOutside.size) add('error', 'Marks', `${issues.marksOutside.size} มาร์คอยู่นอกกระดาษ`);
  if (!marks.length) {
    if (wantsMarks) add('warning', 'Marks', 'ยังไม่มี Registration Marks ไฟล์จะไม่มีมาร์ค');
  } else {
    if (doc.markSettings?.verificationStatus !== 'verified') {
      add('warning', 'Marks', `${doc.markSettings?.label ?? 'มาร์ค'} ยังไม่ยืนยันกับเครื่องตัดจริง ตรวจขนาดและตำแหน่งก่อนสั่งงาน`);
    }
    add('ok', 'Marks', `${marks.length} จุด ตำแหน่งเดียวกันทุกหน้า${o.includeMarks && anyPrint(o) ? ' อยู่ในไฟล์พิมพ์' : ' ไม่อยู่ในไฟล์พิมพ์'}${o.cutSvg ? (o.marksInCutSvg === 'reference' ? ', อยู่ในไฟล์ตัดเป็น Reference ไม่ใช่เส้นตัด' : ', ไม่อยู่ในไฟล์ตัด') : ''}`);
  }

  const frame = markFrame(marks);
  if (frame) {
    const outsideFrame = placed.filter((i) => !rectContains(frame, boundsOf(doc, i), 0.01)).length;
    if (outsideFrame) add('warning', 'Marks', `${outsideFrame} ชิ้นอยู่นอกกรอบที่ล้อมด้วยมาร์ค เครื่องอาจชดเชยตำแหน่งได้ไม่แม่น`);
  }

  const empty = doc.pages.filter((p) => !placed.some((i) => i.pageId === p.id)).length;
  if (empty) add('warning', 'หน้า', `${empty} หน้าว่าง จะได้ไฟล์หน้าเปล่า`);
  return out;
}

export const hasErrors = (checks) => checks.some((c) => c.level === 'error');

/** ชื่อไฟล์ที่ปลอดภัยสำหรับทุกระบบ คงอักษรไทยไว้ */
export function safeName(name) {
  const cleaned = String(name ?? '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 80);
  return cleaned || 'sticker-layout';
}

/** ชื่อไฟล์สม่ำเสมอ: ชื่องาน_p01_print.png (FR-07.6) PDF รวมทุกหน้าในไฟล์เดียวไม่มีเลขหน้า */
export function fileName(base, pageIndex, kind, ext) {
  if (pageIndex === null) return `${base}_${kind}.${ext}`;
  return `${base}_p${String(pageIndex + 1).padStart(2, '0')}_${kind}.${ext}`;
}
