import { parseNumberInput } from '../core/units.js';

/** คูณระยะเพิ่ม/ลดเมื่อกด Shift (×10) หรือ Alt (×0.1) แบบเดียวกับการเลื่อนชิ้นงานด้วยลูกศร */
export const stepFactor = (event) => (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);

/** ค่าใหม่หลังกดเพิ่ม/ลด ปัดทศนิยมกันเศษ floating point เช่น 0.1 + 0.2 */
export function steppedValue(text, dir, step, factor = 1) {
  const base = parseNumberInput(text) ?? 0;
  return Math.round((base + dir * step * factor) * 1e6) / 1e6;
}

/**
 * ผูกช่องกรอกตัวเลข: ยืนยันเมื่อกด Enter หรือออกจากช่อง, Esc ยกเลิก
 * ช่องที่กำลังพิมพ์จะไม่ถูก state เขียนทับ
 * `step` เพิ่มปุ่ม ▲▼ และลูกศรขึ้น/ลงบนคีย์บอร์ด, `unit` แสดงหน่วยท้ายช่อง
 * ค่าที่ได้จากปุ่มผ่าน onCommit เหมือนการพิมพ์ จึงถูกตรวจขอบเขตแบบเดียวกัน
 */
export function bindNumber(input, { onCommit, onInvalid, refresh, step, unit }) {
  const nudge = (dir, event) => {
    if (input.disabled) return;
    delete input.dataset.editing;
    const next = steppedValue(input.value, dir, step, stepFactor(event));
    input.value = String(next);
    onCommit(next);
    refresh();
  };
  input.addEventListener('input', () => { input.dataset.editing = '1'; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      delete input.dataset.editing;
      refresh();
      input.blur();
    }
    if (step && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      nudge(event.key === 'ArrowUp' ? 1 : -1, event);
    }
  });
  input.addEventListener('change', () => {
    if (input.dataset.editing !== '1') return;
    delete input.dataset.editing;
    const value = parseNumberInput(input.value);
    if (value === null) onInvalid();
    else onCommit(value);
    refresh();
  });
  if (step || unit) decorate(input, { step, unit, nudge });
}

function decorate(input, { step, unit, nudge }) {
  const box = document.createElement('span');
  box.className = 'num';
  input.before(box);
  box.append(input);
  if (unit) {
    const tag = document.createElement('span');
    tag.className = 'unit';
    tag.textContent = unit;
    tag.setAttribute('aria-hidden', 'true');
    box.append(tag);
  }
  if (!step) return;
  const name = input.getAttribute('aria-label') || input.closest('label')?.firstChild?.textContent?.trim() || '';
  const spin = document.createElement('span');
  spin.className = 'spin';
  for (const [dir, glyph, verb] of [[1, '▲', 'เพิ่ม'], [-1, '▼', 'ลด']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.textContent = glyph;
    button.title = `${verb} ${step}${unit ? ` ${unit}` : ''} (Shift ×10, Alt ×0.1)`;
    button.setAttribute('aria-label', `${verb} ${name}`.trim());
    // ไม่ให้ปุ่มแย่งโฟกัส ช่องที่กำลังพิมพ์จึงไม่ถูกยืนยันซ้อนก่อนกด
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => nudge(dir, event));
    spin.append(button);
  }
  box.append(spin);
}

export function setField(input, text) {
  if (input.dataset.editing !== '1' && input.value !== text) input.value = text;
}
