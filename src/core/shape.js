import { applyMatrix, boundsOfPoints, placementMatrix } from './geometry.js';

/**
 * รูปร่างจริงของชิ้นงาน ใช้ทั้งการตรวจในหน้าหลักและ Nesting ใน Worker
 * wide  = Envelope ที่กว้างที่สุด: ภาพ + Bleed + เส้นตัด (FR-09.6)
 * image = ขอบภาพ + Bleed
 * Path เป็น flat ในพิกัดชิ้นงาน (มม.)
 */
export function rectPath(x, y, width, height) {
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

export function fallbackPath(master, size = master.desiredSizeMm) {
  const envelope = master.cutline?.envelopeMm;
  const b = master.bleedMm ?? 0;
  let left = -b;
  let top = -b;
  let right = size.widthMm + b;
  let bottom = size.heightMm + b;
  if (envelope) {
    const base = master.cutline.sizeMm;
    left = Math.min(left, envelope.x);
    top = Math.min(top, envelope.y);
    right = Math.max(right, size.widthMm + envelope.x + envelope.width - base.widthMm);
    bottom = Math.max(bottom, size.heightMm + envelope.y + envelope.height - base.heightMm);
  }
  return rectPath(left, top, right - left, bottom - top);
}

/** รูปร่างล่าสุดของแบบ ระหว่างรอคำนวณใหม่ใช้กรอบสี่เหลี่ยมที่ปลอดภัย */
export function shapesOf(master) {
  const { cutline } = master;
  if (cutline?.shapes && !cutline.stale) return cutline.shapes;
  const rect = [fallbackPath(master)];
  return { wide: rect, image: rect };
}

export function convexHull(paths) {
  const pts = [];
  for (const path of paths) for (let i = 0; i < path.length; i += 2) pts.push({ x: path[i], y: path[i + 1] });
  pts.sort((p, q) => p.x - q.x || p.y - q.y);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

const hullCache = new WeakMap();
function hullOf(master) {
  const { wide } = shapesOf(master);
  let hull = hullCache.get(wide);
  if (!hull) {
    hull = convexHull(wide);
    hullCache.set(wide, hull);
  }
  return hull;
}

/** กรอบบนกระดาษจาก Convex Hull ของรูปร่างจริง จึงแคบกว่ากรอบสี่เหลี่ยมหมุน */
export function shapeBounds(transform, master) {
  const m = placementMatrix(transform, master.desiredSizeMm);
  return boundsOfPoints(hullOf(master).map((p) => applyMatrix(m, p)));
}

export function transformPaths(paths, m) {
  return paths.map((path) => {
    const out = new Array(path.length);
    for (let i = 0; i < path.length; i += 2) {
      out[i] = m[0] * path[i] + m[2] * path[i + 1] + m[4];
      out[i + 1] = m[1] * path[i] + m[3] * path[i + 1] + m[5];
    }
    return out;
  });
}

export function pointInPolygon(x, y, path) {
  let inside = false;
  const n = path.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = path[i + 1];
    const yj = path[j + 1];
    if ((yi > y) !== (yj > y)
      && x < ((path[j] - path[i]) * (y - yi)) / (yj - yi) + path[i]) inside = !inside;
  }
  return inside;
}

function segDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = dx - cx;
  const vy = dy - cy;
  const cross = ux * vy - uy * vx;
  if (cross !== 0) {
    const t = ((cx - ax) * vy - (cy - ay) * vx) / cross;
    const s = ((cx - ax) * uy - (cy - ay) * ux) / cross;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0;
  }
  const point = (px, py, qx, qy, wx, wy) => {
    const len = wx * wx + wy * wy;
    const t = len ? Math.max(0, Math.min(1, ((px - qx) * wx + (py - qy) * wy) / len)) : 0;
    return Math.hypot(px - qx - t * wx, py - qy - t * wy);
  };
  return Math.min(
    point(ax, ay, cx, cy, vx, vy),
    point(bx, by, cx, cy, vx, vy),
    point(cx, cy, ax, ay, ux, uy),
    point(dx, dy, ax, ay, ux, uy),
  );
}

/** ระยะใกล้สุดระหว่างชุด Polygon คืน 0 เมื่อทับหรือซ้อนอยู่ข้างใน หยุดทันทีเมื่อต่ำกว่า stopBelow */
export function pathsDistance(a, b, stopBelow = 0) {
  for (const p of a) if (b.some((q) => pointInPolygon(p[0], p[1], q))) return 0;
  for (const q of b) if (a.some((p) => pointInPolygon(q[0], q[1], p))) return 0;
  let best = Infinity;
  for (const p of a) {
    const n = p.length;
    for (const q of b) {
      const m = q.length;
      for (let i = 0; i < n; i += 2) {
        const i2 = (i + 2) % n;
        for (let j = 0; j < m; j += 2) {
          const j2 = (j + 2) % m;
          const d = segDist(p[i], p[i + 1], p[i2], p[i2 + 1], q[j], q[j + 1], q[j2], q[j2 + 1]);
          if (d < best) {
            best = d;
            if (best <= stopBelow) return best;
          }
        }
      }
    }
  }
  return best;
}

export const keepoutPath = (k) => rectPath(k.xMm, k.yMm, k.widthMm, k.heightMm);
export const keepoutRect = (k) => ({ x: k.xMm, y: k.yMm, width: k.widthMm, height: k.heightMm });
