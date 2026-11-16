/** สื่อสารกับ Worker งานละหนึ่งตัว cancel จะหยุดงานจริงด้วย terminate แล้วสร้างใหม่เมื่อใช้ครั้งถัดไป */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export class CutlineService {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../workers/cutline.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id);
      if (!job) return;
      if ('progress' in data) {
        job.onProgress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
    this.worker.onerror = (event) => {
      const message = event.message || 'Worker ทำงานไม่สำเร็จ';
      this.cancelAll(new Error(message));
    };
    return this.worker;
  }

  run(type, payload, onProgress) {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, type, payload });
    });
  }

  analyze(raster, natural, config, onProgress) {
    return this.run('analyze', { raster, natural, config }, onProgress);
  }

  build(input) {
    return this.run('build', input);
  }

  layout(input, onProgress) {
    return this.run('layout', input, onProgress);
  }

  get busy() {
    return this.pending.size > 0;
  }

  cancelAll(reason = new CancelledError()) {
    this.worker?.terminate();
    this.worker = null;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) job.reject(reason);
  }

  dispose() {
    this.cancelAll();
  }
}

/** ภาพสำหรับวิเคราะห์ ย่อเมื่อด้านยาวเกิน maxSide เพื่อคุมหน่วยความจำ */
export function rasterize(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}
