import { clamp } from './units.js';

/** view: { scale (px ต่อ มม.), originX, originY (px หน้าจอของจุด 0,0 บนกระดาษ) } */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 80;

export const paperToScreen = (view, p) => ({
  x: p.x * view.scale + view.originX,
  y: p.y * view.scale + view.originY,
});

export const screenToPaper = (view, p) => ({
  x: (p.x - view.originX) / view.scale,
  y: (p.y - view.originY) / view.scale,
});

/** ซูมโดยจุดใต้เคอร์เซอร์ยังคงอยู่ที่พิกัดกระดาษเดิม */
export function zoomAt(view, screenPoint, factor) {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const p = screenToPaper(view, screenPoint);
  return { scale, originX: screenPoint.x - p.x * scale, originY: screenPoint.y - p.y * scale };
}

export function fitView(paper, viewport, padding) {
  const scale = clamp(
    Math.min(
      (viewport.width - padding * 2) / paper.widthMm,
      (viewport.height - padding * 2) / paper.heightMm,
    ),
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    originX: (viewport.width - paper.widthMm * scale) / 2,
    originY: (viewport.height - paper.heightMm * scale) / 2,
  };
}

/** ระยะขีดไม้บรรทัด (มม.) ที่ห่างบนจอไม่น้อยกว่า minPx */
export function rulerStep(scale, minPx = 56) {
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) {
    if (step * scale >= minPx) return step;
  }
  return 5000;
}
