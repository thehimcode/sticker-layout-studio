import { DEFAULT_CUTLINE_CONFIG, MAX_ANALYSIS_SIDE } from '../core/contour/pipeline.js';
import { cutlineData, cutlineSvg } from '../core/contour/svg.js';
import { curveSegments } from '../core/contour/bezier.js';
import { getMaster, needsCutlineRefresh } from '../core/document.js';
import { UserError } from '../core/errors.js';
import { formatMm } from '../core/units.js';
import { CancelledError, CutlineService, rasterize } from '../app/cutline-service.js';
import { bindNumber, setField } from './fields.js';

const $ = (id) => document.getElementById(id);
const PREVIEW_PAD = 28;
const POINT_HIT_PX = 8;
const CUT_COLOR = '#ff00a0';
const CONTOUR_COLOR = '#00d1c1';

/**
 * ตัวแก้เส้นตัดของหนึ่งแบบ การปรับค่าทั้งหมดอยู่ในหน้าต่างนี้ เอกสารเปลี่ยนเมื่อกด "ใช้เส้นตัดนี้" เท่านั้น
 * พิกัดภาพคือพิกเซลของภาพต้นฉบับ เส้นตัดเป็น มม. ของขนาดงานจริง
 */
export class CutlineEditor {
  constructor({ store, assets, actions }) {
    Object.assign(this, { store, assets, actions });
    this.service = new CutlineService();
    this.dialog = $('cutline-dialog');
    this.canvas = $('cut-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.master = null;
    this.selected = null;
    this.drag = null;
    this.bind();
  }

  bind() {
    const set = (patch) => { this.config = { ...this.config, ...patch }; this.syncControls(); this.schedule('analyze'); };
    $('cut-mask-alpha').addEventListener('click', () => set({ maskMode: 'alpha' }));
    $('cut-mask-color').addEventListener('click', () => set({ maskMode: 'color' }));
    $('cut-mode-outer').addEventListener('click', () => set({ contourMode: 'outer' }));
    $('cut-mode-merged').addEventListener('click', () => set({ contourMode: 'merged' }));
    $('cut-mode-all').addEventListener('click', () => set({ contourMode: 'all' }));
    $('cut-color-auto').addEventListener('click', () => set({ bgColor: null }));
    const slider = (id, key, parse = Number) => $(id).addEventListener('input', (e) => set({ [key]: parse(e.target.value) }));
    slider('cut-alpha', 'alphaThreshold');
    slider('cut-tol', 'colorTolerance');
    slider('cut-noise', 'noiseArea');
    slider('cut-smooth', 'smooth');
    const shape = (id, key) => $(id).addEventListener('input', (e) => {
      this.config = { ...this.config, [key]: Number(e.target.value) };
      this.syncControls();
      this.schedule('build', 120);
    });
    shape('cut-corner', 'cornerRadiusMm');
    shape('cut-fair', 'fairingMm');
    bindNumber($('cut-offset'), {
      step: 0.5,
      unit: 'mm',
      onCommit: (v) => {
        this.config = { ...this.config, offsetMm: v };
        this.schedule('build');
      },
      onInvalid: () => this.actions.toastError('กรุณากรอกตัวเลข'),
      refresh: () => this.syncControls(),
    });

    $('cut-edit').addEventListener('change', (e) => {
      this.editing = e.target.checked;
      this.selected = null;
      this.syncControls();
      this.draw();
    });
    $('cut-point-del').addEventListener('click', () => this.deleteSelected());
    $('cut-point-undo').addEventListener('click', () => this.undoEdit());
    $('cut-point-reset').addEventListener('click', () => {
      this.config = { ...this.config, edited: false };
      this.editStack = [];
      this.syncControls();
      this.schedule('analyze');
    });
    $('cut-defaults').addEventListener('click', () => {
      this.config = { ...DEFAULT_CUTLINE_CONFIG, maskMode: null };
      this.editStack = [];
      this.syncControls();
      this.schedule('analyze');
    });
    $('cut-cancel-job').addEventListener('click', () => this.service.cancelAll());
    $('cut-close').addEventListener('click', () => this.close());
    $('cut-apply').addEventListener('click', () => this.apply());
    $('cut-remove').addEventListener('click', () => {
      this.actions.clearCutline(this.master.id);
      this.close();
    });
    $('cut-svg').addEventListener('click', () => this.downloadSvg());
    this.dialog.addEventListener('close', () => this.cleanup());

    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', () => this.onUp());
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteSelected();
      }
    });
  }

  open(masterId) {
    const master = getMaster(this.store.doc, masterId);
    const bitmap = this.assets.get(master.originalAsset.assetId);
    if (!bitmap) throw new UserError('asset-missing', 'ไม่พบภาพต้นฉบับของแบบนี้ จึงสร้างเส้นตัดไม่ได้');
    this.master = master;
    this.bitmap = bitmap;
    this.raster = rasterize(bitmap, MAX_ANALYSIS_SIDE);
    this.config = { ...DEFAULT_CUTLINE_CONFIG, maskMode: null, ...master.cutlineConfig };
    this.paths = master.contours?.paths ?? null;
    this.cutline = needsCutlineRefresh(master) ? null : master.cutline;
    this.warnings = [];
    this.editing = false;
    this.editStack = [];
    this.selected = null;
    this.view = null;
    this.fatal = null;
    $('cut-title').textContent = master.name;
    $('cut-remove').hidden = !master.cutline;
    this.dialog.showModal();
    this.resize();
    this.syncControls();
    this.renderStatus();
    if (!this.paths) this.schedule('analyze', 0);
    else if (!this.cutline) this.schedule('build', 0);
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  /** คืนหน่วยความจำและหยุด Worker เมื่อปิดหน้าต่าง (NFR-08) */
  cleanup() {
    clearTimeout(this.timer);
    this.service.dispose();
    this.raster = null;
    this.bitmap = null;
    this.master = null;
    this.paths = null;
    this.cutline = null;
  }

  schedule(kind, delay = 180) {
    clearTimeout(this.timer);
    const rank = { build: 1, analyze: 2 };
    if (!this.queued || rank[kind] > rank[this.queued]) this.queued = kind;
    this.timer = setTimeout(() => this.compute(), delay);
  }

  async compute() {
    const kind = this.queued;
    this.queued = null;
    if (!this.master) return;
    this.service.cancelAll();
    const ticket = (this.ticket = (this.ticket ?? 0) + 1);
    const { master } = this;
    this.setBusy(0.05);
    try {
      if (kind === 'analyze' && !this.config.edited) {
        const raster = { ...this.raster, data: this.raster.data.slice() };
        const analysis = await this.service.analyze(raster, master.naturalSize, this.config, (v) => this.setBusy(v * 0.8));
        if (ticket !== this.ticket) return;
        this.paths = analysis.paths;
        this.warnings = analysis.warnings;
        this.config = { ...this.config, maskMode: analysis.maskMode, bgColor: this.config.bgColor };
        this.detectedBg = analysis.bgColor;
        this.syncControls();
      }
      const current = getMaster(this.store.doc, master.id) ?? master;
      const cutline = await this.service.build({
        masterId: master.id,
        paths: this.paths ?? [],
        natural: master.naturalSize,
        sizeMm: current.desiredSizeMm,
        offsetMm: this.config.offsetMm,
        contourMode: this.config.contourMode,
        cornerRadiusMm: this.config.cornerRadiusMm,
        fairingMm: this.config.fairingMm,
        bleedMm: current.bleedMm ?? 0,
      });
      if (ticket !== this.ticket) return;
      this.cutline = cutline;
      this.fatal = null;
    } catch (error) {
      if (ticket !== this.ticket) return;
      if (error instanceof CancelledError) {
        this.fatal = 'ยกเลิกการคำนวณแล้ว ผลด้านล่างเป็นค่าก่อนหน้า';
      } else {
        console.error(error);
        this.fatal = 'คำนวณเส้นตัดไม่สำเร็จ ลองปรับค่าแล้วคำนวณใหม่';
      }
    }
    this.setBusy(null);
    this.renderStatus();
    this.draw();
  }

  setBusy(value) {
    $('cut-job').hidden = value === null;
    if (value !== null) $('cut-progress').value = value;
    $('cut-apply').disabled = value !== null || !this.canApply();
  }

  canApply() {
    return Boolean(this.cutline?.closedPaths.length)
      && !this.cutline.issues.some((i) => i.severity === 'error');
  }

  syncControls() {
    const c = this.config;
    if (!c) return;
    const pressed = (id, on) => $(id).setAttribute('aria-pressed', String(on));
    pressed('cut-mask-alpha', c.maskMode === 'alpha');
    pressed('cut-mask-color', c.maskMode === 'color');
    pressed('cut-mode-outer', c.contourMode === 'outer');
    pressed('cut-mode-merged', c.contourMode === 'merged');
    pressed('cut-mode-all', c.contourMode === 'all');
    $('cut-alpha-row').hidden = c.maskMode === 'color';
    $('cut-color-row').hidden = c.maskMode !== 'color';
    const value = (id, v) => {
      $(id).value = v;
      $(`${id}-out`).textContent = v;
    };
    value('cut-alpha', c.alphaThreshold);
    value('cut-tol', c.colorTolerance);
    value('cut-noise', c.noiseArea);
    value('cut-smooth', c.smooth);
    value('cut-corner', c.cornerRadiusMm);
    value('cut-fair', c.fairingMm);
    const bg = c.bgColor ?? this.detectedBg;
    $('cut-swatch').style.background = bg ? `rgb(${bg.join(',')})` : 'transparent';
    setField($('cut-offset'), formatMm(c.offsetMm));

    const locked = c.edited;
    for (const id of ['cut-mask-alpha', 'cut-mask-color', 'cut-mode-outer', 'cut-mode-merged', 'cut-mode-all',
      'cut-alpha', 'cut-tol', 'cut-noise', 'cut-smooth', 'cut-color-auto']) {
      $(id).disabled = locked;
    }
    $('cut-edit').checked = Boolean(this.editing);
    $('cut-edit-tools').hidden = !this.editing;
    $('cut-point-del').disabled = !this.selected;
    $('cut-point-undo').disabled = !this.editStack?.length;
    $('cut-point-reset').disabled = !c.edited;
    let hint = 'ล้อเมาส์ซูม ลากเพื่อเลื่อนมุมมอง';
    if (this.editing) hint = 'ลากจุดเพื่อย้าย ดับเบิลคลิกบนเส้นเพื่อเพิ่มจุด เลือกจุดแล้วกด Delete เพื่อลบ';
    else if (c.maskMode === 'color') hint = 'คลิกบนภาพเพื่อเลือกสีพื้นหลัง ล้อเมาส์ซูม';
    if (locked) hint += ' ค่าด้านขวาถูกล็อกจนกว่าจะล้างการแก้จุด';
    $('cut-hint').textContent = hint;
  }

  renderStatus() {
    const list = $('cut-issues');
    const items = [...(this.warnings ?? []), ...(this.cutline?.issues ?? [])];
    if (this.fatal) items.unshift({ severity: 'error', message: this.fatal });
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      li.className = item.severity;
      li.textContent = item.message;
      return li;
    }));
    const c = this.cutline;
    if (c) {
      const segments = c.curves.reduce((sum, curve) => sum + curveSegments(curve), 0);
      $('cut-stats').textContent = `${c.closedPaths.length} เส้น, ${segments} ช่วงโค้ง`
        + (c.envelopeMm ? `, กรอบ ${formatMm(c.envelopeMm.width)} × ${formatMm(c.envelopeMm.height)} มม.` : '');
    } else {
      $('cut-stats').textContent = '';
    }
    $('cut-apply').disabled = !$('cut-job').hidden || !this.canApply();
    $('cut-svg').disabled = !c?.closedPaths.length;
  }

  apply() {
    if (!this.canApply()) return;
    this.actions.applyCutline(this.master.id, {
      config: this.config,
      contourPaths: this.paths,
      cutline: this.cutline,
    });
    this.close();
  }

  downloadSvg() {
    const blob = new Blob([cutlineSvg(this.cutline, this.master.name)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.master.name.replace(/\.[^.]+$/, '')}-cutline.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Preview ----------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.dpr = dpr;
    this.size = rect;
    if (!this.view && this.master) this.fitView();
    this.draw();
  }

  fitView() {
    const { widthPx, heightPx } = this.master.naturalSize;
    const scale = Math.min((this.size.width - PREVIEW_PAD * 2) / widthPx, (this.size.height - PREVIEW_PAD * 2) / heightPx);
    this.view = {
      scale,
      x: (this.size.width - widthPx * scale) / 2,
      y: (this.size.height - heightPx * scale) / 2,
    };
  }

  toScreen(x, y) {
    return { x: x * this.view.scale + this.view.x, y: y * this.view.scale + this.view.y };
  }

  toImage(event) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - r.left - this.view.x) / this.view.scale,
      y: (event.clientY - r.top - this.view.y) / this.view.scale,
    };
  }

  draw() {
    if (!this.master || !this.view) return;
    const { ctx, dpr, view, master, bitmap } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2f4f47';
    ctx.fillRect(0, 0, this.size.width, this.size.height);
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);
    const { widthPx, heightPx } = master.naturalSize;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, widthPx, heightPx);

    if (this.cutline?.closedPaths.length) {
      const size = this.cutline.sizeMm;
      const sx = widthPx / size.widthMm;
      const sy = heightPx / size.heightMm;
      ctx.save();
      ctx.scale(sx, sy);
      ctx.strokeStyle = CUT_COLOR;
      ctx.lineWidth = 1.5 / (view.scale * sx);
      ctx.stroke(new Path2D(cutlineData(this.cutline)));
      ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.editing && this.paths) this.drawPoints();
  }

  drawPoints() {
    const { ctx } = this;
    ctx.strokeStyle = CONTOUR_COLOR;
    ctx.lineWidth = 1;
    this.paths.forEach((path, p) => {
      ctx.beginPath();
      for (let i = 0; i < path.length; i += 2) {
        const s = this.toScreen(path[i], path[i + 1]);
        if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.stroke();
      for (let i = 0; i < path.length; i += 2) {
        const s = this.toScreen(path[i], path[i + 1]);
        const active = this.selected?.path === p && this.selected.index === i / 2;
        ctx.fillStyle = active ? CUT_COLOR : '#fff';
        ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
        ctx.strokeRect(s.x - 3, s.y - 3, 6, 6);
      }
    });
  }

  // ---------- การโต้ตอบ ----------

  pointAt(event) {
    const r = this.canvas.getBoundingClientRect();
    const mx = event.clientX - r.left;
    const my = event.clientY - r.top;
    for (let p = 0; p < this.paths.length; p += 1) {
      const path = this.paths[p];
      for (let i = 0; i < path.length; i += 2) {
        const s = this.toScreen(path[i], path[i + 1]);
        if (Math.abs(s.x - mx) <= POINT_HIT_PX && Math.abs(s.y - my) <= POINT_HIT_PX) return { path: p, index: i / 2 };
      }
    }
    return null;
  }

  pushEdit() {
    this.editStack.push(this.paths);
    this.paths = this.paths.map((p) => [...p]);
    this.config = { ...this.config, edited: true };
  }

  onDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.focus({ preventScroll: true });
    if (this.editing && this.paths) {
      const hit = this.pointAt(event);
      this.selected = hit;
      this.syncControls();
      this.draw();
      if (hit) {
        this.drag = { kind: 'point', hit, moved: false };
        return;
      }
    }
    this.lastPoint = this.toImage(event);
    this.drag = { kind: 'pan', x: event.clientX, y: event.clientY, view: this.view, moved: false };
  }

  onMove(event) {
    const { drag } = this;
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.view = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
      this.draw();
      return;
    }
    if (!drag.moved) {
      this.pushEdit();
      drag.moved = true;
    }
    const p = this.toImage(event);
    const path = this.paths[drag.hit.path];
    path[drag.hit.index * 2] = p.x;
    path[drag.hit.index * 2 + 1] = p.y;
    this.draw();
  }

  onUp() {
    const { drag } = this;
    this.drag = null;
    if (!drag) return;
    if (drag.kind === 'point' && drag.moved) {
      this.syncControls();
      this.schedule('build', 0);
      return;
    }
    if (drag.kind === 'pan' && !drag.moved && !this.editing && this.config.maskMode === 'color') {
      this.pickColor();
    }
  }

  pickColor() {
    const { x, y } = this.lastPoint ?? {};
    if (x === undefined) return;
    const { data, width, height } = this.raster;
    const { widthPx, heightPx } = this.master.naturalSize;
    const px = Math.floor((x * width) / widthPx);
    const py = Math.floor((y * height) / heightPx);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 4;
    this.config = { ...this.config, bgColor: [data[i], data[i + 1], data[i + 2]] };
    this.syncControls();
    this.schedule('analyze', 0);
  }

  onDouble(event) {
    if (!this.editing || !this.paths) return;
    const p = this.toImage(event);
    let best = null;
    this.paths.forEach((path, pathIndex) => {
      const n = path.length / 2;
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        const ax = path[i * 2]; const ay = path[i * 2 + 1];
        const dx = path[j * 2] - ax; const dy = path[j * 2 + 1] - ay;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy);
        if (!best || d < best.d) best = { d, pathIndex, i };
      }
    });
    if (!best || best.d * this.view.scale > POINT_HIT_PX * 2) return;
    this.pushEdit();
    this.paths[best.pathIndex].splice((best.i + 1) * 2, 0, p.x, p.y);
    this.selected = { path: best.pathIndex, index: best.i + 1 };
    this.syncControls();
    this.draw();
    this.schedule('build', 0);
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.paths[this.selected.path].length <= 6) {
      this.actions.toastError('เส้นต้องมีอย่างน้อย 3 จุด');
      return;
    }
    this.pushEdit();
    this.paths[this.selected.path].splice(this.selected.index * 2, 2);
    this.selected = null;
    this.syncControls();
    this.draw();
    this.schedule('build', 0);
  }

  undoEdit() {
    if (!this.editStack.length) return;
    this.paths = this.editStack.pop();
    if (!this.editStack.length) this.config = { ...this.config, edited: false };
    this.selected = null;
    this.syncControls();
    this.draw();
    this.schedule('build', 0);
  }

  onWheel(event) {
    event.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = event.clientX - r.left;
    const my = event.clientY - r.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const { view } = this;
    const scale = view.scale * factor;
    this.view = { scale, x: mx - (mx - view.x) * factor, y: my - (my - view.y) * factor };
    this.draw();
  }
}
