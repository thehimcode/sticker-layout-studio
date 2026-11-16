/** เครื่องมือไบต์ที่ใช้ร่วมกันของตัวเขียนไฟล์ ไม่พึ่ง DOM ทดสอบใน Node ได้ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes, start = 0, end = bytes.length, seed = 0) {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function concat(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const encoder = new TextEncoder();
export const utf8 = (text) => encoder.encode(text);

/** ข้อความ ASCII ล้วน เช่นโครงสร้าง PDF ห้ามมีอักขระเกิน 0x7f */
export function ascii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) throw new Error('ข้อความนี้ต้องเป็น ASCII');
    out[i] = c;
  }
  return out;
}

/** zlib (RFC 1950) ตรงกับ FlateDecode ของ PDF ใช้ CompressionStream ของเบราว์เซอร์/Node */
export async function deflate(chunks) {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const done = new Response(stream.readable).arrayBuffer();
  for await (const chunk of chunks) await writer.write(chunk);
  await writer.close();
  return new Uint8Array(await done);
}

export function toBase64(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}
