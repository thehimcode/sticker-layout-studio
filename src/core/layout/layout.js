import { differencePaths, minkowskiSum, offsetPaths, unionPaths } from '../contour/clipper-ops.js';
import { pathsBounds, signedArea, simplifyLoop } from '../contour/path.js';
import { printableArea } from '../paper.js';
import { keepoutPath, keepoutRect, pathsDistance, shapesOf } from '../shape.js';
import { rectsOverlap } from '../geometry.js';
import { effectiveKeepouts } from '../marks.js';

/** ค่าเผื่อกันผลปัดเลขใน NFP ให้ระยะจริงไม่ต่ำกว่าค่าตั้ง */
const SAFETY_MM = 0.03;
const EPS = 1e-6;
const MAX_ITEMS_FOR_SECOND_ORDER = 60;
/** เวลา NFP โตตามจำนวนจุดกำลังสอง จึงลดจุดเฉพาะตอนค้นหา ผลสุดท้ายตรวจกับรูปเต็ม */
const MAX_NEST_POINTS = 60;

/** สรุปข้อมูลเป็น Object ธรรมดาเพื่อส่งเข้า Worker */
export function prepareLayout(doc, method) {
  const masters = {};
  for (const m of doc.masters) {
    masters[m.id] = { shapes: shapesOf(m), quantity: m.quantity, name: m.name };
  }
  return {
    method,
    area: printableArea(doc.paper),
    keepouts: effectiveKeepouts(doc).map((k) => ({ path: keepoutPath(k), rect: keepoutRect(k) })),
    spacingMm: doc.settings.spacingMm,
    spacingMode: doc.settings.spacingMode,
    options: doc.settings.layout,
    items: doc.instances.map((i) => ({ id: i.id, masterId: i.masterId, order: doc.masters.findIndex((m) => m.id === i.masterId) })),
    masters,
  };
}

const areaOf = (paths) => paths.reduce((sum, p) => sum + Math.abs(signedArea(p)), 0);

function sortItems(input) {
  const { items, masters, options } = input;
  const size = (item) => areaOf(masters[item.masterId].shapes.wide);
  const list = [...items];
  if (options.sortBy === 'size') list.sort((a, b) => size(b) - size(a) || a.order - b.order);
  else list.sort((a, b) => a.order - b.order);
  return list;
}

function report(input, placements, unplaced, pageCount) {
  const { masters, items, area } = input;
  const used = placements.reduce((sum, p) => {
    const item = items.find((i) => i.id === p.id);
    return sum + areaOf(masters[item.masterId].shapes.wide);
  }, 0);
  const pages = Math.max(1, pageCount);
  const total = area.width * area.height * pages;
  return {
    method: input.method,
    placed: placements.length,
    unplaced: unplaced.length,
    pages,
    usedMm2: Math.round(used),
    freeMm2: Math.round(total - used),
    usedRatio: total ? used / total : 0,
  };
}

/** FR-05.1: เรียงซ้ายไปขวา บนลงล่าง คาดเดาได้ วัดจากกรอบของ Envelope จึงไม่ละเมิดระยะห่าง */
export function standardLayout(input, onProgress = () => {}) {
  const { area, spacingMm, keepouts, options } = input;
  const queue = sortItems(input);
  const placements = [];
  const unplaced = [];
  let page = 0;
  let x = area.x;
  let y = area.y;
  let rowHeight = 0;
  queue.forEach((item, index) => {
    onProgress(index / queue.length);
    const b = pathsBounds(input.masters[item.masterId].shapes.wide);
    if (b.width > area.width + EPS || b.height > area.height + EPS) {
      unplaced.push(item.id);
      return;
    }
    for (;;) {
      if (x + b.width > area.x + area.width + EPS) {
        x = area.x;
        y += rowHeight + spacingMm;
        rowHeight = 0;
      }
      if (y + b.height > area.y + area.height + EPS) {
        if (!options.autoPages) {
          unplaced.push(item.id);
          return;
        }
        page += 1;
        x = area.x;
        y = area.y;
        rowHeight = 0;
      }
      const rect = { x, y, width: b.width, height: b.height };
      const zone = keepouts.find((k) => rectsOverlap(rect, k.rect));
      if (!zone) break;
      x = zone.rect.x + zone.rect.width + spacingMm;
    }
    placements.push({
      id: item.id, page, rotationDeg: 0, tx: x - b.x, ty: y - b.y,
    });
    x += b.width + spacingMm;
    rowHeight = Math.max(rowHeight, b.height);
  });
  const pageCount = placements.reduce((max, p) => Math.max(max, p.page + 1), 1);
  return { placements, unplaced, pageCount, report: report(input, placements, unplaced, pageCount) };
}

const rotate = (paths, deg) => {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return paths.map((path) => {
    const out = new Array(path.length);
    for (let i = 0; i < path.length; i += 2) {
      out[i] = cos * path[i] - sin * path[i + 1];
      out[i + 1] = sin * path[i] + cos * path[i + 1];
    }
    return out;
  });
};
const negate = (path) => path.map((v) => -v);
const translate = (paths, tx, ty) => paths.map((p) => p.map((v, i) => (i % 2 ? v + ty : v + tx)));

export function rotationList(step) {
  if (!step) return [0];
  const out = [];
  for (let a = 0; a < 360 - 1e-9; a += step) out.push(a);
  return out;
}

/**
 * Clipper บวกเฉพาะเส้นขอบ จึงเหลือรูตรงกลางซึ่งคือตำแหน่งที่ชิ้นซ้อนกันทั้งชิ้น ต้องอุดรูทิ้ง
 * ถ้าอุดรูจริงที่ชิ้นเล็กลงไปอยู่ในช่องปิดของชิ้นใหญ่ได้ ก็แค่เสียโอกาส ไม่ทำให้ผลผิด
 */
const solid = (clipper, parts) => unionPaths(clipper, parts).filter((p) => signedArea(p) > 0);

class Nester {
  constructor(clipper, input) {
    this.clipper = clipper;
    this.input = input;
    this.shapes = new Map();
    this.nfps = new Map();
  }

  /** ลดจุดโดยขยายออกก่อนเท่าค่าคลาดเคลื่อน รูปที่ได้จึงครอบรูปจริงเสมอ */
  reduced(paths) {
    return paths.flatMap((path) => {
      if (path.length / 2 <= MAX_NEST_POINTS) return [path];
      for (let tol = 0.1; ; tol *= 1.6) {
        const outer = offsetPaths(this.clipper, [path], tol * 1.05).filter((p) => signedArea(p) > 0);
        const simple = outer.map((p) => simplifyLoop(p, tol));
        if (tol > 4 || simple.every((p) => p.length / 2 <= MAX_NEST_POINTS)) return simple;
      }
    });
  }

  baseShapes(masterId) {
    this.bases = this.bases ?? new Map();
    if (!this.bases.has(masterId)) {
      const { wide, image } = this.input.masters[masterId].shapes;
      this.bases.set(masterId, { wide: this.reduced(wide), image: this.reduced(image) });
    }
    return this.bases.get(masterId);
  }

  shape(masterId, deg) {
    const key = `${masterId}@${deg}`;
    if (!this.shapes.has(key)) {
      const { wide, image } = this.baseShapes(masterId);
      const w = rotate(wide, deg);
      this.shapes.set(key, {
        key, masterId, deg, wide: w, image: rotate(image, deg), bounds: pathsBounds(w),
      });
    }
    return this.shapes.get(key);
  }

  grown(paths, spacing) {
    return spacing > 0 ? offsetPaths(this.clipper, paths, spacing).filter((p) => signedArea(p) > 0) : paths;
  }

  /** No-Fit Polygon ของ a (ตรึงที่จุดกำเนิด) กับ b: จุดอ้างอิงของ b ที่อยู่ในเขตนี้จะผิดเงื่อนไข */
  nfp(a, b) {
    const key = `${a.key}|${b.key}`;
    if (this.nfps.has(key)) return this.nfps.get(key);
    const { spacingMm, spacingMode } = this.input;
    const pairs = [];
    if (spacingMode === 'image') {
      pairs.push([this.grown(a.image, spacingMm + SAFETY_MM), b.image]);
      pairs.push([this.grown(a.wide, SAFETY_MM), b.wide]);
    } else {
      pairs.push([this.grown(a.wide, spacingMm + SAFETY_MM), b.wide]);
    }
    const parts = [];
    for (const [fixed, moving] of pairs) {
      for (const f of fixed) for (const m of moving) parts.push(...minkowskiSum(this.clipper, negate(m), f));
    }
    const result = solid(this.clipper, parts);
    this.nfps.set(key, result);
    return result;
  }

  keepoutNfp(b) {
    const key = `keep|${b.key}`;
    if (this.nfps.has(key)) return this.nfps.get(key);
    const parts = [];
    for (const zone of this.input.keepouts) {
      for (const fixed of this.grown([zone.path], SAFETY_MM)) {
        for (const m of b.wide) parts.push(...minkowskiSum(this.clipper, negate(m), fixed));
      }
    }
    const result = parts.length ? solid(this.clipper, parts) : [];
    this.nfps.set(key, result);
    return result;
  }

  newPage() {
    return { placed: [], forbidden: new Map(), full: new Set() };
  }

  forbiddenOf(page, shape) {
    let entry = page.forbidden.get(shape.key);
    if (!entry) {
      entry = { paths: this.keepoutNfp(shape), seen: 0 };
      page.forbidden.set(shape.key, entry);
    }
    if (entry.seen < page.placed.length) {
      const extra = [];
      for (let i = entry.seen; i < page.placed.length; i += 1) {
        const p = page.placed[i];
        extra.push(...translate(this.nfp(p.shape, shape), p.tx, p.ty));
      }
      entry.paths = unionPaths(this.clipper, [...entry.paths, ...extra]);
      entry.seen = page.placed.length;
    }
    return entry.paths;
  }

  /** ตำแหน่งที่ดีที่สุดของ shape บนหน้า: ขอบล่างต่ำสุด แล้วชิดซ้าย */
  best(page, shape) {
    if (page.full.has(shape.key)) return null;
    const { area } = this.input;
    const b = shape.bounds;
    const minX = area.x - b.x;
    const minY = area.y - b.y;
    const maxX = area.x + area.width - b.x - b.width;
    const maxY = area.y + area.height - b.y - b.height;
    if (maxX < minX - EPS || maxY < minY - EPS) return null;
    const ifr = [minX, minY, Math.max(maxX, minX + 1e-3), minY, Math.max(maxX, minX + 1e-3), Math.max(maxY, minY + 1e-3), minX, Math.max(maxY, minY + 1e-3)];
    const forbidden = this.forbiddenOf(page, shape);
    const free = forbidden.length ? differencePaths(this.clipper, [ifr], forbidden) : [ifr];
    let top = null;
    for (const path of free) {
      if (signedArea(path) < 0 && free.length === 1) continue;
      for (let i = 0; i < path.length; i += 2) {
        if (path[i] < minX - 1e-3 || path[i + 1] < minY - 1e-3 || path[i] > maxX + 1e-3 || path[i + 1] > maxY + 1e-3) continue;
        // Clipper ปัดเลข 0.001 มม. จึงตรึงกลับให้อยู่ในพื้นที่พอดี
        const tx = Math.min(maxX, Math.max(minX, path[i]));
        const ty = Math.min(maxY, Math.max(minY, path[i + 1]));
        const score = (ty + b.y + b.height) * 1000 + tx + b.x + b.width;
        if (!top || score < top.score) top = { tx, ty, score, shape };
      }
    }
    // เขตห้ามมีแต่จะโตขึ้น ถ้าตอนนี้ไม่มีที่ ต่อไปก็ไม่มี จึงข้ามได้
    if (!top) page.full.add(shape.key);
    return top;
  }

  run(order, rotations, autoPages, onProgress) {
    const pages = [this.newPage()];
    const placements = [];
    const unplaced = [];
    order.forEach((item, index) => {
      onProgress(index / order.length);
      const shapes = rotations.map((deg) => this.shape(item.masterId, deg));
      let chosen = null;
      let pageIndex = -1;
      for (let p = 0; p < pages.length && !chosen; p += 1) {
        for (const shape of shapes) {
          const c = this.best(pages[p], shape);
          if (c && (!chosen || c.score < chosen.score)) {
            chosen = c;
            pageIndex = p;
          }
        }
      }
      if (!chosen && autoPages) {
        const page = this.newPage();
        for (const shape of shapes) {
          const c = this.best(page, shape);
          if (c && (!chosen || c.score < chosen.score)) chosen = c;
        }
        if (chosen) {
          pages.push(page);
          pageIndex = pages.length - 1;
        }
      }
      if (!chosen) {
        unplaced.push(item.id);
        return;
      }
      pages[pageIndex].placed.push({ shape: chosen.shape, tx: chosen.tx, ty: chosen.ty });
      placements.push({
        id: item.id, page: pageIndex, rotationDeg: chosen.shape.deg, tx: chosen.tx, ty: chosen.ty,
      });
    });
    return { placements, unplaced, pageCount: pages.length };
  }
}

/**
 * FR-05.2 Smart Nesting ด้วย No-Fit Polygon ของรูปร่างจริง
 * ไม่รับประกันค่าที่ดีที่สุด แต่ผลต้องไม่ละเมิดเงื่อนไข ชิ้นที่ไม่มีที่จะรายงาน ไม่ย่อขนาด
 */
export function nestLayout(clipper, input, onProgress = () => {}) {
  const { options, items, masters } = input;
  const rotations = rotationList(options.rotationStep);
  const nester = new Nester(clipper, input);
  const bySize = sortItems({ ...input, options: { ...options, sortBy: 'size' } });
  const orders = [options.sortBy === 'size' ? bySize : sortItems(input)];
  if (options.sortBy === 'size' && items.length <= MAX_ITEMS_FOR_SECOND_ORDER) {
    const tall = (item) => pathsBounds(masters[item.masterId].shapes.wide).height;
    orders.push([...items].sort((a, b) => tall(b) - tall(a) || a.order - b.order));
  }
  let best = null;
  const lastY = (res) => res.placements.reduce((m, p) => (p.page === res.pageCount - 1 ? Math.max(m, p.ty) : m), 0);
  orders.forEach((order, index) => {
    const result = nester.run(order, rotations, options.autoPages, (v) => onProgress((index + v) / orders.length));
    const better = !best
      || result.unplaced.length < best.unplaced.length
      || (result.unplaced.length === best.unplaced.length
        && (result.pageCount < best.pageCount || (result.pageCount === best.pageCount && lastY(result) < lastY(best))));
    if (better) best = result;
  });
  const violations = verifyLayout(input, best);
  return { ...best, violations, report: { ...report(input, best.placements, best.unplaced, best.pageCount), violations } };
}

/** ตรวจผลซ้ำแบบอิสระจาก NFP: รูปจริงทุกคู่ต้องห่างตามค่าตั้ง อยู่ในพื้นที่ และไม่ทับ Keep-out */
export function verifyLayout(input, result) {
  const { area, keepouts, spacingMm, spacingMode, items, masters } = input;
  const key = spacingMode === 'image' ? 'image' : 'wide';
  const placed = result.placements.map((p) => {
    const { masterId } = items.find((i) => i.id === p.id);
    const set = masters[masterId].shapes;
    const wide = translate(rotate(set.wide, p.rotationDeg), p.tx, p.ty);
    return {
      p, wide, measure: key === 'wide' ? wide : translate(rotate(set.image, p.rotationDeg), p.tx, p.ty), bounds: pathsBounds(wide),
    };
  });
  let violations = 0;
  for (let a = 0; a < placed.length; a += 1) {
    const x = placed[a];
    const b = x.bounds;
    if (b.x < area.x - 1e-3 || b.y < area.y - 1e-3 || b.x + b.width > area.x + area.width + 1e-3
      || b.y + b.height > area.y + area.height + 1e-3) violations += 1;
    if (keepouts.some((k) => rectsOverlap(b, k.rect) && pathsDistance(x.wide, [k.path]) === 0)) violations += 1;
    for (let c = a + 1; c < placed.length; c += 1) {
      const y = placed[c];
      if (y.p.page !== x.p.page || !rectsOverlap(b, y.bounds, spacingMm)) continue;
      if (pathsDistance(x.wide, y.wide) === 0 || pathsDistance(x.measure, y.measure, spacingMm - 0.02) < spacingMm - 0.02) violations += 1;
    }
  }
  return violations;
}
