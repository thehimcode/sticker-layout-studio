import {
  placementMatrix, rectContains, rectFits, rectsOverlap,
} from './geometry.js';
import { printableArea } from './paper.js';
import {
  boundsOf, getMaster, hitsKeepout, localEnvelope, placedInstances,
} from './document.js';
import { pathsDistance, shapesOf, transformPaths } from './shape.js';
import { marksOutsidePaper } from './marks.js';

/** ค่าเผื่อการปัดเลขของ Polygon ที่ขยายไว้ก่อนลดจุด */
const SPACING_EPS_MM = 0.02;

/**
 * ตรวจทุกชิ้นด้วยรูปร่างจริง
 * outside: ล้นพื้นที่วางงาน, overlapping: Envelope ทับกัน,
 * tooClose: ระยะห่างต่ำกว่าค่าตั้ง (FR-09.5), inKeepout: ทับพื้นที่ห้ามวาง
 */
export function validateDocument(doc) {
  const area = printableArea(doc.paper);
  const { spacingMm, spacingMode } = doc.settings;
  const key = spacingMode === 'image' ? 'image' : 'wide';
  const items = placedInstances(doc).map((i) => ({ i, id: i.id, bounds: boundsOf(doc, i) }));
  const outside = new Set(items.filter((x) => !rectContains(area, x.bounds)).map((x) => x.id));
  const inKeepout = new Set(items.filter((x) => hitsKeepout(doc, x.i)).map((x) => x.id));
  const oversized = new Set(doc.masters
    .filter((m) => {
      const { width, height } = localEnvelope(m);
      return !rectFits(area, { width, height }) && !rectFits(area, { width: height, height: width });
    })
    .map((m) => m.id));

  const shapeOf = (x, name) => {
    x.paths = x.paths ?? {};
    if (!x.paths[name]) {
      const master = getMaster(doc, x.i.masterId);
      const m = placementMatrix(x.i.transform, master.desiredSizeMm);
      x.paths[name] = transformPaths(shapesOf(master)[name], m);
    }
    return x.paths[name];
  };

  const overlapping = new Set();
  const tooClose = new Set();
  const limit = spacingMm - SPACING_EPS_MM;
  for (const page of doc.pages) {
    const list = items.filter((x) => x.i.pageId === page.id).sort((a, b) => a.bounds.x - b.bounds.x);
    for (let a = 0; a < list.length; a += 1) {
      const p = list[a];
      for (let b = a + 1; b < list.length; b += 1) {
        const q = list[b];
        if (q.bounds.x > p.bounds.x + p.bounds.width + spacingMm) break;
        if (!rectsOverlap(p.bounds, q.bounds, spacingMm)) continue;
        if (pathsDistance(shapeOf(p, 'wide'), shapeOf(q, 'wide')) === 0) {
          overlapping.add(p.id);
          overlapping.add(q.id);
        } else if (limit > 0 && pathsDistance(shapeOf(p, key), shapeOf(q, key), limit - 1e-9) < limit) {
          tooClose.add(p.id);
          tooClose.add(q.id);
        }
      }
    }
  }
  const unplaced = doc.instances.length - items.length;
  return {
    outside, oversized, overlapping, tooClose, inKeepout, unplaced, marksOutside: marksOutsidePaper(doc),
  };
}
