import test from 'node:test';
import assert from 'node:assert/strict';
import { art, idGen } from './helpers.mjs';
import * as D from '../src/core/document.js';
import { UserError } from '../src/core/errors.js';
import { rectsOverlap } from '../src/core/geometry.js';
import { readDpi, sniffType } from '../src/core/image-meta.js';
import { validateDocument } from '../src/core/validate.js';
import { Store, HISTORY_LIMIT } from '../src/app/store.js';
import { AutoSaver } from '../src/app/persistence.js';
import { initialSize } from '../src/app/importer.js';
import { readFileSync } from 'node:fs';

const fresh = (over) => {
  const newId = idGen();
  return { doc: D.addMaster(D.createDocument(), art(over), newId).doc, newId };
};
const manyAt = (doc, newId, count) => D.setQuantity(doc, 'a1', count, newId).doc;

test('เพิ่มจำนวนไม่ซ้อนกันและเว้นระยะตาม settings.spacingMm', () => {
  const { doc, newId } = fresh();
  const r = D.setQuantity(doc, 'a1', 6, newId);
  assert.equal(r.doc.instances.length, 6);
  assert.equal(r.doc.masters[0].quantity, 6);
  assert.equal(r.unplaced, 0);
  const b = r.doc.instances.map((i) => D.boundsOf(r.doc, i));
  for (let i = 0; i < b.length; i += 1) {
    for (let j = i + 1; j < b.length; j += 1) assert.equal(rectsOverlap(b[i], b[j], r.doc.settings.spacingMm), false);
  }
  const issues = validateDocument(r.doc);
  assert.equal(issues.overlapping.size, 0);
  assert.equal(issues.outside.size, 0);
});

test('Instance อ้างอิง Master เดียวกัน ไม่คัดลอกข้อมูล', () => {
  const { doc, newId } = fresh();
  const r = D.setQuantity(doc, 'a1', 3, newId);
  assert.equal(r.doc.masters.length, 1);
  assert.equal(r.doc.masters[0].desiredSizeMm, doc.masters[0].desiredSizeMm);
});

test('กระดาษเต็ม: จำนวนครบ ไม่ซ้อน ไม่ย่อ และชิ้นที่เกินเป็น unplaced', () => {
  const { doc, newId } = fresh({ widthMm: 200, heightMm: 287 });
  const r = D.setQuantity(doc, 'a1', 3, newId);
  assert.equal(r.unplaced, 2);
  assert.equal(r.doc.masters[0].quantity, 3);
  assert.equal(r.doc.masters[0].desiredSizeMm.widthMm, 200);
  const issues = validateDocument(r.doc);
  assert.equal(issues.overlapping.size, 0);
  assert.equal(issues.unplaced, 2);
  assert.equal(r.added[1].pageId, null);
});

test('placePending วางชิ้นค้างเมื่อมีที่ว่าง', () => {
  const { doc, newId } = fresh({ widthMm: 200, heightMm: 287 });
  const full = D.setQuantity(doc, 'a1', 2, newId).doc;
  assert.equal(D.placePending(full).remaining, 1);
  const a4l = D.setPaper(full, { preset: 'A0', orientation: 'portrait' });
  const r = D.placePending(a4l);
  assert.equal(r.remaining, 0);
  assert.equal(validateDocument(r.doc).unplaced, 0);
  assert.equal(r.doc.instances[1].pageId, r.doc.pages[0].id);
});

test('FR-03.1 จำนวน 0 ได้ Master ยังอยู่ และเพิ่มกลับได้', () => {
  const { doc, newId } = fresh();
  const zero = D.setQuantity(doc, 'a1', 0, newId).doc;
  assert.equal(zero.masters.length, 1);
  assert.equal(zero.masters[0].quantity, 0);
  assert.equal(zero.instances.length, 0);
  assert.equal(D.setQuantity(zero, 'a1', 2, newId).doc.instances.length, 2);
  for (const bad of [-1, 1.5, NaN]) assert.throws(() => D.setQuantity(doc, 'a1', bad, newId), UserError);
});

test('FR-03.6 ลดจำนวน: เอาชิ้นค้างออกก่อน แล้วชิ้นล่าสุด', () => {
  const { doc, newId } = fresh();
  const six = manyAt(doc, newId, 6);
  const two = D.setQuantity(six, 'a1', 2, newId).doc;
  assert.deepEqual(two.instances.map((i) => i.id), six.instances.slice(0, 2).map((i) => i.id));
  const big = fresh({ widthMm: 200, heightMm: 287 });
  const three = D.setQuantity(big.doc, 'a1', 3, big.newId).doc;
  const reduced = D.setQuantity(three, 'a1', 1, big.newId).doc;
  assert.equal(reduced.instances[0].placementStatus, 'placed');
});

test('จำกัดจำนวนรวม และการเพิ่มหลายชิ้นทำงานเร็ว', () => {
  const { doc, newId } = fresh({ widthMm: 3, heightMm: 3 });
  assert.throws(() => D.setQuantity(doc, 'a1', D.MAX_INSTANCES + 1, newId), UserError);
  const t = performance.now();
  const r = D.setQuantity(doc, 'a1', 1000, newId);
  assert.ok(r.unplaced === 0, `unplaced=${r.unplaced}`);
  assert.ok(performance.now() - t < 5000);
});

test('removeInstances เก็บ Master และ removeMaster ลบทั้งแบบ', () => {
  const { doc } = fresh();
  const gone = D.removeInstances(doc, [doc.instances[0].id]);
  assert.equal(gone.masters[0].quantity, 0);
  assert.equal(D.removeMaster(doc, 'a1').masters.length, 0);
});

test('ขนาดเปลี่ยนทุกชิ้น ไม่เกิดชิ้นนอกพื้นที่', () => {
  const { doc, newId } = fresh();
  const r = D.resizeMaster(manyAt(doc, newId, 4), 'a1', 100, 60);
  assert.equal(validateDocument(r).outside.size, 0);
});

test('Duplicate คงมุมหมุน และหาที่ว่างจากกรอบที่หมุนแล้ว', () => {
  const { doc, newId } = fresh();
  const rotated = D.rotateInstances(doc, [doc.instances[0].id], () => 90);
  const r = D.duplicateInstances(rotated, [rotated.instances[0].id], newId);
  assert.equal(r.doc.instances.length, 2);
  assert.equal(r.doc.masters[0].quantity, 2);
  assert.equal(r.added[0].transform.rotationDeg, 90);
  assert.equal(validateDocument(r.doc).outside.size, 0);
  assert.equal(validateDocument(r.doc).overlapping.size, 0);
});

test('FR-03.5 Align: หลายชิ้นเทียบกรอบรวม ชิ้นเดียวเทียบพื้นที่วางงาน', () => {
  const { doc, newId } = fresh();
  let many = manyAt(doc, newId, 2);
  many = D.positionInstance(many, many.instances[0].id, 40, 20).doc;
  many = D.positionInstance(many, many.instances[1].id, 90, 80).doc;
  const ids = many.instances.map((i) => i.id);
  const left = D.alignInstances(many, ids, 'left');
  assert.deepEqual(left.instances.map((i) => i.transform.xMm), [40, 40]);
  const bottom = D.alignInstances(many, ids, 'bottom');
  assert.deepEqual(bottom.instances.map((i) => i.transform.yMm), [80, 80]);
  const hcenter = D.alignInstances(many, ids, 'hcenter');
  assert.deepEqual(hcenter.instances.map((i) => i.transform.xMm), [65, 65]);
  const single = D.alignInstances(many, [ids[0]], 'right');
  assert.equal(single.instances[0].transform.xMm, 155);
  const vmid = D.alignInstances(many, [ids[0]], 'vcenter');
  assert.equal(vmid.instances[0].transform.yMm, 133.5);
});

test('FR-03.3 จัดลำดับชั้น', () => {
  const { doc, newId } = fresh();
  const many = manyAt(doc, newId, 4);
  const [a, b, c, d] = many.instances.map((i) => i.id);
  const order = (x) => x.instances.map((i) => i.id);
  assert.deepEqual(order(D.reorderInstances(many, [a], 'front')), [b, c, d, a]);
  assert.deepEqual(order(D.reorderInstances(many, [d], 'back')), [d, a, b, c]);
  assert.deepEqual(order(D.reorderInstances(many, [b], 'forward')), [a, c, b, d]);
  assert.deepEqual(order(D.reorderInstances(many, [b], 'backward')), [b, a, c, d]);
  assert.deepEqual(order(D.reorderInstances(many, [a, b], 'forward')), [c, a, b, d]);
  assert.deepEqual(order(D.reorderInstances(many, [d], 'forward')), [a, b, c, d]);
});

test('addMaster วางกึ่งกลางที่จุดปล่อยเมาส์ และไม่ล้ำขอบ', () => {
  const newId = idGen();
  const r = D.addMaster(D.createDocument(), art(), newId, { x: 100, y: 120 });
  assert.equal(r.doc.instances[0].transform.xMm, 75);
  assert.equal(r.doc.instances[0].transform.yMm, 105);
  const edge = D.addMaster(D.createDocument(), art(), newId, { x: 1, y: 1 });
  assert.equal(edge.doc.instances[0].transform.xMm, 5);
  assert.equal(edge.added[0].transform.yMm, 5);
});

test('findFreeSpot คืน null เมื่อไม่มีที่', () => {
  const area = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(D.findFreeSpot(area, [], { width: 11, height: 1 }, 0), null);
  assert.deepEqual(D.findFreeSpot(area, [{ x: 0, y: 0, width: 5, height: 10 }], { width: 5, height: 10 }, 0), { x: 5, y: 0 });
});

test('Undo/Redo กลับเอกสารเดิมทุกค่า และแก้ใหม่ล้าง Redo', () => {
  const { doc } = fresh();
  const s = new Store(doc);
  const { id } = doc.instances[0];
  s.commit(D.positionInstance(s.doc, id, 20, 20).doc);
  s.commit(D.rotateInstances(s.doc, [id], () => 30));
  s.undo();
  assert.equal(D.getInstance(s.doc, id).transform.rotationDeg, 0);
  s.undo();
  assert.equal(s.doc, doc);
  s.redo(); s.redo();
  assert.equal(D.getInstance(s.doc, id).transform.rotationDeg, 30);
  s.undo();
  s.commit(D.positionInstance(s.doc, id, 30, 30).doc);
  assert.equal(s.canRedo, false);
});

test('FR-03.6 ลดจำนวนแล้ว Undo ได้ครบ', () => {
  const { doc, newId } = fresh();
  const six = manyAt(doc, newId, 6);
  const s = new Store(six);
  s.commit(D.setQuantity(s.doc, 'a1', 0, newId).doc);
  s.undo();
  assert.equal(s.doc, six);
  assert.equal(s.doc.masters[0].quantity, 6);
});

test('preview ระหว่างลากรวมเป็น Undo ขั้นเดียว ยกเลิกได้ และ Undo ถูกกันระหว่างลาก', () => {
  const { doc } = fresh();
  const s = new Store(doc);
  const { id } = doc.instances[0];
  for (const x of [10, 20, 30]) s.preview(D.positionInstance(doc, id, x, 10).doc);
  s.undo();
  assert.notEqual(s.doc, doc);
  s.commitPreview();
  assert.equal(s.past.length, 1);
  s.undo();
  assert.equal(s.doc, doc);
  s.preview(D.positionInstance(doc, id, 50, 10).doc);
  s.cancelPreview();
  assert.equal(s.doc, doc);
  assert.equal(s.past.length, 0);
});

test('Selection หลายชิ้น: ชิ้นที่หายถูกตัดออก และ soleId ถูกต้อง', () => {
  const { doc, newId } = fresh();
  const many = manyAt(doc, newId, 2);
  const s = new Store(D.createDocument());
  s.commit(many);
  const ids = many.instances.map((i) => i.id);
  s.select(ids);
  assert.equal(s.soleId, null);
  s.commit(D.removeInstances(s.doc, [ids[0]]));
  assert.deepEqual(s.selectedIds, [ids[1]]);
  assert.equal(s.soleId, ids[1]);
  s.undo(); s.undo();
  assert.deepEqual(s.selectedIds, []);
  for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) s.commit({ ...s.doc });
  assert.equal(s.past.length, HISTORY_LIMIT);
});

test('AutoSaver รวมการบันทึก, ไม่เสียงานเมื่อบันทึกล้ม', async () => {
  const saved = [];
  const statuses = [];
  let fail = true;
  const saver = new AutoSaver({
    delayMs: 5,
    onStatus: (s) => statuses.push(s),
    save: async (d) => { if (fail) throw new Error('quota'); saved.push(d); },
  });
  const original = console.error;
  console.error = () => {};
  saver.schedule('a');
  await saver.flush();
  console.error = original;
  assert.equal(saver.dirty, true);
  assert.ok(statuses.includes('failed'));
  fail = false;
  saver.schedule('b'); saver.schedule('c');
  await saver.flush();
  assert.deepEqual(saved, ['c']);
  assert.equal(saver.dirty, false);
});

test('initialSize ใช้ DPI ในไฟล์ ไม่มีใช้ 300 และย่อตามสัดส่วนเมื่อล้น', () => {
  const area = { width: 200, height: 287 };
  assert.deepEqual(initialSize(600, 600, 300, area), { widthMm: 50.8, heightMm: 50.8, scaled: false });
  assert.equal(initialSize(300, 150, null, area).widthMm, 25.4);
  const big = initialSize(4000, 2000, 72, area);
  assert.ok(big.scaled);
  assert.equal(big.widthMm, 200);
  assert.equal(big.heightMm, 100);
});

const load = (n) => new Uint8Array(readFileSync(new URL(`../test-data/${n}`, import.meta.url)));

test('อ่านชนิดไฟล์และ DPI จากไฟล์จริงในชุดทดสอบ', () => {
  assert.equal(sniffType(load('circle-50.8mm-300dpi.png')), 'image/png');
  assert.equal(sniffType(load('label-127x63.5mm-200dpi.jpg')), 'image/jpeg');
  assert.equal(sniffType(load('not-yet.pdf')), 'application/pdf');
  assert.equal(sniffType(load('not-an-image.txt.png')), null);
  // pHYs เก็บเป็น pixel/meter จึงคลาดเคลื่อนจากการปัดของไฟล์เล็กน้อย
  assert.ok(Math.abs(readDpi(load('circle-50.8mm-300dpi.png'), 'image/png') - 300) < 0.02);
  assert.ok(Math.abs(readDpi(load('badge-50.8x25.4mm-600dpi.png'), 'image/png') - 600) < 0.02);
  assert.equal(readDpi(load('label-127x63.5mm-200dpi.jpg'), 'image/jpeg'), 200);
  assert.equal(readDpi(load('no-dpi-300x150px.png'), 'image/png'), null);
});

test('readDpi ไม่พังกับไฟล์ตัดกลาง', () => {
  const b = load('label-127x63.5mm-200dpi.jpg').subarray(0, 8);
  assert.equal(readDpi(b, 'image/jpeg'), null);
  assert.equal(readDpi(load('corrupt.png'), 'image/png'), null);
});
