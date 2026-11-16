// ทดสอบ M4 ในเบราว์เซอร์จริง: node tests/e2e/m4.e2e.mjs (ต้องมี Playwright และ Chromium/Chrome)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readDpi } from '../../src/core/image-meta.js';

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
const commit = async (id, value) => { await page.fill(id, value); await page.press(id, 'Enter'); };
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b}`);
const toastText = async () => (await page.locator('.toast').allTextContents()).join('|');
const clearToasts = () => page.evaluate(() => document.getElementById('toasts').replaceChildren());

const toScreen = async (x, y) => {
  const box = await page.locator('#canvas').boundingBox();
  const v = await page.evaluate(() => window.__studio.getView());
  return { x: box.x + v.originX + x * v.scale, y: box.y + v.originY + y * v.scale };
};
async function dragMm(from, to) {
  const a = await toScreen(from.x, from.y);
  const b = await toScreen(to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}
/** สีที่จอ ณ พิกัดกระดาษ: คืนค่า magenta (r-g สูงสุด) และความมืด (255-max) ในช่อง 7×7 px */
const probe = (x, y) => page.evaluate(([mx, my]) => {
  const c = document.getElementById('canvas');
  const v = window.__studio.getView();
  const k = c.width / c.getBoundingClientRect().width;
  const px = Math.round((mx * v.scale + v.originX) * k);
  const py = Math.round((my * v.scale + v.originY) * k);
  const d = c.getContext('2d').getImageData(px - 3, py - 3, 7, 7).data;
  let magenta = 0;
  let dark = 0;
  let colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    magenta = Math.max(magenta, Math.min(d[i], d[i + 2]) - d[i + 1]);
    dark = Math.max(dark, 255 - Math.max(d[i], d[i + 1], d[i + 2]));
    colored = Math.max(colored, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
  }
  return { magenta, dark, colored };
}, [x, y]);

/** แตก Zip แบบ Store (ไฟล์จากโปรแกรมนี้) */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    out.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

async function runExport() {
  const wait = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#exp-run');
  const download = await wait;
  const bytes = new Uint8Array(readFileSync(await download.path()));
  await page.waitForFunction(() => !window.__studio.exportDialog.busy);
  return { name: download.suggestedFilename(), bytes };
}

/** วิเคราะห์ภาพที่ส่งออกในเบราว์เซอร์ (ถอดรหัสด้วยตัวถอดรหัสของเบราว์เซอร์ ไม่ใช่โค้ดโปรแกรม) */
const analyze = (bytes, type, script) => page.evaluate(async ([b64, mime, fn]) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  // eslint-disable-next-line no-new-func
  return new Function('img', fn)(img);
}, [Buffer.from(bytes).toString('base64'), type, script]);

async function setExport(opts) {
  for (const [id, value] of Object.entries(opts)) {
    if (typeof value === 'boolean') await page.setChecked(id, value);
    else await page.selectOption(id, value);
  }
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.getElementById('paper-preset').options.length === 10);
  await page.evaluate(() => localStorage.clear());

  await step('แถบเครื่องมือไม่ทำให้หน้าล้นแนวนอนที่จอ 1366, 1280 และ 1024', async () => {
    for (const width of [1366, 1280, 1024]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(100);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${width}px ล้น ${over}px`);
    }
    await page.setViewportSize({ width: 1360, height: 860 });
  });

  await step('FR-06 โหมดแสดงผล: ภาพ+เส้นตัด, ภาพอย่างเดียว, เส้นตัดอย่างเดียว ข้อมูลไม่หาย', async () => {
    await page.setInputFiles('#file-input', [data('circle-50.8mm-300dpi.png')]);
    await page.waitForFunction(() => window.__studio.store.doc.masters.length === 1);
    await page.click('#cut-all');
    await page.waitForFunction(() => window.__studio.store.doc.masters[0].cutline?.shapes);
    await commit('#sel-x', '40');
    await commit('#sel-y', '60');
    await page.evaluate(() => window.__studio.store.select([]));
    const cut = await doc();
    const env = cut.masters[0].cutline.envelopeMm;
    const right = { x: 40 + env.x + env.width, y: 60 + 25.4 };
    const center = { x: 65.4, y: 85.4 };
    await page.waitForTimeout(150);
    assert.ok((await probe(right.x, right.y)).magenta > 120, 'โหมดรวมต้องเห็นเส้นตัด');
    assert.ok((await probe(center.x, center.y)).colored > 60, 'โหมดรวมต้องเห็นภาพ');
    await page.click('#view-menu summary');
    await page.selectOption('#view-mode', 'artwork');
    assert.equal(await page.textContent('#view-menu-label'), 'มุมมอง: ภาพอย่างเดียว');
    await page.click('#view-menu summary');
    await page.waitForTimeout(150);
    assert.ok((await probe(right.x, right.y)).magenta < 40);
    assert.ok((await probe(center.x, center.y)).colored > 60);
    await page.click('#view-menu summary');
    await page.selectOption('#view-mode', 'cutlines');
    await page.click('#view-menu summary');
    await page.waitForTimeout(150);
    assert.ok((await probe(right.x, right.y)).magenta > 120);
    assert.ok((await probe(center.x, center.y)).colored < 20, 'โหมดเส้นตัดต้องไม่มีภาพ');
    await page.screenshot({ path: join(shots, 'm4-1-cutlines-only.png') });
    await page.click('#view-menu summary');
    await page.selectOption('#view-mode', 'both');
    await page.click('#view-menu summary');
    assert.ok((await doc()).masters[0].cutline.closedPaths.length, 'ข้อมูลเส้นตัดต้องยังอยู่');
  });

  await step('AC-08 วงกลม 5 จุด: ตั้งค่า, เปลี่ยนขนาด, ลากย้าย, ล็อก, ซ่อนได้', async () => {
    await page.locator('#marks-section summary').click();
    await page.selectOption('#mark-profile', 'microcut30q-5dots');
    assert.match(await page.textContent('#mark-profile-note'), /SignMaster.*ยังไม่ได้ทดสอบการอ่านมาร์คกับเครื่องจริง/);
    assert.equal(await page.inputValue('#mark-t-bottom'), '40');
    await commit('#mark-t-size', '6');
    await commit('#mark-t-left', '7');
    await commit('#mark-t-top', '7');
    await commit('#mark-t-bottom', '20');
    await page.click('#mark-apply');
    let d = await doc();
    assert.equal(d.marks.length, 6, '5 จุด + สามเหลี่ยมบอกทิศ');
    assert.ok(d.marks.filter((m) => m.shape === 'circle').every((m) => m.widthMm === 6));
    near(d.marks[0].xMm, 7, 1e-9, 'ขอบซ้ายวัดถึงจุดกึ่งกลาง');
    near(d.marks[4].yMm, 297 - 20, 1e-9, 'ขอบล่างวัดถึงจุดกึ่งกลาง');
    assert.match(await page.textContent('#mark-summary'), /MicroCut 30Q - Custom 5 Dots \(Unverified\) 5 จุด \+ สามเหลี่ยมบอกทิศ/);
    await page.waitForTimeout(120);
    assert.ok((await probe(7, 7)).dark > 200, 'มาร์คต้องแสดงเป็นจุดดำ');

    // คลิกเลือกแล้วลากมาร์คที่ 2
    const m2 = d.marks[1];
    await dragMm({ x: m2.xMm, y: m2.yMm }, { x: m2.xMm + 10, y: m2.yMm + 5 });
    d = await doc();
    near(d.marks[1].xMm, m2.xMm + 10, 0.3, 'ลากย้าย X');
    near(d.marks[1].yMm, m2.yMm + 5, 0.3, 'ลากย้าย Y');
    assert.equal(await page.isVisible('#mark-fields'), true);
    await commit('#mark-w', '8');
    await commit('#mark-h', '8');
    await commit('#mark-x', '40');
    d = await doc();
    assert.equal(d.marks[1].widthMm, 8);
    assert.equal(d.marks[1].xMm, 40);
    await page.check('#mark-lock');
    const before = (await doc()).marks[1];
    await dragMm({ x: before.xMm, y: before.yMm }, { x: before.xMm + 20, y: before.yMm + 20 });
    assert.deepEqual((await doc()).marks[1], before, 'มาร์คที่ล็อกต้องไม่ขยับ');
    assert.match(await toastText(), /ล็อกอยู่/);
    assert.equal(await page.isDisabled('#mark-x'), true);
    await page.uncheck('#mark-lock');
    await page.click('[data-mark-align="top"]');
    near((await doc()).marks[1].yMm, 7, 1e-6, 'จัดชิดบนตามขอบบนของชุดมาร์ค');
    await page.screenshot({ path: join(shots, 'm4-2-marks.png') });

    await page.click('#view-menu summary');
    await page.uncheck('#toggle-marks');
    await page.click('#view-menu summary');
    await page.waitForTimeout(120);
    assert.ok((await probe(7, 7)).dark < 30, 'ซ่อนมาร์คแล้วไม่เห็น');
    assert.equal((await doc()).marks.length, 6, 'ซ่อนไม่ลบข้อมูล');
    await page.click('#view-menu summary');
    await page.check('#toggle-marks');
    await page.click('#view-menu summary');
  });

  await step('AC-08 บันทึก Profile แล้วนำกลับมาใช้หลังรีโหลด', async () => {
    await page.fill('#mark-profile-name', 'ร้านทดสอบ');
    await page.click('#mark-save-profile');
    const saved = (await doc()).marks;
    await page.click('#mark-clear');
    assert.equal((await doc()).marks.length, 0);
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('paper-preset').options.length === 10);
    await page.waitForFunction(() => window.__studio.store.doc.masters.length === 1);
    const option = page.locator('#mark-profile option', { hasText: 'ร้านทดสอบ (ของฉัน)' });
    assert.equal(await option.count(), 1);
    await page.locator('#marks-section summary').click();
    await page.selectOption('#mark-profile', await option.getAttribute('value'));
    assert.equal(await page.isHidden('#mark-template'), true);
    await page.click('#mark-apply');
    const restored = (await doc()).marks;
    assert.deepEqual(restored.map(({ id, ...m }) => m), saved.map(({ id, ...m }) => m));
  });

  await step('FR-10.7 พื้นที่สงวนของมาร์คกันการจัดเรียงอัตโนมัติ', async () => {
    await page.locator('.artwork-list li').first().getByRole('textbox').fill('6');
    await page.locator('.artwork-list li').first().getByRole('textbox').press('Enter');
    await page.click('#layout-nest');
    await page.waitForFunction(() => document.getElementById('layout-job').hidden
      && [...document.querySelectorAll('.toast')].some((e) => e.textContent.includes('จัดเรียงครบ')), null, { timeout: 90000 });
    const hit = await page.evaluate(async () => {
      const { validateDocument } = await import('/src/core/validate.js');
      return validateDocument(window.__studio.store.doc).inKeepout.size;
    });
    assert.equal(hit, 0);
    await page.screenshot({ path: join(shots, 'm4-3-nest-marks.png') });
  });

  let exported;
  await step('AC-10 ส่งออก: PNG/JPG/PDF ไม่มีเส้นตัด มีมาร์ค, Cut SVG มี Path จริง และไม่สั่งตัดมาร์ค', async () => {
    await page.click('#export-open');
    await setExport({
      '#exp-png': true, '#exp-jpg': true, '#exp-pdf': true, '#exp-cut': true, '#exp-combined': true, '#exp-marks': true, '#exp-dpi': '300', '#exp-png-bg': 'transparent', '#exp-cut-marks': 'reference',
    });
    const pre = await page.textContent('#exp-preflight');
    assert.match(pre, /ยังไม่ยืนยันกับเครื่องตัดจริง/);
    assert.equal(await page.locator('#exp-preflight li.error').count(), 0, pre);
    assert.match(pre, /2480 × 3508 px/);
    await page.screenshot({ path: join(shots, 'm4-4-export.png') });
    const { name, bytes } = await runExport();
    assert.match(name, /\.zip$/);
    const files = unzip(bytes);
    const base = name.replace(/\.zip$/, '');
    assert.deepEqual([...files.keys()].sort(), [
      `${base}_p01_combined.svg`, `${base}_p01_cut.svg`, `${base}_p01_print-marks.jpg`, `${base}_p01_print-marks.png`, `${base}_print-marks.pdf`,
    ].sort());
    exported = { base, files };
    const png = files.get(`${base}_p01_print-marks.png`);
    near(readDpi(png, 'image/png'), 300, 0.05, 'PNG DPI');
    near(readDpi(files.get(`${base}_p01_print-marks.jpg`), 'image/jpeg'), 300, 0, 'JPG DPI');
    const d = await doc();
    const stats = await analyze(png, 'image/png', `
      const { width, height, data } = img;
      let magenta = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 200 && data[i] > 200 && data[i + 2] > 200 && data[i + 1] < 90) magenta += 1;
      }
      const k = width / 210;
      const at = (x, y) => { const i = (Math.round(y * k) * width + Math.round(x * k)) * 4; return [...data.slice(i, i + 4)]; };
      return { width, height, magenta, marks: ${JSON.stringify(d.marks.map((m) => [m.xMm, m.yMm]))}.map(([x, y]) => at(x, y)), corner: at(100, 290) };
    `);
    assert.equal(stats.width, 2480);
    assert.equal(stats.height, 3508);
    assert.equal(stats.magenta, 0, 'ไฟล์พิมพ์ต้องไม่มีเส้นตัด');
    for (const px of stats.marks) assert.ok(px[3] > 250 && px[0] < 30, `ต้องมีมาร์คดำ ${px}`);
    assert.equal(stats.corner[3], 0, 'พื้นหลัง PNG โปร่งใส');

    const cut = new TextDecoder().decode(files.get(`${base}_p01_cut.svg`));
    assert.match(cut, /width="210mm" height="297mm" viewBox="0 0 210 297"/);
    const cutGroup = cut.slice(cut.indexOf('<g id="CUT_LINES"'), cut.indexOf('</g>'));
    assert.equal((cutGroup.match(/<path /g) ?? []).length, 6);
    assert.match(cutGroup, / d="M[\d.]+ [\d.]+ C/);
    const ref = cut.slice(cut.indexOf('<g id="REG_MARKS_REFERENCE_NOT_CUT"'));
    assert.match(ref, /NOT A CUT LINE/);
    assert.doesNotMatch(ref, /stroke="#/);
    assert.equal((ref.match(/<path /g) ?? []).length, 6); // 5 จุด + สามเหลี่ยม

    const pdf = Buffer.from(files.get(`${base}_print-marks.pdf`)).toString('latin1');
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /\/MediaBox \[0 0 595\.2756 841\.8898\]/);
    assert.match(pdf, /\/Width 2480 \/Height 3508/);
    const combined = new TextDecoder().decode(files.get(`${base}_p01_combined.svg`));
    assert.ok(combined.indexOf('id="ARTWORK"') < combined.indexOf('id="CUT_LINES"') && combined.indexOf('id="CUT_LINES"') < combined.indexOf('id="REG_MARKS"'));
    for (const [n, b] of files) writeFileSync(join(shots, n), b);
  });

  await step('AC-11 ตำแหน่งเส้นตัดใน SVG ตรงกับภาพในไฟล์พิมพ์ ≤0.1 มม. ทุกชิ้น', async () => {
    const { base, files } = exported;
    const d = await doc();
    const cut = new TextDecoder().decode(files.get(`${base}_p01_cut.svg`));
    // จุดศูนย์ถ่วงพื้นที่ของเส้นตัด: สุ่มจุดบน Bezier ทุกช่วง แล้วคำนวณพื้นที่และ Centroid ของ Polygon
    const paths = [...cut.matchAll(/<path id="cut-([^"]+)" d="([^"]+)"/g)].map((m) => {
      const segs = m[2].split(/(?=[MCZ])/).map((s) => s.trim()).filter((s) => s && s !== 'Z');
      const pts = [];
      let cur = null;
      for (const s of segs) {
        const v = s.slice(1).trim().split(/\s+/).map(Number);
        if (s[0] === 'M') { cur = v; pts.push(v); continue; }
        for (let k = 1; k <= 16; k += 1) {
          const t = k / 16; const u = 1 - t;
          pts.push([0, 1].map((j) => u * u * u * cur[j] + 3 * u * u * t * v[j] + 3 * u * t * t * v[2 + j] + t * t * t * v[4 + j]));
        }
        cur = v.slice(4);
      }
      let a = 0; let cx = 0; let cy = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const [x0, y0] = pts[i]; const [x1, y1] = pts[(i + 1) % pts.length];
        const c = x0 * y1 - x1 * y0;
        a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
      }
      a /= 2;
      return { id: m[1], cx: cx / (6 * a), cy: cy / (6 * a), r: Math.sqrt(Math.abs(a) / Math.PI) };
    });
    assert.equal(paths.length, 6);
    // นับเฉพาะพิกเซลในวงกลมรอบเส้นตัดของชิ้นนั้น ไม่ให้มุมของชิ้นข้างเคียงแนวทแยงปนเข้ามา
    const boxes = paths.map((p) => [p.cx, p.cy, p.r + 0.5]);
    const art = await analyze(files.get(`${base}_p01_print-marks.png`), 'image/png', `
      const { width, data } = img;
      const k = width / 210;
      return ${JSON.stringify(boxes)}.map(([ccx, ccy, rr]) => {
        const x0 = ccx - rr; const y0 = ccy - rr; const x1 = ccx + rr; const y1 = ccy + rr;
        let sum = 0; let sx = 0; let sy = 0;
        for (let y = Math.floor(y0 * k); y < Math.ceil(y1 * k); y += 1) {
          for (let x = Math.floor(x0 * k); x < Math.ceil(x1 * k); x += 1) {
            const i = (y * width + x) * 4;
            const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
            const a = data[i + 3] / 255;
            if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue; // ข้ามมาร์คดำ เอาเฉพาะภาพสี
            if (Math.hypot((x + 0.5) / k - ccx, (y + 0.5) / k - ccy) > rr) continue;
            sum += a; sx += a * (x + 0.5); sy += a * (y + 0.5);
          }
        }
        return { cx: sx / sum / k, cy: sy / sum / k, r: Math.sqrt(sum / Math.PI) / k };
      });
    `);
    let worst = 0;
    for (const [i, p] of paths.entries()) {
      worst = Math.max(worst, Math.hypot(p.cx - art[i].cx, p.cy - art[i].cy));
      near(p.cx, art[i].cx, 0.1, `ชิ้น ${i} X`);
      near(p.cy, art[i].cy, 0.1, `ชิ้น ${i} Y`);
      near(p.r - art[i].r, d.masters[0].cutlineConfig.offsetMm, 0.15, `ชิ้น ${i} Offset`);
    }
    console.log(`   ระยะคลาดเคลื่อนสูงสุดระหว่างภาพกับเส้นตัด ${worst.toFixed(3)} มม.`);
  });

  await step('FR-07.8 Preflight: งานทับกันต้องยืนยันก่อนส่งออก', async () => {
    await page.click('#exp-close');
    await page.evaluate(() => {
      const { store } = window.__studio;
      const [a, b] = store.doc.instances;
      store.commit({ ...store.doc, instances: store.doc.instances.map((i) => (i.id === b.id ? { ...i, pageId: a.pageId, transform: { ...a.transform } } : i)) });
    });
    await page.click('#export-open');
    assert.ok(await page.locator('#exp-preflight li.error', { hasText: 'ทับกัน' }).count() > 0);
    assert.equal(await page.isDisabled('#exp-run'), true);
    await page.check('#exp-override');
    assert.equal(await page.isDisabled('#exp-run'), false);
    await page.click('#exp-close');
    await page.click('#undo');
  });

  await step('Bleed พิมพ์จริง: ยืดขอบภาพออก 2 มม. นอกนั้นโปร่งใส', async () => {
    await page.click('#new-doc');
    await page.click('#confirm-new button[value=ok]');
    await page.waitForFunction(() => window.__studio.store.doc.masters.length === 0);
    await page.setInputFiles('#file-input', [data('label-127x63.5mm-200dpi.jpg')]);
    await page.waitForFunction(() => window.__studio.store.doc.masters.length === 1);
    await commit('#sel-bleed', '2');
    await commit('#sel-x', '40');
    await commit('#sel-y', '50');
    await page.click('#export-open');
    await setExport({
      '#exp-png': true, '#exp-jpg': false, '#exp-pdf': false, '#exp-cut': false, '#exp-combined': false, '#exp-marks': false, '#exp-dpi': '300', '#exp-png-bg': 'transparent',
    });
    const { name, bytes } = await runExport();
    assert.match(name, /_p01_print\.png$/);
    const px = await analyze(bytes, 'image/png', `
      const { width, data } = img;
      const k = width / 210;
      const at = (x, y) => { const i = (Math.floor(y * k) * width + Math.floor(x * k)) * 4; return [...data.slice(i, i + 4)]; };
      return { inside: at(40.5, 80), bleed: at(38.7, 80), outside: at(37.5, 80), corner: at(38.5, 48.5) };
    `);
    assert.equal(px.bleed[3], 255, 'ในระยะ Bleed ต้องมีสี');
    assert.ok(px.bleed.slice(0, 3).every((v, i) => Math.abs(v - px.inside[i]) < 60), `สี Bleed ต้องใกล้สีขอบภาพ ${px.bleed} ${px.inside}`);
    assert.equal(px.corner[3], 255, 'มุม Bleed ต้องมีสี');
    assert.equal(px.outside[3], 0, 'นอก Bleed ต้องโปร่งใส');
    await page.click('#exp-close');
  });

  await step('FR-07.6 หลายหน้าแยกไฟล์ตามเลขหน้าใน Zip และยกเลิกการส่งออกได้ (NFR-05)', async () => {
    await page.locator('.artwork-list li').first().getByRole('textbox').fill('6');
    await page.locator('.artwork-list li').first().getByRole('textbox').press('Enter');
    await page.check('#layout-pages');
    await page.click('#layout-standard');
    await page.waitForFunction(() => window.__studio.store.doc.pages.length === 2, null, { timeout: 60000 });
    await page.click('#export-open');
    await setExport({ '#exp-png': false, '#exp-cut': true });
    const { name, bytes } = await runExport();
    const files = unzip(bytes);
    const base = name.replace(/\.zip$/, '');
    assert.deepEqual([...files.keys()], [`${base}_p01_cut.svg`, `${base}_p02_cut.svg`]);
    const d = await doc();
    const perPage = d.pages.map((p) => d.instances.filter((i) => i.pageId === p.id).length);
    [...files.values()].forEach((b, i) => {
      const svg = new TextDecoder().decode(b);
      assert.equal((svg.match(/<path id="cut-/g) ?? []).length, 0, 'ภาพ JPG ยังไม่มีเส้นตัด');
      assert.match(svg, /viewBox="0 0 210 297"/);
      assert.ok(perPage[i] > 0);
    });

    await clearToasts();
    await setExport({ '#exp-png': true, '#exp-dpi': '600' });
    let downloaded = false;
    page.once('download', () => { downloaded = true; });
    await page.click('#exp-run');
    await page.click('#exp-cancel');
    await page.waitForFunction(() => !window.__studio.exportDialog.busy, null, { timeout: 120000 });
    assert.match(await toastText(), /ยกเลิกการส่งออกแล้ว/);
    await page.waitForTimeout(300);
    assert.equal(downloaded, false);
    await page.click('#exp-close');
  });

  assert.deepEqual(pageErrors, []);
  console.log(`\nผ่าน ${passed} ขั้นตอน ไม่มี error จากหน้าเว็บ`);
} catch (error) {
  await page.screenshot({ path: join(shots, 'm4-failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
