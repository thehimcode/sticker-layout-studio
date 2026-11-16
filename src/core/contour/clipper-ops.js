/**
 * ตัวห่อ Clipper2 ทุกหน่วยเป็น มม. ความละเอียด 0.001 มม.
 * คืนหน่วยความจำ WASM ทุกครั้ง (NFR-08)
 * clipper คือ Module ที่โหลดแล้ว จึงใช้ได้ทั้ง Worker และ Node
 */
const PRECISION = 3;
const ARC_TOLERANCE_MM = 0.01;

function toPathsD(clipper, paths) {
  const out = new clipper.PathsD();
  for (const flat of paths) {
    const path = clipper.MakePathD(flat);
    out.push_back(path);
    path.delete();
  }
  return out;
}

function fromPathsD(pathsD) {
  const out = [];
  for (let i = 0; i < pathsD.size(); i += 1) {
    const path = pathsD.get(i);
    const flat = [];
    for (let p = 0; p < path.size(); p += 1) {
      const point = path.get(p);
      flat.push(point.x, point.y);
      point.delete();
    }
    path.delete();
    if (flat.length >= 6) out.push(flat);
  }
  return out;
}

function withPaths(clipper, paths, run) {
  const input = toPathsD(clipper, paths);
  const result = run(input);
  const flat = fromPathsD(result);
  result.delete();
  input.delete();
  return flat;
}

/** รวมเส้นและแก้เส้นที่ซ้อนตัวเอง ผลรวมเป็น Polygon ที่ถูกต้อง */
export const unionPaths = (clipper, paths) => withPaths(
  clipper,
  paths,
  (input) => clipper.UnionSelfD(input, clipper.FillRule.NonZero, PRECISION),
);

export const differencePaths = (clipper, subject, clips) => {
  const clipD = toPathsD(clipper, clips);
  const flat = withPaths(clipper, subject, (input) => clipper.DifferenceD(input, clipD, clipper.FillRule.NonZero, PRECISION));
  clipD.delete();
  return flat;
};

/** ผลบวก Minkowski ของเส้นปิดสองเส้น รวมผลเป็น Polygon เดียวกันแล้ว */
export function minkowskiSum(clipper, pattern, path) {
  const a = clipper.MakePathD(pattern);
  const b = clipper.MakePathD(path);
  const result = clipper.MinkowskiSumD(a, b, true, PRECISION);
  a.delete();
  b.delete();
  const flat = fromPathsD(result);
  result.delete();
  return flat;
}

/** Offset เชิงเรขาคณิตด้วยมุมโค้งกลม บวกขยายออก ลบหดเข้า */
export const offsetPaths = (clipper, paths, deltaMm) => withPaths(
  clipper,
  paths,
  (input) => clipper.InflatePathsD(
    input,
    deltaMm,
    clipper.JoinType.Round,
    clipper.EndType.Polygon,
    2,
    PRECISION,
    ARC_TOLERANCE_MM,
  ),
);
