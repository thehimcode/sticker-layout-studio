/** ฟังก์ชันของ Path แบบ flat [x0, y0, x1, y1, ...] ที่ปิดตัวเองโดยนัย */
export function signedArea(path) {
  let sum = 0;
  const n = path.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    sum += path[i] * path[j + 1] - path[j] * path[i + 1];
  }
  return sum / 2;
}

/** ปรับเรียบแบบ Taubin ไม่ทำให้รูปหดเหมือนการเฉลี่ยตรง ๆ */
export function smoothLoop(path, iterations) {
  const n = path.length / 2;
  if (n < 5 || iterations <= 0) return path;
  let current = Float64Array.from(path);
  const step = (factor) => {
    const out = new Float64Array(current.length);
    for (let i = 0; i < n; i += 1) {
      const a = ((i + n - 1) % n) * 2;
      const b = i * 2;
      const c = ((i + 1) % n) * 2;
      out[b] = current[b] + factor * ((current[a] + current[c]) / 2 - current[b]);
      out[b + 1] = current[b + 1] + factor * ((current[a + 1] + current[c + 1]) / 2 - current[b + 1]);
    }
    current = out;
  };
  for (let i = 0; i < iterations; i += 1) {
    step(0.5);
    step(-0.53);
  }
  return Array.from(current);
}

/** Ramer-Douglas-Peucker สำหรับเส้นปิด ค่าคลาดเคลื่อนไม่เกิน tolerance */
export function simplifyLoop(path, tolerance) {
  const n = path.length / 2;
  if (n <= 4 || tolerance <= 0) return path;
  const px = (i) => path[(i % n) * 2];
  const py = (i) => path[(i % n) * 2 + 1];
  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i += 1) {
    const d = (px(i) - px(0)) ** 2 + (py(i) - py(0)) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const limit = tolerance * tolerance;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = px(a);
    const ay = py(a);
    const dx = px(b) - ax;
    const dy = py(b) - ay;
    const len = dx * dx + dy * dy;
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i += 1) {
      const ex = px(i) - ax;
      const ey = py(i) - ay;
      const t = len ? Math.max(0, Math.min(1, (ex * dx + ey * dy) / len)) : 0;
      const d = (ex - t * dx) ** 2 + (ey - t * dy) ** 2;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > limit) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(px(i), py(i));
  return out.length >= 6 ? out : path;
}

export function pathsBounds(paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (let i = 0; i < path.length; i += 2) {
      if (path[i] < minX) minX = path[i];
      if (path[i] > maxX) maxX = path[i];
      if (path[i + 1] < minY) minY = path[i + 1];
      if (path[i + 1] > maxY) maxY = path[i + 1];
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function segmentsCross(a, b) {
  const d1 = orient(a[0], a[1], a[2], a[3], b[0], b[1]);
  const d2 = orient(a[0], a[1], a[2], a[3], b[2], b[3]);
  const d3 = orient(b[0], b[1], b[2], b[3], a[0], a[1]);
  const d4 = orient(b[0], b[1], b[2], b[3], a[2], a[3]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** นับจุดตัดระหว่างขอบที่ไม่ติดกัน ทั้งในเส้นเดียวและข้ามเส้น ใช้กริดลดการเปรียบเทียบ */
export function countSelfIntersections(paths) {
  const segments = [];
  paths.forEach((path, pathIndex) => {
    const n = path.length / 2;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      segments.push({
        s: [path[i * 2], path[i * 2 + 1], path[j * 2], path[j * 2 + 1]], pathIndex, i, n,
      });
    }
  });
  if (segments.length < 2) return 0;
  const bounds = pathsBounds(paths);
  const cells = Math.max(1, Math.ceil(Math.sqrt(segments.length)));
  const sizeX = (bounds.width || 1) / cells;
  const sizeY = (bounds.height || 1) / cells;
  const grid = new Map();
  segments.forEach((seg, index) => {
    const x0 = Math.floor((Math.min(seg.s[0], seg.s[2]) - bounds.x) / sizeX);
    const x1 = Math.floor((Math.max(seg.s[0], seg.s[2]) - bounds.x) / sizeX);
    const y0 = Math.floor((Math.min(seg.s[1], seg.s[3]) - bounds.y) / sizeY);
    const y1 = Math.floor((Math.max(seg.s[1], seg.s[3]) - bounds.y) / sizeY);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const key = y * (cells + 2) + x;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(index);
      }
    }
  });
  const found = new Set();
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const p = segments[list[a]];
        const q = segments[list[b]];
        const adjacent = p.pathIndex === q.pathIndex
          && (Math.abs(p.i - q.i) === 1 || Math.abs(p.i - q.i) === p.n - 1);
        if (!adjacent && segmentsCross(p.s, q.s)) found.add(list[a] * segments.length + list[b]);
      }
    }
  }
  return found.size;
}
