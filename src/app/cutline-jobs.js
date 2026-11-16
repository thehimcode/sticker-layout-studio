import * as D from '../core/document.js';
import { UserError } from '../core/errors.js';
import { prepareLayout } from '../core/layout/layout.js';
import { DEFAULT_CUTLINE_CONFIG, MAX_ANALYSIS_SIDE } from '../core/contour/pipeline.js';
import { CancelledError, CutlineService, rasterize } from './cutline-service.js';

/** งานเบื้องหลังบนเอกสาร: คำนวณเส้นตัดใหม่เมื่อขนาดเปลี่ยน และสร้างเส้นตัดทุกแบบ */
export class CutlineJobs {
  constructor({ store, assets, onError }) {
    Object.assign(this, { store, assets, onError });
    this.background = new CutlineService();
    this.batch = new CutlineService();
    this.timer = null;
    this.batchRunning = false;
    store.subscribe(({ docChanged }) => {
      if (docChanged) this.scheduleRefresh();
    });
  }

  scheduleRefresh() {
    if (this.running) return;
    if (!this.store.doc.masters.some(D.needsCutlineRefresh)) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refreshStale(), 80);
  }

  buildInput(master) {
    const config = { ...DEFAULT_CUTLINE_CONFIG, ...master.cutlineConfig };
    return {
      masterId: master.id,
      paths: master.contours.paths,
      natural: master.naturalSize,
      sizeMm: master.desiredSizeMm,
      offsetMm: config.offsetMm,
      contourMode: config.contourMode,
      cornerRadiusMm: config.cornerRadiusMm,
      fairingMm: config.fairingMm,
      bleedMm: master.bleedMm ?? 0,
    };
  }

  async refreshStale() {
    this.running = true;
    try {
      for (;;) {
        const master = this.store.doc.masters.find(D.needsCutlineRefresh);
        if (!master) break;
        const input = this.buildInput(master);
        const cutline = await this.background.build(input);
        const current = D.getMaster(this.store.doc, master.id);
        const sameSize = current
          && current.desiredSizeMm.widthMm === input.sizeMm.widthMm
          && current.desiredSizeMm.heightMm === input.sizeMm.heightMm;
        if (sameSize && D.needsCutlineRefresh(current)) {
          if (!this.store.amend(D.refreshCutline(this.store.doc, master.id, cutline))) break;
        }
      }
    } catch (error) {
      if (!(error instanceof CancelledError)) {
        console.error(error);
        this.onError('คำนวณเส้นตัดใหม่ไม่สำเร็จ ลองเปิดตัวแก้เส้นตัดอีกครั้ง');
      }
    } finally {
      this.running = false;
    }
  }

  /** สร้างเส้นตัดให้แบบที่ยังไม่มี คืน { done, failed, cancelled } ผลที่เสร็จแล้วจะถูกเก็บแม้กดยกเลิก */
  async generateAll(onProgress) {
    const targets = this.store.doc.masters.filter((m) => !m.cutline && this.assets.has(m.originalAsset.assetId));
    this.batchRunning = true;
    const finished = [];
    let failed = 0;
    let cancelled = false;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const master = targets[i];
        onProgress(i, targets.length, master.name);
        const raster = rasterize(this.assets.get(master.originalAsset.assetId), MAX_ANALYSIS_SIDE);
        const config = { ...DEFAULT_CUTLINE_CONFIG, maskMode: null };
        try {
          const analysis = await this.batch.analyze(raster, master.naturalSize, config);
          const applied = { ...config, maskMode: analysis.maskMode, bgColor: analysis.bgColor };
          const cutline = await this.batch.build({
            ...this.buildInput({ ...master, contours: { paths: analysis.paths }, cutlineConfig: applied }),
          });
          if (cutline.closedPaths.length) {
            finished.push({ id: master.id, config: applied, contourPaths: analysis.paths, cutline });
          } else {
            failed += 1;
          }
        } catch (error) {
          if (error instanceof CancelledError) throw error;
          console.error(error);
          failed += 1;
        }
      }
    } catch (error) {
      if (!(error instanceof CancelledError)) throw error;
      cancelled = true;
    } finally {
      this.batchRunning = false;
    }
    if (finished.length) {
      let next = this.store.doc;
      for (const item of finished) {
        if (D.getMaster(next, item.id)) next = D.setCutline(next, item.id, item);
      }
      this.store.commit(next);
    }
    return { done: finished.length, failed, cancelled, total: targets.length };
  }

  cancelBatch() {
    this.batch.cancelAll();
  }

  /** ต้องรอเส้นตัดคำนวณใหม่ให้ครบก่อน เพราะการจัดเรียงใช้รูปร่างล่าสุด */
  async layout(method, onProgress) {
    const doc = this.store.doc;
    if (doc.masters.some(D.needsCutlineRefresh)) {
      throw new UserError('layout-stale', 'เส้นตัดกำลังคำนวณใหม่ ลองอีกครั้งในอีกสักครู่');
    }
    const result = await this.batch.layout(prepareLayout(doc, method), onProgress);
    if (result.violations) {
      throw new UserError('layout-invalid', `ผลจัดเรียงไม่ผ่านการตรวจ ${result.violations} จุด จึงไม่นำมาใช้ ลองปรับระยะห่างแล้วคำนวณใหม่`);
    }
    if (this.store.doc !== doc) {
      throw new UserError('layout-changed', 'งานมีการเปลี่ยนแปลงระหว่างคำนวณ กรุณาสั่งจัดเรียงอีกครั้ง');
    }
    return result;
  }
}
