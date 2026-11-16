/**
 * อ่านชนิดไฟล์จาก magic bytes และ DPI จาก metadata
 * ไม่เชื่อนามสกุลไฟล์ เพราะขนาดพิมพ์จริงต้องมาจากข้อมูลในไฟล์
 */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffType(bytes) {
  if (PNG_SIG.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  return null;
}

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function pngDpi(bytes) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'pHYs' && length >= 9 && offset + 17 <= bytes.length) {
      const ppu = u32(bytes, offset + 8);
      return bytes[offset + 16] === 1 && ppu > 0 ? ppu * 0.0254 : null;
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}

function jpegDpi(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = u16(bytes, offset + 2);
    if (marker === 0xe0 && length >= 14
      && String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'JFIF') {
      const units = bytes[offset + 11];
      const density = u16(bytes, offset + 12);
      if (!density) return null;
      if (units === 1) return density;
      if (units === 2) return density * 2.54;
      return null;
    }
    offset += 2 + length;
  }
  return null;
}

/** คืน DPI หรือ null เมื่อไฟล์ไม่ระบุ */
export function readDpi(bytes, type) {
  const dpi = type === 'image/png' ? pngDpi(bytes) : type === 'image/jpeg' ? jpegDpi(bytes) : null;
  return dpi && dpi >= 1 ? Math.round(dpi * 100) / 100 : null;
}
