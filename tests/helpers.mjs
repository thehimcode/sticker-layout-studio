import assert from 'node:assert/strict';
export const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
export function idGen() { let n = 0; return () => `id${n += 1}`; }
export const art = ({ widthMm = 50, heightMm = 30, id = 'a1' } = {}) => ({
  id,
  name: 'a.png',
  originalAsset: { assetId: `asset-${id}` },
  sourceType: 'png',
  naturalSize: { widthPx: 600, heightPx: 360, dpi: 300 },
  desiredSizeMm: { widthMm, heightMm },
});
