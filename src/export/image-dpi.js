import { ascii, concat, crc32 } from './binary.js';
import { MM_PER_INCH } from '../core/units.js';

/**
 * ฝังค่า DPI ลงไฟล์ภาพ ให้โปรแกรมพิมพ์เปิดแล้วได้ขนาดจริงตามเอกสาร
 * Canvas.toBlob ไม่ใส่ค่านี้ให้ (PNG ไม่มี pHYs, JPEG ตั้ง density เป็น 1:1 ไม่มีหน่วย)
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** แทรก pHYs หลัง IHDR (ลบ pHYs เดิมถ้ามี) หน่วยเป็นพิกเซลต่อเมตร */
export function setPngDpi(bytes, dpi) {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error('ไม่ใช่ไฟล์ PNG');
  const ppm = Math.round((dpi / MM_PER_INCH) * 1000);
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  data[8] = 1;
  const parts = [bytes.subarray(0, 8)];
  let at = 8;
  while (at < bytes.length) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (type !== 'pHYs') parts.push(bytes.subarray(at, end));
    if (type === 'IHDR') parts.push(chunk('pHYs', data));
    at = end;
  }
  return concat(parts);
}

/** ตั้งค่า density ของ JFIF APP0 เป็น dots per inch ถ้าไม่มี APP0 จะแทรกให้ */
export function setJpegDpi(bytes, dpi) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('ไม่ใช่ไฟล์ JPEG');
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const out = new Uint8Array(bytes);
  const isJfif = out[2] === 0xff && out[3] === 0xe0 && String.fromCharCode(...out.subarray(6, 11)) === 'JFIF\0';
  if (isJfif) {
    out[13] = 1;
    out[14] = d >> 8;
    out[15] = d & 0xff;
    out[16] = d >> 8;
    out[17] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, d >> 8, d & 0xff, d >> 8, d & 0xff, 0x00, 0x00]);
  return concat([out.subarray(0, 2), app0, out.subarray(2)]);
}
