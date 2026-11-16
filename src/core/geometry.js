import { EPSILON_MM } from './units.js';

/**
 * เมทริกซ์ 2D [a, b, c, d, e, f] รูปแบบเดียวกับ Canvas และ SVG matrix()
 * x' = a·x + c·y + e, y' = b·x + d·y + f
 */
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('เมทริกซ์นี้กลับค่าไม่ได้');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

const axes = (rotationDeg) => {
  const r = (rotationDeg * Math.PI) / 180;
  return { cos: Math.cos(r), sin: Math.sin(r) };
};

/**
 * แหล่งความจริงเดียวของการวางวัตถุ: แปลงพิกัดชิ้นงาน (0..widthMm, 0..heightMm) เป็นพิกัดกระดาษ
 * จุดอ้างอิง: xMm, yMm คือมุมบนซ้ายของกรอบหลัง Scale และก่อนหมุน
 * ลำดับ: Scale ที่มุมบนซ้าย แล้วหมุนรอบจุดกึ่งกลางของกรอบนั้น
 * Canvas ใช้เมทริกซ์นี้แล้ว และการส่งออก PNG/PDF/SVG ต้องใช้เมทริกซ์เดียวกัน
 */
export function placementMatrix(transform, size) {
  const { xMm, yMm, rotationDeg, scaleX = 1, scaleY = 1 } = transform;
  const { cos, sin } = axes(rotationDeg);
  const hw = (size.widthMm * scaleX) / 2;
  const hh = (size.heightMm * scaleY) / 2;
  const cx = xMm + hw;
  const cy = yMm + hh;
  return [cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, cx - cos * hw + sin * hh, cy - sin * hw - cos * hh];
}

export function placementCorners(transform, size) {
  const m = placementMatrix(transform, size);
  const { widthMm: w, heightMm: h } = size;
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map((p) => applyMatrix(m, p));
}

export function boundsOfPoints(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export const placementBounds = (transform, size) => boundsOfPoints(placementCorners(transform, size));

/** กรอบบนกระดาษของสี่เหลี่ยม rect ในพิกัดชิ้นงาน ใช้กับ Envelope ที่กว้างกว่าภาพ */
export function localRectBounds(transform, size, rect) {
  const m = placementMatrix(transform, size);
  return boundsOfPoints([
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((p) => applyMatrix(m, p)));
}

export function rectContains(outer, inner, eps = EPSILON_MM) {
  return inner.x >= outer.x - eps
    && inner.y >= outer.y - eps
    && inner.x + inner.width <= outer.x + outer.width + eps
    && inner.y + inner.height <= outer.y + outer.height + eps;
}

export function rectsOverlap(a, b, gap = 0, eps = EPSILON_MM) {
  return a.x < b.x + b.width + gap - eps
    && b.x < a.x + a.width + gap - eps
    && a.y < b.y + b.height + gap - eps
    && b.y < a.y + a.height + gap - eps;
}

export const rectFits = (outer, inner, eps = EPSILON_MM) => (
  inner.width <= outer.width + eps && inner.height <= outer.height + eps
);

/** ระยะเลื่อน {dx, dy} ที่น้อยที่สุดเพื่อให้ inner อยู่ใน outer ถือว่าเรียกเมื่อ rectFits เป็นจริง */
export function containDelta(outer, inner) {
  const dx = Math.max(outer.x - inner.x, 0) + Math.min(outer.x + outer.width - inner.x - inner.width, 0);
  const dy = Math.max(outer.y - inner.y, 0) + Math.min(outer.y + outer.height - inner.y - inner.height, 0);
  return { dx, dy };
}

export function pointInPlacement(point, transform, size) {
  const p = applyMatrix(invert(placementMatrix(transform, size)), point);
  return p.x >= 0 && p.y >= 0 && p.x <= size.widthMm && p.y <= size.heightMm;
}

export const HANDLES = Object.freeze({
  nw: { sx: -1, sy: -1 },
  ne: { sx: 1, sy: -1 },
  se: { sx: 1, sy: 1 },
  sw: { sx: -1, sy: 1 },
});

/**
 * ย่อขยายจากมุม โดยตรึงมุมตรงข้ามให้อยู่ที่เดิมในพิกัดกระดาษ รองรับวัตถุที่หมุนแล้ว
 * คืน { xMm, yMm, widthMm, heightMm }
 */
export function resizeFromHandle({ transform, size, handle, pointer, lockAspect, minMm = 1 }) {
  const { sx, sy } = HANDLES[handle];
  const { cos, sin } = axes(transform.rotationDeg);
  const ux = { x: cos, y: sin };
  const uy = { x: -sin, y: cos };
  const cx = transform.xMm + size.widthMm / 2;
  const cy = transform.yMm + size.heightMm / 2;
  const anchor = {
    x: cx - sx * (size.widthMm / 2) * ux.x - sy * (size.heightMm / 2) * uy.x,
    y: cy - sx * (size.widthMm / 2) * ux.y - sy * (size.heightMm / 2) * uy.y,
  };
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  let widthMm = Math.max((dx * ux.x + dy * ux.y) * sx, minMm);
  let heightMm = Math.max((dx * uy.x + dy * uy.y) * sy, minMm);
  if (lockAspect) {
    const minScale = Math.max(minMm / size.widthMm, minMm / size.heightMm);
    const scale = Math.max(widthMm / size.widthMm, heightMm / size.heightMm, minScale);
    widthMm = size.widthMm * scale;
    heightMm = size.heightMm * scale;
  }
  const ncx = anchor.x + sx * (widthMm / 2) * ux.x + sy * (heightMm / 2) * uy.x;
  const ncy = anchor.y + sx * (widthMm / 2) * ux.y + sy * (heightMm / 2) * uy.y;
  return { xMm: ncx - widthMm / 2, yMm: ncy - heightMm / 2, widthMm, heightMm };
}

export function unionRects(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}
