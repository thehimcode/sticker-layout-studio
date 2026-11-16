import {
  HANDLES, placementCorners, pointInPlacement, rectsOverlap, resizeFromHandle,
} from '../core/geometry.js';
import { UserError } from '../core/errors.js';
import {
  applyHandleResize, boundsOf, getInstance, getMaster, MIN_ARTWORK_MM, moveInstances, placedInstances,
} from '../core/document.js';
import { printableArea } from '../core/paper.js';
import { effectiveKeepouts, markCorners, markMatrix, moveMarks } from '../core/marks.js';
import { drawArtwork, drawCutlines, drawMarks } from '../render/page-render.js';
import { fitView, paperToScreen, rulerStep, screenToPaper, zoomAt } from '../core/viewport.js';

const RULER_PX = 22;
const HANDLE_PX = 9;
const COLORS = {
  mat: '#2f4f47', matLine: 'rgba(214,235,226,.13)', ruler: '#fbfcfb', rulerInk: '#5d6b67', rulerLine: '#d9dfdc',
  paper: '#ffffff', grid: 'rgba(23,33,30,.12)', cutline: '#ff00a0', margin: '#0a8fb0', cut: '#d4006a', bad: '#b3261e', caution: '#b26a00',
};

export { cutlinePath } from '../render/page-render.js';

/** โหมดแสดงผล FR-06.1 เป็นการแสดงผลเท่านั้น ไม่แก้ข้อมูล (FR-06.2) */
export const VIEW_MODES = Object.freeze(['both', 'artwork', 'cutlines']);

export class CanvasView {
  constructor({
    canvas, store, assets, getIssues, onViewChange, onError, onClamp, onBlocked,
  }) {
    Object.assign(this, {
      canvas, store, assets, getIssues, onViewChange, onError, onClamp, onBlocked,
    });
    this.ctx = canvas.getContext('2d');
    this.view = { scale: 1, originX: 0, originY: 0 };
    this.size = { width: 0, height: 0 };
    this.autoFit = true; // พอดีจอเสมอจนกว่าผู้ใช้จะซูมหรือเลื่อนมุมมองเอง
    this.drag = null;
    this.spaceDown = false;
    this.showGrid = false;
    this.mode = 'both';
    this.showGuides = true;
    this.showMarks = true;
    this.atEdge = false;
    this.frame = 0;

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    store.subscribe(() => this.invalidate());
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = { width: rect.width, height: rect.height };
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    if (this.autoFit && rect.width > 0) this.fit();
    this.invalidate();
  }

  setView(view) {
    this.view = view;
    this.onViewChange(view);
    this.invalidate();
  }

  fit() {
    const area = { width: this.size.width - RULER_PX, height: this.size.height - RULER_PX };
    const view = fitView(this.store.doc.paper, area, 28);
    this.autoFit = true;
    this.setView({ ...view, originX: view.originX + RULER_PX, originY: view.originY + RULER_PX });
  }

  zoomBy(factor) {
    this.autoFit = false;
    this.setView(zoomAt(this.view, { x: this.size.width / 2, y: this.size.height / 2 }, factor));
  }

  pointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** พิกัดกระดาษจาก event หรือ null ถ้าอยู่นอกกระดาษ */
  paperPointAt(event) {
    const p = screenToPaper(this.view, this.pointer(event));
    const { paper } = this.store.doc;
    return p.x >= 0 && p.y >= 0 && p.x <= paper.widthMm && p.y <= paper.heightMm ? p : null;
  }

  handleAt(screen) {
    const { doc, soleId } = this.store;
    const instance = soleId && getInstance(doc, soleId);
    if (!instance) return null;
    const corners = placementCorners(instance.transform, getMaster(doc, instance.masterId).desiredSizeMm);
    const names = ['nw', 'ne', 'se', 'sw'];
    for (let i = 0; i < 4; i += 1) {
      const c = paperToScreen(this.view, corners[i]);
      if (Math.abs(c.x - screen.x) <= HANDLE_PX && Math.abs(c.y - screen.y) <= HANDLE_PX) return names[i];
    }
    return null;
  }

  /** มาร์คที่อยู่ใต้เมาส์ เมื่อแสดงมาร์คอยู่ มาร์คอยู่ชั้นบนสุดจึงตรวจก่อนชิ้นงาน */
  markAt(point) {
    if (!this.showMarks) return null;
    const marks = this.store.doc.marks ?? [];
    for (let i = marks.length - 1; i >= 0; i -= 1) {
      const m = markMatrix(marks[i]);
      const dx = point.x - m[4];
      const dy = point.y - m[5];
      const lx = dx * m[0] + dy * m[1];
      const ly = dx * m[2] + dy * m[3];
      const pad = 4 / this.view.scale;
      if (Math.abs(lx) <= marks[i].widthMm / 2 + pad && Math.abs(ly) <= marks[i].heightMm / 2 + pad) return marks[i];
    }
    return null;
  }

  instanceAt(point) {
    const { doc } = this.store;
    for (let i = doc.instances.length - 1; i >= 0; i -= 1) {
      const instance = doc.instances[i];
      if (instance.placementStatus === 'placed' && instance.pageId === this.store.pageId
        && pointInPlacement(point, instance.transform, getMaster(doc, instance.masterId).desiredSizeMm)) return instance;
    }
    return null;
  }

  onPointerDown(event) {
    this.canvas.focus({ preventScroll: true });
    const screen = this.pointer(event);
    this.canvas.setPointerCapture(event.pointerId);
    if (event.button === 1 || this.spaceDown) {
      this.drag = { kind: 'pan', start: screen, view: this.view };
      return;
    }
    if (event.button !== 0) return;
    const { store } = this;
    const handle = this.handleAt(screen);
    if (handle) {
      const instance = getInstance(store.doc, store.soleId);
      const master = getMaster(store.doc, instance.masterId);
      this.drag = {
        kind: 'resize', handle, instance, master, base: store.doc, lastGood: screenToPaper(this.view, screen),
      };
      return;
    }
    const point = screenToPaper(this.view, screen);
    const mark = this.markAt(point);
    if (mark) {
      store.selectMark(mark.id);
      this.drag = mark.locked ? null : { kind: 'mark', start: point, id: mark.id, base: store.doc };
      if (mark.locked) this.onBlocked('mark-locked');
      return;
    }
    if (store.markId) store.selectMark(null);
    const hit = this.instanceAt(point);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!hit) {
      if (!additive) store.select([]);
      this.drag = { kind: 'marquee', start: point, current: point, base: store.selectedIds };
      return;
    }
    if (additive) {
      const has = store.selectedIds.includes(hit.id);
      store.select(has ? store.selectedIds.filter((id) => id !== hit.id) : [...store.selectedIds, hit.id]);
      if (has) return;
    } else if (!store.selectedIds.includes(hit.id)) {
      store.select([hit.id]);
    }
    this.drag = { kind: 'move', start: point, ids: store.selectedIds, base: store.doc };
  }

  onPointerMove(event) {
    const screen = this.pointer(event);
    const { drag } = this;
    if (!drag) {
      this.updateCursor(screen);
      return;
    }
    if (drag.kind === 'pan') {
      this.autoFit = false;
      this.setView({
        ...drag.view,
        originX: drag.view.originX + screen.x - drag.start.x,
        originY: drag.view.originY + screen.y - drag.start.y,
      });
      return;
    }
    const point = screenToPaper(this.view, screen);
    if (drag.kind === 'marquee') {
      drag.current = point;
      this.invalidate();
      return;
    }
    if (drag.kind === 'mark') {
      this.store.preview(moveMarks(drag.base, [drag.id], point.x - drag.start.x, point.y - drag.start.y));
      return;
    }
    try {
      if (drag.kind === 'move') this.dragMove(drag, point);
      else this.dragResize(drag, point);
    } catch (error) {
      if (!(error instanceof UserError)) this.onError(error);
    }
  }

  dragMove(drag, point) {
    const delta = { dx: point.x - drag.start.x, dy: point.y - drag.start.y };
    try {
      const { doc, clamped } = moveInstances(drag.base, drag.ids, delta);
      drag.clamped = drag.clamped || clamped;
      this.atEdge = clamped;
      this.store.preview(doc);
    } catch (error) {
      if (error.code !== 'keepout') throw error;
      // ทับพื้นที่ห้ามวาง: ชิ้นงานหยุดที่ตำแหน่งล่าสุดที่ถูกต้อง
      drag.blocked = true;
      this.atEdge = true;
      this.invalidate();
    }
  }

  resizeDoc(drag, pointer) {
    const result = resizeFromHandle({
      transform: drag.instance.transform,
      size: drag.master.desiredSizeMm,
      handle: drag.handle,
      pointer,
      lockAspect: drag.master.lockAspect,
      minMm: MIN_ARTWORK_MM,
    });
    return applyHandleResize(drag.base, drag.instance.id, result);
  }

  /** ถ้าจุดเมาส์ล้นพื้นที่ จะแบ่งครึ่งหาจุดสุดท้ายที่ถูกต้อง ทำให้ชิ้นงานหยุดชิดขอบพอดี */
  dragResize(drag, point) {
    try {
      this.store.preview(this.resizeDoc(drag, point));
      drag.lastGood = point;
      this.atEdge = false;
      return;
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
    }
    this.atEdge = true;
    drag.clamped = true;
    let good = drag.lastGood;
    let bad = point;
    let doc = null;
    for (let i = 0; i < 24; i += 1) {
      const mid = { x: (good.x + bad.x) / 2, y: (good.y + bad.y) / 2 };
      try {
        doc = this.resizeDoc(drag, mid);
        good = mid;
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        bad = mid;
      }
    }
    if (doc) this.store.preview(doc);
    drag.lastGood = good;
  }

  onPointerUp() {
    const { drag, store } = this;
    this.drag = null;
    this.atEdge = false;
    if (!drag) return;
    if (drag.kind === 'marquee') {
      const box = {
        x: Math.min(drag.start.x, drag.current.x),
        y: Math.min(drag.start.y, drag.current.y),
        width: Math.abs(drag.current.x - drag.start.x),
        height: Math.abs(drag.current.y - drag.start.y),
      };
      const inside = placedInstances(store.doc, store.pageId).filter((i) => rectsOverlap(box, boundsOf(store.doc, i))).map((i) => i.id);
      store.select([...new Set([...drag.base, ...inside])]);
      this.invalidate();
      return;
    }
    if (drag.kind !== 'pan') {
      store.commitPreview();
      if (drag.blocked) this.onBlocked();
      else if (drag.clamped) this.onClamp();
    }
  }

  cancelDrag() {
    if (this.drag && this.drag.kind !== 'pan' && this.drag.kind !== 'marquee') this.store.cancelPreview();
    this.drag = null;
    this.atEdge = false;
    this.invalidate();
  }

  onWheel(event) {
    event.preventDefault();
    this.autoFit = false;
    this.setView(zoomAt(this.view, this.pointer(event), Math.exp(-event.deltaY * 0.0015)));
  }

  updateCursor(screen) {
    const handle = this.handleAt(screen);
    let cursor = 'default';
    if (this.spaceDown) cursor = 'grab';
    else if (handle) cursor = HANDLES[handle].sx === HANDLES[handle].sy ? 'nwse-resize' : 'nesw-resize';
    else if (this.instanceAt(screenToPaper(this.view, screen))) cursor = 'move';
    this.canvas.style.cursor = cursor;
  }

  draw() {
    const { ctx, view, size, store } = this;
    const dpr = this.canvas.width / (size.width || 1);
    if (!Number.isFinite(dpr) || dpr <= 0) return;
    const { doc } = store;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.mat;
    ctx.fillRect(0, 0, size.width, size.height);
    this.drawMatGrid();

    const toScreen = [view.scale * dpr, 0, 0, view.scale * dpr, view.originX * dpr, view.originY * dpr];
    ctx.setTransform(...toScreen);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, doc.paper.widthMm, doc.paper.heightMm);

    // ภาพ เส้นตัด และมาร์ค ใช้ตัววาดเดียวกับการส่งออก
    if (this.mode !== 'cutlines') drawArtwork(ctx, doc, store.pageId, this.assets);
    if (this.mode !== 'artwork') drawCutlines(ctx, doc, store.pageId, { color: COLORS.cutline, width: 1.25 / view.scale });
    if (this.showMarks) drawMarks(ctx, doc.marks ?? []);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.showGrid) this.drawPaperGrid();
    if (this.showGuides) {
      this.drawKeepouts();
      this.drawMargin();
    }
    this.drawMarkSelection();
    this.drawOverlays();
    this.drawRulers();
  }

  drawMarkSelection() {
    const { ctx, view, store: { doc, markId } } = this;
    const mark = this.showMarks && markId && doc.marks.find((m) => m.id === markId);
    if (!mark) return;
    const corners = markCorners(mark).map((c) => paperToScreen(view, c));
    ctx.strokeStyle = COLORS.cut;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(mark.locked ? [3, 3] : []);
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** พื้นที่ห้ามวางที่ผู้ใช้กำหนด (ขอบทึบ) และพื้นที่สงวนรอบมาร์ค (ขอบประ) */
  drawKeepouts() {
    const { ctx, view, store: { doc } } = this;
    ctx.save();
    for (const zone of effectiveKeepouts(doc)) {
      const p = paperToScreen(view, { x: zone.xMm, y: zone.yMm });
      const w = zone.widthMm * view.scale;
      const h = zone.heightMm * view.scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, w, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(179,38,30,.07)';
      ctx.fillRect(p.x, p.y, w, h);
      ctx.strokeStyle = 'rgba(179,38,30,.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -h; d < w; d += 12) {
        ctx.moveTo(p.x + d, p.y + h);
        ctx.lineTo(p.x + d + h, p.y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = COLORS.bad;
      ctx.setLineDash(zone.markId ? [4, 3] : []);
      ctx.strokeRect(p.x, p.y, w, h);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawPaperGrid() {
    const { ctx, view, store: { doc: { paper } } } = this;
    const step = rulerStep(view.scale, 14);
    const left = view.originX;
    const top = view.originY;
    const right = left + paper.widthMm * view.scale;
    const bottom = top + paper.heightMm * view.scale;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let mm = step; mm < paper.widthMm; mm += step) {
      const x = Math.round(left + mm * view.scale) + 0.5;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let mm = step; mm < paper.heightMm; mm += step) {
      const y = Math.round(top + mm * view.scale) + 0.5;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
  }

  drawMatGrid() {
    const { ctx, view, size } = this;
    const step = rulerStep(view.scale, 18);
    ctx.strokeStyle = COLORS.matLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const firstX = Math.floor(-view.originX / view.scale / step) * step;
    for (let mm = firstX; mm * view.scale + view.originX < size.width; mm += step) {
      const x = Math.round(mm * view.scale + view.originX) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
    }
    const firstY = Math.floor(-view.originY / view.scale / step) * step;
    for (let mm = firstY; mm * view.scale + view.originY < size.height; mm += step) {
      const y = Math.round(mm * view.scale + view.originY) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
    }
    ctx.stroke();
  }

  drawMargin() {
    const { ctx, view, store: { doc } } = this;
    const area = printableArea(doc.paper);
    const p = paperToScreen(view, area);
    ctx.strokeStyle = this.atEdge ? COLORS.bad : COLORS.margin;
    ctx.lineWidth = this.atEdge ? 2 : 1;
    ctx.setLineDash(this.atEdge ? [] : [5, 4]);
    ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(area.width * view.scale), Math.round(area.height * view.scale));
    ctx.setLineDash([]);
  }

  outline(instance, color, width, dash = []) {
    const { ctx, view, store: { doc } } = this;
    const corners = placementCorners(instance.transform, getMaster(doc, instance.masterId).desiredSizeMm)
      .map((c) => paperToScreen(view, c));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    return corners;
  }

  drawOverlays() {
    const { ctx, view, store: { doc, selectedIds, soleId, pageId } } = this;
    const issues = this.getIssues();
    for (const instance of placedInstances(doc, pageId)) {
      const { id } = instance;
      if (issues.outside.has(id) || issues.inKeepout.has(id) || issues.overlapping.has(id)) this.outline(instance, COLORS.bad, 2);
      else if (issues.tooClose.has(id)) this.outline(instance, COLORS.caution, 1.5, [4, 3]);
    }
    for (const id of selectedIds) {
      const instance = getInstance(doc, id);
      if (!instance) continue;
      const corners = this.outline(instance, COLORS.cut, 1.5);
      if (id !== soleId) continue;
      for (const c of corners) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = COLORS.cut;
        ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
        ctx.strokeRect(c.x - 4, c.y - 4, 8, 8);
      }
    }
    if (this.drag?.kind === 'marquee') {
      const a = paperToScreen(view, this.drag.start);
      const b = paperToScreen(view, this.drag.current);
      ctx.strokeStyle = COLORS.cut;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
  }

  drawRulers() {
    const { ctx, view, size } = this;
    ctx.fillStyle = COLORS.ruler;
    ctx.fillRect(0, 0, size.width, RULER_PX);
    ctx.fillRect(0, 0, RULER_PX, size.height);
    ctx.strokeStyle = COLORS.rulerLine;
    ctx.fillStyle = COLORS.rulerInk;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = rulerStep(view.scale);
    for (let mm = Math.floor(-view.originX / view.scale / step) * step; mm * view.scale + view.originX < size.width; mm += step) {
      const x = Math.round(mm * view.scale + view.originX) + 0.5;
      if (x < RULER_PX) continue;
      ctx.moveTo(x, RULER_PX - 7);
      ctx.lineTo(x, RULER_PX);
      ctx.fillText(String(mm), x + 3, 8);
    }
    for (let mm = Math.floor(-view.originY / view.scale / step) * step; mm * view.scale + view.originY < size.height; mm += step) {
      const y = Math.round(mm * view.scale + view.originY) + 0.5;
      if (y < RULER_PX) continue;
      ctx.moveTo(RULER_PX - 7, y);
      ctx.lineTo(RULER_PX, y);
      ctx.save();
      ctx.translate(8, y + 3);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(String(mm), 0, 0);
      ctx.restore();
    }
    ctx.moveTo(0, RULER_PX + 0.5);
    ctx.lineTo(size.width, RULER_PX + 0.5);
    ctx.moveTo(RULER_PX + 0.5, 0);
    ctx.lineTo(RULER_PX + 0.5, size.height);
    ctx.stroke();
  }
}
