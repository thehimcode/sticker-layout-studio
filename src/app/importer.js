import { UserError } from '../core/errors.js';
import { readDpi, sniffType } from '../core/image-meta.js';
import { pxToMm } from '../core/units.js';

export const DEFAULT_DPI = 300;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** ถ้าภาพที่ถอดรหัสแล้วรวมเกินค่านี้จะเตือนเรื่องหน่วยความจำ (FR-02.6) */
export const MEMORY_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;

/**
 * ขนาดเริ่มต้นจาก DPI ในไฟล์ (ไม่มีใช้ 300) และย่อตามสัดส่วนถ้าใหญ่กว่าพื้นที่วางงาน
 */
export function initialSize(pixelWidth, pixelHeight, dpi, area) {
  const usedDpi = dpi ?? DEFAULT_DPI;
  const widthMm = pxToMm(pixelWidth, usedDpi);
  const heightMm = pxToMm(pixelHeight, usedDpi);
  const scale = Math.min(1, area.width / widthMm, area.height / heightMm);
  return { widthMm: widthMm * scale, heightMm: heightMm * scale, scaled: scale < 1 };
}

/** อ่านไฟล์เป็นข้อมูลภาพ throw UserError พร้อมสาเหตุที่ผู้ใช้เข้าใจได้ */
export async function readImageFile(file) {
  if (file.size === 0) throw new UserError('file-empty', `${file.name}: ไฟล์ว่างเปล่า`);
  if (file.size > MAX_FILE_BYTES) throw new UserError('file-large', `${file.name}: ไฟล์ใหญ่เกิน 200 MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (type === 'application/pdf' || /\.ai$/i.test(file.name)) {
    throw new UserError('file-not-yet', `${file.name}: เวอร์ชันนี้ยังเปิด PDF และ AI ไม่ได้ ใช้ PNG หรือ JPG ไปก่อน`);
  }
  if (!type) throw new UserError('file-type', `${file.name}: รองรับเฉพาะ PNG และ JPG`);

  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type }));
  } catch {
    throw new UserError('file-corrupt', `${file.name}: เปิดภาพไม่ได้ ไฟล์อาจเสียหายหรือหน่วยความจำไม่พอ`);
  }
  return {
    bitmap,
    blob: new Blob([bytes], { type }),
    mimeType: type,
    sourceType: type === 'image/png' ? 'png' : 'jpeg',
    byteSize: file.size,
    pixelWidth: bitmap.width,
    pixelHeight: bitmap.height,
    sourceDpi: readDpi(bytes, type),
  };
}
