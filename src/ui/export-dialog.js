import { CancelledError } from '../app/cutline-service.js';
import { download, exportDocument } from '../app/exporter.js';
import { exportSettingsOf, hasErrors, preflight } from '../export/preflight.js';

const $ = (id) => document.getElementById(id);

const CHECKS = {
  'exp-png': 'png', 'exp-jpg': 'jpg', 'exp-pdf': 'pdf', 'exp-cut': 'cutSvg', 'exp-combined': 'combinedSvg', 'exp-marks': 'includeMarks',
};
const SELECTS = { 'exp-dpi': 'dpi', 'exp-png-bg': 'pngBackground', 'exp-cut-marks': 'marksInCutSvg' };

/** หน้าต่างส่งออก: เลือกไฟล์ → Preflight (FR-07.8) → ส่งออกพร้อม Progress และยกเลิกได้ (NFR-05) */
export class ExportDialog {
  constructor({ store, assets, actions }) {
    Object.assign(this, { store, assets, actions });
    this.dialog = $('export-dialog');
    this.busy = false;
    this.cancelled = false;
    for (const id of Object.keys(CHECKS)) $(id).addEventListener('change', () => this.change());
    for (const id of Object.keys(SELECTS)) $(id).addEventListener('change', () => this.change());
    $('exp-override').addEventListener('change', () => this.syncButton());
    $('exp-close').addEventListener('click', () => this.dialog.close());
    $('exp-cancel').addEventListener('click', () => { this.cancelled = true; });
    $('exp-run').addEventListener('click', () => this.run());
    this.dialog.addEventListener('cancel', (e) => { if (this.busy) e.preventDefault(); });
    store.subscribe(() => { if (this.dialog.open && !this.busy) this.refresh(); });
  }

  get options() {
    return exportSettingsOf(this.store.doc);
  }

  open() {
    this.store.selectMark(null);
    $('exp-override').checked = false;
    this.refresh();
    this.dialog.showModal();
  }

  change() {
    const patch = {};
    for (const [id, key] of Object.entries(CHECKS)) patch[key] = $(id).checked;
    for (const [id, key] of Object.entries(SELECTS)) patch[key] = key === 'dpi' ? Number($(id).value) : $(id).value;
    this.actions.setExportSettings(patch);
    this.refresh();
  }

  refresh() {
    const o = this.options;
    for (const [id, key] of Object.entries(CHECKS)) $(id).checked = Boolean(o[key]);
    for (const [id, key] of Object.entries(SELECTS)) $(id).value = String(o[key]);
    $('exp-png-bg').disabled = !o.png;
    $('exp-cut-marks').disabled = !o.cutSvg;
    this.checks = preflight(this.store.doc, o);
    $('exp-preflight').replaceChildren(...this.checks.map((c) => {
      const li = document.createElement('li');
      li.className = c.level;
      const topic = document.createElement('span');
      topic.className = 'topic';
      topic.textContent = c.topic;
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = c.text;
      li.append(topic, text);
      return li;
    }));
    $('exp-override-row').hidden = !hasErrors(this.checks);
    this.syncButton();
  }

  syncButton() {
    const blocked = hasErrors(this.checks) && !$('exp-override').checked;
    const nothing = this.checks.some((c) => c.level === 'error' && (c.topic === 'ไฟล์' || c.topic === 'ชิ้นงาน'));
    $('exp-run').disabled = this.busy || blocked || nothing;
  }

  setBusy(busy) {
    this.busy = busy;
    $('exp-job').hidden = !busy;
    $('exp-cancel').hidden = !busy;
    $('exp-close').disabled = busy;
    for (const id of [...Object.keys(CHECKS), ...Object.keys(SELECTS), 'exp-override']) $(id).disabled = busy;
    if (!busy) this.refresh();
    this.syncButton();
  }

  async run() {
    if (this.busy) return;
    this.cancelled = false;
    this.setBusy(true);
    const doc = this.store.doc; // ใช้เอกสารชุดเดียวทั้งรอบ แก้ระหว่างส่งออกไม่มีผลกับไฟล์
    try {
      const result = await exportDocument({
        doc,
        assets: this.assets,
        options: exportSettingsOf(doc),
        isCancelled: () => this.cancelled,
        onProgress: (value, text) => {
          $('exp-progress').value = value;
          $('exp-job-text').textContent = text;
        },
      });
      this.lastResult = result;
      download(result.bundle);
      this.actions.toast(`ส่งออก ${result.files.length} ไฟล์แล้ว: ${result.bundle.name}`);
    } catch (error) {
      if (error instanceof CancelledError) this.actions.toast('ยกเลิกการส่งออกแล้ว');
      else {
        console.error(error);
        this.actions.toastError(`ส่งออกไม่สำเร็จ: ${error.message}`);
      }
    }
    this.setBusy(false);
  }
}
