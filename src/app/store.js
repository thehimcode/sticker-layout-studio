/**
 * เก็บ state และประวัติ Undo/Redo
 * ประวัติเก็บเอกสารแบบ immutable จึงแชร์ข้อมูลที่ไม่เปลี่ยนกันได้
 * preview ใช้ระหว่างลากเมาส์ ไม่เพิ่มประวัติจนกว่าจะ commitPreview
 */
export const HISTORY_LIMIT = 200;

export class Store {
  constructor(doc) {
    this.doc = doc;
    this.selectedIds = [];
    this.markId = null;
    this.pageId = doc.pages[0].id;
    this.past = [];
    this.future = [];
    this.previewBase = null;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change) {
    for (const listener of this.listeners) listener(change);
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** เปลี่ยนเอกสารถาวร หนึ่งการเรียกเท่ากับหนึ่งขั้น Undo */
  commit(next) {
    if (next === this.doc) return;
    this.past.push(this.doc);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.doc = next;
    this.fixSelection();
    this.emit({ docChanged: true });
  }

  /** แทนค่าที่คำนวณจากเอกสารเดิม เช่น เส้นตัดที่คำนวณใหม่ ไม่เพิ่มขั้น Undo */
  amend(next) {
    if (this.previewBase !== null) return false;
    this.doc = next;
    this.emit({ docChanged: true });
    return true;
  }

  preview(next) {
    if (this.previewBase === null) this.previewBase = this.doc;
    this.doc = next;
    this.emit({ docChanged: false });
  }

  commitPreview() {
    if (this.previewBase === null) return;
    const base = this.previewBase;
    const next = this.doc;
    this.previewBase = null;
    this.doc = base;
    this.commit(next);
  }

  cancelPreview() {
    if (this.previewBase === null) return;
    this.doc = this.previewBase;
    this.previewBase = null;
    this.emit({ docChanged: false });
  }

  undo() {
    if (!this.canUndo || this.previewBase !== null) return;
    this.future.push(this.doc);
    this.doc = this.past.pop();
    this.fixSelection();
    this.emit({ docChanged: true });
  }

  redo() {
    if (!this.canRedo || this.previewBase !== null) return;
    this.past.push(this.doc);
    this.doc = this.future.pop();
    this.fixSelection();
    this.emit({ docChanged: true });
  }

  /** มาร์คที่เลือก แยกจากชิ้นงาน เลือกได้ทีละตัว */
  selectMark(id) {
    this.markId = id;
    if (id) this.selectedIds = [];
    this.emit({ docChanged: false });
  }

  select(ids) {
    this.selectedIds = ids;
    if (ids.length) this.markId = null;
    this.fixSelection();
    this.emit({ docChanged: false });
  }

  /** หน้าที่แสดงอยู่ เป็นสถานะมุมมอง ไม่เข้าประวัติ Undo */
  setPage(pageId) {
    if (this.pageId === pageId) return;
    this.pageId = pageId;
    this.selectedIds = [];
    this.emit({ docChanged: false });
  }

  /** id ของชิ้นเดียวที่เลือก หรือ null เมื่อไม่ได้เลือกหรือเลือกหลายชิ้น */
  get soleId() {
    return this.selectedIds.length === 1 ? this.selectedIds[0] : null;
  }

  /** แทนที่ทั้งเอกสาร เช่น กู้คืนงาน หรือเริ่มงานใหม่ ประวัติถูกล้าง */
  reset(doc) {
    this.doc = doc;
    this.selectedIds = [];
    this.markId = null;
    this.pageId = doc.pages[0].id;
    this.past = [];
    this.future = [];
    this.previewBase = null;
    this.emit({ docChanged: true });
  }

  fixSelection() {
    if (!this.doc.pages.some((p) => p.id === this.pageId)) this.pageId = this.doc.pages[0].id;
    if (this.markId && !(this.doc.marks ?? []).some((m) => m.id === this.markId)) this.markId = null;
    const placed = new Set(this.doc.instances
      .filter((i) => i.placementStatus === 'placed' && i.pageId === this.pageId)
      .map((i) => i.id));
    if (!this.selectedIds.every((id) => placed.has(id))) {
      this.selectedIds = this.selectedIds.filter((id) => placed.has(id));
    }
  }
}
