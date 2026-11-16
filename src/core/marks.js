import { UserError } from './errors.js';
import { boundsOfPoints } from './geometry.js';
import { EPSILON_MM } from './units.js';

/**
 * Registration Marks และ Machine Profiles (FR-10)
 *
 * พิกัดของมาร์ค: xMm, yMm คือ "จุดกึ่งกลาง" ของกรอบมาร์ค อ้างอิงมุมบนซ้ายของกระดาษ หน่วย มม. แกน Y ลงล่าง
 * ลำดับ Transformation: วาดรูปในพิกัดท้องถิ่นที่มีจุดกึ่งกลางที่ 0,0 → หมุนรอบจุดกึ่งกลาง → เลื่อนไปที่ xMm, yMm
 * มาร์คชุดเดียวใช้กับทุกหน้า ตำแหน่งเดียวกัน (FR-07.6)
 *
 * Mark { id, shape, xMm, yMm, widthMm, heightMm, rotationDeg, fill, stroke, lineMm, locked, keepoutMm }
 *   shape: circle | square | cross | corner | triangle
 *   fill/stroke: สี '#rrggbb' หรือ 'none'
 *   lineMm: ความหนาแขนของ cross/corner และความหนาเส้นขอบของ circle/square/triangle
 *   corner: รูปตัว L มุมอยู่ที่มุมบนซ้ายของกรอบเมื่อมุมหมุน 0° หมุน 90° ไปมุมบนขวา และต่อไปตามเข็มนาฬิกา
 *   triangle: สามเหลี่ยมยอดชี้ขึ้นเมื่อมุมหมุน 0° (ตัวบอกทิศทางป้อนกระดาษแบบ SignMaster)
 */
export const MARK_SHAPES = Object.freeze(['circle', 'square', 'cross', 'corner', 'triangle']);
export const MARK_SHAPE_LABELS = Object.freeze({
  circle: 'วงกลม', square: 'สี่เหลี่ยม', cross: 'กากบาท', corner: 'มุม L', triangle: 'สามเหลี่ยม',
});
export const MIN_MARK_MM = 0.5;

/**
 * Template: marginsMm คือระยะจากขอบกระดาษถึง "จุดกึ่งกลาง" ของมาร์คมุม แยก 4 ด้าน
 * ความหมายเดียวกับ Page Mark Margins ของ SignMaster (ยืนยันจาก PDF ที่ SignMaster สร้าง 2026-11-16)
 */
const SIGNMASTER_ARMS = {
  /** จุดที่ 5 อยู่ใต้จุดบนซ้าย ระยะระหว่างจุดกึ่งกลาง */
  extraDotMm: 20,
  /** สามเหลี่ยมด้านเท่ายาวด้านละ 4 มม. ยอดชี้ขึ้น กึ่งกลางกระดาษ ฐานอยู่เหนือแนวจุดบน 2 มม. */
  triangleMm: 4,
  triangleGapMm: 2,
};

/**
 * Profile สำเร็จรูป ทุกตัวเป็น Template ที่ปรับได้ และยังไม่ยืนยันกับเครื่องจริง (FR-10.2)
 * MicroCut 30Q: ขนาดและตำแหน่งวัดจาก PDF ที่ SignMaster สร้างด้วย Teneth MC350CCD, ARMS CCD 5mm
 * (กระดาษ 329 × 483 มม. Page Mark Margins 10/10/10/40) แต่ยังไม่ได้ทดสอบการอ่านกับเครื่องจริง (SRS ข้อ 11)
 */
export const BUILTIN_PROFILES = Object.freeze([
  {
    id: 'microcut30q-5dots',
    label: 'MicroCut 30Q - Custom 5 Dots (Unverified)',
    builtIn: true,
    verificationStatus: 'unverified',
    note: 'ขนาดและตำแหน่งวัดจาก PDF ที่ SignMaster สร้าง (Teneth MC350CCD, ARMS CCD 5mm) ระยะขอบคือระยะถึงจุดกึ่งกลางของจุด เหมือน Page Mark Margins ใน SignMaster ยังไม่ได้ทดสอบการอ่านมาร์คกับเครื่องจริง',
    coordinateConvention: 'mark-center, origin top-left of paper, mm, Y down',
    source: 'SignMaster Contour Cutting Wizard, Teneth MC350CCD, Automatic ARMS CCD 5mm',
    template: {
      layout: 'signmaster5', shape: 'circle', sizeMm: 5, marginsMm: { top: 10, right: 10, bottom: 40, left: 10 }, keepoutMm: 3, lineMm: 0.5,
    },
    exportOptions: { marksInCutSvg: 'reference' },
    pageRules: null,
  },
  {
    id: 'circle-4',
    label: 'วงกลม 4 จุด (Template)',
    builtIn: true,
    verificationStatus: 'unverified',
    note: 'Template ทั่วไป ตรวจกับซอฟต์แวร์เครื่องตัดก่อนใช้งาน ระยะขอบคือระยะถึงจุดกึ่งกลางของมาร์ค',
    coordinateConvention: 'mark-center, origin top-left of paper, mm, Y down',
    template: {
      layout: 'corners4', shape: 'circle', sizeMm: 5, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 }, keepoutMm: 3, lineMm: 0.5,
    },
    exportOptions: { marksInCutSvg: 'reference' },
    pageRules: null,
  },
  {
    id: 'circle-3',
    label: 'วงกลม 3 จุด (Template)',
    builtIn: true,
    verificationStatus: 'unverified',
    note: 'Template ทั่วไป มุมขวาล่างว่างไว้ใช้บอกทิศทาง ตรวจกับซอฟต์แวร์เครื่องตัดก่อนใช้งาน ระยะขอบคือระยะถึงจุดกึ่งกลางของมาร์ค',
    coordinateConvention: 'mark-center, origin top-left of paper, mm, Y down',
    template: {
      layout: 'corners3', shape: 'circle', sizeMm: 5, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 }, keepoutMm: 3, lineMm: 0.5,
    },
    exportOptions: { marksInCutSvg: 'reference' },
    pageRules: null,
  },
  {
    id: 'corner-l',
    label: 'มุม L 4 มุม (Template)',
    builtIn: true,
    verificationStatus: 'unverified',
    note: 'Template ทั่วไป ตรวจกับซอฟต์แวร์เครื่องตัดก่อนใช้งาน ระยะขอบคือระยะถึงจุดกึ่งกลางของกรอบมาร์ค',
    coordinateConvention: 'mark-center, origin top-left of paper, mm, Y down',
    template: {
      layout: 'corners4', shape: 'corner', sizeMm: 10, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 }, keepoutMm: 3, lineMm: 1,
    },
    exportOptions: { marksInCutSvg: 'reference' },
    pageRules: null,
  },
]);

export const getBuiltinProfile = (id) => BUILTIN_PROFILES.find((p) => p.id === id) ?? null;

export const MARGIN_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

function checkTemplate(t, paper) {
  const nums = [t.sizeMm, t.keepoutMm, t.lineMm, ...MARGIN_SIDES.map((k) => t.marginsMm?.[k])];
  if (!nums.every((v) => Number.isFinite(v) && v >= 0)) {
    throw new UserError('mark-template', 'ค่าของมาร์คต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }
  if (t.sizeMm < MIN_MARK_MM) throw new UserError('mark-size', `ขนาดมาร์คต้องไม่ต่ำกว่า ${MIN_MARK_MM} มม.`);
  const m = t.marginsMm;
  if (m.left + m.right + t.sizeMm >= paper.widthMm || m.top + m.bottom + t.sizeMm >= paper.heightMm) {
    throw new UserError('mark-template', 'ระยะขอบของมาร์คมากเกินขนาดกระดาษ');
  }
}

const markAt = (x, y, shape, size, t, rotationDeg = 0, heightMm = size) => ({
  shape,
  xMm: x,
  yMm: y,
  widthMm: size,
  heightMm,
  rotationDeg,
  fill: '#000000',
  stroke: 'none',
  lineMm: t.lineMm,
  locked: false,
  keepoutMm: t.keepoutMm,
});

/** สร้างมาร์คจาก template ตามขนาดกระดาษ marginsMm วัดถึงจุดกึ่งกลางของมาร์คมุม */
export function marksFromTemplate(template, paper, newId) {
  checkTemplate(template, paper);
  const { layout, shape, sizeMm, marginsMm: m } = template;
  const W = paper.widthMm;
  const H = paper.heightMm;
  const tl = { x: m.left, y: m.top, r: 0 };
  const tr = { x: W - m.right, y: m.top, r: 90 };
  const br = { x: W - m.right, y: H - m.bottom, r: 180 };
  const bl = { x: m.left, y: H - m.bottom, r: 270 };
  let spots;
  if (layout === 'corners3') spots = [tl, tr, bl];
  else if (layout === 'signmaster5') spots = [tl, { x: m.left, y: m.top + SIGNMASTER_ARMS.extraDotMm, r: 0 }, tr, br, bl];
  else spots = [tl, tr, br, bl];
  const marks = spots.map((s) => markAt(s.x, s.y, shape, sizeMm, template, shape === 'corner' ? s.r : 0));
  if (layout === 'signmaster5') {
    const side = SIGNMASTER_ARMS.triangleMm;
    const h = (side * Math.sqrt(3)) / 2;
    const base = m.top - SIGNMASTER_ARMS.triangleGapMm;
    if (base - h >= 0) marks.push(markAt(W / 2, base - h / 2, 'triangle', side, { ...template, keepoutMm: 0 }, 0, h));
  }
  return marks.map((mark) => ({ id: newId(), ...mark }));
}

/** มุมทั้ง 4 ของกรอบมาร์คบนกระดาษ */
export function markCorners(mark) {
  const r = (mark.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const hw = mark.widthMm / 2;
  const hh = mark.heightMm / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
    x: mark.xMm + x * cos - y * sin,
    y: mark.yMm + x * sin + y * cos,
  }));
}

export const markBounds = (mark) => boundsOfPoints(markCorners(mark));

/** เมทริกซ์จากพิกัดท้องถิ่นของมาร์ค (จุดกึ่งกลาง 0,0) ไปพิกัดกระดาษ ใช้ทั้ง Canvas และ SVG */
export function markMatrix(mark) {
  const r = (mark.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, mark.xMm, mark.yMm];
}

const n = (v) => String(Math.round(v * 10000) / 10000);

/** SVG Path data ของรูปมาร์คในพิกัดท้องถิ่น ใช้ร่วมกันทั้ง Canvas (Path2D) และไฟล์ SVG */
export function markPathData(mark) {
  const hw = mark.widthMm / 2;
  const hh = mark.heightMm / 2;
  const t = Math.min(mark.lineMm || 0, mark.widthMm, mark.heightMm);
  const poly = (pts) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')} Z`;
  switch (mark.shape) {
    case 'circle':
      return `M${n(-hw)} 0 A${n(hw)} ${n(hh)} 0 1 0 ${n(hw)} 0 A${n(hw)} ${n(hh)} 0 1 0 ${n(-hw)} 0 Z`;
    case 'square':
      return poly([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]);
    case 'cross': {
      const a = t / 2;
      return poly([[-a, -hh], [a, -hh], [a, -a], [hw, -a], [hw, a], [a, a], [a, hh], [-a, hh], [-a, a], [-hw, a], [-hw, -a], [-a, -a]]);
    }
    case 'corner':
      return poly([[-hw, -hh], [hw, -hh], [hw, -hh + t], [-hw + t, -hh + t], [-hw + t, hh], [-hw, hh]]);
    case 'triangle':
      return poly([[0, -hh], [hw, hh], [-hw, hh]]);
    default:
      throw new UserError('mark-shape', 'รูปมาร์คไม่ถูกต้อง');
  }
}

/** รูปที่เป็นแขนเส้น (cross, corner) ระบายด้วยสีเติม ถ้าไม่มีสีเติมใช้สีเส้น */
export function markPaint(mark) {
  const solid = mark.shape === 'cross' || mark.shape === 'corner';
  if (solid) return { fill: mark.fill !== 'none' ? mark.fill : (mark.stroke !== 'none' ? mark.stroke : '#000000'), stroke: 'none', lineMm: 0 };
  return { fill: mark.fill, stroke: mark.stroke, lineMm: mark.stroke !== 'none' ? mark.lineMm : 0 };
}

/** พื้นที่สงวนของมาร์ค (FR-10.6, FR-10.7): กรอบหลังหมุน ขยายด้วย keepoutMm ตัดให้อยู่บนกระดาษ */
export function markKeepout(mark, paper) {
  const b = markBounds(mark);
  const k = mark.keepoutMm ?? 0;
  const x = Math.max(0, b.x - k);
  const y = Math.max(0, b.y - k);
  const right = Math.min(paper.widthMm, b.x + b.width + k);
  const bottom = Math.min(paper.heightMm, b.y + b.height + k);
  return {
    id: `mark:${mark.id}`, xMm: x, yMm: y, widthMm: Math.max(0, right - x), heightMm: Math.max(0, bottom - y), markId: mark.id,
  };
}

/** พื้นที่ห้ามวางทั้งหมดที่การจัดวางต้องหลบ: ที่ผู้ใช้กำหนดเอง + พื้นที่สงวนของมาร์ค */
export function effectiveKeepouts(doc) {
  const marks = doc.marks ?? [];
  if (!marks.length) return doc.keepouts;
  return [...doc.keepouts, ...marks.map((m) => markKeepout(m, doc.paper)).filter((k) => k.widthMm > 0 && k.heightMm > 0)];
}

export function markInsidePaper(mark, paper) {
  const b = markBounds(mark);
  return b.x >= -EPSILON_MM && b.y >= -EPSILON_MM
    && b.x + b.width <= paper.widthMm + EPSILON_MM && b.y + b.height <= paper.heightMm + EPSILON_MM;
}

const COLOR = /^(none|#[0-9a-f]{6})$/i;

function checkMark(mark, paper) {
  if (!MARK_SHAPES.includes(mark.shape)) throw new UserError('mark-shape', 'รูปมาร์คไม่ถูกต้อง');
  const nums = [mark.xMm, mark.yMm, mark.widthMm, mark.heightMm, mark.rotationDeg, mark.lineMm, mark.keepoutMm];
  if (!nums.every(Number.isFinite)) throw new UserError('mark-invalid', 'ค่าของมาร์คต้องเป็นตัวเลข');
  if (mark.widthMm < MIN_MARK_MM || mark.heightMm < MIN_MARK_MM) {
    throw new UserError('mark-size', `ขนาดมาร์คต้องไม่ต่ำกว่า ${MIN_MARK_MM} มม.`);
  }
  if (mark.lineMm < 0 || mark.keepoutMm < 0) throw new UserError('mark-invalid', 'ความหนาและระยะสงวนต้องไม่ติดลบ');
  if (!COLOR.test(mark.fill) || !COLOR.test(mark.stroke)) throw new UserError('mark-color', 'สีของมาร์คไม่ถูกต้อง');
  if (mark.fill === 'none' && mark.stroke === 'none') throw new UserError('mark-color', 'มาร์คต้องมีสีเติมหรือสีเส้นอย่างน้อยหนึ่งอย่าง');
  if (!markInsidePaper(mark, paper)) throw new UserError('mark-outside', 'มาร์คต้องอยู่บนกระดาษทั้งหมด');
}

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

/** ใช้ Profile: แทนมาร์คทั้งหมดด้วยชุดใหม่ หนึ่งขั้น Undo */
export function applyProfile(doc, profile, newId, template = profile.template) {
  let marks;
  if (profile.marks) {
    marks = profile.marks.map((m) => ({ ...m, id: newId() }));
  } else {
    marks = marksFromTemplate(template, doc.paper, newId);
  }
  for (const m of marks) checkMark(m, doc.paper);
  return {
    ...doc,
    marks,
    markSettings: {
      profileId: profile.id,
      label: profile.label,
      verificationStatus: profile.verificationStatus,
      template: profile.marks ? null : { ...template },
      exportOptions: { ...(profile.exportOptions ?? { marksInCutSvg: 'reference' }) },
    },
  };
}

export const clearMarks = (doc) => ({ ...doc, marks: [], markSettings: null });

function requireMark(doc, id) {
  const mark = doc.marks.find((m) => m.id === id);
  if (!mark) throw new UserError('mark-missing', 'ไม่พบมาร์คที่เลือก');
  return mark;
}

const GEOMETRY_KEYS = ['shape', 'xMm', 'yMm', 'widthMm', 'heightMm', 'rotationDeg', 'lineMm', 'keepoutMm', 'fill', 'stroke'];

/** แก้มาร์ค มาร์คที่ล็อกแก้ได้เฉพาะการปลดล็อก (FR-10.5) */
export function updateMark(doc, id, patch) {
  const current = requireMark(doc, id);
  if (current.locked && patch.locked !== false && GEOMETRY_KEYS.some((k) => k in patch)) {
    throw new UserError('mark-locked', 'มาร์คนี้ล็อกอยู่ ปลดล็อกก่อนแก้');
  }
  const mark = { ...current, ...patch };
  if ('rotationDeg' in patch) mark.rotationDeg = normalizeDeg(mark.rotationDeg);
  checkMark(mark, doc.paper);
  return { ...doc, marks: doc.marks.map((m) => (m.id === id ? mark : m)) };
}

export function addMark(doc, mark) {
  checkMark(mark, doc.paper);
  return { ...doc, marks: [...doc.marks, mark], markSettings: doc.markSettings ?? customSettings() };
}

const customSettings = () => ({
  profileId: null, label: 'มาร์คกำหนดเอง', verificationStatus: 'unverified', template: null, exportOptions: { marksInCutSvg: 'reference' },
});

/** มาร์คใหม่กลางกระดาษ ใช้ค่าจากมาร์คล่าสุดถ้ามี */
export function newMark(doc, id, shape = 'circle') {
  const last = doc.marks.at(-1);
  const size = last?.widthMm ?? 5;
  return {
    id,
    shape,
    xMm: doc.paper.widthMm / 2,
    yMm: doc.paper.heightMm / 2,
    widthMm: size,
    heightMm: size,
    rotationDeg: 0,
    fill: '#000000',
    stroke: 'none',
    lineMm: last?.lineMm ?? (shape === 'circle' || shape === 'square' ? 0.5 : 1),
    locked: false,
    keepoutMm: last?.keepoutMm ?? 3,
  };
}

/** ทำซ้ำ: ชิ้นใหม่เลื่อนไปขวาและลงล่าง ถ้าล้นกระดาษจะเลื่อนกลับเข้ามา */
export function duplicateMark(doc, id, newId) {
  const mark = requireMark(doc, id);
  const step = Math.max(mark.widthMm, mark.heightMm) * 1.5;
  const copy = { ...mark, id: newId, locked: false };
  copy.xMm += step;
  copy.yMm += step;
  const b = markBounds(copy);
  if (b.x + b.width > doc.paper.widthMm) copy.xMm -= step * 2;
  if (b.y + b.height > doc.paper.heightMm) copy.yMm -= step * 2;
  return addMark(doc, copy);
}

export function removeMark(doc, id) {
  requireMark(doc, id);
  const marks = doc.marks.filter((m) => m.id !== id);
  return { ...doc, marks, markSettings: marks.length ? doc.markSettings : null };
}

/** เลื่อนมาร์คหลายตัวพร้อมกัน ตัวที่ล็อกไม่ขยับ ไม่ให้ออกนอกกระดาษ */
export function moveMarks(doc, ids, dx, dy) {
  const set = new Set(ids);
  const marks = doc.marks.map((m) => {
    if (!set.has(m.id) || m.locked) return m;
    const next = { ...m, xMm: m.xMm + dx, yMm: m.yMm + dy };
    const b = markBounds(next);
    next.xMm += Math.max(0, -b.x) - Math.max(0, b.x + b.width - doc.paper.widthMm);
    next.yMm += Math.max(0, -b.y) - Math.max(0, b.y + b.height - doc.paper.heightMm);
    return next;
  });
  return { ...doc, marks };
}

/**
 * จัดแนวมาร์คกับขอบกระดาษ: ให้จุดกึ่งกลางมาร์คห่างขอบตาม marginsMm ของด้านนั้น
 * (ความหมายเดียวกับ Page Mark Margins ของ SignMaster) hcenter/vcenter วางกึ่งกลางกระดาษ
 */
export function alignMark(doc, id, edge, marginsMm) {
  requireMark(doc, id);
  const { widthMm: W, heightMm: H } = doc.paper;
  const patch = {
    left: { xMm: marginsMm.left },
    hcenter: { xMm: W / 2 },
    right: { xMm: W - marginsMm.right },
    top: { yMm: marginsMm.top },
    vcenter: { yMm: H / 2 },
    bottom: { yMm: H - marginsMm.bottom },
  }[edge];
  if (!patch) throw new UserError('mark-align', 'การจัดแนวไม่ถูกต้อง');
  return updateMark(doc, id, patch);
}

/**
 * กรอบที่ล้อมด้วยจุดกึ่งกลางของมาร์คอ่านตำแหน่ง (ไม่นับสามเหลี่ยมบอกทิศ)
 * งานนอกกรอบนี้เครื่องอ่านมาร์คชดเชยได้ไม่ดี ใช้แจ้งเตือนใน Preflight
 */
export function markFrame(marks) {
  const readable = (marks ?? []).filter((m) => m.shape !== 'triangle');
  if (readable.length < 3) return null;
  const xs = readable.map((m) => m.xMm);
  const ys = readable.map((m) => m.yMm);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** มาร์คที่ไม่อยู่บนกระดาษแล้ว เช่น หลังเปลี่ยนขนาดกระดาษ */
export const marksOutsidePaper = (doc) => new Set((doc.marks ?? []).filter((m) => !markInsidePaper(m, doc.paper)).map((m) => m.id));

/**
 * User Profile (FR-10.6): เก็บมาร์คตามตำแหน่งจริง พร้อมขนาดกระดาษที่ใช้ตอนบันทึก
 * ใช้กับกระดาษขนาดอื่นได้ถ้ามาร์คยังอยู่บนกระดาษ และ UI ต้องแจ้งว่าขนาดกระดาษต่างกัน
 */
export function profileFromDoc(doc, id, label) {
  const name = String(label ?? '').trim();
  if (!name) throw new UserError('profile-name', 'กรุณาตั้งชื่อ Profile');
  if (!doc.marks.length) throw new UserError('profile-empty', 'ยังไม่มีมาร์คให้บันทึก');
  return {
    id,
    label: name,
    builtIn: false,
    verificationStatus: 'unverified',
    note: 'Profile ของผู้ใช้ ตรวจกับเครื่องจริงก่อนใช้งาน',
    coordinateConvention: 'mark-center, origin top-left of paper, mm, Y down',
    paperMm: { widthMm: doc.paper.widthMm, heightMm: doc.paper.heightMm },
    marks: doc.marks.map((m) => ({ ...m })),
    exportOptions: { ...(doc.markSettings?.exportOptions ?? { marksInCutSvg: 'reference' }) },
    savedAt: new Date().toISOString(),
  };
}

/** ตรวจ Profile ที่อ่านจากที่เก็บ คืน null ถ้าใช้ไม่ได้ */
export function sanitizeProfile(p) {
  if (!p || typeof p.id !== 'string' || typeof p.label !== 'string' || !Array.isArray(p.marks) || !p.marks.length) return null;
  if (!p.marks.every((m) => MARK_SHAPES.includes(m.shape)
    && [m.xMm, m.yMm, m.widthMm, m.heightMm, m.rotationDeg, m.lineMm, m.keepoutMm].every(Number.isFinite))) return null;
  return { ...p, builtIn: false, verificationStatus: p.verificationStatus === 'verified' ? 'verified' : 'unverified' };
}
