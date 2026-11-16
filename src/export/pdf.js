import { ascii, concat } from './binary.js';
import { MM_PER_INCH } from '../core/units.js';

/**
 * PDF 1.4 สำหรับไฟล์พิมพ์: หนึ่งหน้าต่อหนึ่งภาพ RGB 8 บิต บีบอัด FlateDecode แบบไม่สูญเสีย
 * ขนาดหน้า (MediaBox) เท่ากับกระดาษจริง หน่วย point = มม. × 72 / 25.4 ภาพเต็มหน้าพอดี
 * pages: [{ widthMm, heightMm, image: { width, height, deflated: Uint8Array } }]
 */
const pt = (mm) => Math.round(((mm * 72) / MM_PER_INCH) * 10000) / 10000;

export function buildPdf(pages, { title = 'Print', producer = 'Sticker Layout & Cutline Studio' } = {}) {
  const objects = [];
  const add = (parts) => {
    objects.push(parts);
    return objects.length;
  };
  const clean = (s) => s.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
  const info = add([ascii(`<< /Title (${clean(title)}) /Producer (${clean(producer)}) >>`)]);
  const catalogId = add(null);
  const pagesId = add(null);
  const kids = [];
  for (const page of pages) {
    const { image } = page;
    const w = pt(page.widthMm);
    const h = pt(page.heightMm);
    const imageId = add([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.deflated.length} >>\nstream\n`),
      image.deflated,
      ascii('\nendstream'),
    ]);
    const content = ascii(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    const contentId = add([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('\nendstream')]);
    kids.push(add([ascii(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]));
  }
  objects[catalogId - 1] = [ascii(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)];
  objects[pagesId - 1] = [ascii(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`)];

  const parts = [ascii('%PDF-1.4\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = parts[0].length + parts[1].length;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const head = ascii(`${index + 1} 0 obj\n`);
    const tail = ascii('\nendobj\n');
    for (const p of [head, ...body, tail]) {
      parts.push(p);
      offset += p.length;
    }
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`].join('');
  parts.push(ascii(xref));
  return concat(parts);
}
