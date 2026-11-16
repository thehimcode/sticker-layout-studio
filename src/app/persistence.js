/**
 * บันทึกอัตโนมัติลง IndexedDB กันข้อมูลหายเมื่อปิดแท็บหรือเบราว์เซอร์ล่ม
 * ภาพต้นฉบับเก็บแยกเป็น Blob ตาม assetId ไม่ฝังซ้ำในเอกสาร
 */
const DB_NAME = 'sticker-layout-studio';
const DB_VERSION = 1;
const DOC_KEY = 'current';

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onabort = () => reject(tx.error);
  tx.onerror = () => reject(tx.error);
});

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('docs');
      req.result.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Persistence {
  static async create() {
    const p = new Persistence();
    p.db = await open();
    return p;
  }

  async putAsset(id, blob) {
    const tx = this.db.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(blob, id);
    await finished(tx);
  }

  async saveDocument(doc) {
    const tx = this.db.transaction('docs', 'readwrite');
    tx.objectStore('docs').put({ doc, savedAt: Date.now() }, DOC_KEY);
    await finished(tx);
  }

  async load() {
    const tx = this.db.transaction(['docs', 'assets'], 'readonly');
    const saved = await request(tx.objectStore('docs').get(DOC_KEY));
    if (!saved) return null;
    const assets = new Map();
    const ids = (saved.doc.masters ?? saved.doc.artworks ?? []).map((m) => m.originalAsset?.assetId ?? m.assetId);
    await Promise.all(ids.map(async (id) => {
      const blob = await request(tx.objectStore('assets').get(id));
      if (blob) assets.set(id, blob);
    }));
    return { ...saved, assets };
  }

  /** ลบภาพที่เอกสารปัจจุบันไม่ใช้ เรียกตอนเริ่มโปรแกรมเท่านั้นเพราะหลังจากนั้น Undo อาจยังอ้างถึง */
  async collectGarbage(doc) {
    const used = new Set(doc.masters.map((m) => m.originalAsset.assetId));
    const tx = this.db.transaction('assets', 'readwrite');
    const store = tx.objectStore('assets');
    const keys = await request(store.getAllKeys());
    for (const key of keys) if (!used.has(key)) store.delete(key);
    await finished(tx);
  }

  async clear() {
    const tx = this.db.transaction(['docs', 'assets'], 'readwrite');
    tx.objectStore('docs').clear();
    tx.objectStore('assets').clear();
    await finished(tx);
  }
}

/** รวมการบันทึกถี่ ๆ เป็นครั้งเดียว และบอกสถานะให้ UI แสดง */
export class AutoSaver {
  constructor({ save, onStatus, delayMs = 600 }) {
    this.save = save;
    this.onStatus = onStatus;
    this.delayMs = delayMs;
    this.timer = null;
    this.pending = null;
    this.running = Promise.resolve();
  }

  get dirty() { return this.pending !== null; }

  schedule(doc) {
    this.pending = doc;
    this.onStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    clearTimeout(this.timer);
    const doc = this.pending;
    if (doc === null) return this.running;
    this.running = this.running.then(async () => {
      try {
        await this.save(doc);
        if (this.pending === doc) {
          this.pending = null;
          this.onStatus('saved');
        }
      } catch (error) {
        console.error(error);
        this.onStatus('failed');
      }
    });
    return this.running;
  }
}
