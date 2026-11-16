import { MARGIN_SIDES, MARK_SHAPE_LABELS, MARK_SHAPES } from '../core/marks.js';
import { formatMm } from '../core/units.js';
import { bindNumber, setField } from './fields.js';

const $ = (id) => document.getElementById(id);
const MM = { step: 0.5, unit: 'mm' };

/**
 * แผง Registration Marks (FR-10): เลือก Profile/Template, ปรับค่า, แก้มาร์คที่เลือก, บันทึก User Profile
 * ทุกการแก้ผ่าน actions ใน main.js ซึ่งตรวจค่าใน core/marks.js
 */
export class MarksPanel {
  constructor({ store, actions, profiles }) {
    Object.assign(this, { store, actions, profiles });
    this.templateDraft = null;
    for (const select of [$('mark-new-shape'), $('mark-shape')]) {
      for (const shape of MARK_SHAPES) select.add(new Option(MARK_SHAPE_LABELS[shape], shape));
    }
    this.bind();
    store.subscribe(() => this.sync());
  }

  get profile() {
    return this.profiles.get($('mark-profile').value);
  }

  get template() {
    const p = this.profile;
    if (!p?.template) return null;
    const draft = this.templateDraft?.id === p.id ? this.templateDraft.values : {};
    const { marginsMm, ...rest } = draft;
    return { ...p.template, ...rest, marginsMm: { ...p.template.marginsMm, ...marginsMm } };
  }

  /** ระยะขอบที่ใช้จัดแนวมาร์ค: ของชุดที่ใช้อยู่ ถ้าไม่มีใช้ของ Template ที่เลือก */
  get marginsMm() {
    return this.store.doc.markSettings?.template?.marginsMm ?? this.template?.marginsMm ?? { top: 10, right: 10, bottom: 10, left: 10 };
  }

  bind() {
    const { actions, store } = this;
    $('mark-profile').addEventListener('change', () => { this.templateDraft = null; this.sync(); });
    const templateField = (id, key, side = null) => bindNumber($(id), {
      ...MM,
      onCommit: (v) => {
        if (!Number.isFinite(v) || v < 0) { actions.toastError('ค่าต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'); return; }
        const p = this.profile;
        const values = { ...(this.templateDraft?.id === p.id ? this.templateDraft.values : {}) };
        if (side) values.marginsMm = { ...values.marginsMm, [side]: v };
        else values[key] = v;
        this.templateDraft = { id: p.id, values };
      },
      onInvalid: () => actions.toastError('กรุณากรอกตัวเลข'),
      refresh: () => this.sync(),
    });
    templateField('mark-t-size', 'sizeMm');
    for (const side of MARGIN_SIDES) templateField(`mark-t-${side}`, 'marginsMm', side);
    templateField('mark-t-keepout', 'keepoutMm');
    templateField('mark-t-line', 'lineMm');
    $('mark-apply').addEventListener('click', () => actions.applyMarkProfile(this.profile, this.template));
    $('mark-clear').addEventListener('click', () => actions.clearMarks());
    $('mark-add').addEventListener('click', () => actions.addMark($('mark-new-shape').value));

    const mark = () => store.doc.marks.find((m) => m.id === store.markId);
    const field = (id, key, opts = MM) => bindNumber($(id), {
      ...opts,
      onCommit: (v) => actions.updateMark(store.markId, { [key]: v }),
      onInvalid: () => actions.toastError('กรุณากรอกตัวเลข'),
      refresh: () => this.sync(),
    });
    field('mark-x', 'xMm', { step: 1, unit: 'mm' });
    field('mark-y', 'yMm', { step: 1, unit: 'mm' });
    field('mark-w', 'widthMm');
    field('mark-h', 'heightMm');
    field('mark-rot', 'rotationDeg', { step: 90, unit: '°' });
    field('mark-line', 'lineMm', { step: 0.1, unit: 'mm' });
    field('mark-keepout', 'keepoutMm');
    $('mark-shape').addEventListener('change', (e) => actions.updateMark(store.markId, { shape: e.target.value }));
    const paint = () => {
      const color = $('mark-color').value;
      return $('mark-paint').value === 'stroke' ? { fill: 'none', stroke: color } : { fill: color, stroke: 'none' };
    };
    $('mark-paint').addEventListener('change', () => actions.updateMark(store.markId, paint()));
    $('mark-color').addEventListener('change', () => actions.updateMark(store.markId, paint()));
    $('mark-lock').addEventListener('change', (e) => actions.updateMark(store.markId, { locked: e.target.checked }));
    $('mark-dup').addEventListener('click', () => actions.duplicateMark(store.markId));
    $('mark-del').addEventListener('click', () => actions.removeMark(store.markId));
    for (const b of document.querySelectorAll('[data-mark-align]')) {
      b.addEventListener('click', () => {
        if (mark()) actions.alignMark(store.markId, b.dataset.markAlign, this.marginsMm);
      });
    }
    $('mark-save-profile').addEventListener('click', () => {
      const saved = actions.saveMarkProfile($('mark-profile-name').value);
      if (saved) {
        $('mark-profile-name').value = '';
        this.sync(saved.id);
      }
    });
    $('mark-delete-profile').addEventListener('click', () => {
      const p = this.profile;
      if (p && !p.builtIn && actions.deleteMarkProfile(p.id)) this.sync(this.store.doc.markSettings?.profileId);
    });
  }

  syncProfiles(selectId) {
    const select = $('mark-profile');
    const list = this.profiles.all();
    const key = list.map((p) => `${p.id}:${p.label}`).join('|');
    const want = selectId ?? select.value ?? this.store.doc.markSettings?.profileId;
    if (select.dataset.key !== key) {
      select.dataset.key = key;
      select.replaceChildren(...list.map((p) => new Option(p.builtIn ? p.label : `${p.label} (ของฉัน)`, p.id)));
    }
    if (want && list.some((p) => p.id === want)) select.value = want;
  }

  sync(selectId) {
    const { doc, markId } = this.store;
    this.syncProfiles(selectId);
    const p = this.profile;
    const t = this.template;
    $('mark-template').hidden = !t;
    if (t) {
      setField($('mark-t-size'), formatMm(t.sizeMm));
      for (const side of MARGIN_SIDES) setField($(`mark-t-${side}`), formatMm(t.marginsMm[side]));
      setField($('mark-t-keepout'), formatMm(t.keepoutMm));
      setField($('mark-t-line'), formatMm(t.lineMm));
    }
    let note = p?.note ?? '';
    if (p?.paperMm && (p.paperMm.widthMm !== doc.paper.widthMm || p.paperMm.heightMm !== doc.paper.heightMm)) {
      note += ` บันทึกจากกระดาษ ${p.paperMm.widthMm} × ${p.paperMm.heightMm} มม. ไม่ตรงกับกระดาษตอนนี้`;
    }
    $('mark-profile-note').textContent = note;
    $('mark-delete-profile').disabled = !p || p.builtIn;
    const s = doc.markSettings;
    $('mark-summary').textContent = doc.marks.length
      ? `ใช้อยู่: ${s?.label ?? 'มาร์คกำหนดเอง'} ${doc.marks.filter((m) => m.shape !== 'triangle').length} จุด${doc.marks.some((m) => m.shape === 'triangle') ? ' + สามเหลี่ยมบอกทิศ' : ''}${s?.verificationStatus === 'verified' ? '' : ' (ยังไม่ยืนยันกับเครื่องจริง)'}`
      : 'ยังไม่มีมาร์ค';
    $('mark-clear').disabled = !doc.marks.length;
    $('mark-save-profile').disabled = !doc.marks.length;

    const mark = doc.marks.find((m) => m.id === markId);
    $('mark-fields').hidden = !mark;
    if (!mark) return;
    if (this.shownMark !== markId) $('marks-section').open = true;
    this.shownMark = markId;
    if (document.activeElement !== $('mark-shape')) $('mark-shape').value = mark.shape;
    setField($('mark-x'), formatMm(mark.xMm));
    setField($('mark-y'), formatMm(mark.yMm));
    setField($('mark-w'), formatMm(mark.widthMm));
    setField($('mark-h'), formatMm(mark.heightMm));
    setField($('mark-rot'), formatMm(mark.rotationDeg));
    setField($('mark-line'), formatMm(mark.lineMm));
    setField($('mark-keepout'), formatMm(mark.keepoutMm));
    const solid = mark.shape === 'cross' || mark.shape === 'corner';
    $('mark-paint').disabled = solid;
    $('mark-paint').value = !solid && mark.fill === 'none' ? 'stroke' : 'fill';
    $('mark-color').value = mark.fill !== 'none' ? mark.fill : mark.stroke;
    $('mark-lock').checked = mark.locked;
    for (const id of ['mark-x', 'mark-y', 'mark-w', 'mark-h', 'mark-rot', 'mark-line', 'mark-keepout', 'mark-shape', 'mark-paint', 'mark-color', 'mark-dup']) {
      if (id !== 'mark-dup') $(id).disabled = mark.locked || (id === 'mark-paint' && solid);
    }
    for (const b of document.querySelectorAll('[data-mark-align]')) b.disabled = mark.locked;
  }
}
