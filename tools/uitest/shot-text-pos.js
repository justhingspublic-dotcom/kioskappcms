/* 文字九宮格位置（2026-10-20）：共用版面模式開一頁 3×3 文字格（各一個位置），截畫布＋側邊欄選擇器（light/dark）。不寫 DB。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3177/';
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'text-pos');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1512,828'], defaultViewport: { width: 1512, height: 828 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const names = TEXT_POS;
    const c = (i) => Object.assign(DEFAULT_CELL(), { content: 'Text', text: names[i][1] + '\n第二行比較長', txtPos: names[i][0], bgColor: i % 2 ? 4280693304 : 4281545523 });
    const sp = (dir, ratio, a, b) => ({ t: 'split', dir, ratio, a, b });
    const row = (k) => sp('Vertical', 1 / 3, c(k), sp('Vertical', 0.5, c(k + 1), c(k + 2)));
    const tree = sp('Horizontal', 1 / 3, row(0), sp('Horizontal', 0.5, row(3), row(6)));
    const L = { id: 9999, name: '文字位置', pages: [{ id: 1, name: '文字位置', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString() };
    (shared.layouts ||= []).push(L); // 只放記憶體，編輯器靠 id 找版面
    enterSharedLayoutEditor(L);
  });
  await sleep(800);
  // 選右下那格 → 側邊欄應出現九宮格且「右下」亮
  const cells = await page.$$('#canvas .cell');
  console.log('cells', cells.length);
  await cells[cells.length - 1].click(); await sleep(500);
  const state = await page.evaluate(() => {
    const g = document.querySelector('.pos-grid');
    const texts = [...document.querySelectorAll('#canvas .pv-text')].map((t) => {
      const r = t.getBoundingClientRect(), p = t.parentElement.getBoundingClientRect();
      return `${t.dataset.pos || 'Center'}: L${Math.round(r.left - p.left)} R${Math.round(p.right - r.right)} T${Math.round(r.top - p.top)} B${Math.round(p.bottom - r.bottom)} ${getComputedStyle(t).textAlign}`;
    });
    return { grid: !!g, active: g && g.querySelector('.active')?.title, texts };
  });
  console.log(JSON.stringify(state, null, 1));
  await shot('01-light');
  // 點選擇器的「左上」→ 畫布那格應該跑到左上
  await page.evaluate(() => document.querySelector('.pos-grid').scrollIntoView({ block: 'center' })); await sleep(300);
  await page.click('.pos-grid .pos-cell[title="左上"]'); await sleep(400);
  console.log('after pick', await page.evaluate(() => document.querySelector('.cell.selected .pv-text')?.dataset.pos));
  await shot('02-picked-topstart');
  await page.evaluate(() => window.setColorMode('dark', false)); await sleep(400);
  await shot('03-dark');
  await browser.close();
  console.log(errs);
})();
