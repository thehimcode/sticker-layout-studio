/** ระบบพิกัดเอกสารทั้งหมดเป็นมิลลิเมตร ไฟล์นี้เป็นจุดเดียวที่แปลงหน่วย */
export const MM_PER_INCH = 25.4;
/** ความคลาดเคลื่อนที่ยอมรับได้ในการเปรียบเทียบพิกัด (1 นาโนเมตร) ใช้กันผลจาก floating point เท่านั้น */
export const EPSILON_MM = 1e-6;

export const pxToMm = (px, dpi) => (px * MM_PER_INCH) / dpi;
export const mmToPx = (mm, dpi) => (mm * dpi) / MM_PER_INCH;
export const effectiveDpi = (px, mm) => (px * MM_PER_INCH) / mm;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** ปัดค่าที่ผู้ใช้เห็นเป็นทศนิยม 2 ตำแหน่ง (0.01 มม.) */
export const roundMm = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function formatMm(value) {
  return String(roundMm(value));
}

/** แปลงข้อความจากช่องกรอกเป็นตัวเลข รองรับจุลภาคแทนจุด คืน null เมื่อไม่ใช่ตัวเลข */
export function parseNumberInput(text) {
  const normalized = String(text).trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
