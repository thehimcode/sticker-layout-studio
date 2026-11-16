import { UserError } from './errors.js';
import { EPSILON_MM } from './units.js';

/** ขนาดแนวตั้ง (กว้าง × สูง) หน่วยมิลลิเมตร ตาม FR-01.2 และ FR-01.3 */
export const PAPER_PRESETS = Object.freeze({
  A0: { widthMm: 841, heightMm: 1189 },
  A1: { widthMm: 594, heightMm: 841 },
  A2: { widthMm: 420, heightMm: 594 },
  A3: { widthMm: 297, heightMm: 420 },
  'A3+': { widthMm: 320, heightMm: 450 },
  'Super A3': { widthMm: 329, heightMm: 483 },
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
  A6: { widthMm: 105, heightMm: 148 },
});

export const DEFAULT_MARGINS = Object.freeze({ top: 5, right: 5, bottom: 5, left: 5 });
export const CUSTOM_PAPER_MIN_MM = 10;
export const CUSTOM_PAPER_MAX_MM = 5000;

/** preset: ชื่อใน PAPER_PRESETS หรือ 'custom' */
export function resolvePaper({
  preset, orientation = 'portrait', widthMm, heightMm, marginsMm = DEFAULT_MARGINS,
}) {
  if (preset === 'custom') {
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)
      || widthMm < CUSTOM_PAPER_MIN_MM || heightMm < CUSTOM_PAPER_MIN_MM
      || widthMm > CUSTOM_PAPER_MAX_MM || heightMm > CUSTOM_PAPER_MAX_MM) {
      throw new UserError('paper-size', `ขนาดกระดาษต้องอยู่ระหว่าง ${CUSTOM_PAPER_MIN_MM}–${CUSTOM_PAPER_MAX_MM} มม.`);
    }
    return { preset, orientation: widthMm > heightMm ? 'landscape' : 'portrait', widthMm, heightMm, marginsMm };
  }
  const base = PAPER_PRESETS[preset];
  if (!base) throw new UserError('paper-preset', `ไม่รู้จักขนาดกระดาษ ${preset}`);
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw new UserError('paper-orientation', 'แนวกระดาษไม่ถูกต้อง');
  }
  const landscape = orientation === 'landscape';
  return {
    preset,
    orientation,
    widthMm: landscape ? base.heightMm : base.widthMm,
    heightMm: landscape ? base.widthMm : base.heightMm,
    marginsMm,
  };
}

/** พื้นที่วางงาน {x, y, width, height} หรือ throw เมื่อ Margin ไม่เหลือพื้นที่ */
export function printableArea(paper) {
  const margins = paper.marginsMm;
  const width = paper.widthMm - margins.left - margins.right;
  const height = paper.heightMm - margins.top - margins.bottom;
  if (width <= EPSILON_MM || height <= EPSILON_MM) {
    throw new UserError('margin-too-large', 'ระยะขอบกินพื้นที่กระดาษจนไม่เหลือที่วางงาน');
  }
  return { x: margins.left, y: margins.top, width, height };
}

export function validateMargins(margins) {
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (!Number.isFinite(margins[side]) || margins[side] < 0) {
      throw new UserError('margin-negative', 'ระยะขอบต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    }
  }
}
