import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { art, idGen, near } from './helpers.mjs';
import factory from '../vendor/clipper2/clipper2z.js';
import * as D from '../src/core/document.js';
import * as M from '../src/core/marks.js';
import { UserError } from '../src/core/errors.js';
import { nestLayout, prepareLayout, standardLayout, verifyLayout } from '../src/core/layout/layout.js';
import { validateDocument } from '../src/core/validate.js';
import { rectsOverlap } from '../src/core/geometry.js';
import { keepoutRect } from '../src/core/shape.js';

let clipper;
before(async () => { clipper = await factory(); });

const profile = (id) => M.getBuiltinProfile(id);

test('Profile สำเร็จรูป 3 กลุ่ม ทุกตัวยังไม่ยืนยัน และ MicroCut ใช้ชื่อตาม SRS ข้อ 11', () => {
  const ids = M.BUILTIN_PROFILES.map((p) => p.id);
  assert.deepEqual(ids, ['microcut30q-5dots', 'circle-4', 'circle-3', 'corner-l']);
  assert.ok(M.BUILTIN_PROFILES.every((p) => p.verificationStatus === 'unverified'));
  assert.equal(profile('microcut30q-5dots').label, 'MicroCut 30Q - Custom 5 Dots (Unverified)');
});

/**
 * ค่าที่วัดจาก PDF ที่ SignMaster สร้าง (Teneth MC350CCD, ARMS CCD 5mm) กระดาษ 329 × 483 มม.
 * Page Mark Margins ซ้าย/ขวา/บน 10 ล่าง 40 หน่วย pt แปลงเป็น มม. แล้ว (1 pt = 25.4/72 มม.)
 * วงกลม: จุดกึ่งกลาง (28.35, 1340.79) (28.35, 1284.09) (904.25, 1340.79) (904.25, 113.39) (28.35, 113.39) รัศมี 7.08 pt
 * สามเหลี่ยม: (466.3, 1356.28) (471.97, 1346.46) (460.63, 1346.46) ความสูงหน้า 1369.13 pt
 */
test('MicroCut 30Q ตรงกับ PDF จาก SignMaster ภายใน 0.01 มม.', () => {
  const pt = (v) => (v * 25.4) / 72;
  const top = (y) => pt(1369.13 - y);
  let doc = D.setPaper(D.createDocument(), { preset: 'Super A3', orientation: 'portrait' });
  doc = M.applyProfile(doc, profile('microcut30q-5dots'), idGen());
  const dots = doc.marks.filter((m) => m.shape === 'circle');
  const expected = [[28.35, 1340.79], [28.35, 1284.09], [904.25, 1340.79], [904.25, 113.39], [28.35, 113.39]];
  assert.equal(dots.length, 5);
  dots.forEach((m, i) => {
    near(m.xMm, pt(expected[i][0]), 0.01);
    near(m.yMm, top(expected[i][1]), 0.01);
    near(m.widthMm, pt(7.08 * 2), 0.01);
  });
  const [tri] = doc.marks.filter((m) => m.shape === 'triangle');
  const b = M.markBounds(tri);
  near(b.x, pt(460.63), 0.01);
  near(b.x + b.width, pt(471.97), 0.01);
  near(b.y, top(1356.28), 0.01);
  near(b.y + b.height, top(1346.46), 0.01);
  assert.match(M.markPathData(tri), /^M0 -/, 'ยอดชี้ขึ้น');
  // กรอบมาร์คตรงกับ "Marks: 309 x 433 mm" ของ SignMaster
  const frame = M.markFrame(doc.marks);
  near(frame.width, 309, 0.01);
  near(frame.height, 433, 0.01);
  assert.equal(doc.markSettings.verificationStatus, 'unverified');
});

test('AC-08 ระยะขอบแยก 4 ด้านวัดถึงจุดกึ่งกลาง และกำหนดค่าเองได้', () => {
  const t = profile('microcut30q-5dots').template;
  const custom = M.applyProfile(D.createDocument(), profile('microcut30q-5dots'), idGen(), {
    ...t, sizeMm: 6, marginsMm: { top: 12, right: 8, bottom: 15, left: 9 },
  });
  const [tl, extra, tr, br, bl] = custom.marks;
  assert.deepEqual([tl.xMm, tl.yMm], [9, 12]);
  assert.deepEqual([extra.xMm, extra.yMm], [9, 32]);
  assert.deepEqual([tr.xMm, tr.yMm], [202, 12]);
  assert.deepEqual([br.xMm, br.yMm], [202, 282]);
  assert.deepEqual([bl.xMm, bl.yMm], [9, 282]);
  assert.equal(custom.markSettings.template.sizeMm, 6);
  assert.throws(() => M.applyProfile(D.createDocument(), profile('circle-4'), idGen(), {
    ...profile('circle-4').template, marginsMm: { top: 10, right: 100, bottom: 10, left: 120 },
  }), UserError);
});

test('วงกลม 3/4 จุด และมุม L หมุนชี้เข้าแต่ละมุม', () => {
  assert.equal(M.applyProfile(D.createDocument(), profile('circle-3'), idGen()).marks.length, 3);
  assert.equal(M.applyProfile(D.createDocument(), profile('circle-4'), idGen()).marks.length, 4);
  const l = M.applyProfile(D.createDocument(), profile('corner-l'), idGen()).marks;
  assert.deepEqual(l.map((m) => m.rotationDeg), [0, 90, 180, 270]);
  assert.ok(l.every((m) => m.shape === 'corner'));
  assert.match(M.markPathData(l[0]), /^M-5 -5 L5 -5 L5 -4 L-4 -4 L-4 5 L-5 5 Z$/);
});

test('แก้ ย้าย หมุน ขนาด ล็อก ทำซ้ำ ลบ และจัดแนว (FR-10.5)', () => {
  const newId = idGen();
  let doc = M.applyProfile(D.createDocument(), profile('circle-4'), newId);
  const id = doc.marks[0].id;
  doc = M.updateMark(doc, id, { xMm: 50, yMm: 60, widthMm: 8, heightMm: 8, rotationDeg: 370 });
  assert.equal(doc.marks[0].rotationDeg, 10);
  doc = M.updateMark(doc, id, { locked: true });
  assert.throws(() => M.updateMark(doc, id, { xMm: 1 }), /ล็อก/);
  assert.throws(() => M.moveMarks(doc, [id], 5, 5).marks[0].xMm === 55 || (() => { throw new Error('ไม่ขยับ'); })(), /ไม่ขยับ/);
  doc = M.updateMark(doc, id, { locked: false });
  doc = M.moveMarks(doc, [id], 1000, 0);
  const b = M.markBounds(doc.marks[0]); // กรอบหลังหมุน 10° กว้างกว่า 8 มม.
  near(b.x + b.width, 210, 1e-9);
  doc = M.alignMark(doc, id, 'left', { top: 10, right: 10, bottom: 40, left: 7 });
  near(doc.marks[0].xMm, 7, 1e-9);
  doc = M.alignMark(doc, id, 'bottom', { top: 10, right: 10, bottom: 40, left: 7 });
  near(doc.marks[0].yMm, 297 - 40, 1e-9);
  doc = M.duplicateMark(doc, id, newId());
  assert.equal(doc.marks.length, 5);
  doc = M.removeMark(doc, doc.marks.at(-1).id);
  assert.equal(doc.marks.length, 4);
  assert.throws(() => M.updateMark(doc, id, { xMm: -100 }), UserError);
  assert.throws(() => M.updateMark(doc, id, { fill: 'none', stroke: 'none' }), UserError);
  assert.throws(() => M.updateMark(doc, id, { widthMm: 0.1 }), UserError);
});

test('พื้นที่สงวนของมาร์คกันทั้งการวางเอง Standard และ Nesting (FR-10.7)', () => {
  const newId = idGen();
  let doc = D.addMaster(D.createDocument(), art({ widthMm: 40, heightMm: 40 }), newId).doc;
  doc = D.setQuantity(doc, 'a1', 12, newId).doc;
  doc = M.applyProfile(doc, profile('circle-4'), newId, { ...profile('circle-4').template, sizeMm: 10, marginsMm: { top: 11, right: 11, bottom: 11, left: 11 }, keepoutMm: 4 });
  const zones = M.effectiveKeepouts(doc);
  assert.equal(zones.length, 4);
  near(zones[0].xMm, 2); // 11 - 5 - 4
  near(zones[0].widthMm, 18); // 10 + 4*2
  for (const method of ['standard', 'nest']) {
    const input = prepareLayout(doc, method);
    assert.equal(input.keepouts.length, 4);
    const result = method === 'nest' ? nestLayout(clipper, input) : standardLayout(input);
    assert.equal(verifyLayout(input, result), 0);
    const applied = D.applyLayout(doc, result, newId);
    const issues = validateDocument(applied);
    assert.equal(issues.inKeepout.size, 0, method);
    for (const i of D.placedInstances(applied)) {
      assert.ok(!zones.some((z) => rectsOverlap(D.boundsOf(applied, i), keepoutRect(z), 0, 1e-6)), method);
    }
  }
  // ลากเข้าเขตมาร์คไม่ได้
  const placed = D.placedInstances(D.applyLayout(doc, standardLayout(prepareLayout(doc, 'standard')), newId));
  const moved = D.applyLayout(doc, standardLayout(prepareLayout(doc, 'standard')), newId);
  assert.throws(() => D.positionInstance(moved, placed[0].id, 5, 5), /ห้ามวาง/);
});

test('เปลี่ยนกระดาษจนมาร์คหลุดขอบ: แจ้งใน validate ไม่ย้ายเอง', () => {
  let doc = M.applyProfile(D.createDocument(), profile('circle-4'), idGen());
  doc = D.setPaper(doc, { preset: 'A5', orientation: 'portrait' });
  const issues = validateDocument(doc);
  assert.equal(issues.marksOutside.size, 3);
});

test('User Profile เก็บมาร์คตามตำแหน่งจริงและนำกลับมาใช้ได้ (AC-08)', () => {
  const newId = idGen();
  let doc = M.applyProfile(D.createDocument(), profile('microcut30q-5dots'), newId);
  doc = M.updateMark(doc, doc.marks[1].id, { xMm: 40, widthMm: 6, heightMm: 6, locked: true });
  const saved = M.profileFromDoc(doc, 'u1', 'เครื่องร้าน A');
  const restored = M.sanitizeProfile(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.verificationStatus, 'unverified');
  const again = M.applyProfile(D.createDocument(), restored, newId);
  assert.equal(again.marks.length, 6); // 5 จุด + สามเหลี่ยม
  assert.equal(again.marks[1].xMm, 40);
  assert.equal(again.marks[1].locked, true);
  assert.equal(again.markSettings.label, 'เครื่องร้าน A');
  assert.equal(M.sanitizeProfile({ id: 'x', label: 'x', marks: [{ shape: 'blob' }] }), null);
  assert.throws(() => M.profileFromDoc(doc, 'u2', '  '), UserError);
});

test('migrate v3 เป็น v4: เพิ่ม markSettings', () => {
  const v3 = { ...D.createDocument(), version: 3 };
  delete v3.markSettings;
  const up = D.assertDocument(D.migrate(v3));
  assert.equal(up.version, 4);
  assert.equal(up.markSettings, null);
  assert.deepEqual(up.marks, []);
});
