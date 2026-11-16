import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import factory from '../vendor/clipper2/clipper2z.js';
import { alphaMask, colorMask, detectBackground, removeNoise } from '../src/core/contour/mask.js';
import { traceContours } from '../src/core/contour/trace.js';
import {
  countSelfIntersections, pathsBounds, signedArea, simplifyLoop, smoothLoop,
} from '../src/core/contour/path.js';
import { analyzeContours, buildCutline, DEFAULT_CUTLINE_CONFIG as C } from '../src/core/contour/pipeline.js';
import { cutlineSvg, toCurveData, toPathData } from '../src/core/contour/svg.js';
import { curveSegments, fairLoop, fitClosedCurve, flattenCurve } from '../src/core/contour/bezier.js';
import * as D from '../src/core/document.js';
import { validateDocument } from '../src/core/validate.js';
import { Store } from '../src/app/store.js';
import { art, idGen } from './helpers.mjs';

let clipper;
before(async () => { clipper = await factory(); });

/** สร้างภาพ RGBA จากฟังก์ชัน inside(x, y) พิกัดพิกเซล ใช้ Supersampling ที่ขอบ */
function raster(width, height, inside, { fg = [20, 90, 200], bg = null } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on = inside(x + 0.5, y + 0.5);
      const i = (y * width + x) * 4;
      const rgb = on ? fg : (bg ?? [0, 0, 0]);
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
      data[i + 3] = on || bg ? 255 : 0;
    }
  }
  return { data, width, height };
}
const nat = (r) => ({ widthPx: r.width, heightPx: r.height });
function cut(r, sizeMm, over = {}) {
  const config = { ...C, ...over };
  const { paths, warnings } = analyzeContours(r, nat(r), config);
  return {
    warnings,
    paths,
    cutline: buildCutline(clipper, {
      masterId: 'm', paths, natural: nat(r), sizeMm, offsetMm: config.offsetMm, contourMode: config.contourMode, cornerRadiusMm: config.cornerRadiusMm, fairingMm: config.fairingMm,
    }),
  };
}
function* points(paths) { for (const p of paths) for (let i = 0; i < p.length; i += 2) yield [p[i], p[i + 1]]; }
const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const distToPolygon = (px, py, poly) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const [a, b] = poly[i]; const [c, d] = poly[(i + 1) % poly.length];
    best = Math.min(best, distToSegment(px, py, a, b, c, d));
  }
  return best;
};

// ภาพทดสอบ AC-06 ใช้ 1200 px ต่อ 100 มม. (ราว 305 DPI) ใกล้เคียงงานพิมพ์จริง
const HI = 1200;
const S = HI / 100; // px ต่อ มม.
const size100 = { widthMm: 100, heightMm: 100 };
// วงกลมรัศมี 40 มม.
const disc = () => raster(HI, HI, (x, y) => Math.hypot(x - 50 * S, y - 50 * S) <= 40 * S);
// สี่เหลี่ยมด้าน 60 มม.
const square = () => raster(HI, HI, (x, y) => x >= 20 * S && x <= 80 * S && y >= 20 * S && y <= 80 * S);
// ภาพเล็กสำหรับทดสอบกลไก ไม่ใช้วัดความแม่นยำ
const smallDisc = () => raster(200, 200, (x, y) => Math.hypot(x - 100, y - 100) <= 80);

test('alphaMask ใช้ Threshold ที่ปรับได้', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 10, 0, 0, 0, 200]);
  assert.deepEqual([...alphaMask(data, 2, 1, 128)], [0, 1]);
  assert.deepEqual([...alphaMask(data, 2, 1, 5)], [1, 1]);
});

test('traceContours: ขอบนอกพื้นที่บวก รูพื้นที่ลบ พื้นที่ตรงจำนวนพิกเซล', () => {
  const m = new Uint8Array(100).fill(0);
  for (let y = 2; y < 8; y += 1) for (let x = 2; x < 8; x += 1) m[y * 10 + x] = 1;
  m[4 * 10 + 4] = 0; m[4 * 10 + 5] = 0; m[5 * 10 + 4] = 0; m[5 * 10 + 5] = 0;
  const loops = traceContours(m, 10, 10);
  assert.equal(loops.length, 2);
  const areas = loops.map(signedArea).sort((a, b) => a - b);
  assert.ok(areas[0] < 0 && areas[1] > 0);
  near(areas[0] + areas[1], 32 - 2, 2.5);
});

test('traceContours: ทุกเส้นปิด จุดกระโดดไม่เกิน 1 พิกเซล', () => {
  const r = smallDisc();
  const [loop] = traceContours(alphaMask(r.data, 200, 200, 128), 200, 200);
  for (let i = 0; i < loop.length; i += 2) {
    const j = (i + 2) % loop.length;
    assert.ok(Math.hypot(loop[j] - loop[i], loop[j + 1] - loop[i + 1]) <= 1.01);
  }
});

test('แนวทแยงแตะมุม (saddle) ไม่ทำให้เส้นขาด', () => {
  const m = Uint8Array.from([1, 0, 0, 1]);
  assert.equal(traceContours(m, 2, 2).length, 2);
});

test('removeNoise ลบจุดเล็กและอุดรูเล็ก ไม่แตะพื้นหลังที่ต่อกับขอบ', () => {
  const m = new Uint8Array(400);
  for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) m[y * 20 + x] = 1;
  m[10 * 20 + 10] = 0;
  m[1 * 20 + 1] = 1;
  const parts = removeNoise(m, 20, 20, 4);
  assert.equal(parts, 1);
  assert.equal(m[10 * 20 + 10], 1);
  assert.equal(m[21], 0);
  assert.equal(m[0], 0);
});

test('smoothLoop ไม่ทำให้วงกลมหด และ simplify อยู่ในค่าคลาดเคลื่อน', () => {
  const r = smallDisc();
  const [loop] = traceContours(alphaMask(r.data, 200, 200, 128), 200, 200);
  const s = smoothLoop(loop, 5);
  near(Math.abs(signedArea(s)) / Math.abs(signedArea(loop)), 1, 0.01);
  const simple = simplifyLoop(s, 0.5);
  assert.ok(simple.length < s.length / 3);
  const poly = [];
  for (let i = 0; i < simple.length; i += 2) poly.push([simple[i], simple[i + 1]]);
  for (const [x, y] of points([s])) assert.ok(distToPolygon(x, y, poly) <= 0.51);
});

test('AC-06 Circle: Offset +2 มม. ทุกจุดห่างจากวงกลมจริงในเกณฑ์ ≤0.1 มม.', () => {
  const { cutline } = cut(disc(), size100);
  assert.equal(cutline.closedPaths.length, 1);
  for (const [x, y] of points(cutline.closedPaths)) near(Math.hypot(x - 50, y - 50), 42, 0.1);
  assert.equal(cutline.issues.filter((i) => i.severity === 'error').length, 0);
});

test('AC-06 Square: Offset +2 มม. ระยะจากรูปสี่เหลี่ยมจริงในเกณฑ์ ≤0.1 มม.', () => {
  const { cutline } = cut(square(), size100, { smooth: 0 });
  const poly = [[20, 20], [80, 20], [80, 80], [20, 80]];
  for (const [x, y] of points(cutline.closedPaths)) near(distToPolygon(x, y, poly), 2, 0.1);
  const b = pathsBounds(cutline.closedPaths);
  near(b.width, 64, 0.1); near(b.height, 64, 0.1);
});

test('Offset ลบ: หดเข้า 3 มม. ตามเรขาคณิต', () => {
  const { cutline } = cut(disc(), size100, { offsetMm: -3 });
  for (const [x, y] of points(cutline.closedPaths)) near(Math.hypot(x - 50, y - 50), 37, 0.1);
});

test('ไม่ใช่การ Scale: Offset ของสี่เหลี่ยมเพิ่มเท่ากันทุกด้าน แม้ภาพไม่จัตุรัส', () => {
  const r = raster(300, 100, (x, y) => x >= 50 && x <= 250 && y >= 25 && y <= 75);
  const { cutline } = cut(r, { widthMm: 150, heightMm: 50 }, { smooth: 0 });
  const b = pathsBounds(cutline.closedPaths);
  near(b.width, 104, 0.1);
  near(b.height, 29, 0.1);
});

test('FR-04.8 แก้ขนาดแล้วคำนวณใหม่: Offset ยังเป็น 2 มม. ไม่โตตามภาพ', () => {
  const r = disc();
  // ขยายสองเท่าจึงเหลือ 6 px ต่อ มม. เกณฑ์ขึ้นกับความละเอียดภาพ
  const { paths } = analyzeContours(r, nat(r), C);
  const big = buildCutline(clipper, {
    masterId: 'm', paths, natural: nat(r), sizeMm: { widthMm: 200, heightMm: 200 }, offsetMm: 2, contourMode: 'outer',
  });
  for (const [x, y] of points(big.closedPaths)) near(Math.hypot(x - 100, y - 100), 82, 0.2);
});

test('FR-04.8 ขนาดไม่เท่ากันแกน X/Y แปลงจากพิกเซลถูกต้อง', () => {
  const r = disc();
  const { cutline } = cut(r, { widthMm: 200, heightMm: 100 }, { offsetMm: 0 });
  const b = pathsBounds(cutline.closedPaths);
  near(b.width, 160, 0.3); near(b.height, 80, 0.3);
});

test('วิเคราะห์จากภาพย่อแล้วคืนพิกัดภาพเต็ม', () => {
  const r = smallDisc();
  const natural = { widthPx: 2000, heightPx: 2000 };
  const { paths } = analyzeContours(r, natural, C);
  const b = pathsBounds(paths);
  near(b.width, 1600, 10);
});

test('AC-05 รูปเว้า: เส้นตามรูปทรง ไม่ใช่สี่เหลี่ยมครอบ', () => {
  // รูปตัว C: วงแหวนมีช่องเปิดทางขวา
  const r = raster(200, 200, (x, y) => {
    const d = Math.hypot(x - 100, y - 100);
    return d <= 80 && d >= 45 && !(x > 100 && Math.abs(y - 100) < 22);
  });
  const { cutline } = cut(r, size100, { offsetMm: 1, cornerRadiusMm: 0.5 });
  assert.equal(cutline.closedPaths.length, 1);
  const [path] = cutline.closedPaths;
  assert.ok(path.length / 2 > 30, 'ต้องมีหลายจุดตามรูปทรง');
  const b = pathsBounds(cutline.closedPaths);
  const area = Math.abs(signedArea(path));
  assert.ok(area < b.width * b.height * 0.72, 'พื้นที่ต้องน้อยกว่ากรอบครอบมาก');
  assert.equal(cutline.issues.filter((i) => i.code === 'self-intersect').length, 0);
});

test('รูปเว้าแคบ: Offset ใหญ่ปิดช่องโดยไม่เกิดเส้นซ้อนตัวเอง', () => {
  const r = raster(200, 200, (x, y) => (x >= 20 && x <= 180 && y >= 20 && y <= 180) && !(y > 40 && y < 160 && x > 90 && x < 104));
  const { cutline } = cut(r, size100, { offsetMm: 5 });
  assert.equal(countSelfIntersections(cutline.closedPaths), 0);
  assert.equal(cutline.closedPaths.length, 1);
});

test('FR-04.3 โหมด: outer ไม่มีรู, all มีรู, merged รวมชิ้นส่วนแยกเป็นเส้นเดียว', () => {
  const ring = raster(HI, HI, (x, y) => { const d = Math.hypot(x - 50 * S, y - 50 * S); return d <= 40 * S && d >= 20 * S; });
  assert.equal(cut(ring, size100, { contourMode: 'outer' }).cutline.closedPaths.length, 1);
  const all = cut(ring, size100, { contourMode: 'all', offsetMm: 1 }).cutline;
  assert.equal(all.closedPaths.length, 2);
  // รูหดเล็กลงเมื่อ Offset บวก: รัศมี 20 มม. เหลือ 19 มม.
  const hole = all.closedPaths.find((p) => signedArea(p) < 0);
  for (const [x, y] of points([hole])) near(Math.hypot(x - 50, y - 50), 19, 0.1);

  const two = raster(200, 100, (x, y) => Math.hypot(x - 50, y - 50) <= 30 || Math.hypot(x - 150, y - 50) <= 30);
  const sized = { widthMm: 100, heightMm: 50 };
  assert.equal(cut(two, sized, { contourMode: 'outer' }).cutline.closedPaths.length, 2);
  const merged = cut(two, sized, { contourMode: 'merged', offsetMm: 0 }).cutline;
  assert.equal(merged.closedPaths.length, 1);
  // เส้นรวมต้องคลุมทั้งสองชิ้น และไม่ใช่กรอบสี่เหลี่ยมเต็มรูป
  near(pathsBounds(merged.closedPaths).width, 80, 0.8);
  assert.ok(Math.abs(signedArea(merged.closedPaths[0])) < 80 * 30 * 0.97);
});

test('Offset ลบมากจนหมด: เป็น error ไม่ใช่ผลเทียม', () => {
  const { cutline } = cut(disc(), size100, { offsetMm: -60 });
  assert.equal(cutline.closedPaths.length, 0);
  assert.equal(cutline.envelopeMm, null);
  assert.ok(cutline.issues.some((i) => i.code === 'empty-path' && i.severity === 'error'));
});

test('ตรวจเส้นซ้อนตัวเอง และ Contour ที่แก้จนไขว้กันถูกรวมพร้อมแจ้งเตือน', () => {
  const bowtie = [0, 0, 10, 10, 10, 0, 0, 10];
  assert.equal(countSelfIntersections([bowtie]), 1);
  assert.equal(countSelfIntersections([[0, 0, 10, 0, 10, 10, 0, 10]]), 0);
  const c = buildCutline(clipper, {
    masterId: 'm', paths: [[0, 0, 100, 100, 100, 0, 0, 100]], natural: { widthPx: 100, heightPx: 100 }, sizeMm: { widthMm: 50, heightMm: 50 }, offsetMm: 1, contourMode: 'outer',
  });
  assert.ok(c.issues.some((i) => i.code === 'contour-self-intersect'));
  assert.equal(countSelfIntersections(c.closedPaths), 0);
});

test('FR-04.2 JPG พื้นทึบ: แยกด้วยสี สีเดียวกันกลางชิ้นงานไม่หาย', () => {
  const r = raster(100, 100, (x, y) => x >= 20 && x <= 80 && y >= 20 && y <= 80, { fg: [30, 30, 200], bg: [250, 250, 250] });
  for (let y = 45; y < 55; y += 1) for (let x = 45; x < 55; x += 1) { const i = (y * 100 + x) * 4; r.data[i] = 250; r.data[i + 1] = 250; r.data[i + 2] = 250; }
  assert.deepEqual(detectBackground(r.data, 100, 100), [250, 250, 250]);
  const mask = colorMask(r.data, 100, 100, [250, 250, 250], 20);
  assert.equal(mask[50 * 100 + 50], 1);
  assert.equal(mask[0], 0);
  const { cutline, warnings } = cut(r, { widthMm: 50, heightMm: 50 }, { maskMode: 'color', offsetMm: 0, smooth: 0 });
  const b = pathsBounds(cutline.closedPaths);
  near(b.width, 30, 0.6);
  assert.ok(warnings.some((w) => w.code === 'color-uncertain'));
});

test('AC-14 ภาพไม่มี Alpha: เตือนชัด ไม่อ้างว่าแม่นยำ', () => {
  const r = raster(50, 50, () => true, { bg: [255, 255, 255] });
  const { warnings } = analyzeContours(r, nat(r), C);
  assert.ok(warnings.some((w) => w.code === 'no-alpha'));
  const empty = raster(50, 50, () => false);
  const res = analyzeContours(empty, nat(empty), C);
  assert.equal(res.paths.length, 0);
  assert.ok(res.warnings.some((w) => w.code === 'empty-mask'));
});

test('SVG เป็น Path ปิดจริง อยู่ในกลุ่ม CUT_LINES และขนาดเป็น มม.', () => {
  const { cutline } = cut(disc(), size100);
  const svg = cutlineSvg(cutline, 'a<b>.png');
  assert.match(svg, /<g id="CUT_LINES"/);
  near(Number(svg.match(/width="([\d.]+)mm"/)[1]), 84, 0.1);
  assert.match(svg, /<path d="M/);
  assert.doesNotMatch(svg, /<rect|<image|a<b>/);
  assert.equal(toPathData([[0, 0, 1.23456, 0, 1, 1]]), 'M0 0 L1.235 0 L1 1 Z');
  assert.doesNotMatch(svg, / L/);
  assert.match(svg, / ?C[\d.-]+ /);
  assert.equal(toCurveData(cutline.curves).match(/Z/g).length, cutline.closedPaths.length);
});

test('ทำซ้ำ 200 รอบ หน่วยความจำ WASM ไม่โตตามรอบ', () => {
  const r = smallDisc();
  const { paths } = analyzeContours(r, nat(r), C);
  const run = () => buildCutline(clipper, { masterId: 'm', paths, natural: nat(r), sizeMm: size100, offsetMm: 2, contourMode: 'outer' });
  for (let i = 0; i < 20; i += 1) run();
  const heap = clipper.HEAPU8.length;
  for (let i = 0; i < 200; i += 1) run();
  assert.equal(clipper.HEAPU8.length, heap);
});

const withCutline = (offsetMm = 2) => {
  const newId = idGen();
  const { doc } = D.addMaster(D.createDocument(), art({ widthMm: 100, heightMm: 100 }), newId);
  const r = smallDisc();
  const { paths } = analyzeContours(r, nat(r), C);
  const natural = nat(r);
  const master = { ...doc.masters[0], naturalSize: natural };
  const cutline = buildCutline(clipper, {
    masterId: 'a1', paths, natural, sizeMm: master.desiredSizeMm, offsetMm, contourMode: 'outer',
  });
  const base = { ...doc, masters: [master] };
  return { doc: D.setCutline(base, 'a1', { config: { ...C, offsetMm }, contourPaths: paths, cutline }), paths, natural };
};

test('FR-08.3 Envelope รวมเส้นตัด: ลากชิดขอบแล้วเส้นตัดยังอยู่ในพื้นที่', () => {
  const { doc } = withCutline(2);
  const moved = D.positionInstance(doc, doc.instances[0].id, -100, -100).doc;
  const bounds = D.boundsOf(moved, moved.instances[0]);
  near(bounds.x, 5, 1e-6);
  // วงกลมอยู่ในกรอบภาพ และ +2 มม. ยังไม่เกินภาพมาก จึงตรวจจากด้านที่ยื่นจริงด้วยภาพที่เต็มกรอบ
  assert.equal(validateDocument(moved).outside.size, 0);
});

test('FR-08.3 เส้นตัดยื่นเกินภาพ: Envelope กันขอบตามระยะจริงทุกด้าน', () => {
  const master = {
    desiredSizeMm: { widthMm: 40, heightMm: 40 },
    cutline: { envelopeMm: { x: -2, y: -3, width: 45, height: 46 }, sizeMm: { widthMm: 40, heightMm: 40 } },
  };
  assert.deepEqual(D.localEnvelope(master), { x: -2, y: -3, width: 45, height: 46 });
  assert.deepEqual(D.localEnvelope(master, { widthMm: 80, heightMm: 10 }), { x: -2, y: -3, width: 85, height: 16 });
  assert.deepEqual(D.localEnvelope({ desiredSizeMm: { widthMm: 5, heightMm: 6 }, cutline: null }), { x: 0, y: 0, width: 5, height: 6 });
});

test('FR-08.5 ใส่เส้นตัดที่ล้นพื้นที่: ไม่ย้าย แต่แจ้งชิ้นที่ไม่ถูกต้อง', () => {
  const newId = idGen();
  const { doc } = D.addMaster(D.createDocument(), art({ widthMm: 100, heightMm: 100 }), newId);
  const before = doc.instances[0].transform;
  const cutline = { closedPaths: [[0, 0, 1, 0, 1, 1]], envelopeMm: { x: -9, y: -9, width: 118, height: 118 }, sizeMm: { widthMm: 100, heightMm: 100 }, issues: [], stale: false, offsetMm: 9 };
  const next = D.setCutline(doc, 'a1', { config: C, contourPaths: [], cutline });
  assert.equal(next.instances[0].transform, before);
  assert.equal(validateDocument(next).outside.size, 1);
  assert.equal(validateDocument(D.pullInside(next).doc).outside.size, 0);
});

test('FR-04.8 แก้ขนาดแล้วเส้นตัดเดิมถูกทำเครื่องหมาย stale ไม่ถูก Scale', () => {
  const { doc } = withCutline(2);
  const original = doc.masters[0].cutline;
  const r = D.resizeMaster(doc, 'a1', 50, 50);
  assert.equal(r.masters[0].cutline.stale, true);
  assert.equal(r.masters[0].cutline.closedPaths, original.closedPaths);
  assert.equal(doc.masters[0].cutline.stale, false);
});

test('คำนวณเส้นตัดใหม่ไม่เพิ่มขั้น Undo และ Undo กลับเส้นของขนาดเดิม', () => {
  const { doc, paths, natural } = withCutline(2);
  const s = new Store(doc);
  s.commit(D.resizeMaster(s.doc, 'a1', 50, 50));
  const past = s.past.length;
  const fresh = buildCutline(clipper, {
    masterId: 'a1', paths, natural, sizeMm: { widthMm: 50, heightMm: 50 }, offsetMm: 2, contourMode: 'outer',
  });
  assert.equal(s.amend(D.refreshCutline(s.doc, 'a1', fresh)), true);
  assert.equal(s.past.length, past);
  assert.equal(s.doc.masters[0].cutline.stale, false);
  assert.equal(s.doc.masters[0].cutline.geometryVersion, 2);
  s.undo();
  assert.equal(s.doc, doc);
  s.preview(s.doc);
  assert.equal(s.amend(s.doc), false);
  s.cancelPreview();
});

test('clearCutline ลบข้อมูลเส้นตัดทั้งหมด และ Undo กลับได้', () => {
  const { doc } = withCutline(2);
  const s = new Store(doc);
  s.commit(D.clearCutline(s.doc, 'a1'));
  assert.equal(s.doc.masters[0].cutline, null);
  assert.equal(s.doc.masters[0].contours, null);
  s.undo();
  assert.ok(s.doc.masters[0].cutline);
});

test('เตือนเมื่อความละเอียดภาพทำให้เส้นคลาดเกินเกณฑ์ 0.1 มม.', () => {
  const low = cut(smallDisc(), size100).cutline;
  assert.ok(low.issues.some((i) => i.code === 'low-resolution'));
  const fine = cut(disc(), size100).cutline;
  assert.equal(fine.issues.some((i) => i.code === 'low-resolution'), false);
  const capped = buildCutline(clipper, {
    masterId: 'm', paths: [[0, 0, 100, 0, 100, 100]], natural: { widthPx: 8000, heightPx: 8000 }, sizeMm: { widthMm: 297, heightMm: 297 }, offsetMm: 0, contourMode: 'outer',
  });
  assert.ok(capped.issues.some((i) => i.code === 'low-resolution'));
});

/** มุมหักสูงสุด (องศา) ของเส้น วัดตามระยะทางจริงทุก step มม. รอบเส้นปิด */
function maxKinkDeg(path, step = 0.5) {
  const { points } = (() => { const n = path.length / 2; let perim = 0; for (let i = 0; i < n; i += 1) { const j = (i + 1) % n; perim += Math.hypot(path[j * 2] - path[i * 2], path[j * 2 + 1] - path[i * 2 + 1]); } const count = Math.round(perim / step); const pts = []; let seg = 0; let walked = 0; for (let k = 0; k < count; k += 1) { const target = (k * perim) / count; for (;;) { const j = (seg + 1) % n; const l = Math.hypot(path[j * 2] - path[seg * 2], path[j * 2 + 1] - path[seg * 2 + 1]); if (walked + l >= target || seg === n - 1) { const t = l ? Math.min(1, (target - walked) / l) : 0; pts.push([path[seg * 2] + (path[j * 2] - path[seg * 2]) * t, path[seg * 2 + 1] + (path[j * 2 + 1] - path[seg * 2 + 1]) * t]); break; } walked += l; seg += 1; } } return { points: pts }; })();
  let worst = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[(i + n - 1) % n]; const b = points[i]; const c = points[(i + 1) % n];
    const d1 = Math.atan2(b[1] - a[1], b[0] - a[0]); const d2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(d1 - d2) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  return worst;
}

// จำลองภาพจริงความละเอียดต่ำ 0.19 มม./px: ตัวการ์ตูนมีรอยเว้าลึกและรายละเอียดตามขอบ
const lobed = () => {
  const W = 400;
  return raster(W, 400, (x, y) => {
    const body = Math.hypot((x - 200) / 150, (y - 210) / 170) <= 1;
    const ear1 = Math.hypot(x - 110, y - 70) <= 45;
    const ear2 = Math.hypot(x - 290, y - 70) <= 45;
    const leg = Math.abs(x - 330) < 22 && y > 200 && y < 395;
    const notch = Math.abs(y - 300) < 2.5 + Math.abs(x - 352) * 0.35 && x > 330;
    return (body || ear1 || ear2 || leg) && !notch;
  });
};
const size76 = { widthMm: 76, heightMm: 76 };

test('เส้นจริงไม่มีมุมหัก: มุมเว้าถูกลบมน มุมหักทุก 0.5 มม. ไม่เกิน 22°', () => {
  const { cutline } = cut(lobed(), size76);
  assert.equal(cutline.closedPaths.length, 1);
  const kink = maxKinkDeg(cutline.closedPaths[0]);
  assert.ok(kink < 22, `มุมหัก ${kink.toFixed(1)}°`);
});

test('ตัวปรับความมนมีผลจริง: มุมเล็กกว่าเดิมอย่างชัดเจนเทียบกับปิดการลบมุม', () => {
  const sharp = cut(lobed(), size76, { cornerRadiusMm: 0, fairingMm: 0 }).cutline;
  const round = cut(lobed(), size76, { cornerRadiusMm: 3 }).cutline;
  assert.ok(maxKinkDeg(sharp.closedPaths[0]) > maxKinkDeg(round.closedPaths[0]) * 2);
});

test('เส้นโค้งใช้ช่วงน้อยกว่าการต่อจุดมาก และต่อเนื่องที่รอยต่อ', () => {
  const { cutline } = cut(lobed(), size76);
  const curve = cutline.curves[0];
  const segments = curveSegments(curve);
  assert.ok(segments < 80, `${segments} ช่วง`);
  assert.ok(segments < cutline.closedPaths[0].length / 2 / 5);
  let worst = 0;
  const n = segments;
  for (let i = 0; i < n; i += 1) {
    const end = 2 + i * 6;
    const nextStart = i === n - 1 ? 2 : end + 6;
    const hx = curve[end + 4]; const hy = curve[end + 5];
    const inA = Math.atan2(hy - curve[end + 3], hx - curve[end + 2]);
    const outA = Math.atan2(curve[nextStart + 1] - hy, curve[nextStart] - hx);
    let d = Math.abs(inA - outA) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  assert.ok(worst < 2, `รอยต่อหัก ${worst.toFixed(2)}°`);
});

test('เส้นโค้งไม่กินเข้าหาภาพ: ทุกจุดห่างจากขอบวงกลมไม่ต่ำกว่า Offset เกิน 0.1 มม.', () => {
  const { cutline } = cut(disc(), size100, { cornerRadiusMm: 5 });
  for (const [x, y] of points(cutline.closedPaths)) assert.ok(Math.hypot(x - 50, y - 50) >= 41.9);
});

test('Closing ไม่กินงาน: Offset +2 ไม่ทำให้เส้นเข้าใกล้สี่เหลี่ยมเกิน 0.1 มม. แม้ตั้งมุมมน 10 มม.', () => {
  const { cutline } = cut(square(), size100, { cornerRadiusMm: 10 });
  const poly = [[20, 20], [80, 20], [80, 80], [20, 80]];
  for (const [x, y] of points(cutline.closedPaths)) assert.ok(distToPolygon(x, y, poly) >= 1.9);
});

test('Offset ลบ: ยังได้มุมมน เส้นไม่ขาดเป็นหลายชิ้นเพราะการลบมุม', () => {
  const { cutline } = cut(square(), size100, { offsetMm: -2, cornerRadiusMm: 3, smooth: 0 });
  assert.equal(cutline.closedPaths.length, 1);
  assert.ok(maxKinkDeg(cutline.closedPaths[0]) < 15);
});

test('fitClosedCurve ไม่เกินค่าคลาดเคลื่อน และ flatten ได้จุดในระยะนั้น', () => {
  const circle = [];
  for (let i = 0; i < 720; i += 1) circle.push(30 * Math.cos(i * Math.PI / 360), 30 * Math.sin(i * Math.PI / 360));
  const fair = fairLoop(circle, 0.3);
  const curve = fitClosedCurve(fair, 0.03);
  assert.ok(curveSegments(curve) <= 16);
  const flat = flattenCurve(curve);
  for (let i = 0; i < flat.length; i += 2) near(Math.hypot(flat[i], flat[i + 1]), 30, 0.05);
});

test('มุมจริงที่ตั้งใจคงไว้: ปิดลบมุมและความเรียบ สี่เหลี่ยมยังมีมุมเหลี่ยม', () => {
  const path = [0, 0, 40, 0, 40, 40, 0, 40];
  const curve = fitClosedCurve(fairLoop(path, 0), 0.03);
  const flat = flattenCurve(curve);
  let far = 0;
  for (let i = 0; i < flat.length; i += 2) far = Math.max(far, Math.hypot(flat[i] - 20, flat[i + 1] - 20));
  near(far, Math.hypot(20, 20), 0.2);
});

test('งานรุ่นก่อนไม่มีเส้นโค้ง ถูกตรวจว่าต้องคำนวณใหม่', () => {
  assert.equal(D.needsCutlineRefresh({ cutline: { stale: false, closedPaths: [] } }), true);
  assert.equal(D.needsCutlineRefresh({ cutline: { stale: false, curves: [], shapes: null } }), false);
  assert.equal(D.needsCutlineRefresh({ cutline: null }), false);
});
