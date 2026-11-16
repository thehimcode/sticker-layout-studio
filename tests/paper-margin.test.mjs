import test from 'node:test';
import assert from 'node:assert/strict';
import { art, idGen, near } from './helpers.mjs';
import {
  CUSTOM_PAPER_MAX_MM, DEFAULT_MARGINS, PAPER_PRESETS, printableArea, resolvePaper,
} from '../src/core/paper.js';
import * as D from '../src/core/document.js';
import { UserError } from '../src/core/errors.js';
import { placementBounds, rectContains } from '../src/core/geometry.js';
import { validateDocument } from '../src/core/validate.js';

const userError = (code) => (e) => e instanceof UserError && e.code === code;
const docWith = (over) => D.addMaster(D.createDocument(), art(over), idGen()).doc;
const inst = (doc) => doc.instances[0];
const size = (doc) => doc.masters[0].desiredSizeMm;

test('FR-01.1 ค่าเริ่มต้น A4 แนวตั้ง, FR-08.1 Margin 5 มม., FR-09.1 ระยะห่าง 3 มม.', () => {
  const { paper, settings } = D.createDocument();
  assert.equal(paper.widthMm, 210); assert.equal(paper.heightMm, 297);
  assert.equal(paper.orientation, 'portrait');
  assert.deepEqual(paper.marginsMm, { ...DEFAULT_MARGINS });
  assert.equal(settings.spacingMm, 3);
});

test('FR-01.2/01.3 ขนาดกระดาษตรง SRS รวม A3+ 320×450 และ Super A3 329×483', () => {
  const expected = {
    A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
    'A3+': [320, 450], 'Super A3': [329, 483],
  };
  assert.equal(Object.keys(PAPER_PRESETS).length, 9);
  for (const [name, [w, h]] of Object.entries(expected)) {
    assert.deepEqual(PAPER_PRESETS[name], { widthMm: w, heightMm: h });
  }
});

test('แนวนอนสลับกว้าง/สูง', () => {
  const p = resolvePaper({ preset: 'A4', orientation: 'landscape' });
  assert.equal(p.widthMm, 297); assert.equal(p.heightMm, 210);
});

test('กำหนดเอง: ตรวจช่วงค่า และระบุแนวตามสัดส่วน', () => {
  assert.equal(resolvePaper({ preset: 'custom', widthMm: 500, heightMm: 300 }).orientation, 'landscape');
  assert.throws(() => resolvePaper({ preset: 'custom', widthMm: 5, heightMm: 300 }), userError('paper-size'));
  assert.throws(() => resolvePaper({ preset: 'custom', widthMm: CUSTOM_PAPER_MAX_MM + 1, heightMm: 300 }), userError('paper-size'));
  assert.throws(() => resolvePaper({ preset: 'custom', widthMm: NaN, heightMm: 300 }), userError('paper-size'));
  assert.throws(() => resolvePaper({ preset: 'B5' }), userError('paper-preset'));
});

test('AC-02 Margin 10/15/20/5 คำนวณพื้นที่แยกแต่ละด้าน', () => {
  const area = printableArea({ widthMm: 210, heightMm: 297, marginsMm: { top: 10, right: 15, bottom: 20, left: 5 } });
  assert.deepEqual(area, { x: 5, y: 10, width: 190, height: 267 });
});

test('FR-08.6 Margin ที่ไม่เหลือพื้นที่หรือค่าลบถูกปฏิเสธ เอกสารเดิมไม่เปลี่ยน', () => {
  const doc = D.createDocument();
  assert.throws(() => D.setMargins(doc, { left: 105, right: 105 }), userError('margin-too-large'));
  assert.throws(() => D.setMargins(doc, { top: -1 }), userError('margin-negative'));
  assert.equal(doc.paper.marginsMm.left, 5);
});

test('FR-08.4 ย้ายออกนอกพื้นที่ถูก Clamp และรายงาน clamped', () => {
  const doc = docWith();
  const { id } = inst(doc);
  const r = D.positionInstance(doc, id, -100, 9999);
  assert.equal(r.clamped, true);
  assert.equal(inst(r.doc).transform.xMm, 5);
  near(inst(r.doc).transform.yMm + 30, 292);
  assert.equal(D.positionInstance(doc, id, 20, 20).clamped, false);
});

test('Clamp กลุ่มหลายชิ้นเป็นก้อนเดียว ระยะห่างภายในกลุ่มคงเดิม', () => {
  const newId = idGen();
  let { doc } = D.addMaster(D.createDocument(), art(), newId);
  doc = D.setQuantity(doc, 'a1', 2, newId).doc;
  doc = D.positionInstance(doc, doc.instances[0].id, 40, 40).doc;
  doc = D.positionInstance(doc, doc.instances[1].id, 100, 80).doc;
  const ids = doc.instances.map((i) => i.id);
  const r = D.moveInstances(doc, ids, { dx: -500, dy: 0 });
  assert.equal(r.clamped, true);
  assert.equal(r.doc.instances[0].transform.xMm, 5);
  assert.equal(r.doc.instances[1].transform.xMm, 65);
});

test('ชิ้นที่หมุนแล้วก็ต้องอยู่ในพื้นที่', () => {
  let doc = docWith();
  const { id } = inst(doc);
  doc = D.rotateInstances(doc, [id], () => 45);
  doc = D.positionInstance(doc, id, -500, -500).doc;
  const area = printableArea(doc.paper);
  const bounds = placementBounds(inst(doc).transform, size(doc));
  assert.ok(rectContains(area, bounds));
  near(bounds.x, 5);
});

test('หมุนแล้วล้นพื้นที่ถูกปฏิเสธ', () => {
  const doc = docWith({ widthMm: 190, heightMm: 20 });
  const small = D.setPaper(doc, { preset: 'custom', widthMm: 210, heightMm: 40 });
  assert.throws(() => D.rotateInstances(small, [inst(small).id], () => 90), userError('rotation-no-fit'));
});

test('FR-08.5 เปลี่ยนกระดาษ/Margin ไม่ย้ายและไม่ Scale แต่แจ้งชิ้นที่ไม่ถูกต้อง', () => {
  let doc = docWith();
  doc = D.positionInstance(doc, inst(doc).id, 155, 262).doc;
  const before = inst(doc).transform;
  const changed = D.setMargins(doc, { right: 40, bottom: 40 });
  assert.equal(inst(changed).transform, before);
  assert.deepEqual(size(changed), size(doc));
  assert.deepEqual([...validateDocument(changed).outside], [inst(doc).id]);
  const smaller = D.setPaper(doc, { preset: 'A6', orientation: 'portrait' });
  assert.equal(inst(smaller).transform, before);
  assert.equal(validateDocument(smaller).outside.size, 1);
});

test('pullInside เลื่อนกลับเฉพาะเมื่อผู้ใช้สั่ง และรายงานชิ้นที่ใหญ่เกิน', () => {
  let doc = docWith();
  doc = D.positionInstance(doc, inst(doc).id, 155, 262).doc;
  doc = D.setMargins(doc, { right: 40, bottom: 40 });
  const { doc: fixed, oversized } = D.pullInside(doc);
  assert.equal(oversized, 0);
  assert.equal(validateDocument(fixed).outside.size, 0);
  const big = D.setPaper(docWith({ widthMm: 190, heightMm: 120 }), { preset: 'A6', orientation: 'portrait' });
  const issues = validateDocument(big);
  assert.equal(issues.outside.size, 1);
  assert.equal(issues.oversized.size, 1);
  assert.equal(D.pullInside(big).oversized, 1);
  assert.equal(size(big).widthMm, 190);
});

test('ขนาดใหญ่กว่าพื้นที่ถูกปฏิเสธ และย่อขยายคงจุดกึ่งกลาง', () => {
  const doc = docWith();
  const centred = D.positionInstance(doc, inst(doc).id, 80, 100).doc;
  assert.throws(() => D.resizeMaster(centred, 'a1', 500, 20), userError('size-no-fit'));
  assert.throws(() => D.resizeMaster(centred, 'a1', 0.5, 20), userError('size-invalid'));
  const r = D.resizeMaster(centred, 'a1', 60, 40);
  assert.equal(inst(r).transform.xMm, 75); assert.equal(inst(r).transform.yMm, 95);
});

test('ลากมุมจนล้นถูกปฏิเสธ แต่พอดีขอบผ่าน', () => {
  const doc = docWith();
  const { id } = inst(doc);
  assert.throws(() => D.applyHandleResize(doc, id, { xMm: 5, yMm: 5, widthMm: 201, heightMm: 30 }), userError('size-no-fit'));
  const ok = D.applyHandleResize(doc, id, { xMm: 5, yMm: 5, widthMm: 200, heightMm: 30 });
  assert.equal(size(ok).widthMm, 200);
});

test('migrate แปลงงานรุ่นเก่า A3+ เดิม (329×483) เป็น Super A3 ขนาดเท่าเดิม', () => {
  const old = {
    schemaVersion: 1, name: 'เดิม',
    paper: { preset: 'A3+', orientation: 'portrait', widthMm: 329, heightMm: 483 },
    margins: { top: 1, right: 2, bottom: 3, left: 4 }, gapMm: 2,
    artworks: [{ id: 'a', assetId: 'x', name: 'p.JPG', widthMm: 10, heightMm: 20, pixelWidth: 100, pixelHeight: 200, sourceDpi: null, lockAspect: false }],
    placements: [{ id: 'p', artworkId: 'a', x: 7, y: 8, rotation: 30 }],
  };
  const doc = D.assertDocument(D.migrate(old));
  assert.equal(doc.paper.preset, 'Super A3');
  assert.equal(doc.paper.widthMm, 329);
  assert.deepEqual(doc.paper.marginsMm, old.margins);
  assert.equal(doc.masters[0].quantity, 1);
  assert.equal(doc.masters[0].sourceType, 'jpeg');
  assert.deepEqual(doc.instances[0].transform, { xMm: 7, yMm: 8, rotationDeg: 30, scaleX: 1, scaleY: 1 });
});

test('assertDocument ตรวจข้อมูลเสีย', () => {
  const doc = docWith();
  assert.equal(D.assertDocument(doc), doc);
  assert.throws(() => D.assertDocument({ ...doc, version: 99 }), userError('doc-invalid'));
  assert.throws(() => D.assertDocument({ ...doc, masters: [] }), userError('doc-invalid'));
  assert.throws(() => D.assertDocument(null), userError('doc-invalid'));
});
