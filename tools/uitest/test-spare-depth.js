/* 子頁層數上限的說明（2026-10-29 user：拖到第三層要說為什麼，文字一行一句、Apple 中性簡潔）：
   收納匣裡接不上去的卡片滑過有淺色提示、硬拖到格子上放開跳通知、第二層子頁的「點擊動作」照列「進入子頁」但變灰掛「已達上限」。
   只改本機畫面、不存檔（攔 PUT）。用法：node test-spare-depth.js（BASE 預設本機 3177；USER_／PASS_ 換帳號） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'spare');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1512, height: 828 },
  });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.method() === 'PUT' ? req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : req.continue()));

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);
  await page.evaluate(async () => {
    const list = await api('GET', '/api/devices');
    await enterWorkspace(list.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || list[0]);
  });
  await sleep(1200);
  // 首頁「餐廳」→ 餐廳介紹（第一層，裡面「菜單入口」→ 菜單＝第二層）；未使用：活動（一層）、帶子頁（自己裡面還有一層）
  await page.evaluate(() => {
    wsAppVer = '1.60';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const txt = (t, color) => c({ content: 'Text', text: t, bgColor: color });
    const menu = { name: '菜單', node: txt('菜單內容', 4278223759), layout: 'Kiosk' };
    const intro = { name: '餐廳介紹', layout: 'Kiosk', node: { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '菜單入口', bgColor: 4283321390, tap: 'OpenSubPage', sub: menu }), b: txt('空格', 4284367411) } };
    const home = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '餐廳', bgColor: 4285353025, tap: 'OpenSubPage', sub: intro }), b: txt('住宿', 4279060385) };
    state.config.pages = [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: home }] }];
    state.config.spareSubs = [
      { id: 1, name: '活動', node: txt('活動', 4280693304), layout: 'Kiosk', from: '' },
      { id: 2, name: '帶子頁', node: c({ content: 'Text', text: '帶子頁', bgColor: 4285290667, tap: 'OpenSubPage', sub: { name: '內層', node: txt('內層', 4283215696), layout: 'Kiosk' } }), layout: 'Kiosk', from: '' },
    ];
    pageIndex = 0; subStack = []; spareEdit = 0; selected = null; render();
  });
  await sleep(500);

  const enter = async (text) => {
    await page.evaluate((t) => { const l = leavesOf(page().blocks[0].node).find((x) => x.cell.text === t); enterSub(l.path); }, text);
    await sleep(700);
  };
  const openTray = async () => { if (!(await page.evaluate(() => sparePopOpen))) { await page.click('#spareBtn'); await sleep(500); } };
  const card = (name) => page.evaluate((n) => {
    const it = [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.querySelector('.spare-item-name').textContent === n);
    const r = it.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2, off: it.classList.contains('is-off'), tip: it.dataset.tip || '', title: it.title };
  }, name);
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.b-toast').forEach((t) => t.remove()));
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.b-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.includes('無法加入子頁')));
  // 拖卡片：dropOn＝放大預覽裡要放的格子文字（null＝放在預覽外面）
  const dragCard = async (name, dropOn) => {
    await openTray();
    const from = await card(name);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y - 20, { steps: 4 });
    await sleep(450);
    const to = dropOn ? await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.drop-board .cell')].find((c) => c.textContent.includes(t));
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, dropOn) : { x: 8, y: 8 };
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await sleep(120);
    const mark = await page.evaluate(() => (document.querySelector('.drop-board .cell.is-drop-no') ? 'no' : document.querySelector('.drop-board .cell.is-drop-ok') ? 'ok' : ''));
    await page.mouse.up();
    await sleep(500);
    return mark;
  };
  const state_ = () => page.evaluate(() => ({ spares: spares().map((s) => s.name).join(), cells: leavesOf(page().blocks[0].node).map((l) => `${l.cell.text}:${l.cell.tap}`).join() }));

  console.log('1. 第一層子頁裡：裡面還有子頁的「帶子頁」接不上去，說是因為其中還有子頁');
  await enter('餐廳');
  await openTray();
  let a = await card('活動'), b = await card('帶子頁');
  ok(!a.off && !a.tip, '「活動」可以接（沒有提示）');
  ok(b.off && b.tip === '內含子頁，加入後會超過層數上限' && b.title === '', `「帶子頁」變淡、提示「${b.tip}」，不用瀏覽器內建提示`);
  await page.mouse.move(b.x, b.y); await sleep(700);
  const bubble = await page.evaluate(() => { const t = document.querySelector('.tip-bubble'); const p = document.getElementById('sparePop').getBoundingClientRect(); const r = t.getBoundingClientRect(); return { on: t.classList.contains('is-on'), text: t.textContent, outside: r.left >= p.right }; });
  ok(bubble.on && bubble.text === '內含子頁，加入後會超過層數上限' && bubble.outside, '滑過出現淺色提示，在清單外面');
  await shot('depth-tip');
  const before = await state_();
  await clearToasts();
  let m = await dragCard('帶子頁', '空格');
  let t = await toasts();
  ok(m === 'no' && t.length === 1 && (t[0] || '').replace(/ /g, '') === '無法加入子頁這個子頁內還有子頁，加入後會超過兩層。', `硬拖到格子上放開：跳通知（${t[0] || '沒有'}）`);
  ok(JSON.stringify(await state_()) === JSON.stringify(before), '版面沒有變');
  await shot('depth-toast');

  console.log('2. 第二層子頁裡：什麼子頁都接不上，說已達上限；放在預覽外面不跳通知');
  await clearToasts();
  await enter('菜單入口');
  await openTray();
  a = await card('活動');
  ok(a.off && a.tip === '已達子頁層數上限', `「活動」變淡、提示「${a.tip}」`);
  m = await dragCard('活動', '菜單內容');
  t = await toasts();
  ok(m === 'no' && t.length === 1 && (t[0] || '').replace(/ /g, '') === '無法加入子頁主頁之下最多可以有兩層子頁。', `放到格子上：跳通知（${t[0] || '沒有'}）`);
  await clearToasts();
  await dragCard('活動', null);
  ok((await toasts()).length === 0, '放在預覽外面＝放棄，不跳通知');
  await page.keyboard.press('Escape'); await sleep(300);

  console.log('3. 第二層子頁的「點擊動作」：「進入子頁」照列，變灰掛「已達上限」');
  await page.evaluate(() => { const l = leavesOf(page().blocks[0].node)[0]; selected = { bi: 0, path: l.path }; render(); });
  await sleep(400);
  const opt = await page.evaluate(() => {
    const s = [...document.querySelectorAll('#cellPanel select')].find((x) => [...x.options].some((o) => o.value === 'OpenWeb'));
    const o = s && [...s.options].find((x) => x.value === 'OpenSubPage');
    return o ? { disabled: o.disabled, badge: o.dataset.badge || '' } : null;
  });
  ok(opt && opt.disabled && opt.badge === '已達上限', `「進入子頁」變灰、小標「${opt && opt.badge}」`);

  console.log('4. 主頁：都接得上');
  await page.evaluate(() => { subStack = []; selected = null; render(); });
  await sleep(500);
  await openTray();
  a = await card('活動'); b = await card('帶子頁');
  ok(!a.off && !b.off && !a.tip && !b.tip, '主頁上兩個都能接，沒有提示');

  ok(!errs.length, '沒有 JS 錯誤' + (errs.length ? '：' + errs.join(' | ') : ''));
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
