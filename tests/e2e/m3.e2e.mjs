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
const PORT = 8126;
const server = spawn('node', ['tools/serve.mjs', String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, acceptDownloads: true });
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

const ready = () => page.waitForFunction(() => {
  const e = window.__studio.editor;
  return e.master && !e.queued && document.getElementById('cut-job').hidden && e.cutline;
});
const openCut = async (name) => {
  await page.locator('.artwork-list li', { hasText: name }).getByRole('button', { name: /^ตั้งค่าเส้นตัด/ }).click();
  await ready();
};
const editorCut = () => page.evaluate(() => window.__studio.editor.cutline);
const issuesText = () => page.textContent('#cut-issues');
const closePoints = function* (paths) { for (const p of paths) for (let i = 0; i < p.length; i += 2) yield [p[i], p[i + 1]]; };
const setRange = (id, value) => page.$eval(id, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const stable = async () => { await page.waitForTimeout(260); await ready(); };
const apply = async () => { await page.click('#cut-apply'); await page.waitForFunction(() => !document.getElementById('cutline-dialog').open); };
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; };

const layoutDone = (text) => page.waitForFunction((t) => document.getElementById('layout-job').hidden && [...document.querySelectorAll('.toast')].some((e) => e.textContent.includes(t)), text, { timeout: 90000 });
const distance = (idsOnly = null) => page.evaluate((only) => {
  // ระยะใกล้สุดของเส้นตัดจริงทุกคู่ในหน้าเดียวกัน คำนวณอิสระจากโค้ดโปรแกรม
  const { store } = window.__studio;
  const { doc } = store;
  const pts = doc.instances.filter((i) => i.placementStatus === 'placed').map((i) => {
    const m = doc.masters.find((x) => x.id === i.masterId);
    const { xMm, yMm, rotationDeg } = i.transform;
    const r = rotationDeg * Math.PI / 180; const c = Math.cos(r); const s = Math.sin(r);
    const hw = m.desiredSizeMm.widthMm / 2; const hh = m.desiredSizeMm.heightMm / 2;
    const out = [];
    for (const p of m.cutline.closedPaths) {
      for (let k = 0; k < p.length; k += 6) {
        const x = p[k] - hw; const y = p[k + 1] - hh;
        out.push([c * x - s * y + xMm + hw, s * x + c * y + yMm + hh]);
      }
    }
    return { page: i.pageId, out };
  });
  let best = Infinity;
  for (let a = 0; a < pts.length; a += 1) {
    for (let b = a + 1; b < pts.length; b += 1) {
      if (pts[a].page !== pts[b].page) continue;
      for (const p of pts[a].out) for (const q of pts[b].out) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  }
  return best;
}, idsOnly);

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.getElementById('paper-preset').options.length === 10);

  await step('AC-07 จัดให้ประหยัด 10 ชิ้น ใน Worker: เส้นตัดทุกคู่ห่างอย่างน้อย 3 มม.', async () => {
    await importAll(['star-concave-300dpi.png'], 1);
    await page.click('#cut-all');
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline?.shapes);
    await page.locator('.artwork-list li').first().getByRole('textbox').fill('10');
    await page.locator('.artwork-list li').first().getByRole('textbox').press('Enter');
    assert.equal(await page.inputValue('#spacing-mm'), '3');
    assert.equal(await page.inputValue('#spacing-mode'), 'cutline');
    await page.selectOption('#layout-step', '30');
    await page.click('#layout-nest');
    await layoutDone('จัดเรียงครบ 10 ชิ้น');
    assert.ok(await distance() >= 3 - 0.02, 'ใกล้สุดต้องไม่ต่ำกว่า 3 มม.');
    assert.match(await page.textContent('#layout-report'), /วางแล้ว10 ชิ้น/);
    assert.equal(await page.textContent('#status-warn'), '');
    const d = await doc();
    assert.ok(new Set(d.instances.map((i) => i.transform.rotationDeg)).size >= 2, 'ต้องมีการหมุนจริง');
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shots, 'm3-1-nest.png') });
  });

  await step('Undo ย้อนการจัดเรียงเป็นขั้นเดียว', async () => {
    const before = await doc();
    await page.click('#undo');
    assert.notDeepEqual((await doc()).instances, before.instances);
    await page.click('#redo');
    assert.deepEqual((await doc()).instances, before.instances);
  });

  await step('เรียงตามแถว ผ่านการตรวจเดียวกัน', async () => {
    await page.click('#layout-standard');
    await layoutDone('ใช้');
    assert.ok(await distance() >= 3 - 0.02);
    assert.ok((await doc()).instances.every((i) => i.transform.rotationDeg === 0));
  });

  await step('AC-12 ชิ้นงานเกินหน้า: เพิ่มหน้าโดยจำนวนและสเกลไม่เปลี่ยน สลับหน้าดูได้', async () => {
    await page.locator('.artwork-list li').first().getByRole('textbox').fill('30');
    await page.locator('.artwork-list li').first().getByRole('textbox').press('Enter');
    await page.selectOption('#layout-step', '90');
    const size = (await doc()).masters[0].desiredSizeMm;
    await page.click('#layout-nest');
    await layoutDone('จัดเรียงครบ 30 ชิ้น');
    const d = await doc();
    assert.ok(d.pages.length >= 2);
    assert.equal(d.masters[0].quantity, 30);
    assert.deepEqual(d.masters[0].desiredSizeMm, size);
    assert.ok(new Set(d.instances.map((i) => i.pageId)).size === d.pages.length);
    assert.match(await page.textContent('#page-label'), new RegExp(`หน้า 1/${d.pages.length}`));
    const shot = () => page.evaluate(() => document.getElementById('canvas').toDataURL().length);
    await page.waitForTimeout(120);
    const a = await shot();
    await page.click('#page-next');
    await page.waitForTimeout(120);
    assert.notEqual(await shot(), a);
    await page.screenshot({ path: join(shots, 'm3-2-page2.png') });
    await page.click('#page-prev');
  });

  await step('ปิดเพิ่มหน้า: แจ้งชิ้นที่ยังวางไม่ได้ ไม่ย่อ', async () => {
    await page.uncheck('#layout-pages');
    await page.click('#layout-nest');
    await layoutDone('ยังวางไม่ได้');
    const d = await doc();
    const pending = d.instances.filter((i) => i.placementStatus === 'unplaced').length;
    assert.ok(pending > 0);
    assert.equal(d.pages.length, 1);
    assert.equal(d.masters[0].quantity, 30);
    assert.match(await page.textContent('#layout-report'), new RegExp(`ยังวางไม่ได้${pending} ชิ้น`));
    await page.check('#layout-pages');
  });

  await step('FR-05.7 ยกเลิกการจัดเรียงได้จริง งานเดิมไม่เปลี่ยน และคำนวณใหม่ได้', async () => {
    await page.locator('.artwork-list li').first().getByRole('textbox').fill('60');
    await page.locator('.artwork-list li').first().getByRole('textbox').press('Enter');
    await page.selectOption('#layout-step', '15');
    await clearToasts();
    const before = await doc();
    await page.click('#layout-nest');
    await page.waitForSelector('#layout-cancel', { state: 'visible' });
    await page.waitForTimeout(150);
    await page.click('#layout-cancel');
    await layoutDone('ยกเลิกการจัดเรียงแล้ว');
    assert.deepEqual(await doc(), before);
    await page.locator('.artwork-list li').first().getByRole('textbox').fill('8');
    await page.locator('.artwork-list li').first().getByRole('textbox').press('Enter');
    await page.selectOption('#layout-step', '90');
    await clearToasts();
    await page.click('#layout-nest');
    await layoutDone('จัดเรียงครบ 8 ชิ้น');
  });

  await step('AC-09 Keep-out: ลากเข้าไม่ได้ และ Auto Layout ไม่ทับ', async () => {
    await page.locator('details:has(#keepout-list)').locator('summary').click();
    await page.click('#keepout-add');
    const set = async (name, v) => { const f = page.getByRole('textbox', { name: `พื้นที่ห้ามวาง 1 ${name}` }); await f.fill(v); await f.press('Enter'); };
    await set('X', '60'); await set('Y', '100'); await set('กว้าง', '90'); await set('สูง', '80');
    assert.deepEqual((({ xMm, yMm, widthMm, heightMm }) => [xMm, yMm, widthMm, heightMm])((await doc()).keepouts[0]), [60, 100, 90, 80]);
    await clearToasts();
    await page.click('#layout-nest');
    await layoutDone('จัดเรียงครบ 8 ชิ้น');
    assert.equal(await page.textContent('#status-warn'), '');
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shots, 'm3-3-keepout.png') });
    const d = await doc();
    const first = d.instances.find((i) => i.pageId === d.pages[0].id);
    await page.evaluate((id) => window.__studio.store.select([id]), first.id);
    const m = d.masters[0].desiredSizeMm;
    await clearToasts();
    const start = first.transform;
    await dragMm({ x: start.xMm + m.widthMm / 2, y: start.yMm + m.heightMm / 2 }, { x: 105, y: 140 });
    assert.doesNotMatch(await page.textContent('#status-warn'), /พื้นที่ห้ามวาง/);
    assert.match(await toastText(), /หยุดก่อนถึงพื้นที่ห้ามวาง/);
    await commit('#sel-x', '80'); await commit('#sel-y', '120');
    assert.match(await toastText(), /ทับพื้นที่ห้ามวาง/);
    await page.click('#undo');
  });

  await step('FR-09.5 จัดเองใกล้เกิน: แจ้ง และเปลี่ยนค่าระยะห่างแล้วตรวจใหม่', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png'], 1);
    await page.click('#cut-all');
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline?.shapes);
    await setQty(0, 2);
    const ids = (await doc()).instances.map((i) => i.id);
    const place = async (id, x) => { await page.evaluate((i) => window.__studio.store.select([i]), id); await commit('#sel-x', String(x)); await commit('#sel-y', '20'); };
    await place(ids[0], 20); await place(ids[1], 72);
    assert.match(await page.textContent('#status-warn'), /ระยะห่างไม่ถึงค่าที่ตั้ง 2 ชิ้น/);
    await commit('#spacing-mm', '0.5');
    assert.doesNotMatch(await page.textContent('#status-warn'), /ระยะห่าง/);
    await commit('#spacing-mm', '3');
    await place(ids[1], 50);
    assert.match(await page.textContent('#status-warn'), /ชิ้นงานทับกัน 2 ชิ้น/);
  });

  await step('Bleed ขยาย Envelope และคำนวณรูปร่างใหม่', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png'], 1);
    await page.click('#cut-all');
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline?.shapes);
    await page.evaluate(() => window.__studio.store.select(window.__studio.store.doc.instances.map((i) => i.id)));
    await commit('#sel-bleed', '6');
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline.geometryVersion >= 2);
    const d = await doc();
    assert.equal(d.masters[0].bleedMm, 6);
    const w = d.masters[0].cutline.shapes.wide[0].filter((_, i) => i % 2 === 0);
    assert.ok(Math.max(...w) - Math.min(...w) > 57, 'ต้องกว้างกว่าเส้นตัด +2');
  });

  await step('ภาพพื้นทึบที่วางชิด: พื้นหลังไม่ทับชิ้นข้างเคียง', async () => {
    await newProject();
    await importAll(['oval-on-white-300dpi.jpg'], 1);
    await page.click('#cut-all');
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline?.shapes);
    await commit('#spacing-mm', '0');
    await setQty(0, 2);
    const ids = (await doc()).instances.map((i) => i.id);
    const put = async (id, x, y) => { await page.evaluate((i) => window.__studio.store.select([i]), id); await commit('#sel-x', String(x)); await commit('#sel-y', String(y)); };
    // วางให้กรอบภาพทับกันแต่วงรีไม่ทับ ชิ้นบนสุดคือชิ้นที่สอง
    await put(ids[0], 30, 60);
    await put(ids[1], 80, 92);
    await page.evaluate(() => window.__studio.store.select([]));
    assert.doesNotMatch(await page.textContent('#status-warn'), /ทับ/);
    await page.waitForTimeout(150);
    const pixel = await page.evaluate(([x, y]) => {
      const c = document.getElementById('canvas');
      const v = window.__studio.getView();
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d').getImageData(Math.round((x * v.scale + v.originX) * k), Math.round((y * v.scale + v.originY) * k), 1, 1).data];
    }, [81, 96]);
    assert.ok(pixel[0] < 80 && pixel[2] > 150, `ต้องเห็นสีน้ำเงินของชิ้นแรก ได้ ${pixel}`);
  });

  await step('บันทึกอัตโนมัติคืนหน้า Keep-out และรายงานครบ', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png'], 1);
    await setQty(0, 40);
    await page.click('#keepout-add');
    await clearToasts();
    await page.click('#layout-standard');
    await layoutDone('จัดเรียงครบ 40 ชิ้น');
    await page.waitForFunction(() => document.getElementById('status-save').textContent.includes('บันทึกในเบราว์เซอร์แล้ว'));
    await page.waitForTimeout(800);
    const before = await doc();
    assert.ok(before.pages.length > 1);
    await page.reload();
    await page.waitForFunction((n) => window.__studio.store.doc.pages.length === n, before.pages.length);
    assert.deepEqual(await doc(), before);
    assert.match(await page.textContent('#layout-report'), /วางแล้ว40 ชิ้น/);
  });

  await step('ลบหน้า: ชิ้นงานไม่หาย และ Undo คืนได้', async () => {
    await page.click('#page-next');
    const before = await doc();
    await page.click('#page-del');
    const d = await doc();
    assert.equal(d.pages.length, before.pages.length - 1);
    assert.equal(d.masters[0].quantity, 40);
    assert.match(await page.textContent('#status-warn'), /ยังไม่ได้วาง/);
    await page.click('#undo');
    assert.equal((await doc()).pages.length, before.pages.length);
  });

  const expected = pageErrors.filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(expected, []);
  console.log(`\nผ่าน ${passed} ขั้นตอน ไม่มี error จากหน้าเว็บ`);
} finally {
  await browser.close();
  server.kill();
}
