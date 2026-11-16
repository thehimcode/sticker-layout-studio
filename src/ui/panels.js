import { getInstance, getMaster, instancesOf } from '../core/document.js';
import { PAPER_PRESETS } from '../core/paper.js';
import { effectiveDpi, formatMm } from '../core/units.js';
import { bindNumber, setField } from './fields.js';

const $ = (id) => document.getElementById(id);
const LOW_DPI = 150;
const dpiOf = (master) => Math.round(effectiveDpi(master.naturalSize.widthPx, master.desiredSizeMm.widthMm));

const PRESET_LABELS = { 'Super A3': 'Super A3 / 13×19 นิ้ว' };
const TYPE_LABELS = { png: 'PNG', jpeg: 'JPG' };
const SIDES = ['top', 'right', 'bottom', 'left'];
/** ขนาดก้าวของปุ่ม ▲▼ และหน่วยที่แสดงท้ายช่อง */
const MM = { step: 1, unit: 'mm' };
const FINE_MM = { step: 0.5, unit: 'mm' };
const DEG = { step: 1, unit: '°' };

export class Panels {
  constructor({ store, assets, actions, getIssues }) {
    Object.assign(this, { store, assets, actions, getIssues });
    this.rows = new Map();
    const presets = $('paper-preset');
    for (const [name, size] of Object.entries(PAPER_PRESETS)) {
      presets.add(new Option(`${PRESET_LABELS[name] ?? name} (${size.widthMm} × ${size.heightMm})`, name));
    }
    presets.add(new Option('กำหนดเอง', 'custom'));
    this.bind();
    store.subscribe(() => this.sync());
  }

  number(id, onCommit, field = MM) {
    bindNumber($(id), {
      ...field,
      onCommit,
      onInvalid: () => this.actions.toastError('กรุณากรอกตัวเลข'),
      refresh: () => this.sync(),
    });
  }

  bind() {
    const { actions, store } = this;
    const sole = () => getInstance(store.doc, store.soleId);
    const master = () => getMaster(store.doc, sole().masterId);

    $('doc-name').addEventListener('change', (e) => { actions.rename(e.target.value); this.sync(true); });
    $('paper-preset').addEventListener('change', (e) => { actions.choosePreset(e.target.value); this.sync(); });
    $('orient-portrait').addEventListener('click', () => actions.setOrientation('portrait'));
    $('orient-landscape').addEventListener('click', () => actions.setOrientation('landscape'));
    this.number('paper-w', (v) => actions.setCustomPaper(v, store.doc.paper.heightMm));
    this.number('paper-h', (v) => actions.setCustomPaper(store.doc.paper.widthMm, v));
    for (const side of SIDES) {
      this.number(`margin-${side}`, (v) => {
        if ($('margin-link').checked) actions.setAllMargins(v);
        else actions.setMargins({ [side]: v });
      }, FINE_MM);
    }
    $('margin-link').addEventListener('change', (e) => {
      if (e.target.checked) actions.setAllMargins(store.doc.paper.marginsMm.top);
    });

    this.number('sel-x', (v) => actions.position(store.soleId, v, sole().transform.yMm));
    this.number('sel-y', (v) => actions.position(store.soleId, sole().transform.xMm, v));
    this.number('sel-w', (v) => {
      const m = master();
      const { widthMm, heightMm } = m.desiredSizeMm;
      actions.resize(m.id, v, m.lockAspect ? heightMm * (v / widthMm) : heightMm);
    });
    this.number('sel-h', (v) => {
      const m = master();
      const { widthMm, heightMm } = m.desiredSizeMm;
      actions.resize(m.id, m.lockAspect ? widthMm * (v / heightMm) : widthMm, v);
    });
    this.number('sel-rot', (v) => actions.rotate(() => v), DEG);
    $('sel-rot90').addEventListener('click', () => actions.rotate((deg) => deg + 90));
    $('sel-lock').addEventListener('change', (e) => actions.setLock(master().id, e.target.checked));
    $('sel-dup').addEventListener('click', () => actions.duplicateSelected());
    $('sel-del').addEventListener('click', () => actions.removeSelected());
    for (const b of document.querySelectorAll('[data-align]')) {
      b.addEventListener('click', () => actions.align(b.dataset.align));
    }
    for (const b of document.querySelectorAll('[data-order]')) {
      b.addEventListener('click', () => actions.reorder(b.dataset.order));
    }
    this.number('sel-bleed', (v) => actions.setBleed(master().id, v), FINE_MM);
    this.number('spacing-mm', (v) => actions.setSpacing({ spacingMm: v }), FINE_MM);
    $('spacing-mode').addEventListener('change', (e) => actions.setSpacing({ spacingMode: e.target.value }));
    $('layout-sort').addEventListener('change', (e) => actions.setLayoutOptions({ sortBy: e.target.value }));
    $('layout-step').addEventListener('change', (e) => actions.setLayoutOptions({ rotationStep: Number(e.target.value) }));
    $('layout-pages').addEventListener('change', (e) => actions.setLayoutOptions({ autoPages: e.target.checked }));
    $('layout-standard').addEventListener('click', () => actions.runLayout('standard'));
    $('layout-nest').addEventListener('click', () => actions.runLayout('nest'));
    $('keepout-add').addEventListener('click', () => actions.addKeepout());
    const page = (delta) => {
      const { pages } = store.doc;
      const index = pages.findIndex((p) => p.id === store.pageId) + delta;
      if (pages[index]) store.setPage(pages[index].id);
    };
    $('page-prev').addEventListener('click', () => page(-1));
    $('page-next').addEventListener('click', () => page(1));
    $('page-add').addEventListener('click', () => actions.addPage());
    $('page-del').addEventListener('click', () => actions.removePage());
    $('fix-outside').addEventListener('click', () => actions.pullInside());
    $('place-pending').addEventListener('click', () => actions.placePending());
  }

  sync(force = false) {
    const { doc } = this.store;
    const name = $('doc-name');
    if (force || document.activeElement !== name) name.value = doc.name;
    document.title = `${doc.name} | Sticker Layout & Cutline Studio`;

    $('cut-all').disabled = doc.masters.length === 0;
    $('undo').disabled = !this.store.canUndo;
    $('redo').disabled = !this.store.canRedo;

    const { paper } = doc;
    const custom = paper.preset === 'custom';
    $('paper-preset').value = paper.preset;
    setField($('paper-w'), formatMm(paper.widthMm));
    setField($('paper-h'), formatMm(paper.heightMm));
    $('paper-w').disabled = !custom;
    $('paper-h').disabled = !custom;
    $('paper-note').hidden = paper.preset !== 'A3+' && paper.preset !== 'Super A3';
    $('orient-portrait').setAttribute('aria-pressed', String(paper.orientation === 'portrait'));
    $('orient-landscape').setAttribute('aria-pressed', String(paper.orientation === 'landscape'));
    for (const side of SIDES) setField($(`margin-${side}`), formatMm(paper.marginsMm[side]));

    this.syncLayout(doc);
    this.syncKeepouts(doc);
    this.syncSelection(doc);
    this.syncMasters(doc);
    this.syncStatus(doc);
  }

  syncLayout(doc) {
    const { settings, pages, lastLayout } = doc;
    setField($('spacing-mm'), formatMm(settings.spacingMm));
    $('spacing-mode').value = settings.spacingMode;
    $('layout-sort').value = settings.layout.sortBy;
    $('layout-step').value = String(settings.layout.rotationStep);
    $('layout-pages').checked = settings.layout.autoPages;
    const index = pages.findIndex((p) => p.id === this.store.pageId);
    $('page-label').textContent = `หน้า ${index + 1}/${pages.length}`;
    $('page-prev').disabled = index <= 0;
    $('page-next').disabled = index >= pages.length - 1;
    $('page-del').disabled = pages.length <= 1;

    const box = $('layout-report');
    box.hidden = !lastLayout;
    if (!lastLayout) return;
    const rows = [
      ['วางแล้ว', `${lastLayout.placed} ชิ้น`, false],
      ['ยังวางไม่ได้', `${lastLayout.unplaced} ชิ้น`, lastLayout.unplaced > 0],
      ['จำนวนหน้า', String(lastLayout.pages), false],
      ['พื้นที่ใช้', `${(lastLayout.usedMm2 / 100).toFixed(1)} ตร.ซม. (${Math.round(lastLayout.usedRatio * 100)}%)`, false],
      ['พื้นที่ว่าง', `${(lastLayout.freeMm2 / 100).toFixed(1)} ตร.ซม.`, false],
    ];
    box.replaceChildren(...rows.flatMap(([label, value, bad]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (bad) dd.className = 'bad';
      return [dt, dd];
    }));
  }

  syncKeepouts(doc) {
    const list = $('keepout-list');
    if (list.contains(document.activeElement) || list.dataset.key === JSON.stringify(doc.keepouts)) return;
    list.dataset.key = JSON.stringify(doc.keepouts);
    list.replaceChildren(...doc.keepouts.map((zone, index) => {
      const li = document.createElement('li');
      const field = (label, key) => {
        const wrap = document.createElement('label');
        wrap.textContent = label;
        const input = document.createElement('input');
        input.inputMode = 'decimal';
        input.value = formatMm(zone[key]);
        input.setAttribute('aria-label', `พื้นที่ห้ามวาง ${index + 1} ${label}`);
        wrap.append(input);
        bindNumber(input, {
          ...MM,
          onCommit: (v) => this.actions.updateKeepout(zone.id, { [key]: v }),
          onInvalid: () => this.actions.toastError('กรุณากรอกตัวเลข'),
          refresh: () => { delete list.dataset.key; this.sync(); },
        });
        return wrap;
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'ลบพื้นที่นี้';
      remove.addEventListener('click', () => this.actions.removeKeepout(zone.id));
      li.append(field('X', 'xMm'), field('Y', 'yMm'), field('กว้าง', 'widthMm'), field('สูง', 'heightMm'), remove);
      return li;
    }));
  }

  syncSelection(doc) {
    const { selectedIds, soleId } = this.store;
    $('no-selection').hidden = selectedIds.length > 0;
    $('selection-actions').hidden = selectedIds.length === 0;
    $('selection-fields').hidden = !soleId;
    $('selection-title').textContent = selectedIds.length > 1 ? `เลือกอยู่ ${selectedIds.length} ชิ้น` : 'ชิ้นงานที่เลือก';
    if (!soleId) return;
    const instance = getInstance(doc, soleId);
    const master = getMaster(doc, instance.masterId);
    const { transform } = instance;
    setField($('sel-x'), formatMm(transform.xMm));
    setField($('sel-y'), formatMm(transform.yMm));
    setField($('sel-w'), formatMm(master.desiredSizeMm.widthMm));
    setField($('sel-h'), formatMm(master.desiredSizeMm.heightMm));
    setField($('sel-rot'), formatMm(transform.rotationDeg));
    setField($('sel-bleed'), formatMm(master.bleedMm ?? 0));
    $('sel-lock').checked = master.lockAspect;
    const dpi = dpiOf(master);
    const line = $('sel-dpi');
    line.textContent = dpi < LOW_DPI
      ? `ความละเอียดเมื่อพิมพ์ ${dpi} DPI ต่ำกว่า ${LOW_DPI} ภาพอาจไม่คม`
      : `ความละเอียดเมื่อพิมพ์ ${dpi} DPI`;
    line.classList.toggle('bad', dpi < LOW_DPI);
  }

  syncMasters(doc) {
    const list = $('artwork-list');
    const live = new Set(doc.masters.map((m) => m.id));
    for (const [id, row] of this.rows) {
      if (!live.has(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    }
    const active = new Set(this.store.selectedIds.map((id) => getInstance(doc, id)?.masterId));
    for (const master of doc.masters) {
      const row = this.rows.get(master.id) ?? this.createRow(master);
      list.append(row.el);
      setField(row.copies, String(master.quantity));
      row.minus.disabled = master.quantity <= 0;
      row.el.classList.toggle('active', active.has(master.id));
      row.drawThumb();
      this.fillMeta(row.meta, doc, master);
    }
  }

  fillMeta(meta, doc, master) {
    const { widthPx, heightPx } = master.naturalSize;
    const { widthMm, heightMm } = master.desiredSizeMm;
    const dpi = dpiOf(master);
    const pending = instancesOf(doc, master.id).filter((i) => i.placementStatus === 'unplaced').length;
    const lines = [
      [`${TYPE_LABELS[master.sourceType]} ${widthPx} × ${heightPx} px`, false],
      [`${formatMm(widthMm)} × ${formatMm(heightMm)} มม., ${dpi} DPI`, dpi < LOW_DPI],
    ];
    if (pending) lines.push([`ยังไม่ได้วาง ${pending} ชิ้น`, true]);
    const { cutline } = master;
    if (cutline?.stale) {
      lines.push(['กำลังคำนวณเส้นตัดใหม่', false]);
    } else if (cutline) {
      const sign = cutline.offsetMm > 0 ? '+' : '';
      const bad = cutline.issues.some((i) => i.severity === 'error');
      lines.push([`เส้นตัด ${sign}${formatMm(cutline.offsetMm)} มม., ${bad ? 'มีปัญหา' : 'พร้อมใช้'}`, bad]);
    } else {
      lines.push(['ยังไม่มีเส้นตัด', false]);
    }
    meta.replaceChildren(...lines.map(([text, bad]) => {
      const div = document.createElement('div');
      div.textContent = text;
      if (bad) div.className = 'bad';
      return div;
    }));
  }

  createRow(master) {
    const li = document.createElement('li');
    const thumb = document.createElement('canvas');
    thumb.width = 96;
    thumb.height = 96;
    thumb.setAttribute('aria-hidden', 'true');

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'art-name';
    name.textContent = master.name;
    name.title = master.name;

    const controls = document.createElement('div');
    controls.className = 'art-controls';
    const make = (tag, text, label) => {
      const el = document.createElement(tag);
      if (tag === 'button') { el.type = 'button'; el.textContent = text; }
      el.setAttribute('aria-label', label);
      return el;
    };
    const minus = make('button', '−', `ลดจำนวน ${master.name}`);
    const copies = make('input', '', `จำนวน ${master.name}`);
    copies.inputMode = 'numeric';
    const plus = make('button', '+', `เพิ่มจำนวน ${master.name}`);
    const remove = make('button', 'ลบ', `ลบแบบ ${master.name}`);
    remove.className = 'art-remove';
    const unit = document.createElement('span');
    unit.className = 'art-unit';
    unit.textContent = 'ชิ้น';
    controls.append(minus, copies, plus, unit, remove);
    const meta = document.createElement('div');
    meta.className = 'art-meta';
    const cut = make('button', 'เส้นตัด', `ตั้งค่าเส้นตัด ${master.name}`);
    cut.className = 'art-cut';
    cut.addEventListener('click', () => this.actions.openCutline(master.id));
    li.append(thumb, name, controls, meta, cut);

    const count = () => getMaster(this.store.doc, master.id).quantity;
    const pick = () => {
      const placed = instancesOf(this.store.doc, master.id).filter((i) => i.placementStatus === 'placed');
      if (!placed.length) return;
      const here = placed.filter((i) => i.pageId === this.store.pageId);
      if (!here.length) this.store.setPage(placed[0].pageId);
      this.store.select((here.length ? here : placed.filter((i) => i.pageId === placed[0].pageId)).map((i) => i.id));
    };
    name.addEventListener('click', pick);
    thumb.addEventListener('click', pick);
    minus.addEventListener('click', () => this.actions.setQuantity(master.id, count() - 1));
    plus.addEventListener('click', () => this.actions.setQuantity(master.id, count() + 1));
    remove.addEventListener('click', () => this.actions.removeMaster(master.id));
    bindNumber(copies, {
      onCommit: (v) => this.actions.setQuantity(master.id, v),
      onInvalid: () => this.actions.toastError('กรุณากรอกจำนวนเต็ม'),
      refresh: () => this.sync(),
    });

    let drawn = null;
    const drawThumb = () => {
      const bitmap = this.assets.get(master.originalAsset.assetId);
      if (!bitmap || drawn === bitmap) return;
      drawn = bitmap;
      const scale = Math.min(96 / bitmap.width, 96 / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      thumb.getContext('2d').drawImage(bitmap, (96 - w) / 2, (96 - h) / 2, w, h);
    };
    const row = { el: li, copies, minus, meta, drawThumb };
    this.rows.set(master.id, row);
    return row;
  }

  syncStatus(doc) {
    const {
      outside, overlapping, oversized, unplaced, tooClose, inKeepout,
    } = this.getIssues();
    const { paper } = doc;
    const label = paper.preset === 'custom' ? 'กำหนดเอง' : paper.preset;
    $('status-paper').textContent = `${label} ${formatMm(paper.widthMm)} × ${formatMm(paper.heightMm)} มม.`;
    $('status-count').textContent = `วางแล้ว ${doc.instances.length - unplaced} จาก ${doc.instances.length} ชิ้น`;
    const warnings = [];
    if (outside.size) warnings.push(`นอกพื้นที่วางงาน ${outside.size} ชิ้น`);
    if (oversized.size) warnings.push(`ภาพใหญ่เกินพื้นที่ ${oversized.size} แบบ`);
    if (inKeepout.size) warnings.push(`ทับพื้นที่ห้ามวาง ${inKeepout.size} ชิ้น`);
    if (overlapping.size) warnings.push(`ชิ้นงานทับกัน ${overlapping.size} ชิ้น`);
    if (tooClose.size) warnings.push(`ระยะห่างไม่ถึงค่าที่ตั้ง ${tooClose.size} ชิ้น`);
    if (unplaced) warnings.push(`ยังไม่ได้วาง ${unplaced} ชิ้น`);
    $('status-warn').textContent = warnings.join(', ');
    $('fix-outside').hidden = outside.size === 0;
    $('place-pending').hidden = unplaced === 0;
  }
}
