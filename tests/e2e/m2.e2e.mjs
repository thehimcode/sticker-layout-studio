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
const PORT = 8124;
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

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.getElementById('paper-preset').options.length === 10);

  await step('AC-05 รูปดาวเว้า: เส้นตามรูปทรงจาก Worker จริง ไม่ใช่กรอบ', async () => {
    await importAll(['star-concave-300dpi.png'], 1);
    assert.match(await row(0).locator('.art-meta').textContent(), /ยังไม่มีเส้นตัด/);
    await openCut('star-concave');
    const c = await editorCut();
    assert.equal(c.offsetMm, 2);
    assert.equal(c.closedPaths.length, 1);
    assert.ok(c.closedPaths[0].length / 2 >= 10);
    const b = c.envelopeMm;
    assert.ok(Math.abs(polyArea(c.closedPaths[0])) < b.width * b.height * 0.75, 'ต้องน้อยกว่ากรอบครอบ');
    assert.equal(c.issues.filter((i) => i.severity === 'error').length, 0);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(shots, 'm2-1-star.png') });
    await apply();
    assert.ok((await doc()).masters[0].cutline);
    assert.match(await row(0).locator('.art-meta').textContent(), /เส้นตัด \+2 มม\., พร้อมใช้/);
    await page.click('#undo');
    assert.equal((await doc()).masters[0].cutline, null);
    await page.click('#redo');
  });

  await step('AC-06 วงกลมจริงผ่าน UI: Offset +2 มม. ระยะห่าง ≤0.1 มม.', async () => {
    await newProject();
    await importAll(['circle-50.8mm-300dpi.png'], 1);
    await openCut('circle');
    // Pillow วาดแบบรวมพิกเซลขอบ: กว้าง 541 px ศูนย์กลาง 300.5 px @300 DPI
    // รัศมีจริง 22.90 มม. ศูนย์กลางจริง 25.44 มม.
    const check = async (expected) => {
      for (const [x, y] of closePoints((await editorCut()).closedPaths)) near(Math.hypot(x - 25.44, y - 25.44), expected, 0.1, 'ระยะ');
    };
    await check(24.9);
    await commit('#cut-offset', '-1.5');
    await stable();
    await check(21.4);
    await commit('#cut-offset', 'abc');
    assert.equal(await page.inputValue('#cut-offset'), '-1.5');
    await commit('#cut-offset', '5');
    await stable();
    await check(27.9);
  });

  await step('เส้นตัดสี Magenta แสดงตรงตำแหน่งบนกระดาษ ซ่อนได้โดยข้อมูลไม่หาย', async () => {
    await apply();
    const [id] = await selected();
    await commit('#sel-x', '60'); await commit('#sel-y', '80');
    await page.evaluate(() => window.__studio.store.select([]));
    await page.waitForTimeout(120);
    const probe = (x, y) => page.evaluate(([mx, my]) => {
      const c = document.getElementById('canvas');
      const v = window.__studio.getView();
      const k = c.width / c.getBoundingClientRect().width;
      const px = Math.round((mx * v.scale + v.originX) * k);
      const py = Math.round((my * v.scale + v.originY) * k);
      const d = c.getContext('2d').getImageData(px - 3, py - 3, 7, 7).data;
      let best = 0;
      for (let i = 0; i < d.length; i += 4) best = Math.max(best, d[i] - d[i + 1]);
      return best;
    }, [x, y]);
    // จุดขวาสุดของเส้นตัด: 60 + 25.44 + 27.9
    assert.ok(await probe(113.34, 105.44) > 150, 'ต้องมีเส้น Magenta');
    assert.ok(await probe(105, 105.44) < 40, 'ด้านในต้องไม่มีเส้น');
    await page.click('#view-menu summary');
    await page.selectOption('#view-mode', 'artwork');
    await page.waitForTimeout(120);
    assert.ok(await probe(113.34, 105.44) < 40);
    assert.ok((await doc()).masters[0].cutline);
    await page.selectOption('#view-mode', 'both');
    await page.click('#view-menu summary');
    await page.evaluate((i) => window.__studio.store.select([i]), id);
  });

  await step('FR-08.3 ลากชิดขอบ: เส้นตัดที่ยื่นเกินภาพยังอยู่ใน Margin', async () => {
    const [id] = await selected();
    const t = (await inst(id)).transform;
    await dragMm({ x: t.xMm + 25, y: t.yMm + 25 }, { x: -80, y: 100 });
    const x = (await inst(id)).transform.xMm;
    near(x + 25.44 - 27.9, 5, 0.1, 'ขอบเส้นตัด');
  });

  await step('FR-04.8 แก้ขนาดแล้วคำนวณใหม่ Offset คงที่ และไม่เพิ่มขั้น Undo', async () => {
    const pastBefore = await page.evaluate(() => window.__studio.store.past.length);
    await commit('#sel-w', '101.6');
    await page.waitForFunction(() => {
      const c = window.__studio.store.doc.masters[0].cutline;
      return !c.stale && c.geometryVersion >= 2;
    });
    const d = await doc();
    const c = d.masters[0].cutline;
    near(d.masters[0].desiredSizeMm.heightMm, 101.6, 1e-6);
    for (const [x, y] of closePoints(c.closedPaths)) near(Math.hypot(x - 50.88, y - 50.88), 50.8, 0.2, 'รัศมีใหม่');
    assert.equal(await page.evaluate(() => window.__studio.store.past.length), pastBefore + 1);
    await page.click('#undo');
    assert.equal((await doc()).masters[0].desiredSizeMm.widthMm, 50.8);
    assert.equal((await doc()).masters[0].cutline.stale, false);
  });

  await step('เปลี่ยน Margin หลังมีเส้นตัด: แจ้งชิ้นที่เส้นตัดล้น', async () => {
    await commit('#margin-left', '8');
    assert.match(await page.textContent('#status-warn'), /นอกพื้นที่วางงาน 1 ชิ้น/);
    await page.click('#fix-outside');
    assert.equal(await page.textContent('#status-warn'), '');
    await page.click('#undo'); await page.click('#undo');
  });

  await step('AC-14 JPG ไม่มี Alpha: เลือกแยกสีเอง เลือกสีจากภาพได้ และเตือนว่าผลไม่แน่นอน', async () => {
    await newProject();
    await importAll(['oval-on-white-300dpi.jpg'], 1);
    await openCut('oval-on-white');
    assert.equal(await page.getAttribute('#cut-mask-color', 'aria-pressed'), 'true');
    assert.match(await issuesText(), /ผลขึ้นกับภาพ/);
    const c = await editorCut();
    // วงรี 600 × 400 px @300 DPI = 50.8 × 33.87 มม. + Offset 2 ด้านละ 2 มม.
    near(c.envelopeMm.width, 54.8, 0.4);
    near(c.envelopeMm.height, 37.87, 0.4);
    await page.click('#cut-mask-alpha');
    await stable();
    assert.match(await issuesText(), /ไม่มีพื้นที่โปร่งใส/);
    await page.click('#cut-mask-color');
    await stable();
    await page.waitForFunction(() => document.getElementById('cut-swatch').style.background.includes('255'));
    const box = await page.locator('#cut-canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__studio.editor.config.bgColor?.[2] > 150 && window.__studio.editor.config.bgColor[0] < 60);
    await stable();
    await page.click('#cut-color-auto');
    await stable();
    near((await editorCut()).envelopeMm.width, 54.8, 0.4);
    await page.screenshot({ path: join(shots, 'm2-2-jpg.png') });
  });

  await step('กด Delete ในตัวแก้ ไม่ลบชิ้นงานบนกระดาษ', async () => {
    await page.locator('#cut-canvas').focus();
    await page.keyboard.press('Delete');
    assert.equal((await doc()).instances.length, 1);
    await page.click('#cut-close');
    await page.waitForFunction(() => window.__studio.editor.master === null);
    assert.equal((await doc()).masters[0].cutline, null, 'ปิดโดยไม่กดใช้ต้องไม่เปลี่ยนเอกสาร');
    assert.equal(await page.evaluate(() => window.__studio.editor.service.worker), null, 'ต้องปิด Worker');
  });

  await step('ภาพจริงความละเอียดต่ำ: เส้นเป็น Bezier ปรับความมนได้ และเส้นตัดเก่ารุ่นก่อนคำนวณใหม่', async () => {
    await newProject();
    await importAll(['toon-lowres-133dpi.jpg'], 1);
    await openCut('toon-lowres');
    const a = await editorCut();
    assert.ok(a.curves[0].length > 8);
    assert.match(await page.textContent('#cut-stats'), /ช่วงโค้ง/);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(shots, 'm2-5-toon.png') });
    const box = await page.locator('#cut-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.85);
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(shots, 'm2-6-toon-zoom.png') });
    await setRange('#cut-corner', 5);
    await stable();
    const b = await editorCut();
    assert.notDeepEqual(b.closedPaths, a.closedPaths);
    await setRange('#cut-corner', 1.5);
    await stable();
    await apply();
    await page.evaluate(() => {
      const { store } = window.__studio;
      const m = store.doc.masters[0];
      const { curves, ...old } = m.cutline;
      store.amend({ ...store.doc, masters: [{ ...m, cutline: old }] });
    });
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline.curves);
    await page.locator('.artwork-list li', { hasText: 'toon-lowres' }).getByRole('button', { name: /^ตั้งค่าเส้นตัด/ }).click();
    await ready();
    await page.click('#cut-close');
  });

  await step('FR-04.3 โหมดขอบนอก รวมเส้นเดียว และทุกเส้น', async () => {
    await newProject();
    await importAll(['two-parts-300dpi.png', 'ring-hole-300dpi.png'], 2);
    await openCut('two-parts');
    assert.equal((await editorCut()).closedPaths.length, 2);
    await page.click('#cut-mode-merged');
    await stable();
    const merged = await editorCut();
    assert.equal(merged.closedPaths.length, 1);
    await page.screenshot({ path: join(shots, 'm2-3-merged.png') });
    await page.click('#cut-close');
    await openCut('ring-hole');
    assert.equal((await editorCut()).closedPaths.length, 1);
    await page.click('#cut-mode-all');
    await stable();
    assert.equal((await editorCut()).closedPaths.length, 2);
    await page.click('#cut-close');
  });

  await step('FR-04.6/07 แก้จุด: ย้าย เพิ่ม ลบ ย้อน ล้าง และตรวจเส้นไขว้', async () => {
    await openCut('ring-hole');
    await page.check('#cut-edit');
    const before = await editorCut();
    const pointer = () => page.evaluate(() => {
      const e = window.__studio.editor;
      const r = e.canvas.getBoundingClientRect();
      const s = e.toScreen(e.paths[0][0], e.paths[0][1]);
      return { x: r.left + s.x, y: r.top + s.y, n: e.paths[0].length / 2 };
    });
    const p = await pointer();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 30, { steps: 4 });
    await page.mouse.up();
    await stable();
    const moved = await editorCut();
    assert.notDeepEqual(moved.closedPaths, before.closedPaths);
    assert.equal(await page.isDisabled('#cut-alpha'), true, 'ค่าต้องล็อกเมื่อแก้จุด');

    await page.click('#cut-point-undo');
    await stable();
    assert.deepEqual((await editorCut()).closedPaths, before.closedPaths);
    assert.equal(await page.isDisabled('#cut-alpha'), false);

    const mid = await page.evaluate(() => {
      const e = window.__studio.editor;
      const r = e.canvas.getBoundingClientRect();
      const q = e.paths[0];
      const a = e.toScreen(q[0], q[1]); const b = e.toScreen(q[2], q[3]);
      return { x: r.left + (a.x + b.x) / 2, y: r.top + (a.y + b.y) / 2, n: q.length / 2 };
    });
    await page.mouse.dblclick(mid.x, mid.y);
    await stable();
    assert.equal(await page.evaluate(() => window.__studio.editor.paths[0].length / 2), mid.n + 1);
    await page.click('#cut-point-del');
    await stable();
    assert.equal(await page.evaluate(() => window.__studio.editor.paths[0].length / 2), mid.n);

    // ลากจุดข้ามเส้นตรงข้ามให้ Contour ไขว้กัน ต้องแจ้งเตือน
    const q = await pointer();
    const box = await page.locator('#cut-canvas').boundingBox();
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height - 40, { steps: 3 });
    await page.mouse.move(2 * (box.x + box.width / 2) - q.x + 60, 2 * (box.y + box.height / 2) - q.y, { steps: 3 });
    await page.mouse.up();
    await stable();
    assert.match(await issuesText(), /ซ้อนตัวเอง/);
    await page.click('#cut-point-reset');
    await stable();
    assert.equal(await page.isDisabled('#cut-alpha'), false);
    assert.doesNotMatch(await issuesText(), /ซ้อนตัวเอง/);
    await page.click('#cut-close');
  });

  await step('Offset ลบจนไม่เหลือเส้น: ใช้ไม่ได้และแจ้งชัด', async () => {
    await openCut('ring-hole');
    await commit('#cut-offset', '-40');
    await stable().catch(() => {});
    await page.waitForFunction(() => document.getElementById('cut-issues').textContent.includes('ไม่เหลือเส้นตัด'));
    assert.equal(await page.isDisabled('#cut-apply'), true);
    await page.click('#cut-close');
  });

  await step('NFR-05 ยกเลิกการคำนวณได้จริง และคำนวณใหม่ต่อได้', async () => {
    await openCut('ring-hole');
    await page.evaluate(() => {
      const e = window.__studio.editor;
      e.service.analyze = () => new Promise((resolve, reject) => {
        e.service.ensureWorker();
        e.service.pending.set(-1, { resolve, reject });
      });
      e.schedule('analyze', 0);
    });
    await page.waitForSelector('#cut-cancel-job', { state: 'visible' });
    assert.equal(await page.isDisabled('#cut-apply'), true);
    await page.click('#cut-cancel-job');
    await page.waitForFunction(() => document.getElementById('cut-job').hidden);
    assert.match(await issuesText(), /ยกเลิกการคำนวณแล้ว/);
    assert.equal(await page.evaluate(() => window.__studio.editor.service.worker), null);
    await page.evaluate(() => { delete window.__studio.editor.service.analyze; });
    await page.click('#cut-mode-outer');
    await stable();
    assert.equal((await editorCut()).closedPaths.length, 1);
    await page.click('#cut-close');
  });

  await step('ดาวน์โหลด SVG: Path จริงในกลุ่ม CUT_LINES ขนาดเป็น มม.', async () => {
    await openCut('ring-hole');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#cut-svg')]);
    assert.equal(download.suggestedFilename(), 'ring-hole-300dpi-cutline.svg');
    const svg = readFileSync(await download.path(), 'utf8');
    assert.match(svg, /<g id="CUT_LINES"/);
    assert.match(svg, /<path d="M[^"]+Z"/);
    assert.match(svg, / C[\d.-]+ /);
    assert.doesNotMatch(svg, / L[\d.-]/);
    assert.match(svg, /width="[\d.]+mm"/);
    assert.doesNotMatch(svg, /<image|<rect/);
    await page.click('#cut-close');
  });

  await step('สร้างเส้นตัดทุกแบบ และบันทึกอัตโนมัติคืนเส้นตัดครบ', async () => {
    await page.click('#cut-all');
    await page.waitForFunction(() => window.__studio.store.doc.masters.every((m) => m.cutline));
    assert.match(await toastText(), /สร้างเส้นตัดครบ 2 แบบ/);
    await page.click('#undo');
    assert.equal((await doc()).masters.every((m) => !m.cutline), true, 'Undo ทีเดียวทั้งชุด');
    await page.click('#redo');
    await page.waitForFunction(() => document.getElementById('status-save').textContent.includes('บันทึกในเบราว์เซอร์แล้ว'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, 'm2-4-sheet.png') });
    const before = await doc();
    await page.reload();
    await page.waitForFunction((n) => window.__studio.store.doc.masters.length === n, before.masters.length);
    assert.deepEqual(await doc(), before);
    await openCut('ring-hole');
    assert.deepEqual((await editorCut()).closedPaths, before.masters[1].cutline.closedPaths);
    await page.click('#cut-close');
  });

  await step('ลบเส้นตัดจากตัวแก้', async () => {
    await page.locator('.artwork-list li', { hasText: 'ring-hole' }).getByRole('button', { name: /^ตั้งค่าเส้นตัด/ }).click();
    await page.click('#cut-remove');
    assert.equal((await doc()).masters[1].cutline, null);
    await page.click('#undo');
    assert.ok((await doc()).masters[1].cutline);
  });

  const expected = pageErrors.filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(expected, []);
  console.log(`\nผ่าน ${passed} ขั้นตอน ไม่มี error จากหน้าเว็บ`);
} finally {
  await browser.close();
  server.kill();
}
