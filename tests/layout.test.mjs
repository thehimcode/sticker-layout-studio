import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { art, idGen, near } from './helpers.mjs';
import factory from '../vendor/clipper2/clipper2z.js';
import * as D from '../src/core/document.js';
import { UserError } from '../src/core/errors.js';
import { signedArea } from '../src/core/contour/path.js';
import { buildCutline, DEFAULT_CUTLINE_CONFIG as C } from '../src/core/contour/pipeline.js';
import { nestLayout, prepareLayout, rotationList, standardLayout, verifyLayout } from '../src/core/layout/layout.js';
import { placementMatrix } from '../src/core/geometry.js';
import { keepoutPath, pathsDistance, shapesOf, transformPaths } from '../src/core/shape.js';
import { validateDocument } from '../src/core/validate.js';
import { printableArea } from '../src/core/paper.js';

let clipper;
before(async () => { clipper = await factory(); });

// ดาวเว้าใน px: ขนาดจริงตาม sizeMm
function starPath(n = 5, outer = 50, inner = 20, c = 50) {
  const p = [];
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    p.push(c + r * Math.cos(a), c + r * Math.sin(a));
  }
  return p;
}
const circlePath = (r = 50, c = 50, n = 64) => {
  const p = [];
  for (let i = 0; i < n; i += 1) p.push(c + r * Math.cos((i * 2 * Math.PI) / n), c + r * Math.sin((i * 2 * Math.PI) / n));
  return p;
};
function master(doc, id, path, widthMm, heightMm, newId, offsetMm = 2, quantity = 1, bleedMm = 0) {
  const natural = { widthPx: 100, heightPx: 100 };
  let next = D.addMaster(doc, { ...art({ id, widthMm, heightMm }), naturalSize: { ...natural, dpi: null } }, newId).doc;
  const cutline = buildCutline(clipper, {
    masterId: id, paths: [path], natural, sizeMm: { widthMm, heightMm }, offsetMm, contourMode: 'outer', bleedMm,
  });
  next = D.setCutline(next, id, { config: { ...C, offsetMm }, contourPaths: [path], cutline });
  next = { ...next, masters: next.masters.map((m) => (m.id === id ? { ...m, bleedMm } : m)) };
  return D.setQuantity(next, id, quantity, newId).doc;
}
function applyNest(doc, newId) {
  const input = prepareLayout(doc, 'nest');
  const result = nestLayout(clipper, input);
  return { doc: D.applyLayout(doc, result, newId), result };
}
function placedPaths(doc, key = 'wide') {
  return D.placedInstances(doc).map((i) => {
    const m = D.getMaster(doc, i.masterId);
    return { i, paths: transformPaths(shapesOf(m)[key], placementMatrix(i.transform, m.desiredSizeMm)) };
  });
}
function minGap(doc, key = 'wide') {
  const list = placedPaths(doc, key);
  let best = Infinity;
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      if (list[a].i.pageId === list[b].i.pageId) best = Math.min(best, pathsDistance(list[a].paths, list[b].paths));
    }
  }
  return best;
}
const cutPaths = (doc) => D.placedInstances(doc).map((i) => {
  const m = D.getMaster(doc, i.masterId);
  return { i, paths: transformPaths(m.cutline.closedPaths, placementMatrix(i.transform, m.desiredSizeMm)) };
});

test('AC-07 Spacing 3 มม.: 10 ชิ้น เส้นตัดทุกคู่ห่างไม่น้อยกว่า 3 มม.', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', starPath(), 50, 50, newId, 2, 10);
  const { doc: done, result } = applyNest(doc, newId);
  assert.equal(result.report.placed, 10);
  assert.equal(result.violations, 0);
  const list = cutPaths(done);
  let best = Infinity;
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      if (list[a].i.pageId === list[b].i.pageId) best = Math.min(best, pathsDistance(list[a].paths, list[b].paths));
    }
  }
  assert.ok(best >= 3, `ใกล้สุด ${best}`);
  assert.equal(validateDocument(done).tooClose.size, 0);
  assert.equal(validateDocument(done).overlapping.size, 0);
  assert.equal(validateDocument(done).outside.size, 0);
});

test('FR-05.2 Nesting ใช้รูปร่างจริง: ดาวลงหน้าได้มากกว่าการเรียงกรอบ', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', starPath(), 60, 60, newId, 1, 16);
  const onOne = { ...doc, settings: { ...doc.settings, layout: { ...doc.settings.layout, autoPages: false, rotationStep: 30 } } };
  const std = standardLayout(prepareLayout(onOne, 'standard'));
  const nest = nestLayout(clipper, prepareLayout(onOne, 'nest'));
  assert.ok(nest.placements.length > std.placements.length, `${nest.placements.length} vs ${std.placements.length}`);
  assert.equal(nest.violations, 0);
  assert.ok(new Set(nest.placements.map((p) => p.rotationDeg)).size >= 2, 'ต้องใช้การหมุนจริง');
  const done = D.applyLayout(onOne, nest, newId);
  assert.equal(validateDocument(done).overlapping.size, 0);
  assert.equal(validateDocument(done).tooClose.size, 0);
});

test('FR-05.2 หมุนตาม step ที่กำหนด', () => {
  assert.deepEqual(rotationList(0), [0]);
  assert.deepEqual(rotationList(90), [0, 90, 180, 270]);
  assert.equal(rotationList(15).length, 24);
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', starPath(), 40, 40, newId, 1, 6);
  const set = { ...doc, settings: { ...doc.settings, layout: { ...doc.settings.layout, rotationStep: 0 } } };
  const res = nestLayout(clipper, prepareLayout(set, 'nest'));
  assert.ok(res.placements.every((p) => p.rotationDeg === 0));
});

test('FR-05.3/AC-09 ชิ้นงานไม่ทับ Margin และ Keep-out ทั้ง Nesting และ Standard', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 40, 40, newId, 2, 14);
  doc = D.addKeepout(doc, { id: 'k1', xMm: 60, yMm: 80, widthMm: 90, heightMm: 70 });
  doc = D.setMargins(doc, { top: 10, right: 15, bottom: 20, left: 5 });
  for (const method of ['nest', 'standard']) {
    const input = prepareLayout(doc, method);
    const res = method === 'nest' ? nestLayout(clipper, input) : standardLayout(input);
    assert.equal(res.placements.length, 14);
    assert.equal(verifyLayout(input, res), 0, method);
    const done = D.applyLayout(doc, res, newId);
    const issues = validateDocument(done);
    assert.equal(issues.inKeepout.size, 0, method);
    assert.equal(issues.outside.size, 0, method);
    assert.equal(issues.tooClose.size, 0, method);
  }
});

test('AC-12 หลายหน้า: จำนวนและสเกลครบ ไม่เสียชิ้นงาน', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', circlePath(), 60, 60, newId, 2, 40);
  const size = doc.masters[0].desiredSizeMm;
  for (const method of ['nest', 'standard']) {
    const input = prepareLayout(doc, method);
    const res = method === 'nest' ? nestLayout(clipper, input) : standardLayout(input);
    assert.equal(res.placements.length, 40);
    assert.equal(res.unplaced.length, 0);
    assert.ok(res.pageCount >= 3);
    assert.equal(verifyLayout(input, res), 0);
    const done = D.applyLayout(doc, res, newId);
    assert.equal(done.pages.length, res.pageCount);
    assert.equal(done.masters[0].quantity, 40);
    assert.equal(done.masters[0].desiredSizeMm, size);
    assert.equal(done.instances.every((i) => i.transform.scaleX === 1), true);
    assert.equal(validateDocument(done).unplaced, 0);
    assert.equal(validateDocument(done).tooClose.size, 0);
  }
});

test('FR-05.5/05.6 ปิดเพิ่มหน้า: รายงานชิ้นที่วางไม่ได้ ไม่ย่อ พื้นที่รวมถูกต้อง', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 60, 60, newId, 2, 40);
  doc = D.setLayoutOptions(doc, { autoPages: false });
  const input = prepareLayout(doc, 'nest');
  const res = nestLayout(clipper, input);
  assert.equal(res.placements.length + res.unplaced.length, 40);
  assert.ok(res.unplaced.length > 0);
  assert.equal(res.pageCount, 1);
  assert.equal(res.report.placed, res.placements.length);
  assert.equal(res.report.unplaced, res.unplaced.length);
  const a = printableArea(doc.paper);
  near(res.report.usedMm2 + res.report.freeMm2, a.width * a.height, 2);
  const done = D.applyLayout(doc, res, newId);
  assert.equal(done.masters[0].quantity, 40);
  assert.equal(validateDocument(done).unplaced, res.unplaced.length);
});

test('ชิ้นใหญ่กว่าหน้า: รายงานว่าวางไม่ได้ ไม่สร้างหน้าวน', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', circlePath(), 280, 280, newId, 2, 2);
  for (const method of ['nest', 'standard']) {
    const input = prepareLayout(doc, method);
    const res = method === 'nest' ? nestLayout(clipper, input) : standardLayout(input);
    assert.equal(res.placements.length, 0);
    assert.equal(res.unplaced.length, 2);
    assert.equal(res.pageCount, 1);
  }
});

test('FR-05.1 Standard เรียงซ้ายไปขวา บนลงล่าง ตามลำดับรายการหรือขนาด และเว้นระยะ', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 0, 2);
  doc = master(doc, 'b', circlePath(), 60, 60, newId, 0, 2);
  doc = D.setSpacing(doc, { spacingMm: 5 });
  doc = D.setLayoutOptions(doc, { sortBy: 'list' });
  const list = standardLayout(prepareLayout(doc, 'standard'));
  const ids = doc.instances.map((i) => i.id);
  assert.deepEqual(list.placements.map((p) => p.id), ids);
  const sized = standardLayout(prepareLayout(D.setLayoutOptions(doc, { sortBy: 'size' }), 'standard'));
  assert.equal(sized.placements[0].id, doc.instances[2].id);
  assert.ok(sized.placements[1].tx > sized.placements[0].tx);
  assert.equal(sized.placements[0].ty, sized.placements[1].ty);
  near(sized.placements[0].tx, 5 , 0.3);
});

test('FR-09.2 Image Spacing วัดจากภาพ แต่เส้นตัดยังห้ามทับกัน (FR-09.6)', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 2, 6);
  doc = D.setSpacing(doc, { spacingMm: 1, spacingMode: 'image' });
  const { doc: done, result } = applyNest(doc, newId);
  assert.equal(result.violations, 0);
  assert.ok(minGap(done, 'image') >= 1);
  assert.ok(minGap(done, 'wide') >= 0.01, 'Envelope ต้องไม่ทับ');
  assert.ok(minGap(done, 'image') >= 4 - 0.15, 'ภาพต้องห่างเท่าเส้นตัดสองเส้นเป็นอย่างน้อย');
});

test('FR-09.6 Bleed ขยาย Envelope ที่ใช้กันทับและกันขอบ', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', circlePath(), 40, 40, newId, 1, 2, 3);
  const shape = doc.masters[0].cutline.shapes;
  const bx = (paths) => { const xs = paths[0].filter((_, i) => i % 2 === 0); return Math.max(...xs) - Math.min(...xs); };
  near(bx(shape.wide), 46, 0.3);
  near(bx(shape.image), 46, 0.3);
  const moved = D.moveInstances(doc, [doc.instances[0].id], { dx: -500, dy: -500 }).doc;
  near(D.boundsOf(moved, moved.instances[0]).x, 5, 1e-6);
  near(moved.instances[0].transform.xMm, 8, 0.15);
});

test('รูปร่างหลังลดจุดยังครอบรูปจริง', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', starPath(), 50, 50, newId, 2, 1);
  const { wide } = doc.masters[0].cutline.shapes;
  const { closedPaths } = doc.masters[0].cutline;
  assert.ok(wide[0].length < closedPaths[0].length / 3, 'ต้องจุดน้อยกว่า');
  assert.ok(Math.abs(signedArea(wide[0])) >= Math.abs(signedArea(closedPaths[0])));
});

test('FR-05 ขนาดจริงมีหลายแบบผสม รวมแบบไม่มีเส้นตัด', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', starPath(), 45, 45, newId, 2, 5);
  doc = master(doc, 'b', circlePath(), 30, 30, newId, 1, 8);
  doc = D.addMaster(doc, art({ id: 'c', widthMm: 50, heightMm: 25 }), newId).doc;
  doc = D.setQuantity(doc, 'c', 6, newId).doc;
  const { doc: done, result } = applyNest(doc, newId);
  assert.equal(result.report.placed, 19);
  assert.equal(result.violations, 0);
  const issues = validateDocument(done);
  for (const key of ['overlapping', 'tooClose', 'outside', 'inKeepout']) assert.equal(issues[key].size, 0, key);
  assert.deepEqual(done.masters.map((m) => m.quantity), [5, 8, 6]);
});

test('transformFromOrigin ให้จุดชิ้นงานตรงกับเมทริกซ์เอกสารทุกมุม', () => {
  for (const deg of [0, 15, 90, 200]) {
    const size = { widthMm: 40, heightMm: 20 };
    const t = D.transformFromOrigin(deg, 12, 34, size);
    const m = placementMatrix(t, size);
    near(m[4], 12); near(m[5], 34);
  }
});

test('FR-09.5 ตรวจระยะห่างตอนจัดเอง: ใกล้เกินถูกแจ้ง ทับกันถูกแจ้งแยก', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 0, 2);
  const [a, b] = doc.instances.map((i) => i.id);
  doc = D.positionInstance(doc, a, 20, 20).doc;
  doc = D.positionInstance(doc, b, 51.5, 20).doc;
  let issues = validateDocument(doc);
  assert.equal(issues.tooClose.size, 2);
  assert.equal(issues.overlapping.size, 0);
  doc = D.positionInstance(doc, b, 40, 20).doc;
  issues = validateDocument(doc);
  assert.equal(issues.overlapping.size, 2);
  doc = D.positionInstance(doc, b, 60, 20).doc;
  issues = validateDocument(doc);
  assert.equal(issues.tooClose.size, 0);
});

test('วางบนมุมโปร่งใส: วงกลมเข้ามุมกันได้เพราะตรวจรูปจริง ไม่ใช่กรอบภาพ', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 0, 2);
  const [a, b] = doc.instances.map((i) => i.id);
  doc = D.positionInstance(doc, a, 20, 20).doc;
  doc = D.positionInstance(doc, b, 45, 45).doc;
  const issues = validateDocument(doc);
  assert.equal(issues.overlapping.size, 0);
  assert.equal(issues.tooClose.size, 0);
});

test('AC-09 ลากเข้าพื้นที่ห้ามวางถูกปฏิเสธ แต่ชิ้นที่ทับอยู่ย้ายออกได้', () => {
  const newId = idGen();
  let doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 2, 1);
  const { id } = doc.instances[0];
  doc = D.addKeepout(doc, { id: 'k', xMm: 60, yMm: 60, widthMm: 50, heightMm: 50 });
  assert.throws(() => D.positionInstance(doc, id, 70, 70), (e) => e instanceof UserError && e.code === 'keepout');
  const flagged = { ...doc, instances: [{ ...doc.instances[0], transform: { ...doc.instances[0].transform, xMm: 70, yMm: 70 } }] };
  assert.equal(validateDocument(flagged).inKeepout.size, 1);
  const out = D.positionInstance(flagged, id, 5, 5).doc;
  assert.equal(validateDocument(out).inKeepout.size, 0);
});

test('Keep-out ตรวจค่า และสำเนาใหม่ไม่ลงพื้นที่ห้ามวาง', () => {
  const newId = idGen();
  let doc = D.createDocument();
  assert.throws(() => D.addKeepout(doc, { id: 'k', xMm: 0, yMm: 0, widthMm: 0, heightMm: 5 }), UserError);
  assert.throws(() => D.addKeepout(doc, { id: 'k', xMm: 200, yMm: 0, widthMm: 50, heightMm: 5 }), UserError);
  doc = D.addKeepout(doc, { id: 'k', xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 });
  doc = D.updateKeepout(doc, 'k', { widthMm: 120 });
  assert.equal(doc.keepouts[0].widthMm, 120);
  doc = D.addMaster(doc, art(), newId).doc;
  assert.equal(validateDocument(doc).inKeepout.size, 0);
  assert.ok(doc.instances[0].transform.xMm >= 120 || doc.instances[0].transform.yMm >= 100);
  assert.equal(D.removeKeepout(doc, 'k').keepouts.length, 0);
});

test('หน้า: เพิ่ม ลบ และชิ้นในหน้าที่ลบกลับเป็นยังไม่ได้วาง ไม่หาย', () => {
  const newId = idGen();
  const big = { widthMm: 195, heightMm: 280 };
  let doc = D.addMaster(D.createDocument(), art(big), newId).doc;
  doc = D.addPage(doc, 'p2');
  doc = D.setQuantity(doc, 'a1', 3, newId).doc;
  assert.equal(doc.instances[1].pageId, 'p2');
  assert.equal(doc.instances[2].placementStatus, 'unplaced');
  const gone = D.removePage(doc, 'p2');
  assert.equal(gone.pages.length, 1);
  assert.equal(gone.masters[0].quantity, 3);
  assert.equal(validateDocument(gone).unplaced, 2);
  assert.throws(() => D.removePage(gone, gone.pages[0].id), UserError);
});

test('การตรวจซ้อนแยกตามหน้า ชิ้นคนละหน้าตำแหน่งเดียวกันไม่ถือว่าทับ', () => {
  const newId = idGen();
  const big = { widthMm: 195, heightMm: 280 };
  let doc = D.addMaster(D.createDocument(), art(big), newId).doc;
  doc = D.addPage(doc, 'p2');
  doc = D.setQuantity(doc, 'a1', 2, newId).doc;
  assert.equal(validateDocument(doc).overlapping.size, 0);
  assert.equal(validateDocument(doc).tooClose.size, 0);
});

test('setBleed ทำให้รูปร่างต้องคำนวณใหม่ และปฏิเสธค่าลบ', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 1, 1);
  const next = D.setBleed(doc, 'a', 2);
  assert.equal(D.needsCutlineRefresh(next.masters[0]), true);
  assert.throws(() => D.setBleed(doc, 'a', -1), UserError);
});

test('setSpacing ค่าเริ่มต้น FR-09 และ migrate v2 เป็น v3', () => {
  const doc = D.createDocument();
  assert.equal(doc.settings.spacingMm, 3);
  assert.equal(doc.settings.spacingMode, 'cutline');
  assert.throws(() => D.setSpacing(doc, { spacingMm: -1 }), UserError);
  const old = { version: 2, settings: { spacingMm: 7, spacingMode: 'image' }, masters: [], instances: [], paper: doc.paper, pages: doc.pages };
  const up = D.assertDocument(D.migrate(old));
  assert.equal(up.version, D.SCHEMA_VERSION);
  assert.deepEqual(up.keepouts, []);
  assert.equal(up.settings.spacingMm, 7);
});

test('Nesting ผลคงที่เมื่อสั่งซ้ำ และงานราว 100 ชิ้นเสร็จในเวลาที่รับได้', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', starPath(), 25, 25, newId, 1, 100);
  const input = prepareLayout(doc, 'nest');
  const t = performance.now();
  const r1 = nestLayout(clipper, input);
  const took = performance.now() - t;
  const r2 = nestLayout(clipper, input);
  assert.deepEqual(r1.placements, r2.placements);
  assert.equal(r1.violations, 0);
  assert.ok(took < 60000, `${took} ms`);
});

test('verifyLayout จับผลที่ละเมิด', () => {
  const newId = idGen();
  const doc = master(D.createDocument(), 'a', circlePath(), 30, 30, newId, 0, 2);
  const input = prepareLayout(doc, 'nest');
  const [a, b] = doc.instances.map((i) => i.id);
  const bad = { placements: [{ id: a, page: 0, rotationDeg: 0, tx: 10, ty: 10 }, { id: b, page: 0, rotationDeg: 0, tx: 15, ty: 10 }] };
  assert.ok(verifyLayout(input, bad) > 0);
  const outside = { placements: [{ id: a, page: 0, rotationDeg: 0, tx: -10, ty: 10 }] };
  assert.ok(verifyLayout(input, outside) > 0);
  assert.ok(keepoutPath({ xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 }).length === 8);
});
