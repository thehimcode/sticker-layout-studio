import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import {
  applyMatrix, containDelta, invert, multiply, placementBounds, placementCorners, placementMatrix,
  pointInPlacement, rectContains, rectsOverlap, resizeFromHandle,
} from '../src/core/geometry.js';
import { effectiveDpi, formatMm, mmToPx, parseNumberInput, pxToMm } from '../src/core/units.js';
import { fitView, paperToScreen, rulerStep, screenToPaper, zoomAt } from '../src/core/viewport.js';

const size = { widthMm: 40, heightMm: 20 };

test('แปลงหน่วย: 300 px @300 DPI = 25.4 มม. และกลับค่าได้', () => {
  near(pxToMm(300, 300), 25.4);
  near(mmToPx(25.4, 300), 300);
  near(mmToPx(pxToMm(1234, 600), 600), 1234);
  near(effectiveDpi(600, 50.8), 300);
});

test('parseNumberInput รับจุลภาค ปฏิเสธข้อความ', () => {
  assert.equal(parseNumberInput(' 12,5 '), 12.5);
  assert.equal(parseNumberInput('-3'), -3);
  assert.equal(parseNumberInput('.5'), 0.5);
  for (const bad of ['', 'abc', '1e5', '1.2.3', 'Infinity']) assert.equal(parseNumberInput(bad), null);
});

test('formatMm ปัด 2 ตำแหน่ง', () => {
  assert.equal(formatMm(1.005), '1.01');
  assert.equal(formatMm(50.8), '50.8');
});

test('เมทริกซ์ไม่หมุน: เลื่อนอย่างเดียว', () => {
  const p = applyMatrix(placementMatrix({ xMm: 10, yMm: 5, rotationDeg: 0 }, size), { x: 1, y: 2 });
  near(p.x, 11); near(p.y, 7);
});

test('หมุน 90°: มุมบนซ้ายหมุนรอบจุดกึ่งกลาง', () => {
  const [tl, tr] = placementCorners({ xMm: 0, yMm: 0, rotationDeg: 90 }, size);
  near(tl.x, 30); near(tl.y, -10);
  near(tr.x, 30); near(tr.y, 30);
});

test('จุดกึ่งกลางไม่เปลี่ยนเมื่อหมุนทุกมุม', () => {
  for (const rotation of [0, 17, 45, 133.3, 270]) {
    const c = applyMatrix(placementMatrix({ xMm: 7, yMm: 9, rotationDeg: rotation }, size), { x: 20, y: 10 });
    near(c.x, 27); near(c.y, 19);
  }
});

test('ระยะในชิ้นงานคงเดิมหลังแปลง (ไม่บิดเบือน)', () => {
  const [a, b] = placementCorners({ xMm: 3, yMm: 4, rotationDeg: 33 }, size);
  near(Math.hypot(b.x - a.x, b.y - a.y), 40);
});

test('scaleX/scaleY: ขยายจากมุมบนซ้าย แล้วหมุนรอบกึ่งกลางของกรอบหลัง Scale', () => {
  const corners = placementCorners({ xMm: 0, yMm: 0, rotationDeg: 90, scaleX: 2, scaleY: 1 }, size);
  const c = placementMatrix({ xMm: 0, yMm: 0, rotationDeg: 90, scaleX: 2, scaleY: 1 }, size);
  const mid = applyMatrix(c, { x: 20, y: 10 });
  near(mid.x, 40); near(mid.y, 10);
  near(Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y), 80);
});

test('invert และ multiply คืนจุดเดิม', () => {
  const m = placementMatrix({ xMm: 12, yMm: -3, rotationDeg: 71 }, size);
  const id = multiply(m, invert(m));
  near(id[0], 1); near(id[1], 0); near(id[2], 0); near(id[3], 1); near(id[4], 0); near(id[5], 0);
});

test('กรอบหลังหมุน 45° ของสี่เหลี่ยมจัตุรัส 10 มม.', () => {
  const b = placementBounds({ xMm: 0, yMm: 0, rotationDeg: 45 }, { widthMm: 10, heightMm: 10 });
  near(b.width, Math.SQRT2 * 10); near(b.height, Math.SQRT2 * 10);
});

test('pointInPlacement ใช้รูปที่หมุนจริง ไม่ใช่กรอบรวม', () => {
  const p = { xMm: 0, yMm: 0, rotationDeg: 45 };
  const s = { widthMm: 10, heightMm: 10 };
  assert.ok(pointInPlacement({ x: 5, y: 5 }, p, s));
  const b = placementBounds(p, s);
  assert.equal(pointInPlacement({ x: b.x + 0.1, y: b.y + 0.1 }, p, s), false);
});

test('rectContains, rectsOverlap: ชิดกันพอดีไม่นับว่าซ้อน', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  assert.ok(rectContains(a, { x: 0, y: 0, width: 10, height: 10 }));
  assert.equal(rectContains(a, { x: 0, y: 0, width: 10.01, height: 10 }), false);
  assert.equal(rectsOverlap(a, { x: 10, y: 0, width: 5, height: 5 }), false);
  assert.ok(rectsOverlap(a, { x: 9.99, y: 0, width: 5, height: 5 }));
  assert.ok(rectsOverlap(a, { x: 11, y: 0, width: 5, height: 5 }, 2));
});

test('containDelta เลื่อนน้อยที่สุด', () => {
  const outer = { x: 5, y: 5, width: 100, height: 100 };
  assert.deepEqual(containDelta(outer, { x: 0, y: 200, width: 10, height: 10 }), { dx: 5, dy: -105 });
  assert.deepEqual(containDelta(outer, { x: 50, y: 50, width: 10, height: 10 }), { dx: 0, dy: 0 });
});

test('resize: มุมตรงข้ามอยู่ที่เดิมแม้วัตถุหมุน', () => {
  for (const rotation of [0, 30, 90, 215]) {
    const transform = { xMm: 50, yMm: 60, rotationDeg: rotation };
    const before = placementCorners(transform, size)[0];
    const r = resizeFromHandle({ transform, size, handle: 'se', pointer: { x: 140, y: 150 }, lockAspect: false });
    const after = placementCorners({ xMm: r.xMm, yMm: r.yMm, rotationDeg: rotation }, { widthMm: r.widthMm, heightMm: r.heightMm })[0];
    near(after.x, before.x); near(after.y, before.y);
  }
});

test('resize: ล็อกสัดส่วนคงอัตราส่วน และไม่ต่ำกว่าขนาดขั้นต่ำ', () => {
  const transform = { xMm: 0, yMm: 0, rotationDeg: 0 };
  const r = resizeFromHandle({ transform, size, handle: 'se', pointer: { x: 80, y: 21 }, lockAspect: true });
  near(r.widthMm, 80); near(r.heightMm, 40);
  const small = resizeFromHandle({ transform, size, handle: 'se', pointer: { x: -50, y: -50 }, lockAspect: true, minMm: 1 });
  near(small.heightMm, 1); near(small.widthMm, 2);
});

test('resize จากมุมบนซ้าย: มุมล่างขวาคงที่', () => {
  const r = resizeFromHandle({ transform: { xMm: 10, yMm: 10, rotationDeg: 0 }, size, handle: 'nw', pointer: { x: 0, y: 5 }, lockAspect: false });
  near(r.xMm, 0); near(r.yMm, 5); near(r.widthMm, 50); near(r.heightMm, 25);
});

test('viewport: แปลงไปกลับ และซูมคงจุดใต้เคอร์เซอร์', () => {
  const v = { scale: 3, originX: 20, originY: -40 };
  const s = paperToScreen(v, { x: 12.5, y: 40 });
  const back = screenToPaper(v, s);
  near(back.x, 12.5); near(back.y, 40);
  const z = zoomAt(v, { x: 300, y: 200 }, 1.7);
  const a = screenToPaper(v, { x: 300, y: 200 });
  const b = screenToPaper(z, { x: 300, y: 200 });
  near(a.x, b.x); near(a.y, b.y);
});

test('fitView จัดกลาง และ rulerStep เป็นค่ามาตรฐาน', () => {
  const v = fitView({ widthMm: 210, heightMm: 297 }, { width: 1000, height: 700 }, 20);
  near(v.scale, 660 / 297);
  near(v.originX, (1000 - 210 * v.scale) / 2);
  assert.equal(rulerStep(10, 50), 5);
  assert.equal(rulerStep(0.001), 5000);
});

test('ปุ่ม ▲▼ ของช่องตัวเลข: ก้าวตามค่าที่ตั้ง, Shift ×10, Alt ×0.1, ไม่มีเศษทศนิยม', async () => {
  const { steppedValue, stepFactor } = await import('../src/ui/fields.js');
  assert.equal(steppedValue('5', 1, 0.5), 5.5);
  assert.equal(steppedValue('5', -1, 0.5), 4.5);
  assert.equal(steppedValue('0.2', 1, 1, 0.1), 0.3);
  assert.equal(steppedValue('2,5', 1, 1), 3.5);
  assert.equal(steppedValue('', 1, 1), 1);
  assert.equal(steppedValue('abc', -1, 0.5), -0.5);
  assert.equal(steppedValue('10', 1, 1, stepFactor({ shiftKey: true })), 20);
  assert.equal(stepFactor({ altKey: true }), 0.1);
  assert.equal(stepFactor({}), 1);
});
