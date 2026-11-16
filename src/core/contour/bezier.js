/**
 * ทำเส้นตัดให้โค้งลื่นและแปลงเป็น Cubic Bezier
 * fairLoop: เกลี่ยเส้นตามระยะทางจริงเป็น มม. เพื่อลบรอยหักเล็ก ๆ
 * fitClosedCurve: ฟิตเส้นโค้งแบบ Schneider ปลายเส้นต่อกันด้วยทิศทางเดียว (G1)
 * Curve เก็บแบบ flat: [x0, y0, c1x, c1y, c2x, c2y, x1, y1, ...] และปิดกลับจุดแรกเสมอ
 */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
};

/** สุ่มจุดใหม่ให้ระยะเท่ากันรอบเส้นปิด คืนอาร์เรย์ของ [x, y] */
export function resampleLoop(path, spacing) {
  const n = path.length / 2;
  let perimeter = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    perimeter += Math.hypot(path[j * 2] - path[i * 2], path[j * 2 + 1] - path[i * 2 + 1]);
  }
  const count = Math.max(16, Math.round(perimeter / spacing));
  const step = perimeter / count;
  const out = [];
  let segment = 0;
  let walked = 0;
  for (let k = 0; k < count; k += 1) {
    const target = k * step;
    for (;;) {
      const j = (segment + 1) % n;
      const l = Math.hypot(path[j * 2] - path[segment * 2], path[j * 2 + 1] - path[segment * 2 + 1]);
      if (walked + l >= target || segment === n - 1) {
        const t = l > 0 ? Math.min(1, (target - walked) / l) : 0;
        out.push([
          path[segment * 2] + (path[j * 2] - path[segment * 2]) * t,
          path[segment * 2 + 1] + (path[j * 2 + 1] - path[segment * 2 + 1]) * t,
        ]);
        break;
      }
      walked += l;
      segment += 1;
    }
  }
  return { points: out, step };
}

function gaussian(points, sigmaSteps) {
  const radius = Math.max(1, Math.ceil(sigmaSteps * 3));
  const kernel = [];
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigmaSteps * sigmaSteps));
    kernel.push(w);
    total += w;
  }
  const n = points.length;
  return points.map((_, index) => {
    let x = 0;
    let y = 0;
    for (let i = -radius; i <= radius; i += 1) {
      const p = points[((index + i) % n + n) % n];
      const w = kernel[i + radius];
      x += p[0] * w;
      y += p[1] * w;
    }
    return [x / total, y / total];
  });
}

/**
 * เกลี่ยเส้นโดยไม่ทำให้รูปหด: ใช้ 2G − G² แทน Gaussian ตรง ๆ
 * ส่วนโค้งใหญ่แทบไม่ขยับ แต่รอยหักความถี่สูงถูกกำจัด
 */
export function fairLoop(path, sigmaMm, spacingMm = 0.25) {
  const { points, step } = resampleLoop(path, spacingMm);
  if (sigmaMm <= 0) return points;
  const sigma = sigmaMm / step;
  const once = gaussian(points, sigma);
  const twice = gaussian(once, sigma);
  return once.map((p, i) => [2 * p[0] - twice[i][0], 2 * p[1] - twice[i][1]]);
}

const bezierAt = (c, t) => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0],
    a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1],
  ];
};

function chordParams(points) {
  const u = [0];
  for (let i = 1; i < points.length; i += 1) u.push(u[i - 1] + len(sub(points[i], points[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(points, u, t0, t1) {
  const p0 = points[0];
  const p3 = points[points.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < points.length; i += 1) {
    const t = u[i];
    const m = 1 - t;
    const b1 = 3 * m * m * t;
    const b2 = 3 * m * t * t;
    const a0 = mul(t0, b1);
    const a1 = mul(t1, b2);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const base = (m * m * m + b1);
    const tail = (t * t * t + b2);
    const rest = sub(points[i], add(mul(p0, base), mul(p3, tail)));
    x0 += dot(a0, rest);
    x1 += dot(a1, rest);
  }
  const det = c00 * c11 - c01 * c01;
  const chord = len(sub(p3, p0));
  let alpha0 = det ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha1 = det ? (c00 * x1 - c01 * x0) / det : 0;
  const floor = chord * 1e-3;
  if (alpha0 < floor || alpha1 < floor) {
    alpha0 = chord / 3;
    alpha1 = chord / 3;
  }
  return [p0, add(p0, mul(t0, alpha0)), add(p3, mul(t1, alpha1)), p3];
}

function reparameterize(c, points, u) {
  const d1 = [0, 1, 2].map((i) => mul(sub(c[i + 1], c[i]), 3));
  const d2 = [0, 1].map((i) => mul(sub(d1[i + 1], d1[i]), 2));
  return u.map((t, i) => {
    const m = 1 - t;
    const q = bezierAt(c, t);
    const q1 = add(add(mul(d1[0], m * m), mul(d1[1], 2 * m * t)), mul(d1[2], t * t));
    const q2 = add(mul(d2[0], m), mul(d2[1], t));
    const e = sub(q, points[i]);
    const den = dot(q1, q1) + dot(e, q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - dot(e, q1) / den));
  });
}

function maxError(c, points, u) {
  let worst = -1;
  let index = Math.floor(points.length / 2);
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = sub(bezierAt(c, u[i]), points[i]);
    const e = dot(d, d);
    if (e > worst) {
      worst = e;
      index = i;
    }
  }
  return { error: Math.sqrt(Math.max(worst, 0)), index };
}

const MAX_CHUNK = 400;

function fitSegment(points, t0, t1, tolerance, out) {
  if (points.length === 2) {
    const d = len(sub(points[1], points[0])) / 3;
    out.push([points[0], add(points[0], mul(t0, d)), add(points[1], mul(t1, d)), points[1]]);
    return;
  }
  let u = chordParams(points);
  let c = generate(points, u, t0, t1);
  let { error, index } = maxError(c, points, u);
  if (error > tolerance && error < tolerance * 16) {
    for (let i = 0; i < 6 && error > tolerance; i += 1) {
      u = reparameterize(c, points, u);
      c = generate(points, u, t0, t1);
      ({ error, index } = maxError(c, points, u));
    }
  }
  if (error <= tolerance && points.length <= MAX_CHUNK) {
    out.push(c);
    return;
  }
  const split = Math.max(1, Math.min(points.length - 2, error > tolerance ? index : points.length >> 1));
  const tangent = unit(sub(points[split - 1], points[split + 1]));
  fitSegment(points.slice(0, split + 1), t0, tangent, tolerance, out);
  fitSegment(points.slice(split), mul(tangent, -1), t1, tolerance, out);
}

/** ดัชนีจุดหักมุมจริงที่ต้องคงไว้ ถ้าหักน้อยกว่า cornerDeg จะถือเป็นเส้นโค้งต่อเนื่อง */
function findCorners(points, cornerDeg) {
  const n = points.length;
  const limit = Math.cos((cornerDeg * Math.PI) / 180);
  const reach = 2;
  const scores = [];
  for (let i = 0; i < n; i += 1) {
    const a = unit(sub(points[i], points[((i - reach) % n + n) % n]));
    const b = unit(sub(points[(i + reach) % n], points[i]));
    scores.push(dot(a, b));
  }
  const corners = [];
  for (let i = 0; i < n; i += 1) {
    if (scores[i] >= limit) continue;
    let isMin = true;
    for (let k = -reach; k <= reach; k += 1) {
      if (k && scores[((i + k) % n + n) % n] < scores[i]) isMin = false;
    }
    if (isMin && (!corners.length || i - corners[corners.length - 1] > reach)) corners.push(i);
  }
  return corners;
}

/** คืน Curve แบบ flat สำหรับเส้นปิดหนึ่งเส้น */
export function fitClosedCurve(points, tolerance, cornerDeg = 55) {
  const n = points.length;
  const corners = findCorners(points, cornerDeg);
  const anchors = corners.length >= 2 ? corners : [corners[0] ?? 0, ((corners[0] ?? 0) + (n >> 1)) % n];
  anchors.sort((a, b) => a - b);
  const isCorner = new Set(corners);
  const tangentAt = (i, dir) => {
    if (isCorner.has(i)) {
      const near = points[((i + dir * 2) % n + n) % n];
      return unit(sub(near, points[i]));
    }
    const fwd = unit(sub(points[(i + 1) % n], points[((i - 1) % n + n) % n]));
    return dir > 0 ? fwd : mul(fwd, -1);
  };
  const out = [];
  for (let a = 0; a < anchors.length; a += 1) {
    const from = anchors[a];
    const to = anchors[(a + 1) % anchors.length];
    const count = ((to - from + n - 1) % n) + 2;
    const piece = [];
    for (let k = 0; k < count; k += 1) piece.push(points[(from + k) % n]);
    fitSegment(piece, tangentAt(from, 1), tangentAt(to, -1), tolerance, out);
  }
  const flat = [out[0][0][0], out[0][0][1]];
  for (const c of out) flat.push(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]);
  return flat;
}

/** แปลง Curve เป็น Polyline ความคลาดเคลื่อนไม่เกิน tolerance เป็นข้อมูลเรขาคณิตชุดเดียวกับที่วาด */
export function flattenCurve(curve, tolerance = 0.005) {
  const out = [curve[0], curve[1]];
  for (let i = 2; i + 5 < curve.length; i += 6) {
    const x0 = curve[i - 2];
    const y0 = curve[i - 1];
    const [x1, y1, x2, y2, x3, y3] = curve.slice(i, i + 6);
    const m = Math.max(
      Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2),
      Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3),
    );
    const steps = Math.max(1, Math.ceil(Math.sqrt((6 * m) / (8 * tolerance))));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
    }
  }
  out.length -= 2; // จุดท้ายซ้ำกับจุดแรก
  return out;
}

export const curveSegments = (curve) => (curve.length - 2) / 6;
