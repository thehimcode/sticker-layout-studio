import { BUILTIN_PROFILES, sanitizeProfile } from '../core/marks.js';

/**
 * Machine Profile ของผู้ใช้ (FR-10.6) เก็บใน localStorage ของเบราว์เซอร์นี้ แยกจากโปรเจกต์
 * จึงใช้ซ้ำได้ทุกงาน ถ้าเบราว์เซอร์ไม่ให้เก็บ จะใช้ได้เฉพาะจนกว่าจะปิดหน้า
 */
const KEY = 'sticker-layout-studio.machine-profiles';

export class ProfileStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.user = [];
    this.persistent = true;
    try {
      const raw = this.storage?.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      this.user = Array.isArray(list) ? list.map(sanitizeProfile).filter(Boolean) : [];
    } catch {
      this.persistent = false;
    }
  }

  all() {
    return [...BUILTIN_PROFILES, ...this.user];
  }

  get(id) {
    return this.all().find((p) => p.id === id) ?? null;
  }

  /** คืน false ถ้าบันทึกถาวรไม่ได้ Profile ยังใช้ได้จนกว่าจะปิดหน้า */
  save(profile) {
    this.user = [...this.user.filter((p) => p.id !== profile.id && p.label !== profile.label), profile];
    return this.flush();
  }

  remove(id) {
    this.user = this.user.filter((p) => p.id !== id);
    return this.flush();
  }

  flush() {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.user));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
    return this.persistent;
  }
}
