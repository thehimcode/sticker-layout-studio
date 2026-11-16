import { alphaMask, colorMask, coverage, detectBackground, hasUsableAlpha, removeNoise } from './mask.js';
import { traceContours } from './trace.js';
import {
  countSelfIntersections, pathsBounds, signedArea, simplifyLoop, smoothLoop,
} from './path.js';
import { offsetPaths, unionPaths } from './clipper-ops.js';
import { curveSegments, fairLoop, fitClosedCurve, flattenCurve } from './bezier.js';

export const DEFAULT_CUTLINE_CONFIG = Object.freeze({
  maskMode: 'alpha', // 'alpha' | 'color'
  alphaThreshold: 128,
  bgColor: null, // null = ตรวจจากขอบภาพ
  colorTolerance: 32,
  contourMode: 'outer', // 'outer' | 'merged' | 'all'
  noiseArea: 20,
  smooth: 3,
  simplifyPx: 0.5,
  offsetMm: 2,
  cornerRadiusMm: 1.5,
  fairingMm: 0.6,
  edited: false,
});

const MIN_PATH_AREA_MM2 = 1;
const MAX_CURVES = 1500;
const CURVE_TOLERANCE_MM = 0.05;
export const MAX_ANALYSIS_SIDE = 2000;
const TARGET_RESOLUTION_MM = 0.1;

/** ภาพมีพื้นที่โปร่งใสใช้ Alpha ถ้าไม่มีใช้การแยกสีพื้นหลัง */
export const chooseMaskMode = (raster) => (
  hasUsableAlpha(raster.data, raster.width, raster.height) ? 'alpha' : 'color'
);

export const issue = (severity, code, message) => ({ severity, code, message });

/**
 * ขั้นที่ 1: พิกเซลเป็น Contour คืนพิกัดเป็นพิกเซลของภาพต้นฉบับ
 * raster: { data, width, height } อาจเป็นภาพที่ย่อเพื่อวิเคราะห์ natural คือขนาดจริง
 */
export function analyzeContours(raster, natural, config, onProgress = () => {}) {
  const { data, width, height } = raster;
  const warnings = [];
  const usableAlpha = hasUsableAlpha(data, width, height);
  let mask;
  let bgColor = config.bgColor;
  if (config.maskMode === 'color') {
    bgColor = bgColor ?? detectBackground(data, width, height);
    mask = colorMask(data, width, height, bgColor, config.colorTolerance);
    warnings.push(issue('info', 'color-uncertain', 'แยกด้วยสีพื้นหลัง ผลขึ้นกับภาพ กรุณาตรวจเส้นก่อนใช้งาน'));
  } else {
    mask = alphaMask(data, width, height, config.alphaThreshold);
  }
  onProgress(0.3);
  const parts = removeNoise(mask, width, height, config.noiseArea);
  onProgress(0.5);

  const share = coverage(mask);
  if (share === 0) {
    return { paths: [], parts: 0, bgColor, warnings: [...warnings, issue('error', 'empty-mask', 'ไม่พบชิ้นงานในภาพ ลองปรับค่า Threshold')] };
  }
  if (config.maskMode === 'alpha' && !usableAlpha) {
    warnings.push(issue('warning', 'no-alpha', 'ภาพนี้ไม่มีพื้นที่โปร่งใส เส้นจึงเป็นกรอบภาพ ลองเปลี่ยนเป็นแยกด้วยสีพื้นหลัง'));
  } else if (share > 0.97) {
    warnings.push(issue('warning', 'full-mask', 'ชิ้นงานเต็มเกือบทั้งภาพ ตรวจว่าพื้นหลังถูกแยกออกแล้ว'));
  }
  if (parts > 40) warnings.push(issue('warning', 'many-parts', `พบ ${parts} ชิ้นส่วน ภาพอาจมี Noise ลองเพิ่มค่าลด Noise`));

  const loops = traceContours(mask, width, height);
  onProgress(0.7);
  const fx = natural.widthPx / width;
  const fy = natural.heightPx / height;
  const paths = [];
  for (const loop of loops) {
    const isOuter = signedArea(loop) > 0;
    if (!isOuter && config.contourMode !== 'all') continue;
    const smoothed = smoothLoop(loop, config.smooth);
    const simple = simplifyLoop(smoothed, config.simplifyPx);
    const scaled = new Array(simple.length);
    for (let i = 0; i < simple.length; i += 2) {
      scaled[i] = simple[i] * fx;
      scaled[i + 1] = simple[i + 1] * fy;
    }
    paths.push(scaled);
  }
  onProgress(0.9);
  return { paths, parts, bgColor, warnings };
}

function convexHull(paths) {
  const pts = [];
  for (const path of paths) for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())].flat();
}

/**
 * รวมชิ้นส่วนแยกเป็นเส้นเดียวด้วย Morphological Closing (ขยายแล้วหด)
 * เพิ่มรัศมีจนผลหลังหดยังเป็นชิ้นเดียว ถ้าไม่สำเร็จใช้ Convex Hull ซึ่งยังตามรูปทรงมากกว่ากรอบสี่เหลี่ยม
 */
function mergeToOne(clipper, paths, bounds) {
  const limit = Math.max(bounds.width, bounds.height) * 2;
  for (let radius = 0.5; radius <= limit; radius *= 1.5) {
    const grown = offsetPaths(clipper, paths, radius).filter((p) => signedArea(p) > 0);
    if (grown.length !== 1) continue;
    const closed = offsetPaths(clipper, grown, -radius).filter((p) => signedArea(p) > 0);
    if (closed.length === 1) return closed;
  }
  return [convexHull(paths)];
}

/**
 * ลบมุมด้วยรัศมีจริง: Closing (ขยายแล้วหด) ลบมุมเว้า เส้นจะไม่กินเข้าหาภาพ
 * มุมนูนจากการ Offset บวกโค้งตามค่า Offset อยู่แล้ว
 * Opening ใช้เฉพาะ Offset ≤ 0 เพราะเส้นอยู่ในภาพอยู่แล้ว และไม่ใช้ถ้าทำให้เส้นขาดเป็นหลายชิ้น
 */
function roundCorners(clipper, paths, radiusMm, offsetMm) {
  if (radiusMm <= 0 || !paths.length) return paths;
  const holes = paths.filter((p) => signedArea(p) < 0);
  const outers = paths.filter((p) => signedArea(p) > 0);
  let rounded = offsetPaths(clipper, offsetPaths(clipper, outers, radiusMm), -radiusMm)
    .filter((p) => signedArea(p) > 0);
  if (offsetMm <= 0) {
    const opened = offsetPaths(clipper, offsetPaths(clipper, rounded, -radiusMm), radiusMm);
    if (opened.length === rounded.length) rounded = opened;
  }
  return [...rounded, ...holes];
}

/** เส้นโค้งสุดท้าย คืน curves และ Polyline ที่ได้จาก curves เดียวกัน */
function toCurves(paths, fairingMm) {
  const curves = paths.map((path) => fitClosedCurve(fairLoop(path, fairingMm), CURVE_TOLERANCE_MM));
  const closedPaths = curves.map((curve) => flattenCurve(curve).map((v) => Math.round(v * 1000) / 1000));
  return { curves: curves.map((c) => c.map((v) => Math.round(v * 10000) / 10000)), closedPaths };
}

const SHAPE_MARGIN_MM = 0.1;

/** รูปร่างสำหรับ Nesting: ขยายเล็กน้อยก่อนลดจุด จึงครอบรูปจริงเสมอ */
function compactShape(clipper, paths) {
  const grown = offsetPaths(clipper, paths, SHAPE_MARGIN_MM).filter((p) => signedArea(p) > 0);
  return grown.map((p) => simplifyLoop(p, SHAPE_MARGIN_MM * 0.8).map((v) => Math.round(v * 1000) / 1000));
}

function buildShapes(clipper, inkOuters, cutOuters, bleedMm) {
  const art = bleedMm > 0 && inkOuters.length ? offsetPaths(clipper, inkOuters, bleedMm) : inkOuters;
  const wide = unionPaths(clipper, [...art, ...cutOuters]).filter((p) => signedArea(p) > 0);
  return { wide: compactShape(clipper, wide), image: compactShape(clipper, art) };
}

function diagnose(paths, offsetMm) {
  const issues = [];
  if (!paths.length) {
    issues.push(issue('error', 'empty-path', offsetMm < 0
      ? 'Offset ลบมากจนไม่เหลือเส้นตัด ลดค่า Offset'
      : 'ไม่มีเส้นตัดที่ใช้งานได้'));
    return issues;
  }
  const tiny = paths.filter((p) => Math.abs(signedArea(p)) < MIN_PATH_AREA_MM2).length;
  if (tiny) issues.push(issue('warning', 'tiny-path', `มีเส้นเล็กกว่า ${MIN_PATH_AREA_MM2} ตร.มม. ${tiny} เส้น เครื่องอาจตัดไม่สวย`));
  const crossings = countSelfIntersections(paths);
  if (crossings) issues.push(issue('error', 'self-intersect', `พบเส้นตัดซ้อนตัวเอง ${crossings} จุด`));
  if (paths.length > 1) issues.push(issue('info', 'multi-path', `เส้นตัดมี ${paths.length} เส้นปิด`));
  return issues;
}

/**
 * ขั้นที่ 2: Contour เป็น Cutline คำนวณในหน่วย มม. ตามขนาดงานจริง ไม่ใช้การ Scale
 * เรียกซ้ำเมื่อขนาดหรือ Offset เปลี่ยน
 */
export function buildCutline(clipper, {
  masterId, paths, natural, sizeMm, offsetMm, contourMode, geometryVersion = 1,
  cornerRadiusMm = DEFAULT_CUTLINE_CONFIG.cornerRadiusMm,
  fairingMm = DEFAULT_CUTLINE_CONFIG.fairingMm,
  bleedMm = 0,
}) {
  const sx = sizeMm.widthMm / natural.widthPx;
  const sy = sizeMm.heightMm / natural.heightPx;
  const inMm = paths.map((path) => path.map((v, i) => (i % 2 ? v * sy : v * sx)));
  const crossingsBefore = countSelfIntersections(inMm);
  const clean = inMm.length ? unionPaths(clipper, inMm) : [];
  const bounds = clean.length ? pathsBounds(clean) : null;
  const outers = clean.filter((p) => signedArea(p) > 0);
  const base = contourMode === 'merged' && outers.length > 1 ? mergeToOne(clipper, outers, bounds) : clean;
  const offset = offsetMm === 0 || !base.length ? base : offsetPaths(clipper, base, offsetMm);
  const { curves, closedPaths } = toCurves(roundCorners(clipper, offset, cornerRadiusMm, offsetMm), fairingMm);
  const issues = diagnose(closedPaths, offsetMm);
  const segments = curves.reduce((sum, c) => sum + curveSegments(c), 0);
  if (segments > MAX_CURVES) issues.push(issue('warning', 'many-curves', `เส้นตัดมี ${segments} ช่วงโค้ง ลองเพิ่มความเรียบของเส้น`));
  const longest = Math.max(sizeMm.widthMm / Math.min(natural.widthPx, MAX_ANALYSIS_SIDE), sizeMm.heightMm / Math.min(natural.heightPx, MAX_ANALYSIS_SIDE));
  if (longest > TARGET_RESOLUTION_MM) {
    issues.push(issue('warning', 'low-resolution', `ตรวจขอบได้ละเอียด ${longest.toFixed(2)} มม. ต่อพิกเซล เส้นอาจคลาดเกิน ${TARGET_RESOLUTION_MM} มม. ใช้ภาพละเอียดขึ้นหรือลดขนาดงาน`));
  }
  if (crossingsBefore) {
    issues.push(issue('warning', 'contour-self-intersect', `Contour ต้นทางซ้อนตัวเอง ${crossingsBefore} จุด ระบบรวมเส้นให้แล้ว กรุณาตรวจผล`));
  }
  const envelopeMm = closedPaths.length ? pathsBounds(closedPaths) : null;
  const shapes = closedPaths.length
    ? buildShapes(clipper, outers, closedPaths.filter((p) => signedArea(p) > 0), bleedMm)
    : null;
  return {
    sourceMasterId: masterId,
    closedPaths,
    curves,
    offsetMm,
    contourParameters: { contourMode, cornerRadiusMm, fairingMm },
    sizeMm: { ...sizeMm },
    envelopeMm,
    shapes,
    issues,
    geometryVersion,
    stale: false,
  };
}
