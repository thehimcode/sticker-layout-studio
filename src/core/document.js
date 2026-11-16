import { UserError } from './errors.js';
import {
  containDelta, localRectBounds, placementMatrix, rectFits, rectsOverlap, unionRects,
} from './geometry.js';
import {
  keepoutPath, keepoutRect, pathsDistance, shapeBounds, shapesOf, transformPaths,
} from './shape.js';
import { printableArea, resolvePaper, validateMargins } from './paper.js';
import { effectiveKeepouts } from './marks.js';
import { EPSILON_MM } from './units.js';

/**
 * Project ตาม Data Model ของ SRS ข้อ 5 แก้ไขแบบ copy-on-write ทุกฟังก์ชันคืนเอกสารใหม่
 * Undo/Redo จึงเก็บแค่การอ้างอิง
 *
 * Master = กราฟิกหนึ่งแบบ ขนาดและค่าเส้นตัดอยู่ที่นี่ (FR-03.4)
 * Instance = หนึ่งชิ้น placementStatus: 'placed' อยู่บนหน้า, 'unplaced' ยังไม่มีที่วาง
 * ชิ้น unplaced ไม่ถูกวาดและไม่นับในการตรวจตำแหน่ง แต่ยังนับรวมในจำนวน
 */
export const SCHEMA_VERSION = 4;
export const MAX_INSTANCES = 2000;
export const MIN_ARTWORK_MM = 1;
export const DEFAULT_SPACING_MM = 3;
export const PAGE_ID = 'page-1';

export function createDocument(id = 'project') {
  return {
    id,
    version: SCHEMA_VERSION,
    name: 'งานใหม่',
    paper: resolvePaper({ preset: 'A4', orientation: 'portrait' }),
    pages: [{ id: PAGE_ID }],
    masters: [],
    instances: [],
    marks: [],
    markSettings: null,
    keepouts: [],
    settings: {
      spacingMm: DEFAULT_SPACING_MM,
      spacingMode: 'cutline', // FR-09.3 ไม่มีเส้นตัดจะวัดจากภาพเอง
      layout: {
        sortBy: 'size', rotationStep: 90, autoPages: true,
      },
    },
    lastLayout: null,
  };
}

export const getMaster = (doc, id) => doc.masters.find((m) => m.id === id);
export const getInstance = (doc, id) => doc.instances.find((i) => i.id === id);
export const instancesOf = (doc, masterId) => doc.instances.filter((i) => i.masterId === masterId);
export const placedInstances = (doc, pageId = null) => doc.instances.filter(
  (i) => i.placementStatus === 'placed' && (pageId === null || i.pageId === pageId),
);

/**
 * Envelope ในพิกัดชิ้นงาน: กรอบที่รวมภาพและเส้นตัด (FR-08.3)
 * ระยะที่เส้นตัดยื่นจากภาพคงเป็น มม. จึงใช้ได้ระหว่างรอคำนวณใหม่หลังแก้ขนาด
 */
export function localEnvelope(master, size = master.desiredSizeMm) {
  const envelope = master.cutline?.envelopeMm;
  if (!envelope) return { x: 0, y: 0, width: size.widthMm, height: size.heightMm };
  const base = master.cutline.sizeMm;
  const left = Math.min(0, envelope.x);
  const top = Math.min(0, envelope.y);
  const right = Math.max(0, envelope.x + envelope.width - base.widthMm);
  const bottom = Math.max(0, envelope.y + envelope.height - base.heightMm);
  return { x: left, y: top, width: size.widthMm + right - left, height: size.heightMm + bottom - top };
}

const envelopeBounds = (transform, master, size = master.desiredSizeMm) => {
  if (size === master.desiredSizeMm && !master.cutline?.stale && master.cutline?.shapes) {
    return shapeBounds(transform, master);
  }
  return localRectBounds(transform, size, localEnvelope(master, size));
};
export const boundsOf = (doc, instance) => envelopeBounds(instance.transform, getMaster(doc, instance.masterId));

export function hitsKeepout(doc, instance) {
  const all = effectiveKeepouts(doc);
  if (!all.length) return false;
  const bounds = boundsOf(doc, instance);
  const zones = all.filter((k) => rectsOverlap(bounds, keepoutRect(k)));
  if (!zones.length) return false;
  const master = getMaster(doc, instance.masterId);
  const m = placementMatrix(instance.transform, master.desiredSizeMm);
  const paths = transformPaths(shapesOf(master).wide, m);
  return pathsDistance(paths, zones.map(keepoutPath)) === 0;
}

function requireMaster(doc, id) {
  const master = getMaster(doc, id);
  if (!master) throw new UserError('master-missing', 'ไม่พบแบบงานที่เลือก');
  return master;
}

function requireInstances(doc, ids) {
  const set = new Set(ids);
  const found = doc.instances.filter((i) => set.has(i.id) && i.placementStatus === 'placed');
  if (!found.length) throw new UserError('instance-missing', 'ไม่พบชิ้นงานที่เลือก');
  return found;
}

const shifted = (instance, dx, dy) => ({
  ...instance,
  transform: { ...instance.transform, xMm: instance.transform.xMm + dx, yMm: instance.transform.yMm + dy },
});

function replaceInstances(doc, changed) {
  const byId = new Map(changed.map((i) => [i.id, i]));
  return { ...doc, instances: doc.instances.map((i) => byId.get(i.id) ?? i) };
}

/** จำนวนใน Master ต้องตรงกับ Instance เสมอ ทุกคำสั่งที่เพิ่มหรือลดชิ้นต้องผ่านจุดนี้ */
function syncQuantities(doc) {
  const counts = new Map();
  for (const i of doc.instances) counts.set(i.masterId, (counts.get(i.masterId) ?? 0) + 1);
  return {
    ...doc,
    masters: doc.masters.map((m) => {
      const quantity = counts.get(m.id) ?? 0;
      return m.quantity === quantity ? m : { ...m, quantity };
    }),
  };
}

/** FR-08.5: เปลี่ยนกระดาษไม่ย้ายหรือ Scale ชิ้นงาน ให้ validateDocument แจ้งชิ้นที่ไม่ถูกต้อง */
export function setPaper(doc, spec) {
  const paper = resolvePaper({ ...spec, marginsMm: doc.paper.marginsMm });
  printableArea(paper);
  return { ...doc, paper };
}

export function setMargins(doc, patch) {
  const marginsMm = { ...doc.paper.marginsMm, ...patch };
  validateMargins(marginsMm);
  const paper = { ...doc.paper, marginsMm };
  printableArea(paper);
  return { ...doc, paper };
}

export function setName(doc, name) {
  const trimmed = name.trim();
  if (!trimmed) throw new UserError('name-empty', 'กรุณาตั้งชื่องาน');
  return { ...doc, name: trimmed };
}

/**
 * หาตำแหน่งว่างแรกจากซ้ายบนด้วยกรอบสี่เหลี่ยม ใช้วางชิ้นใหม่เท่านั้น
 * ไม่ใช่ระบบจัดเรียง (Standard Layout และ Nesting อยู่ใน M3) คืน null เมื่อไม่มีที่ว่าง
 */
export function findFreeSpot(area, occupied, size, gap) {
  if (!rectFits(area, size)) return null;
  const xs = [...new Set([area.x, ...occupied.map((r) => r.x + r.width + gap)])].sort((a, b) => a - b);
  const ys = [...new Set([area.y, ...occupied.map((r) => r.y + r.height + gap)])].sort((a, b) => a - b);
  const maxX = area.x + area.width - size.width + EPSILON_MM;
  const maxY = area.y + area.height - size.height + EPSILON_MM;
  for (const y of ys) {
    if (y > maxY) break;
    for (const x of xs) {
      if (x > maxX) break;
      const candidate = { x, y, width: size.width, height: size.height };
      if (!occupied.some((r) => rectsOverlap(candidate, r, gap))) return { x, y };
    }
  }
  return null;
}

/** พื้นที่ถูกใช้ต่อหน้า รวมพื้นที่ห้ามวาง */
function occupiedMap(doc) {
  const keepouts = effectiveKeepouts(doc).map(keepoutRect);
  const map = new Map(doc.pages.map((p) => [p.id, [...keepouts]]));
  for (const i of placedInstances(doc)) map.get(i.pageId)?.push(boundsOf(doc, i));
  return map;
}

/** วางชิ้นลงที่ว่างหน้าแรกที่พอ ถ้าไม่มีจะเป็น unplaced คงจำนวนไว้ ไม่ซ้อนและไม่ย่อขนาด */
function tryPlace(instance, master, area, occupied, gap) {
  const bounds = envelopeBounds(instance.transform, master);
  for (const [pageId, list] of occupied) {
    const spot = findFreeSpot(area, list, bounds, gap);
    if (spot) {
      const next = shifted(instance, spot.x - bounds.x, spot.y - bounds.y);
      list.push({ ...bounds, x: spot.x, y: spot.y });
      return { ...next, pageId, placementStatus: 'placed' };
    }
  }
  return { ...instance, pageId: null, placementStatus: 'unplaced' };
}

const newInstance = (id, masterId, rotationDeg = 0) => ({
  id,
  masterId,
  pageId: null,
  transform: { xMm: 0, yMm: 0, rotationDeg, scaleX: 1, scaleY: 1 },
  placementStatus: 'unplaced',
});

function addInstances(doc, seeds) {
  if (doc.instances.length + seeds.length > MAX_INSTANCES) {
    throw new UserError('too-many', `โปรเจกต์หนึ่งมีได้ไม่เกิน ${MAX_INSTANCES} ชิ้น`);
  }
  const area = printableArea(doc.paper);
  const occupied = occupiedMap(doc);
  const gap = doc.settings.spacingMm;
  const added = seeds.map((seed) => tryPlace(seed, getMaster(doc, seed.masterId), area, occupied, gap));
  return {
    doc: syncQuantities({ ...doc, instances: [...doc.instances, ...added] }),
    added,
    unplaced: added.filter((i) => i.placementStatus === 'unplaced').length,
  };
}

/** input: { id, name, originalAsset, sourceType, naturalSize, desiredSizeMm } at: จุดกึ่งกลางที่ต้องการ (มม.) */
export function addMaster(doc, input, newId, at = null) {
  const master = {
    ...input, lockAspect: true, quantity: 0, cutlineConfig: null, contours: null, cutline: null, bleedMm: 0,
  };
  const withMaster = { ...doc, masters: [...doc.masters, master] };
  const result = addInstances(withMaster, [newInstance(newId(), master.id)]);
  const [instance] = result.added;
  if (!at || instance.placementStatus !== 'placed') return result;
  const { widthMm, heightMm } = master.desiredSizeMm;
  const moved = moveInstances(result.doc, [instance.id], {
    dx: at.x - widthMm / 2 - instance.transform.xMm,
    dy: at.y - heightMm / 2 - instance.transform.yMm,
  }).doc;
  return { ...result, doc: moved, added: [getInstance(moved, instance.id)] };
}

/** FR-03.1 จำนวนเป็นจำนวนเต็ม ≥ 0, FR-03.6 ลดโดยเอาชิ้นที่ยังไม่ได้วางออกก่อน แล้วจึงชิ้นล่าสุด */
export function setQuantity(doc, masterId, quantity, newId) {
  requireMaster(doc, masterId);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new UserError('quantity-invalid', 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  }
  const current = instancesOf(doc, masterId);
  if (quantity > current.length) {
    const seeds = Array.from({ length: quantity - current.length }, () => newInstance(newId(), masterId));
    return addInstances(doc, seeds);
  }
  const order = [
    ...current.filter((i) => i.placementStatus === 'unplaced').reverse(),
    ...current.filter((i) => i.placementStatus === 'placed').reverse(),
  ];
  const removed = new Set(order.slice(0, current.length - quantity).map((i) => i.id));
  return {
    doc: syncQuantities({ ...doc, instances: doc.instances.filter((i) => !removed.has(i.id)) }),
    added: [],
    unplaced: 0,
  };
}

export function duplicateInstances(doc, ids, newId) {
  const seeds = requireInstances(doc, ids).map((i) => ({
    ...newInstance(newId(), i.masterId, i.transform.rotationDeg),
    transform: { ...i.transform },
  }));
  return addInstances(doc, seeds);
}

/** ลองวางชิ้นที่ค้างอยู่อีกครั้ง */
export function placePending(doc) {
  const area = printableArea(doc.paper);
  const occupied = occupiedMap(doc);
  const placed = doc.instances
    .filter((i) => i.placementStatus === 'unplaced')
    .map((i) => tryPlace(i, getMaster(doc, i.masterId), area, occupied, doc.settings.spacingMm));
  return {
    doc: replaceInstances(doc, placed),
    remaining: placed.filter((i) => i.placementStatus === 'unplaced').length,
  };
}

/**
 * เลื่อนชิ้นงานหนึ่งกลุ่มเป็นก้อนเดียว ถ้าเกินพื้นที่จะ Clamp ทั้งกลุ่ม (FR-08.4)
 * คืน { doc, clamped } เพื่อให้ UI แจ้งผู้ใช้
 */
export function moveInstances(doc, ids, { dx, dy }) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new UserError('position-invalid', 'ตำแหน่งต้องเป็นตัวเลข');
  }
  const targets = requireInstances(doc, ids);
  const area = printableArea(doc.paper);
  const moved = targets.map((i) => shifted(i, dx, dy));
  const union = unionRects(moved.map((i) => boundsOf(doc, i)));
  if (!rectFits(area, union)) throw new UserError('group-no-fit', 'ชิ้นงานที่เลือกใหญ่เกินพื้นที่วางงาน');
  const fix = containDelta(area, union);
  const clamped = Math.abs(fix.dx) > EPSILON_MM || Math.abs(fix.dy) > EPSILON_MM;
  const final = moved.map((i) => shifted(i, fix.dx, fix.dy));
  if (final.some((i) => hitsKeepout(doc, i))) {
    throw new UserError('keepout', 'ตำแหน่งนี้ทับพื้นที่ห้ามวาง');
  }
  return { doc: replaceInstances(doc, final), clamped };
}

/** ตั้งตำแหน่งแบบระบุค่า ถ้าเกินพื้นที่จะ Clamp */
export function positionInstance(doc, id, xMm, yMm) {
  const [instance] = requireInstances(doc, [id]);
  return moveInstances(doc, [id], { dx: xMm - instance.transform.xMm, dy: yMm - instance.transform.yMm });
}

function containIn(doc, instance, area) {
  const bounds = boundsOf(doc, instance);
  if (!rectFits(area, bounds)) return null;
  const { dx, dy } = containDelta(area, bounds);
  return shifted(instance, dx, dy);
}

/** ปุ่มแก้ไขตามคำขอผู้ใช้ เลื่อนชิ้นที่ล้นกลับเข้าพื้นที่ ไม่ Scale คืนจำนวนชิ้นที่ยังใหญ่เกิน */
export function pullInside(doc) {
  const area = printableArea(doc.paper);
  let oversized = 0;
  const changed = [];
  for (const instance of placedInstances(doc)) {
    const next = containIn(doc, instance, area);
    if (next) changed.push(next);
    else oversized += 1;
  }
  return { doc: replaceInstances(doc, changed), oversized };
}

/** rotate: ฟังก์ชันรับมุมเดิม คืนมุมใหม่ */
export function rotateInstances(doc, ids, rotate) {
  const area = printableArea(doc.paper);
  const changed = requireInstances(doc, ids).map((instance) => {
    const value = rotate(instance.transform.rotationDeg);
    if (!Number.isFinite(value)) throw new UserError('rotation-invalid', 'มุมต้องเป็นตัวเลข');
    const rotationDeg = ((value % 360) + 360) % 360;
    const next = containIn(doc, { ...instance, transform: { ...instance.transform, rotationDeg } }, area);
    if (!next) throw new UserError('rotation-no-fit', 'หมุนมุมนี้แล้วชิ้นงานใหญ่เกินพื้นที่วางงาน');
    return next;
  });
  return replaceInstances(doc, changed);
}

/** ขนาดเป็นของ Master จึงมีผลกับทุกชิ้น การย่อขยายคงจุดกึ่งกลางของแต่ละชิ้น */
export function resizeMaster(doc, masterId, widthMm, heightMm) {
  const master = requireMaster(doc, masterId);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)
    || widthMm < MIN_ARTWORK_MM || heightMm < MIN_ARTWORK_MM) {
    throw new UserError('size-invalid', `ขนาดชิ้นงานต้องไม่ต่ำกว่า ${MIN_ARTWORK_MM} มม.`);
  }
  const old = master.desiredSizeMm;
  const next = {
    ...master,
    desiredSizeMm: { widthMm, heightMm },
    // ขนาดเปลี่ยนต้องคำนวณเส้นตัดใหม่จาก Geometry ไม่ Scale เส้นเดิม (FR-04.8)
    cutline: master.cutline ? { ...master.cutline, stale: true } : null,
  };
  const resized = { ...doc, masters: doc.masters.map((m) => (m.id === masterId ? next : m)) };
  const area = printableArea(doc.paper);
  const changed = instancesOf(doc, masterId)
    .filter((i) => i.placementStatus === 'placed')
    .map((i) => {
      const recentred = shifted(i, (old.widthMm - widthMm) / 2, (old.heightMm - heightMm) / 2);
      const next = containIn(resized, recentred, area);
      if (!next) throw new UserError('size-no-fit', 'ขนาดนี้ใหญ่เกินพื้นที่วางงาน');
      return next;
    });
  return replaceInstances(resized, changed);
}

/**
 * ใช้ผลจากการลากมุม ชิ้นที่ลากใช้ตำแหน่งที่คำนวณ ชิ้นอื่นคงจุดกึ่งกลาง
 * throw เมื่อชิ้นที่ลากจะล้นพื้นที่ เพื่อให้ UI หาค่าที่ชิดขอบพอดี
 */
export function applyHandleResize(doc, instanceId, result) {
  const [instance] = requireInstances(doc, [instanceId]);
  const area = printableArea(doc.paper);
  const size = { widthMm: result.widthMm, heightMm: result.heightMm };
  const transform = { ...instance.transform, xMm: result.xMm, yMm: result.yMm };
  const bounds = envelopeBounds(transform, getMaster(doc, instance.masterId), size);
  const delta = rectFits(area, bounds) ? containDelta(area, bounds) : { dx: 1, dy: 1 };
  if (Math.abs(delta.dx) > EPSILON_MM || Math.abs(delta.dy) > EPSILON_MM) {
    throw new UserError('size-no-fit', 'ขนาดนี้ล้นพื้นที่วางงาน');
  }
  const resized = resizeMaster(doc, instance.masterId, result.widthMm, result.heightMm);
  return replaceInstances(resized, [{ ...getInstance(resized, instanceId), transform }]);
}

/** เส้นตัดที่ต้องคำนวณใหม่: ขนาดเปลี่ยน หรือเป็นงานรุ่นก่อนที่ยังไม่มีเส้นโค้ง */
export const needsCutlineRefresh = (master) => Boolean(
  master.cutline && (master.cutline.stale || !master.cutline.curves || master.cutline.shapes === undefined),
);

function updateMaster(doc, masterId, patch) {
  requireMaster(doc, masterId);
  return { ...doc, masters: doc.masters.map((m) => (m.id === masterId ? { ...m, ...patch } : m)) };
}

/** บันทึกผลจากตัวแก้เส้นตัด contourPaths เป็นพิกัดพิกเซลของภาพต้นฉบับ */
export function setCutline(doc, masterId, { config, contourPaths, cutline }) {
  return updateMaster(doc, masterId, { cutlineConfig: config, contours: { paths: contourPaths }, cutline });
}

export const clearCutline = (doc, masterId) => updateMaster(doc, masterId, {
  cutlineConfig: null, contours: null, cutline: null,
});

/** แทนเส้นตัดด้วยผลคำนวณใหม่ของขนาดปัจจุบัน Contour และค่าตั้งเดิมไม่เปลี่ยน */
export function refreshCutline(doc, masterId, cutline) {
  const master = requireMaster(doc, masterId);
  return updateMaster(doc, masterId, {
    cutline: { ...cutline, geometryVersion: (master.cutline?.geometryVersion ?? 0) + 1 },
  });
}

/** Bleed เป็นของแบบ มีผลกับ Envelope จึงต้องคำนวณรูปร่างใหม่ */
export function setBleed(doc, masterId, bleedMm) {
  const master = requireMaster(doc, masterId);
  if (!Number.isFinite(bleedMm) || bleedMm < 0) throw new UserError('bleed-invalid', 'Bleed ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return updateMaster(doc, masterId, {
    bleedMm,
    cutline: master.cutline ? { ...master.cutline, stale: true } : null,
  });
}

export function setSpacing(doc, { spacingMm, spacingMode }) {
  const settings = { ...doc.settings };
  if (spacingMm !== undefined) {
    if (!Number.isFinite(spacingMm) || spacingMm < 0) throw new UserError('spacing-invalid', 'ระยะห่างต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    settings.spacingMm = spacingMm;
  }
  if (spacingMode) settings.spacingMode = spacingMode;
  return { ...doc, settings };
}

export function setLayoutOptions(doc, patch) {
  return { ...doc, settings: { ...doc.settings, layout: { ...doc.settings.layout, ...patch } } };
}

function validKeepout(doc, zone) {
  const { paper } = doc;
  if (![zone.xMm, zone.yMm, zone.widthMm, zone.heightMm].every(Number.isFinite)
    || zone.widthMm <= 0 || zone.heightMm <= 0) {
    throw new UserError('keepout-invalid', 'พื้นที่ห้ามวางต้องมีความกว้างและความสูงมากกว่า 0');
  }
  if (zone.xMm < 0 || zone.yMm < 0 || zone.xMm + zone.widthMm > paper.widthMm + EPSILON_MM
    || zone.yMm + zone.heightMm > paper.heightMm + EPSILON_MM) {
    throw new UserError('keepout-outside', 'พื้นที่ห้ามวางต้องอยู่บนกระดาษ');
  }
}

export function addKeepout(doc, zone) {
  validKeepout(doc, zone);
  return { ...doc, keepouts: [...doc.keepouts, zone] };
}

export function updateKeepout(doc, id, patch) {
  const current = doc.keepouts.find((k) => k.id === id);
  if (!current) throw new UserError('keepout-missing', 'ไม่พบพื้นที่ห้ามวาง');
  const zone = { ...current, ...patch };
  validKeepout(doc, zone);
  return { ...doc, keepouts: doc.keepouts.map((k) => (k.id === id ? zone : k)) };
}

export const removeKeepout = (doc, id) => ({ ...doc, keepouts: doc.keepouts.filter((k) => k.id !== id) });

export const addPage = (doc, id) => ({ ...doc, pages: [...doc.pages, { id }] });

/** ลบหน้า ชิ้นงานในหน้านั้นไม่หาย แต่กลับเป็นยังไม่ได้วาง */
export function removePage(doc, pageId) {
  if (doc.pages.length <= 1) throw new UserError('page-last', 'ต้องมีอย่างน้อย 1 หน้า');
  return {
    ...doc,
    pages: doc.pages.filter((p) => p.id !== pageId),
    instances: doc.instances.map((i) => (i.pageId === pageId
      ? { ...i, pageId: null, placementStatus: 'unplaced' }
      : i)),
  };
}

/** แปลงตำแหน่งแบบ "จุด 0,0 ของชิ้นงานหลังหมุนไปอยู่ที่ tx,ty" เป็น transform ของเอกสาร */
export function transformFromOrigin(rotationDeg, tx, ty, size) {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const hw = size.widthMm / 2;
  const hh = size.heightMm / 2;
  return {
    xMm: tx + cos * hw - sin * hh - hw,
    yMm: ty + sin * hw + cos * hh - hh,
    rotationDeg,
    scaleX: 1,
    scaleY: 1,
  };
}

/** ใช้ผลการจัดเรียงเป็นหนึ่งขั้น Undo จำนวนและขนาดไม่เปลี่ยน */
export function applyLayout(doc, result, newId) {
  const pages = result.pageCount <= doc.pages.length
    ? doc.pages.slice(0, Math.max(1, result.pageCount))
    : [...doc.pages, ...Array.from({ length: result.pageCount - doc.pages.length }, () => ({ id: newId() }))];
  const placements = new Map(result.placements.map((p) => [p.id, p]));
  const instances = doc.instances.map((i) => {
    const p = placements.get(i.id);
    if (!p) return { ...i, pageId: null, placementStatus: 'unplaced' };
    const { desiredSizeMm } = getMaster(doc, i.masterId);
    return {
      ...i,
      pageId: pages[p.page].id,
      placementStatus: 'placed',
      transform: transformFromOrigin(p.rotationDeg, p.tx, p.ty, desiredSizeMm),
    };
  });
  return { ...doc, pages, instances, lastLayout: result.report };
}

export function setLockAspect(doc, masterId, lockAspect) {
  requireMaster(doc, masterId);
  return { ...doc, masters: doc.masters.map((m) => (m.id === masterId ? { ...m, lockAspect } : m)) };
}

export function removeMaster(doc, masterId) {
  return {
    ...doc,
    masters: doc.masters.filter((m) => m.id !== masterId),
    instances: doc.instances.filter((i) => i.masterId !== masterId),
  };
}

/** ลบชิ้นงาน Master ยังอยู่แม้จำนวนเหลือ 0 (FR-03.1) */
export function removeInstances(doc, ids) {
  const set = new Set(ids);
  return syncQuantities({ ...doc, instances: doc.instances.filter((i) => !set.has(i.id)) });
}

/**
 * จัดแนว edge: left, hcenter, right, top, vcenter, bottom
 * หลายชิ้นจัดเทียบกรอบรวม ชิ้นเดียวจัดเทียบพื้นที่วางงาน
 */
export function alignInstances(doc, ids, edge) {
  const targets = requireInstances(doc, ids);
  const area = printableArea(doc.paper);
  const items = targets.map((i) => ({ instance: i, b: boundsOf(doc, i) }));
  const ref = targets.length > 1 ? unionRects(items.map((i) => i.b)) : area;
  const offset = {
    left: (b) => [ref.x - b.x, 0],
    hcenter: (b) => [ref.x + ref.width / 2 - b.x - b.width / 2, 0],
    right: (b) => [ref.x + ref.width - b.x - b.width, 0],
    top: (b) => [0, ref.y - b.y],
    vcenter: (b) => [0, ref.y + ref.height / 2 - b.y - b.height / 2],
    bottom: (b) => [0, ref.y + ref.height - b.y - b.height],
  }[edge];
  return replaceInstances(doc, items.map(({ instance, b }) => {
    const [dx, dy] = offset(b);
    return shifted(instance, dx, dy);
  }));
}

/** จัดลำดับชั้น: ตำแหน่งท้ายอาร์เรย์คือชั้นบนสุด direction: front, forward, backward, back */
export function reorderInstances(doc, ids, direction) {
  const set = new Set(ids);
  const picked = doc.instances.filter((i) => set.has(i.id));
  const rest = doc.instances.filter((i) => !set.has(i.id));
  if (direction === 'front') return { ...doc, instances: [...rest, ...picked] };
  if (direction === 'back') return { ...doc, instances: [...picked, ...rest] };
  const list = [...doc.instances];
  const step = direction === 'forward' ? 1 : -1;
  const order = step > 0 ? [...list.keys()].reverse() : [...list.keys()];
  for (const index of order) {
    const other = index + step;
    if (set.has(list[index].id) && other >= 0 && other < list.length && !set.has(list[other].id)) {
      [list[index], list[other]] = [list[other], list[index]];
    }
  }
  return { ...doc, instances: list };
}

/** แปลงงานที่บันทึกจากรุ่นก่อนหน้า */
export function migrate(saved) {
  if (saved?.version === 2) {
    return migrate({
      ...saved,
      version: 3,
      keepouts: [],
      lastLayout: null,
      settings: { ...createDocument().settings, spacingMm: saved.settings.spacingMm },
    });
  }
  if (saved?.version === 3) {
    // M4: มาร์คของรุ่นก่อนเป็นอาร์เรย์ว่างเสมอ เพิ่มค่าตั้งมาร์ค
    return { ...saved, version: SCHEMA_VERSION, marks: saved.marks ?? [], markSettings: null };
  }
  if (saved?.version === SCHEMA_VERSION || saved?.schemaVersion !== 1) return saved;
  const paper = {
    preset: saved.paper.preset === 'A3+' ? 'Super A3' : saved.paper.preset,
    orientation: saved.paper.orientation,
    widthMm: saved.paper.widthMm,
    heightMm: saved.paper.heightMm,
    marginsMm: saved.margins,
  };
  const masters = saved.artworks.map((a) => ({
    id: a.id,
    name: a.name,
    originalAsset: { assetId: a.assetId },
    sourceType: /\.jpe?g$/i.test(a.name) ? 'jpeg' : 'png',
    naturalSize: { widthPx: a.pixelWidth, heightPx: a.pixelHeight, dpi: a.sourceDpi },
    desiredSizeMm: { widthMm: a.widthMm, heightMm: a.heightMm },
    lockAspect: a.lockAspect,
    quantity: 0,
    cutlineConfig: null,
    contours: null,
    cutline: null,
    bleedMm: 0,
  }));
  const instances = saved.placements.map((p) => ({
    id: p.id,
    masterId: p.artworkId,
    pageId: PAGE_ID,
    transform: { xMm: p.x, yMm: p.y, rotationDeg: p.rotation, scaleX: 1, scaleY: 1 },
    placementStatus: 'placed',
  }));
  return syncQuantities({
    ...createDocument(), name: saved.name, paper, masters, instances,
  });
}

/** ตรวจเอกสารที่อ่านจากที่เก็บข้อมูล ก่อนนำมาใช้งาน */
export function assertDocument(doc) {
  if (!doc || doc.version !== SCHEMA_VERSION
    || !Array.isArray(doc.masters) || !Array.isArray(doc.instances) || !Array.isArray(doc.marks)) {
    throw new UserError('doc-invalid', 'ข้อมูลงานที่บันทึกไว้ใช้ไม่ได้');
  }
  validateMargins(doc.paper.marginsMm);
  printableArea(doc.paper);
  const ids = new Set(doc.masters.map((m) => m.id));
  if (!doc.instances.every((i) => ids.has(i.masterId))) {
    throw new UserError('doc-invalid', 'ข้อมูลงานที่บันทึกไว้ไม่ครบ');
  }
  return doc;
}
