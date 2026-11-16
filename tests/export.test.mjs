import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, deflateSync } from 'node:zlib';
import { art, idGen, near } from './helpers.mjs';
import factory from '../vendor/clipper2/clipper2z.js';
import * as D from '../src/core/document.js';
import * as M from '../src/core/marks.js';
import { buildCutline, DEFAULT_CUTLINE_CONFIG as C } from '../src/core/contour/pipeline.js';
import { readDpi } from '../src/core/image-meta.js';
import { crc32, deflate } from '../src/export/binary.js';
import { setJpegDpi, setPngDpi } from '../src/export/image-dpi.js';
import { makeZip } from '../src/export/zip.js';
import { buildPdf } from '../src/export/pdf.js';
import { cutSvg, combinedSvg, pageCutPaths } from '../src/export/svg-export.js';
import {
  DEFAULT_EXPORT, fileName, hasErrors, preflight, rasterSize, safeName,
} from '../src/export/preflight.js';

let clipper;
before(async () => { clipper = await factory(); });

const circle = (r = 50, c = 50, n = 96) => {
  const p = [];
  for (let i = 0; i < n; i += 1) p.push(c + r * Math.cos((i * 2 * Math.PI) / n), c + r * Math.sin((i * 2 * Math.PI) / n));
  return p;
};

/** แบบวงกลมเส้นผ่านศูนย์กลาง 30 มม. Offset +2 วางที่ x,y */
function docWithCircle(newId, { x = 40, y = 60, rotationDeg = 0 } = {}) {
  const natural = { widthPx: 100, heightPx: 100 };
  let doc = D.addMaster(D.createDocument(), { ...art({ id: 'c', widthMm: 30, heightMm: 30 }), naturalSize: { ...natural, dpi: null } }, newId).doc;
  const cutline = buildCutline(clipper, {
    masterId: 'c', paths: [circle()], natural, sizeMm: { widthMm: 30, heightMm: 30 }, offsetMm: 2, contourMode: 'outer',
  });
  doc = D.setCutline(doc, 'c', { config: { ...C, offsetMm: 2 }, contourPaths: [circle()], cutline });
  const [inst] = doc.instances;
  doc = D.positionInstance(doc, inst.id, x, y).doc;
  if (rotationDeg) doc = D.rotateInstances(doc, [inst.id], () => rotationDeg);
  return doc;
}

const PNG_1PX = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

test('PNG: ฝัง pHYs ตาม DPI และ CRC ถูกต้อง อ่านกลับได้ค่าเดิม', () => {
  for (const dpi of [150, 300, 600]) {
    const out = setPngDpi(PNG_1PX, dpi);
    near(readDpi(out, 'image/png'), dpi, 0.05);
    // ใส่ซ้ำไม่เกิด pHYs สองชุด
    const again = setPngDpi(out, dpi);
    assert.equal(again.length, out.length);
  }
  const at = 33; // ต่อจาก IHDR
  const out = setPngDpi(PNG_1PX, 300);
  const len = new DataView(out.buffer).getUint32(at);
  assert.equal(String.fromCharCode(...out.subarray(at + 4, at + 8)), 'pHYs');
  assert.equal(new DataView(out.buffer).getUint32(at + 8 + len), crc32(out, at + 4, at + 8 + len));
});

test('JPEG: ตั้ง JFIF density เป็น DPI ทั้งไฟล์ที่มีและไม่มี APP0', () => {
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  near(readDpi(setJpegDpi(jfif, 300), 'image/jpeg'), 300);
  const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]);
  near(readDpi(setJpegDpi(bare, 600), 'image/jpeg'), 600);
});

test('Zip แบบ Store: โครงสร้างถูกและอ่านข้อมูลกลับได้ ชื่อไทยเป็น UTF-8', () => {
  const files = [{ name: 'งาน_p01_print.png', data: Uint8Array.from([1, 2, 3]) }, { name: 'b.svg', data: new TextEncoder().encode('<svg/>') }];
  const zip = makeZip(files);
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  let at = 0;
  for (const f of files) {
    assert.equal(view.getUint32(at, true), 0x04034b50);
    const nameLen = view.getUint16(at + 26, true);
    assert.equal(new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen)), f.name);
    const size = view.getUint32(at + 18, true);
    assert.deepEqual([...zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size)], [...f.data]);
    assert.equal(view.getUint32(at + 14, true), crc32(f.data));
    at += 30 + nameLen + size;
  }
});

test('PDF: MediaBox ตามกระดาษจริง xref ชี้ตำแหน่ง obj ถูก ภาพ FlateDecode กลับได้', async () => {
  const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const deflated = await deflate([rgb]);
  assert.deepEqual([...inflateSync(deflated)], [...rgb]);
  const pdf = buildPdf([
    { widthMm: 210, heightMm: 297, image: { width: 2, height: 2, deflated } },
    { widthMm: 210, heightMm: 297, image: { width: 2, height: 2, deflated: deflateSync(rgb) } },
  ], { title: 'ทดสอบ test' });
  const text = Buffer.from(pdf).toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.equal(text.match(/\/MediaBox \[0 0 595\.2756 841\.8898\]/g).length, 2);
  assert.match(text, /\/Count 2/);
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const offsets = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
});

test('AC-11 Cutline SVG: ขนาด มม., viewBox ตรงกระดาษ และพิกัดเส้นตรงกับตำแหน่งภาพ ≤0.1 มม.', () => {
  const newId = idGen();
  for (const rotationDeg of [0, 30]) {
    const doc = docWithCircle(newId, { x: 40, y: 60, rotationDeg });
    const svg = cutSvg(doc, doc.pages[0].id);
    assert.match(svg, /width="210mm" height="297mm" viewBox="0 0 210 297"/);
    assert.match(svg, /<g id="CUT_LINES" fill="none" stroke="#ff00ff"/);
    assert.doesNotMatch(svg, /transform=/, 'เส้นตัดต้องเป็นพิกัดตรง');
    const [{ d }] = pageCutPaths(doc, doc.pages[0].id);
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    // จุดกึ่งกลางภาพ 40+15, 60+15 รัศมีเส้นตัด 15+2 = 17 (Control point ของ Bezier อาจยื่นเล็กน้อย จึงวัดจากจุดปลาย)
    const ends = [];
    for (let i = 0; i < xs.length; i += 1) ends.push([xs[i], ys[i]]);
    const center = [55, 75];
    const anchors = d.split(/[CMZ]/).filter(Boolean).map((seg) => seg.trim().split(/\s+/).map(Number).slice(-2));
    for (const [x, y] of anchors) near(Math.hypot(x - center[0], y - center[1]), 17, 0.1);
    assert.ok(ends.length > 8);
  }
});

test('AC-10 ไฟล์ตัดไม่สั่งตัดมาร์ค: มาร์คอยู่ในกลุ่มอ้างอิงที่ไม่มี stroke เท่านั้น', () => {
  const newId = idGen();
  let doc = docWithCircle(newId);
  doc = M.applyProfile(doc, M.getBuiltinProfile('circle-4'), newId);
  const none = cutSvg(doc, doc.pages[0].id, { marks: 'none' });
  assert.doesNotMatch(none, /mark-/);
  const ref = cutSvg(doc, doc.pages[0].id, { marks: 'reference' });
  const group = ref.slice(ref.indexOf('<g id="REG_MARKS_REFERENCE_NOT_CUT"'));
  assert.match(group, /NOT A CUT LINE/);
  assert.equal((group.match(/<path id="mark-/g) ?? []).length, 4);
  assert.doesNotMatch(group, /stroke="#/);
  const cut = ref.slice(ref.indexOf('<g id="CUT_LINES"'), ref.indexOf('</g>'));
  assert.doesNotMatch(cut, /mark-/);
  const combined = combinedSvg(doc, doc.pages[0].id, { artworkHref: 'data:image/png;base64,AA==' });
  assert.ok(combined.indexOf('id="ARTWORK"') < combined.indexOf('id="CUT_LINES"'));
  assert.ok(combined.indexOf('id="CUT_LINES"') < combined.indexOf('id="REG_MARKS"'));
  assert.match(combined, /<image x="0" y="0" width="210" height="297"/);
});

test('Preflight: ผ่านเมื่องานถูกต้อง และจับ Overlap, เส้นตัดรอคำนวณ, มาร์คยังไม่ยืนยัน, ภาพใหญ่เกิน', () => {
  const newId = idGen();
  let doc = docWithCircle(newId);
  let checks = preflight(doc, DEFAULT_EXPORT);
  assert.equal(hasErrors(checks), false, JSON.stringify(checks));
  assert.ok(checks.some((c) => c.topic === 'Marks' && c.level === 'warning'), 'ไม่มีมาร์คแต่จะใส่ในไฟล์พิมพ์');

  doc = D.setQuantity(doc, 'c', 2, newId).doc;
  const [a, b] = doc.instances;
  doc = { ...doc, instances: [a, { ...b, transform: { ...a.transform } }] };
  checks = preflight(doc, DEFAULT_EXPORT);
  assert.ok(checks.some((c) => c.topic === 'Overlap' && c.level === 'error'));

  const stale = D.resizeMaster(docWithCircle(newId), 'c', 31, 31);
  assert.ok(preflight(stale, DEFAULT_EXPORT).some((c) => c.topic === 'เส้นตัด' && c.level === 'error'));

  const marked = M.applyProfile(docWithCircle(newId), M.getBuiltinProfile('microcut30q-5dots'), newId);
  assert.ok(preflight(marked, DEFAULT_EXPORT).some((c) => c.topic === 'Marks' && /ยังไม่ยืนยัน/.test(c.text)));

  const a0 = D.setPaper(docWithCircle(newId), { preset: 'A0', orientation: 'portrait' });
  assert.ok(preflight(a0, { ...DEFAULT_EXPORT, dpi: 600 }).some((c) => c.topic === 'หน่วยความจำ' && c.level === 'error'));
  assert.ok(preflight(a0, { ...DEFAULT_EXPORT, dpi: 300 }).some((c) => c.topic === 'หน่วยความจำ' && c.level === 'warning'));
  assert.ok(hasErrors(preflight(doc, {
    ...DEFAULT_EXPORT, png: false, cutSvg: false,
  })));
});

test('ขนาดภาพตาม DPI และชื่อไฟล์สม่ำเสมอ', () => {
  assert.deepEqual(rasterSize({ widthMm: 210, heightMm: 297 }, 300), { width: 2480, height: 3508 });
  assert.equal(fileName(safeName('งาน ร้าน/A'), 0, 'print', 'png'), 'งาน_ร้าน_A_p01_print.png');
  assert.equal(fileName('x', 11, 'cut', 'svg'), 'x_p12_cut.svg');
  assert.equal(fileName('x', null, 'print-marks', 'pdf'), 'x_print-marks.pdf');
  assert.equal(safeName('  '), 'sticker-layout');
});
