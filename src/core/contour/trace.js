/**
 * Marching Squares บน Mask แบบ 0/1 ได้ Loop ปิดในพิกัดพิกเซล (0..width, 0..height)
 * เส้นเดินตามเข็มนาฬิกาบนจอรอบชิ้นงาน: ขอบนอกมีพื้นที่ Shoelace เป็นบวก รูเป็นลบ
 * Path เก็บแบบ flat: [x0, y0, x1, y1, ...]
 */
const T = 0;
const R = 1;
const B = 2;
const L = 3;
const SEGMENTS = [
  [], [[L, B]], [[B, R]], [[L, R]],
  [[R, T]], [[R, T], [L, B]], [[B, T]], [[L, T]],
  [[T, L]], [[T, B]], [[T, L], [B, R]], [[T, R]],
  [[R, L]], [[R, B]], [[B, L]], [],
];

export function traceContours(mask, width, height) {
  const stride = width + 2;
  const at = (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x] : 0);
  // รหัสขอบกริด: แนวนอน (x,y)-(x+1,y) เป็นเลขคู่, แนวตั้ง (x,y)-(x,y+1) เป็นเลขคี่
  const edge = (cx, cy, side) => {
    if (side === T) return ((cy + 1) * stride + (cx + 1)) * 2;
    if (side === B) return ((cy + 2) * stride + (cx + 1)) * 2;
    if (side === L) return ((cy + 1) * stride + (cx + 1)) * 2 + 1;
    return ((cy + 1) * stride + (cx + 2)) * 2 + 1;
  };
  const next = new Map();
  for (let cy = -1; cy < height; cy += 1) {
    for (let cx = -1; cx < width; cx += 1) {
      const code = at(cx, cy) * 8 + at(cx + 1, cy) * 4 + at(cx + 1, cy + 1) * 2 + at(cx, cy + 1);
      for (const [from, to] of SEGMENTS[code]) next.set(edge(cx, cy, from), edge(cx, cy, to));
    }
  }
  // จุดกลางของขอบกริด จุดกริดคือศูนย์กลางพิกเซล (x + 0.5, y + 0.5)
  const point = (id) => {
    const cell = id >> 1;
    const gx = (cell % stride) - 1;
    const gy = Math.floor(cell / stride) - 1;
    return id & 1 ? [gx + 0.5, gy + 1] : [gx + 1, gy + 0.5];
  };
  const loops = [];
  while (next.size) {
    const [start] = next.keys();
    const loop = [];
    let id = start;
    do {
      const [x, y] = point(id);
      loop.push(x, y);
      const following = next.get(id);
      next.delete(id);
      id = following;
    } while (id !== start && id !== undefined);
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}
