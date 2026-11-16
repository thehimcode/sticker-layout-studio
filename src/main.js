import { Store } from './app/store.js';
import { AutoSaver, Persistence } from './app/persistence.js';
import { initialSize, MEMORY_WARN_BYTES, readImageFile } from './app/importer.js';
import { UserError } from './core/errors.js';
import * as D from './core/document.js';
import { printableArea } from './core/paper.js';
import { validateDocument } from './core/validate.js';
import { CutlineJobs } from './app/cutline-jobs.js';
import { CancelledError } from './app/cutline-service.js';
import { CanvasView } from './ui/canvas-view.js';
import { CutlineEditor } from './ui/cutline-editor.js';
import { Panels } from './ui/panels.js';
import { MarksPanel } from './ui/marks-panel.js';
import { ProfileStore } from './app/profiles.js';
import * as M from './core/marks.js';
import { ExportDialog } from './ui/export-dialog.js';
import { DEFAULT_EXPORT } from './export/preflight.js';

const $ = (id) => document.getElementById(id);
const MAX_TOASTS = 3;

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  const box = $('toasts');
  box.append(el);
  while (box.children.length > MAX_TOASTS) box.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}
const toastError = (message) => toast(message, 'error');

const store = new Store(D.createDocument(newId()));
const assets = new Map(); // assetId -> ImageBitmap ใช้ร่วมทุกสำเนา ไม่เข้าประวัติ Undo
let persistence = null;

let issuesFor = null;
let issuesCache = null;
function getIssues() {
  if (issuesFor !== store.doc) {
    issuesCache = validateDocument(store.doc);
    issuesFor = store.doc;
  }
  return issuesCache;
}

/** ทุกการแก้เอกสารผ่านจุดนี้ ข้อผิดพลาดที่ผู้ใช้แก้ได้แสดงเป็นข้อความ เอกสารไม่เปลี่ยน */
function run(change) {
  try {
    return change();
  } catch (error) {
    if (error instanceof UserError) toastError(error.message);
    else {
      console.error(error);
      toastError('เกิดข้อผิดพลาดที่ไม่คาดคิด งานยังอยู่ครบ ลองทำอีกครั้ง');
    }
    return undefined;
  }
}

function reportUnplaced(unplaced) {
  if (unplaced > 0) toast(`พื้นที่ไม่พอ มี ${unplaced} ชิ้นยังไม่ได้วาง ขนาดไม่ถูกเปลี่ยน`, 'error');
}

const reportClamp = () => toast('ชิ้นงานหยุดที่ขอบพื้นที่วางงาน');
const reportBlocked = () => toast('ชิ้นงานหยุดก่อนถึงพื้นที่ห้ามวาง');

async function runLayout(method) {
  const label = method === 'nest' ? 'กำลังจัดให้ประหยัดพื้นที่' : 'กำลังเรียงตามแถว';
  const bar = $('layout-job');
  bar.hidden = false;
  $('layout-standard').disabled = true;
  $('layout-nest').disabled = true;
  $('layout-job-text').textContent = label;
  $('layout-progress').value = 0;
  try {
    const result = await jobs.layout(method, (v) => { $('layout-progress').value = v; });
    store.commit(D.applyLayout(store.doc, result, newId));
    store.setPage(store.doc.pages[0].id);
    if (result.unplaced.length) toastError(`วางได้ ${result.placements.length} ชิ้น ยังวางไม่ได้ ${result.unplaced.length} ชิ้น ขนาดไม่ถูกเปลี่ยน`);
    else toast(`จัดเรียงครบ ${result.placements.length} ชิ้น ใช้ ${result.pageCount} หน้า`);
  } catch (error) {
    if (error instanceof CancelledError) toast('ยกเลิกการจัดเรียงแล้ว งานเดิมไม่เปลี่ยน');
    else if (error instanceof UserError) toastError(error.message);
    else {
      console.error(error);
      toastError('จัดเรียงไม่สำเร็จ งานเดิมไม่เปลี่ยน');
    }
  }
  bar.hidden = true;
  $('layout-standard').disabled = false;
  $('layout-nest').disabled = false;
}

const profiles = new ProfileStore();

/** หลังเปลี่ยนมาร์ค ถ้าพื้นที่สงวนทับชิ้นงานต้องแจ้ง ไม่ย้ายชิ้นงานเอง */
function commitMarks(next) {
  store.commit(next);
  const hit = getIssues().inKeepout.size;
  if (hit) toastError(`พื้นที่สงวนของมาร์คทับชิ้นงาน ${hit} ชิ้น กดจัดเรียงใหม่หรือย้ายชิ้นงานออก`);
}

const actions = {
  toast,
  toastError,
  /** ค่าตั้งส่งออกเป็นค่าของโปรเจกต์ บันทึกพร้อมงาน แต่ไม่เข้าประวัติ Undo */
  setExportSettings(patch) {
    const { doc } = store;
    const next = { ...doc, settings: { ...doc.settings, export: { ...DEFAULT_EXPORT, ...doc.settings.export, ...patch } } };
    if (!store.amend(next)) store.commit(next);
  },
  applyMarkProfile(profile, template) {
    if (!profile) return;
    run(() => {
      commitMarks(M.applyProfile(store.doc, profile, newId, template ?? profile.template));
      if (profile.verificationStatus !== 'verified') toast(`ใช้ ${profile.label} แล้ว ค่ายังไม่ยืนยันกับเครื่องจริง ตรวจก่อนสั่งงาน`);
    });
  },
  clearMarks: () => run(() => { store.selectMark(null); store.commit(M.clearMarks(store.doc)); }),
  addMark(shape) {
    run(() => {
      const id = newId();
      commitMarks(M.addMark(store.doc, M.newMark(store.doc, id, shape)));
      store.selectMark(id);
    });
  },
  updateMark: (id, patch) => run(() => commitMarks(M.updateMark(store.doc, id, patch))),
  moveMark: (id, dx, dy) => run(() => {
    const mark = store.doc.marks.find((m) => m.id === id);
    if (mark?.locked) throw new UserError('mark-locked', 'มาร์คนี้ล็อกอยู่ ปลดล็อกก่อนย้าย');
    commitMarks(M.moveMarks(store.doc, [id], dx, dy));
  }),
  duplicateMark(id) {
    run(() => {
      const copy = newId();
      commitMarks(M.duplicateMark(store.doc, id, copy));
      store.selectMark(copy);
    });
  },
  removeMark: (id) => run(() => store.commit(M.removeMark(store.doc, id))),
  alignMark: (id, edge, marginsMm) => run(() => commitMarks(M.alignMark(store.doc, id, edge, marginsMm))),
  saveMarkProfile(label) {
    return run(() => {
      const profile = M.profileFromDoc(store.doc, `user-${newId()}`, label);
      if (profiles.save(profile)) toast(`บันทึก Profile "${profile.label}" แล้ว`);
      else toastError('เบราว์เซอร์ไม่ให้บันทึกถาวร Profile จะหายเมื่อปิดหน้า');
      return profile;
    });
  },
  deleteMarkProfile(id) {
    return run(() => {
      profiles.remove(id);
      toast('ลบ Profile แล้ว');
      return true;
    });
  },
  rename: (name) => run(() => store.commit(D.setName(store.doc, name))),
  choosePreset(preset) {
    run(() => {
      const { paper } = store.doc;
      const spec = preset === 'custom'
        ? { preset, widthMm: paper.widthMm, heightMm: paper.heightMm }
        : { preset, orientation: paper.orientation };
      store.commit(D.setPaper(store.doc, spec));
    });
  },
  setOrientation(orientation) {
    run(() => {
      const { paper } = store.doc;
      if (paper.orientation === orientation) return;
      const spec = paper.preset === 'custom'
        ? { preset: 'custom', widthMm: paper.heightMm, heightMm: paper.widthMm }
        : { preset: paper.preset, orientation };
      store.commit(D.setPaper(store.doc, spec));
    });
  },
  setCustomPaper(widthMm, heightMm) {
    run(() => store.commit(D.setPaper(store.doc, { preset: 'custom', widthMm, heightMm })));
  },
  setMargins: (patch) => run(() => store.commit(D.setMargins(store.doc, patch))),
  setAllMargins: (v) => run(() => store.commit(D.setMargins(store.doc, {
    top: v, right: v, bottom: v, left: v,
  }))),
  position(id, x, y) {
    run(() => {
      const { doc, clamped } = D.positionInstance(store.doc, id, x, y);
      store.commit(doc);
      if (clamped) reportClamp();
    });
  },
  moveBy(dx, dy) {
    run(() => {
      const { doc, clamped } = D.moveInstances(store.doc, store.selectedIds, { dx, dy });
      store.commit(doc);
      if (clamped) reportClamp();
    });
  },
  rotate: (fn) => run(() => store.commit(D.rotateInstances(store.doc, store.selectedIds, fn))),
  resize: (id, w, h) => run(() => store.commit(D.resizeMaster(store.doc, id, w, h))),
  setLock: (id, value) => run(() => store.commit(D.setLockAspect(store.doc, id, value))),
  setQuantity(id, quantity) {
    run(() => {
      const result = D.setQuantity(store.doc, id, quantity, newId);
      store.commit(result.doc);
      reportUnplaced(result.unplaced);
    });
  },
  duplicateSelected() {
    if (!store.selectedIds.length) return;
    run(() => {
      const result = D.duplicateInstances(store.doc, store.selectedIds, newId);
      store.commit(result.doc);
      store.select(result.added.filter((i) => i.placementStatus === 'placed').map((i) => i.id));
      reportUnplaced(result.unplaced);
    });
  },
  removeMaster: (id) => run(() => store.commit(D.removeMaster(store.doc, id))),
  removeSelected() {
    if (store.selectedIds.length) run(() => store.commit(D.removeInstances(store.doc, store.selectedIds)));
  },
  align: (edge) => run(() => store.commit(D.alignInstances(store.doc, store.selectedIds, edge))),
  reorder: (direction) => run(() => store.commit(D.reorderInstances(store.doc, store.selectedIds, direction))),
  pullInside() {
    run(() => {
      const { doc, oversized } = D.pullInside(store.doc);
      store.commit(doc);
      if (oversized) toast(`มี ${oversized} ชิ้นใหญ่เกินพื้นที่ ต้องลดขนาดหรือเปลี่ยนกระดาษ`, 'error');
    });
  },
  setBleed: (id, v) => run(() => store.commit(D.setBleed(store.doc, id, v))),
  setSpacing: (patch) => run(() => store.commit(D.setSpacing(store.doc, patch))),
  setLayoutOptions: (patch) => run(() => store.commit(D.setLayoutOptions(store.doc, patch))),
  addKeepout() {
    run(() => {
      const { paper } = store.doc;
      const widthMm = Math.min(30, paper.widthMm);
      const heightMm = Math.min(30, paper.heightMm);
      store.commit(D.addKeepout(store.doc, {
        id: newId(), xMm: paper.widthMm - widthMm, yMm: 0, widthMm, heightMm,
      }));
    });
  },
  updateKeepout: (id, patch) => run(() => store.commit(D.updateKeepout(store.doc, id, patch))),
  removeKeepout: (id) => run(() => store.commit(D.removeKeepout(store.doc, id))),
  addPage() {
    run(() => {
      const id = newId();
      store.commit(D.addPage(store.doc, id));
      store.setPage(id);
    });
  },
  removePage: () => run(() => store.commit(D.removePage(store.doc, store.pageId))),
  runLayout,
  openCutline: (id) => run(() => editor.open(id)),
  applyCutline: (id, result) => run(() => store.commit(D.setCutline(store.doc, id, result))),
  clearCutline: (id) => run(() => store.commit(D.clearCutline(store.doc, id))),
  placePending() {
    run(() => {
      const { doc, remaining } = D.placePending(store.doc);
      store.commit(doc);
      reportUnplaced(remaining);
    });
  },
};

const view = new CanvasView({
  canvas: $('canvas'),
  store,
  assets,
  getIssues,
  onViewChange: (v) => {
    $('zoom-level').textContent = `${Math.round((v.scale / (96 / 25.4)) * 100)}%`;
  },
  onError: (error) => { console.error(error); toastError('เกิดข้อผิดพลาดระหว่างลาก'); },
  onClamp: reportClamp,
  onBlocked: (reason) => (reason === 'mark-locked' ? toast('มาร์คนี้ล็อกอยู่ ปลดล็อกที่แผงมาร์คก่อนย้าย') : reportBlocked()),
});
const panels = new Panels({ store, assets, actions, getIssues });
const marksPanel = new MarksPanel({ store, actions, profiles });
const exportDialog = new ExportDialog({ store, assets, actions });
const editor = new CutlineEditor({ store, assets, actions });
const jobs = new CutlineJobs({ store, assets, onError: toastError });

const saveLabels = {
  pending: 'กำลังบันทึก',
  saved: 'บันทึกในเบราว์เซอร์แล้ว',
  failed: 'บันทึกอัตโนมัติไม่สำเร็จ',
};
const saver = new AutoSaver({
  save: (doc) => persistence.saveDocument(doc),
  onStatus: (status) => { $('status-save').textContent = saveLabels[status]; },
});
let shownPaper = store.doc.paper;
store.subscribe(({ docChanged }) => {
  if (docChanged && persistence) saver.schedule(store.doc);
  const { paper } = store.doc;
  if (paper.widthMm !== shownPaper.widthMm || paper.heightMm !== shownPaper.heightMm) view.fit();
  shownPaper = paper;
});

function decodedBytes() {
  let total = 0;
  for (const bitmap of assets.values()) total += bitmap.width * bitmap.height * 4;
  return total;
}

/** at: จุดบนกระดาษที่ปล่อยเมาส์ ไฟล์แรกวางที่จุดนั้น ไฟล์ถัดไปหาที่ว่างเอง */
async function importFiles(files, at = null) {
  let dropPoint = at;
  for (const file of files) {
    try {
      const image = await readImageFile(file);
      const assetId = newId();
      assets.set(assetId, image.bitmap);
      if (persistence) {
        try {
          await persistence.putAsset(assetId, image.blob);
        } catch (error) {
          console.error(error);
          toastError(`บันทึก ${file.name} ในเบราว์เซอร์ไม่ได้ ภาพนี้จะหายถ้าปิดหน้า`);
        }
      }
      const area = printableArea(store.doc.paper);
      const size = initialSize(image.pixelWidth, image.pixelHeight, image.sourceDpi, area);
      const result = D.addMaster(store.doc, {
        id: newId(),
        name: file.name,
        originalAsset: { assetId, mimeType: image.mimeType, byteSize: image.byteSize },
        sourceType: image.sourceType,
        naturalSize: { widthPx: image.pixelWidth, heightPx: image.pixelHeight, dpi: image.sourceDpi },
        desiredSizeMm: { widthMm: size.widthMm, heightMm: size.heightMm },
      }, newId, dropPoint);
      dropPoint = null;
      store.commit(result.doc);
      const [first] = result.added;
      if (first.placementStatus === 'placed') {
        store.setPage(first.pageId);
        store.select([first.id]);
      }
      if (size.scaled) toast(`${file.name} ใหญ่กว่าพื้นที่วางงาน จึงย่อขนาดเริ่มต้นให้พอดี`);
      reportUnplaced(result.unplaced);
      if (decodedBytes() > MEMORY_WARN_BYTES) toast('ภาพรวมกันใช้หน่วยความจำมาก โปรแกรมอาจช้าลง', 'error');
    } catch (error) {
      if (error instanceof UserError) toastError(error.message);
      else {
        console.error(error);
        toastError(`${file.name}: นำเข้าไม่สำเร็จ`);
      }
    }
  }
}

async function generateAllCutlines() {
  const bar = $('job-bar');
  bar.hidden = false;
  $('cut-all').disabled = true;
  try {
    const result = await jobs.generateAll((index, total, name) => {
      $('job-text').textContent = `กำลังสร้าง ${index + 1} จาก ${total}: ${name}`;
      $('job-progress').value = index / total;
    });
    if (result.total === 0) toast('ทุกแบบมีเส้นตัดแล้ว');
    else if (result.cancelled) toast(`ยกเลิกแล้ว สร้างได้ ${result.done} จาก ${result.total} แบบ`);
    else if (result.failed) toastError(`สร้างได้ ${result.done} จาก ${result.total} แบบ อีก ${result.failed} แบบต้องปรับค่าเอง`);
    else toast(`สร้างเส้นตัดครบ ${result.done} แบบ`);
  } catch (error) {
    console.error(error);
    toastError('สร้างเส้นตัดไม่สำเร็จ');
  }
  bar.hidden = true;
  panels.sync();
}

function bindImport() {
  const input = $('file-input');
  $('add-files').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    importFiles([...input.files]);
    input.value = '';
  });

  const overlay = $('drop-overlay');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    importFiles([...e.dataTransfer.files], e.target === $('canvas') ? view.paperPointAt(e) : null);
  });
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (mod && !typing && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (typing) return;
    if (e.code === 'Space') {
      view.spaceDown = true;
      if (e.target === $('canvas')) e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      store.select(D.placedInstances(store.doc, store.pageId).map((i) => i.id));
      return;
    }
    if (store.markId && e.target === $('canvas')) {
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) {
        e.preventDefault();
        actions.moveMark(store.markId, dir[0] * step, dir[1] * step);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        actions.removeMark(store.markId);
      }
      return;
    }
    if (!store.selectedIds.length) return;
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      actions.duplicateSelected();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      actions.removeSelected();
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir && e.target === $('canvas')) {
      e.preventDefault();
      let step = 1;
      if (e.shiftKey) step = 10;
      if (e.altKey) step = 0.1;
      actions.moveBy(dir[0] * step, dir[1] * step);
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') view.spaceDown = false; });
}

function bindToolbar() {
  $('undo').addEventListener('click', () => store.undo());
  $('redo').addEventListener('click', () => store.redo());
  $('zoom-in').addEventListener('click', () => view.zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => view.zoomBy(0.8));
  $('zoom-fit').addEventListener('click', () => view.fit());
  $('cut-all').addEventListener('click', generateAllCutlines);
  $('job-cancel').addEventListener('click', () => jobs.cancelBatch());
  $('layout-cancel').addEventListener('click', () => jobs.cancelBatch());
  $('view-mode').addEventListener('change', (e) => {
    view.mode = e.target.value;
    // ปุ่มบอกโหมดที่ไม่ใช่ค่าเริ่มต้น ผู้ใช้จะได้ไม่ลืมว่าซ่อนภาพหรือเส้นตัดอยู่
    $('view-menu-label').textContent = e.target.value === 'both' ? 'มุมมอง' : `มุมมอง: ${e.target.selectedOptions[0].textContent}`;
    view.invalidate();
  });
  document.addEventListener('pointerdown', (e) => {
    if ($('view-menu').open && !$('view-menu').contains(e.target)) $('view-menu').open = false;
  });
  $('toggle-guides').addEventListener('change', (e) => {
    view.showGuides = e.target.checked;
    view.invalidate();
  });
  $('toggle-marks').addEventListener('change', (e) => {
    view.showMarks = e.target.checked;
    if (!e.target.checked) store.selectMark(null);
    view.invalidate();
  });
  $('toggle-grid').addEventListener('change', (e) => {
    view.showGrid = e.target.checked;
    view.invalidate();
  });
  $('export-open').addEventListener('click', () => exportDialog.open());
  $('new-doc').addEventListener('click', () => $('confirm-new').showModal());
  $('confirm-new').addEventListener('close', async () => {
    if ($('confirm-new').returnValue !== 'ok') return;
    for (const bitmap of assets.values()) bitmap.close();
    assets.clear();
    store.reset(D.createDocument(newId()));
    if (persistence) await persistence.clear().catch(console.error);
    $('status-save').textContent = '';
  });
}

window.addEventListener('beforeunload', (e) => {
  const unsafe = persistence ? saver.dirty : store.doc.masters.length > 0;
  if (unsafe) {
    saver.flush();
    e.preventDefault();
  }
});

async function restore() {
  try {
    persistence = await Persistence.create();
    const saved = await persistence.load();
    if (!saved) return;
    const doc = D.assertDocument(D.migrate(saved.doc));
    let missing = 0;
    await Promise.all(doc.masters.map(async (master) => {
      const { assetId } = master.originalAsset;
      const blob = saved.assets.get(assetId);
      if (!blob) { missing += 1; return; }
      assets.set(assetId, await createImageBitmap(blob));
    }));
    store.reset(doc);
    await persistence.collectGarbage(doc);
    if (doc.masters.length) toast('เปิดงานล่าสุดให้แล้ว');
    if (missing) toastError(`ไม่พบภาพต้นฉบับ ${missing} ไฟล์ แสดงเป็นกรอบเทาแทน`);
  } catch (error) {
    console.error(error);
    if (!persistence) {
      $('status-save').textContent = 'เบราว์เซอร์นี้บันทึกอัตโนมัติไม่ได้';
    } else {
      toastError('เปิดงานที่บันทึกไว้ไม่ได้ เริ่มจากงานเปล่าแทน');
    }
  }
}

bindImport();
bindKeyboard();
bindToolbar();
panels.sync();
marksPanel.sync();
restore().then(() => { panels.sync(); marksPanel.sync(); });

// ใช้ตรวจอัตโนมัติ (E2E) เท่านั้น
window.__studio = {
  store, assets, getView: () => view.view, editor, jobs, profiles, exportDialog,
};
