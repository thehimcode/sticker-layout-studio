// ทดสอบในเบราว์เซอร์จริง: node tests/e2e/m1.e2e.mjs (ต้องมี Playwright และ Chromium)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? '/opt/npm-tools/');
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../..', import.meta.url));
const data = (n) => join(root, 'test-data', n);
const shots = process.env.SHOTS ?? join(root, 'test-results');
mkdirSync(shots, { recursive: true });
const PORT = 8123;
const server = spawn('node', ['tools/serve.mjs', String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const doc = () => page.evaluate(() => window.__studio.store.doc);
const selected = () => page.evaluate(() => window.__studio.store.selectedIds);
const commit = async (id, value) => { await page.fill(id, value); await page.press(id, 'Enter'); };
const inst = async (id) => (await doc()).instances.find((i) => i.id === id);
const clearToasts = () => page.evaluate(() => document.getElementById('toasts').replaceChildren());
const toastText = async () => (await page.locator('.toast').allTextContents()).join('|');
const row = (i) => page.locator('.artwork-list li').nth(i);
const setQty = async (i, n) => { await row(i).getByRole('textbox').fill(String(n)); await row(i).getByRole('textbox').press('Enter'); };
const near = (a, b, eps = 0.02, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b}`);

/** แปลงพิกัดกระดาษ (มม.) เป็นพิกัดเมาส์ จากมุมมองจริงของโปรแกรม */
const toPage = async (x, y) => {
  const box = await page.locator('#canvas').boundingBox();
  const v = await page.evaluate(() => window.__studio.getView());
  return { x: box.x + v.originX + x * v.scale, y: box.y + v.originY + y * v.scale };
};
async function dragMm(from, to, opts = {}) {
  const a = await toPage(from.x, from.y);
  const b = await toPage(to.x, to.y);
  await page.mouse.move(a.x, a.y);
  if (opts.modifier) await page.keyboard.down(opts.modifier);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  if (opts.modifier) await page.keyboard.up(opts.modifier);
}
async function clickMm(x, y, modifier) {
  const p = await toPage(x, y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(p.x, p.y);
  if (modifier) await page.keyboard.up(modifier);
}
const area = (d) => {
  const m = d.paper.marginsMm;
  return { l: m.left, t: m.top, r: d.paper.widthMm - m.right, b: d.paper.heightMm - m.bottom };
};
async function newProject() {
  await page.click('#new-doc');
  await page.click('dialog button[value=ok]');
  await page.waitForFunction(() => window.__studio.store.doc.masters.length === 0);
}
async function importAll(names, n) {
  await page.setInputFiles('#file-input', names.map(data));
  await page.waitForFunction((c) => window.__studio.store.doc.masters.length === c, n);
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.getElementById('paper-preset').options.length === 10);

  await step('AC-01 เปิดเป็น A4 210×297, เปลี่ยน A3+ 320×450 และ Custom ได้', async () => {
    assert.equal(await page.inputValue('#paper-w'), '210');
    assert.equal(await page.inputValue('#paper-h'), '297');
    await page.screenshot({ path: join(shots, '1-empty.png') });
    await page.selectOption('#paper-preset', 'A3+');
    assert.equal(await page.inputValue('#paper-w'), '320');
    assert.equal(await page.inputValue('#paper-h'), '450');
    assert.equal(await page.isVisible('#paper-note'), true);
    await page.selectOption('#paper-preset', 'Super A3');
    assert.equal(await page.inputValue('#paper-w'), '329');
    await page.click('#orient-landscape');
    assert.equal(await page.inputValue('#paper-w'), '483');
    await page.selectOption('#paper-preset', 'custom');
    await commit('#paper-w', '400');
    assert.equal((await doc()).paper.widthMm, 400);
    await commit('#paper-w', '1');
    assert.equal(await page.inputValue('#paper-w'), '400');
    await page.selectOption('#paper-preset', 'A4');
    await page.click('#orient-portrait');
  });

  await step('FR-02 นำเข้า PNG/JPG หลายไฟล์ ขนาดจริงจาก DPI และแสดงข้อมูลไฟล์', async () => {
    await importAll(['circle-50.8mm-300dpi.png', 'label-127x63.5mm-200dpi.jpg', 'no-dpi-300x150px.png'], 3);
    const d = await doc();
    near(d.masters[0].desiredSizeMm.widthMm, 50.8);
    near(d.masters[1].desiredSizeMm.widthMm, 127);
    assert.equal(d.masters[2].desiredSizeMm.widthMm, 25.4);
    assert.equal(d.masters[2].naturalSize.dpi, null);
    const meta = await row(1).locator('.art-meta').textContent();
    assert.match(meta, /JPG 1000 × 500 px/);
    assert.match(meta, /127 × 63.5 มม\., 200 DPI/);
  });

  await step('ไฟล์เสีย/ไม่รองรับแจ้งสาเหตุ และโปรเจกต์ไม่เสียหาย', async () => {
    const before = await doc();
    await clearToasts();
    await page.setInputFiles('#file-input', ['corrupt.png', 'not-an-image.txt.png', 'not-yet.pdf'].map(data));
    await page.waitForFunction(() => document.querySelectorAll('.toast.error').length === 3);
    const text = await toastText();
    assert.match(text, /เปิดภาพไม่ได้/); assert.match(text, /รองรับเฉพาะ PNG และ JPG/); assert.match(text, /ยังเปิด PDF และ AI ไม่ได้/);
    assert.deepEqual(await doc(), before);
    await clearToasts();
  });

  await step('ลากวางไฟล์: ภาพลงตรงจุดที่ปล่อยเมาส์', async () => {
    const bytes = [...readFileSync(data('badge-50.8x25.4mm-600dpi.png'))];
    const dt = await page.evaluateHandle((b) => {
      const t = new DataTransfer();
      t.items.add(new File([new Uint8Array(b)], 'badge.png', { type: 'image/png' }));
      return t;
    }, bytes);
    await page.dispatchEvent('#canvas', 'dragenter', { dataTransfer: dt });
    assert.equal(await page.isVisible('#drop-overlay'), true);
    const p = await toPage(110, 200);
    await page.dispatchEvent('#canvas', 'drop', { dataTransfer: dt, clientX: p.x, clientY: p.y });
    await page.waitForFunction(() => window.__studio.store.doc.masters.length === 4);
    assert.equal(await page.isVisible('#drop-overlay'), false);
    const t = (await doc()).instances.at(-1).transform;
    near(t.xMm + 25.4, 110, 0.5, 'x');
    near(t.yMm + 12.7, 200, 0.5, 'y');
  });

  await step('ไฟล์ใหญ่เกินย่อขนาดเริ่มต้นพร้อมแจ้ง และ Undo ได้', async () => {
    await importAll(['oversized-4000px-72dpi.png'], 5);
    assert.ok((await doc()).masters[4].desiredSizeMm.widthMm <= 200);
    assert.match(await toastText(), /ย่อขนาดเริ่มต้น/);
    await page.click('#undo');
    assert.equal((await doc()).masters.length, 4);
    await clearToasts();
  });

  await step('AC-04 ภาพ A 12 ชิ้น B 8 ชิ้น จำนวนแสดงตรงกัน, ลดเหลือ 0 ได้', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png', 'badge-50.8x25.4mm-600dpi.png'], 2);
    await setQty(0, 12);
    await setQty(1, 8);
    const d = await doc();
    assert.deepEqual(d.masters.map((m) => m.quantity), [12, 8]);
    assert.equal(d.instances.filter((i) => i.masterId === d.masters[0].id).length, 12);
    assert.equal(d.instances.filter((i) => i.masterId === d.masters[1].id).length, 8);
    assert.equal(await row(0).getByRole('textbox').inputValue(), '12');
    assert.equal(await row(1).getByRole('textbox').inputValue(), '8');
    await page.screenshot({ path: join(shots, '2-quantity.png') });
    await row(1).getByRole('button', { name: /^เพิ่มจำนวน/ }).click();
    await row(1).getByRole('button', { name: /^ลดจำนวน/ }).click();
    await setQty(1, 0);
    assert.equal((await doc()).masters[1].quantity, 0);
    assert.equal(await row(1).getByRole('button', { name: /^ลดจำนวน/ }).isDisabled(), true);
    await page.click('#undo');
    assert.equal((await doc()).masters[1].quantity, 8);
    await setQty(0, 1);
    await setQty(1, 1);
  });

  await step('กระดาษเต็ม: ไม่ซ้อน ไม่ย่อ ชิ้นเกินแจ้งเป็นยังไม่ได้วาง', async () => {
    await clearToasts();
    await setQty(0, 20);
    const d = await doc();
    const pending = d.instances.filter((i) => i.placementStatus === 'unplaced').length;
    assert.ok(pending > 0);
    assert.equal(d.masters[0].quantity, 20);
    assert.match(await page.textContent('#status-warn'), new RegExp(`ยังไม่ได้วาง ${pending} ชิ้น`));
    assert.match(await row(0).locator('.art-meta').textContent(), /ยังไม่ได้วาง/);
    assert.equal(await page.isVisible('#place-pending'), true);
    assert.doesNotMatch(await page.textContent('#status-warn'), /ซ้อน/);
    await page.selectOption('#paper-preset', 'A3');
    await page.click('#place-pending');
    assert.equal((await doc()).instances.filter((i) => i.placementStatus === 'unplaced').length, 0);
    await page.selectOption('#paper-preset', 'A4');
    await setQty(0, 1);
  });

  await step('AC-02 Margin 10/15/20/5 ลากวัตถุข้ามพื้นที่ไม่ได้ทั้ง 4 ด้าน', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png'], 1);
    await commit('#margin-top', '10');
    await commit('#margin-right', '15');
    await commit('#margin-bottom', '20');
    await commit('#margin-left', '5');
    assert.deepEqual((await doc()).paper.marginsMm, { top: 10, right: 15, bottom: 20, left: 5 });
    const [id] = await selected();
    await commit('#sel-x', '80'); await commit('#sel-y', '120');
    const go = async (tx, ty) => {
      const { xMm, yMm } = (await inst(id)).transform;
      await dragMm({ x: xMm + 25, y: yMm + 25 }, { x: tx, y: ty });
      return (await inst(id)).transform;
    };
    let t = await go(-60, 150);
    near(t.xMm, 5, 1e-6, 'ซ้าย');
    t = await go(300, 150);
    near(t.xMm + 50.8, 195, 1e-6, 'ขวา');
    assert.match(await toastText(), /ขอบพื้นที่วางงาน/);
    t = await go(100, -80);
    near(t.yMm, 10, 1e-6, 'บน');
    t = await go(100, 400);
    near(t.yMm + 50.8, 277, 1e-6, 'ล่าง');
    await commit('#sel-x', '-50');
    assert.equal(await page.inputValue('#sel-x'), '5');
    await commit('#sel-x', 'abc');
    assert.equal(await page.inputValue('#sel-x'), '5');
    await commit('#margin-left', '9999');
    assert.equal(await page.inputValue('#margin-left'), '5');
  });

  await step('FR-08.2 ตั้งเท่ากันทั้งสี่ด้าน', async () => {
    await page.check('#margin-link');
    assert.deepEqual((await doc()).paper.marginsMm, { top: 10, right: 10, bottom: 10, left: 10 });
    await commit('#margin-left', '7');
    assert.deepEqual((await doc()).paper.marginsMm, { top: 7, right: 7, bottom: 7, left: 7 });
    await page.uncheck('#margin-link');
    await commit('#margin-left', '5');
    assert.deepEqual((await doc()).paper.marginsMm, { top: 7, right: 7, bottom: 7, left: 5 });
  });

  await step('FR-08.5 เปลี่ยน Margin ไม่ย้ายและไม่ Scale แต่แจ้งชิ้นที่ไม่ถูกต้อง', async () => {
    const [id] = await selected();
    await commit('#sel-x', '140');
    const before = await inst(id);
    await commit('#margin-right', '40');
    assert.deepEqual(await inst(id), before);
    assert.match(await page.textContent('#status-warn'), /นอกพื้นที่วางงาน 1 ชิ้น/);
    await page.click('#fix-outside');
    near((await inst(id)).transform.xMm + 50.8, 170, 1e-6);
    assert.equal(await page.textContent('#status-warn'), '');
  });

  await step('ลากย้ายรวมเป็น Undo ขั้นเดียว', async () => {
    const [id] = await selected();
    const before = await inst(id);
    await dragMm({ x: before.transform.xMm + 25, y: before.transform.yMm + 25 }, { x: 60, y: 60 });
    assert.notDeepEqual(await inst(id), before);
    await page.click('#undo');
    assert.deepEqual(await inst(id), before);
  });

  await step('ลากมุมย่อขยายล็อกสัดส่วน และหยุดชิดขอบพอดี', async () => {
    const [id] = await selected();
    await commit('#sel-x', '40'); await commit('#sel-y', '40');
    const start = (await doc()).masters[0].desiredSizeMm.widthMm;
    await dragMm({ x: 40 + start, y: 40 + start }, { x: 100, y: 100 });
    near((await doc()).masters[0].desiredSizeMm.widthMm, 60, 0.3);
    const w = (await doc()).masters[0].desiredSizeMm;
    assert.ok(Math.abs(w.widthMm - w.heightMm) < 1e-9);
    await dragMm({ x: 100, y: 100 }, { x: 900, y: 900 });
    const d = await doc();
    const t = (await inst(id)).transform;
    near(t.xMm + d.masters[0].desiredSizeMm.widthMm, area(d).r, 0.01, 'ต้องชิดขอบขวา');
    assert.equal(await page.isVisible('.toast'), true);
    await page.click('#undo');
    await page.click('#undo');
  });

  await step('ลากมุมชิ้นที่หมุนแล้ว: มุมตรงข้ามอยู่ที่เดิม และอยู่ในพื้นที่', async () => {
    const [id] = await selected();
    await commit('#sel-x', '60'); await commit('#sel-y', '100');
    await commit('#sel-rot', '30');
    const corners = () => page.evaluate((iid) => {
      const { store } = window.__studio;
      const i = store.doc.instances.find((q) => q.id === iid);
      const s = store.doc.masters.find((m) => m.id === i.masterId).desiredSizeMm;
      const { xMm, yMm, rotationDeg } = i.transform;
      const r = rotationDeg * Math.PI / 180;
      const cx = xMm + s.widthMm / 2; const cy = yMm + s.heightMm / 2;
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
        x: cx + a * s.widthMm / 2 * Math.cos(r) - b * s.heightMm / 2 * Math.sin(r),
        y: cy + a * s.widthMm / 2 * Math.sin(r) + b * s.heightMm / 2 * Math.cos(r),
      }));
    }, id);
    const before = await corners();
    await dragMm(before[2], { x: before[2].x + 10, y: before[2].y + 10 });
    const after = await corners();
    near(after[0].x, before[0].x, 1e-6); near(after[0].y, before[0].y, 1e-6);
    assert.notEqual(after[2].x, before[2].x);
    await page.click('#undo');
    await commit('#sel-rot', '0');
  });

  await step('Margin กับชิ้นที่หมุนแล้ว: ใช้กรอบหลังหมุน', async () => {
    const [id] = await selected();
    await commit('#sel-rot', '45');
    await commit('#sel-x', '-100');
    const { xMm, rotationDeg } = (await inst(id)).transform;
    assert.equal(rotationDeg, 45);
    const d = await doc();
    const w = d.masters[0].desiredSizeMm.widthMm;
    near(xMm + w / 2 - (w * Math.SQRT2) / 2, area(d).l, 1e-6);
    await commit('#sel-rot', '0');
  });

  await step('FR-03.3 ขนาดเป็น มม., ล็อกสัดส่วน, หมุน 90°', async () => {
    await page.check('#sel-lock');
    await commit('#sel-w', '40');
    assert.equal(await page.inputValue('#sel-h'), '40');
    await page.uncheck('#sel-lock');
    await commit('#sel-h', '30');
    assert.equal(await page.inputValue('#sel-w'), '40');
    assert.match(await page.textContent('#sel-dpi'), /381 DPI/);
    await page.click('#sel-rot90');
    assert.equal(await page.inputValue('#sel-rot'), '90');
    await page.click('#undo');
  });

  await step('ช่องตัวเลข: ปุ่ม ▲▼, ลูกศรขึ้น/ลง, Shift ×10 และหน่วยทุกช่อง', async () => {
    const units = await page.$$eval('input[inputmode=decimal]', (inputs) => inputs.map((i) => [i.id || i.getAttribute('aria-label'),
      i.closest('.num')?.querySelector('.unit')?.textContent ?? null, i.closest('.num')?.querySelectorAll('.spin button').length ?? 0]));
    for (const [name, unit, buttons] of units) {
      assert.equal(buttons, 2, `${name} ไม่มีปุ่ม ▲▼`);
      assert.equal(unit, name.endsWith('-rot') ? '°' : 'mm', `${name} หน่วยไม่ถูก`);
    }
    const spin = (sel, i) => page.locator(`.num:has(${sel}) .spin button`).nth(i);
    const [id] = await selected();
    await commit('#sel-x', '40');
    await spin('#sel-x', 0).click();
    near((await inst(id)).transform.xMm, 41, 1e-9, 'X ▲');
    await spin('#sel-x', 1).click({ modifiers: ['Shift'] });
    near((await inst(id)).transform.xMm, 31, 1e-9, 'X ▼ Shift');
    assert.equal(await page.inputValue('#sel-x'), '31');
    const before = await inst(id);
    await page.focus('#sel-y');
    await page.keyboard.press('ArrowUp');
    near((await inst(id)).transform.yMm, before.transform.yMm + 1, 1e-9, 'Y ลูกศรขึ้น');
    near((await inst(id)).transform.xMm, 31, 1e-9, 'ลูกศรในช่องต้องไม่เลื่อนชิ้นงาน');
    await page.click('#undo');
    near((await inst(id)).transform.yMm, before.transform.yMm, 1e-9, 'Undo');
    const top = (await doc()).paper.marginsMm.top;
    await spin('#margin-top', 0).click();
    near((await doc()).paper.marginsMm.top, top + 0.5, 1e-9, 'Margin ▲ 0.5');
    await page.click('#undo');
    const keepouts = page.locator('details:has(#keepout-list)');
    await keepouts.locator('summary').click();
    await page.click('#keepout-add');
    const zone = (await doc()).keepouts.at(-1);
    await page.locator('.keepout-list li:last-child .num').first().locator('.spin button').nth(1).click();
    near((await doc()).keepouts.at(-1).xMm, zone.xMm - 1, 1e-9, 'Keep-out ▼');
    await page.locator('#selection-fields').screenshot({ path: join(shots, 'm1-stepper-fields.png') });
    await page.locator('.keepout-list').screenshot({ path: join(shots, 'm1-stepper-keepout.png') });
    await page.locator('.margin-box').screenshot({ path: join(shots, 'm1-stepper-margins.png') });
    await page.click('.keepout-list li:last-child button:has-text("ลบพื้นที่นี้")');
    await keepouts.locator('summary').click();
  });

  await step('FR-03.5 เลือกหลายชิ้น Shift/ลากคลุม ย้ายพร้อมกัน Duplicate Delete Align', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png'], 1);
    await setQty(0, 3);
    const ids = (await doc()).instances.map((i) => i.id);
    await commit('#margin-left', '5');
    await page.evaluate(() => window.__studio.store.select([]));
    const place = async (i, x, y) => {
      await page.evaluate((id) => window.__studio.store.select([id]), ids[i]);
      await commit('#sel-x', String(x)); await commit('#sel-y', String(y));
    };
    await place(0, 20, 20); await place(1, 90, 50); await place(2, 40, 130);
    await page.evaluate(() => window.__studio.store.select([]));
    await clickMm(45, 45);
    await clickMm(115, 75, 'Shift');
    assert.deepEqual((await selected()).sort(), ids.slice(0, 2).sort());
    assert.match(await page.textContent('#selection-title'), /เลือกอยู่ 2 ชิ้น/);
    assert.equal(await page.isVisible('#selection-fields'), false);

    const a0 = (await inst(ids[0])).transform;
    const a1 = (await inst(ids[1])).transform;
    await dragMm({ x: 45, y: 45 }, { x: 55, y: 60 });
    const b0 = (await inst(ids[0])).transform;
    const b1 = (await inst(ids[1])).transform;
    near(b0.xMm - a0.xMm, b1.xMm - a1.xMm, 1e-9);
    near(b0.xMm - a0.xMm, 10, 0.5);
    await page.click('#undo');

    await page.click('[data-align=left]');
    const d = await doc();
    assert.equal(d.instances[0].transform.xMm, d.instances[1].transform.xMm);
    await page.click('#undo');

    await clickMm(190, 280);
    assert.deepEqual(await selected(), []);
    await dragMm({ x: 8, y: 8 }, { x: 150, y: 110 });
    assert.deepEqual((await selected()).sort(), ids.slice(0, 2).sort());

    await page.locator('#canvas').focus();
    await page.keyboard.press('Control+d');
    assert.equal((await doc()).masters[0].quantity, 5);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+a');
    assert.equal((await selected()).length, 3);
    await page.keyboard.press('Delete');
    assert.equal((await doc()).masters[0].quantity, 0);
    assert.equal((await doc()).masters.length, 1);
    await page.keyboard.press('Control+z');
    assert.equal((await doc()).masters[0].quantity, 3);
  });

  await step('FR-03.3 จัดลำดับชั้น เปลี่ยนชิ้นที่คลิกถูกจริง', async () => {
    const ids = (await doc()).instances.map((i) => i.id);
    await page.evaluate((id) => window.__studio.store.select([id]), ids[0]);
    await commit('#sel-x', '100'); await commit('#sel-y', '150');
    await page.evaluate((id) => window.__studio.store.select([id]), ids[1]);
    await commit('#sel-x', '110'); await commit('#sel-y', '160');
    await clickMm(130, 180);
    assert.deepEqual(await selected(), [ids[1]]);
    await page.click('[data-order=back]');
    await clickMm(130, 180);
    assert.deepEqual(await selected(), [ids[0]]);
    await page.click('[data-order=forward]');
    await page.click('[data-order=front]');
    assert.equal((await doc()).instances.at(-1).id, ids[0]);
  });

  await step('แป้นพิมพ์: ลูกศรเลื่อน, Undo', async () => {
    const [id] = await selected();
    await page.locator('#canvas').focus();
    const x0 = (await inst(id)).transform.xMm;
    await page.keyboard.press('Shift+ArrowRight');
    near((await inst(id)).transform.xMm - x0, 10, 1e-6);
    await page.keyboard.press('Control+z');
    assert.equal((await inst(id)).transform.xMm, x0);
    await page.screenshot({ path: join(shots, '3-selection.png') });
  });

  await step('FR-01.5 ซูม เลื่อนมุมมอง พอดีจอ และ Grid ไม่แก้เอกสาร', async () => {
    const before = await doc();
    const box = await page.locator('#canvas').boundingBox();
    await page.mouse.move(box.x + 300, box.y + 300);
    const zoomBefore = await page.textContent('#zoom-level');
    await page.mouse.wheel(0, -300);
    await page.waitForFunction((z) => document.getElementById('zoom-level').textContent !== z, zoomBefore);
    const v0 = await page.evaluate(() => window.__studio.getView());
    await page.keyboard.down('Space');
    await page.locator('#canvas').focus();
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(box.x + 360, box.y + 340);
    await page.mouse.up();
    await page.keyboard.up('Space');
    const v1 = await page.evaluate(() => window.__studio.getView());
    near(v1.originX - v0.originX, 60, 0.01);
    await page.click('#zoom-fit');
    const pixel = () => page.evaluate(() => {
      const c = document.getElementById('canvas');
      const v = window.__studio.getView();
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d').getImageData(Math.round((10.5 * v.scale + v.originX) * k), Math.round((280 * v.scale + v.originY) * k), 1, 1).data];
    });
    await page.click('#view-menu summary');
    await page.click('#toggle-grid');
    assert.equal(await page.isChecked('#toggle-grid'), true);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(shots, '4-grid.png') });
    await page.click('#toggle-grid');
    await page.waitForTimeout(100);
    assert.deepEqual(await pixel(), [255, 255, 255, 255]);
    assert.deepEqual(await doc(), before);
  });

  await step('บันทึกอัตโนมัติ: รีโหลดแล้วงานและภาพกลับมาครบ', async () => {
    await page.waitForFunction(() => document.getElementById('status-save').textContent.includes('บันทึกในเบราว์เซอร์แล้ว'));
    const before = await doc();
    await page.reload();
    await page.waitForFunction((n) => window.__studio.store.doc.instances.length === n, before.instances.length);
    await page.waitForFunction(() => window.__studio.assets.size === 1);
    assert.deepEqual(await doc(), before);
    await page.screenshot({ path: join(shots, '5-restored.png') });
  });

  await step('เริ่มงานใหม่ต้องยืนยัน และล้างข้อมูลจริง', async () => {
    await page.click('#new-doc');
    await page.click('dialog button[value=cancel]');
    assert.equal((await doc()).masters.length, 1);
    await newProject();
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('paper-preset').options.length === 10);
    await page.waitForTimeout(200);
    assert.equal((await doc()).masters.length, 0);
  });

  await step('NFR-07 ภาพบน Canvas ตรงพิกัด มม. (ตรวจพิกเซล)', async () => {
    await importAll(['no-dpi-300x150px.png'], 1);
    await commit('#sel-x', '40');
    await commit('#sel-y', '60');
    await page.evaluate(() => window.__studio.store.select([]));
    await page.waitForTimeout(100);
    const probe = (x, y) => page.evaluate(([mx, my]) => {
      const c = document.getElementById('canvas');
      const v = window.__studio.getView();
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d').getImageData(Math.round((mx * v.scale + v.originX) * k), Math.round((my * v.scale + v.originY) * k), 1, 1).data];
    }, [x, y]);
    const isArt = (px) => px[0] === 120 && px[1] === 60 && px[2] === 160;
    assert.ok(isArt(await probe(40.5, 60.5)));
    assert.ok(isArt(await probe(64.9, 72.2)));
    assert.deepEqual(await probe(39.5, 66), [255, 255, 255, 255]);
    assert.deepEqual(await probe(65.9, 66), [255, 255, 255, 255]);
    assert.deepEqual(await probe(50, 73.2), [255, 255, 255, 255]);
    await page.selectOption('#paper-preset', 'A0');
    await page.waitForTimeout(100);
    assert.ok((await page.evaluate(() => window.__studio.getView())).scale < 0.8, 'กระดาษใหม่ต้องพอดีจอ');
    await page.click('#undo');
  });

  await step('จอเล็กไม่ล้นแนวนอน และกระดาษพอดีจอ', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `ล้น ${over}px`);
    const { originX } = await page.evaluate(() => window.__studio.getView());
    assert.ok(originX >= 0 && originX < 100, 'กระดาษต้องอยู่ในจอ');
  });

  const expected = pageErrors.filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(expected, []);
  console.log(`\nผ่าน ${passed} ขั้นตอน ไม่มี error จากหน้าเว็บ`);
} finally {
  await browser.close();
  server.kill();
}
