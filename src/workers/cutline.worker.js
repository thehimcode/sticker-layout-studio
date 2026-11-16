/** งานหนักของเส้นตัด ยกเลิกได้ด้วยการ terminate Worker จากฝั่ง CutlineService */
import factory from '../../vendor/clipper2/clipper2z.js';
import { analyzeContours, buildCutline, chooseMaskMode } from '../core/contour/pipeline.js';
import { nestLayout, standardLayout, verifyLayout } from '../core/layout/layout.js';

let clipperReady = null;
const getClipper = () => {
  clipperReady = clipperReady ?? factory();
  return clipperReady;
};

const handlers = {
  async analyze({ raster, natural, config }, progress) {
    const applied = config.maskMode ? config : { ...config, maskMode: chooseMaskMode(raster) };
    const analysis = analyzeContours(raster, natural, applied, progress);
    return { ...analysis, maskMode: applied.maskMode };
  },
  async build(input) {
    return buildCutline(await getClipper(), input);
  },
  async layout(input, progress) {
    if (input.method === 'nest') return nestLayout(await getClipper(), input, progress);
    const result = standardLayout(input, progress);
    const violations = verifyLayout(input, result);
    return { ...result, violations, report: { ...result.report, violations } };
  },
};

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    const result = await handlers[type](payload, (value) => self.postMessage({ id, progress: value }));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) });
  }
};
