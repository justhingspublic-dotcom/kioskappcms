/* 子頁（樹狀展示，2026-10-20）：後台編輯器設子頁、進子頁、子頁裡分割、再往下一層、路徑點回、改掉動作可復原；
   播放頁攔 API 餵假設定，點格子進子頁、返回、首頁、第二層。
   用法：node test-subpage.js（BASE 預設本機 3177；USER_／PASS_ 換帳號） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'subpage');
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
  // 這台 Windows 關了動畫效果，Chrome 會回報「減少動態效果」→ 轉場直接跳過；模擬一般使用者的設定
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // 寫入一律攔下（不能寫到真的共用設定或機器）
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.method() === 'PUT' ? req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : req.continue()));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });

  // ---------- 後台編輯器 ----------
  console.log('後台編輯器');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const tree = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '餐廳', bgColor: 4285353025 }), b: c({ content: 'Text', text: '住宿', bgColor: 4279060385 }) };
    const L = { id: 9998, name: '子頁測試', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString() };
    (shared.layouts ||= []).push(L);
    enterSharedLayoutEditor(L);
  });
  await sleep(800);
  const tapSelect = () => page.evaluateHandle(() => [...document.querySelectorAll('#cellPanel select')].find((s) => [...s.options].some((o) => o.value === 'OpenWeb')));
  const setTap = async (v) => {
    const s = await tapSelect();
    await s.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('change')); }, v);
    await sleep(350);
  };
  // 新增子頁取名視窗（2026-10-27 起選「進入子頁」先取名）：打字、按「建立」＝直接進子頁
  const nameDialog = async (name) => {
    await page.waitForSelector('.b-modal.is-alert input', { visible: true });
    await page.type('.b-modal.is-alert input', name);
    await page.evaluate(() => [...document.querySelectorAll('.b-modal.is-alert .b-alert-foot button')].pop().click());
    await sleep(700);
  };
  const info = () => page.evaluate(() => ({
    // 畫布標頭：主頁＝[主頁名]；子頁＝路徑每一段（不含 ›）
    trail: document.querySelector('#pageHead .ph-lead:not(:disabled)')
      ? [...document.querySelectorAll('#pageHead .ph-sub > :not(.ph-sep)')].map((x) => x.textContent.trim())
      : [document.querySelector('#pageHead .ph-title')?.textContent || ''],
    trailHidden: !document.querySelector('#pageHead .ph-lead:not(:disabled)'), // 在主頁（沒有返回鈕）
    headTitle: document.querySelector('#pageHead .ph-title')?.textContent || null,
    headChip: document.querySelector('#pageHead .ph-chip')?.textContent.replace('layers', '').trim() || null,
    barH: document.querySelector('#canvas .cv-subbar')?.getBoundingClientRect().height || 0,
    bar: document.querySelector('#canvas .cv-subbar .cv-subbar-title')?.textContent || null,
    cells: document.querySelectorAll('#canvas .cell').length,
    chips: [...document.querySelectorAll('#canvas .cell')].filter((c) => c.querySelector('.pv-sub-pill')).map((c) => c.dataset.path),
    head: document.querySelector('#cellPanel .panel-head h3')?.textContent || null,
    size: document.querySelector('#cellPanel .panel-size')?.textContent || null,
    hasSubOpt: [...document.querySelectorAll('#cellPanel select')].some((s) => [...s.options].some((o) => o.value === 'OpenSubPage' && !o.disabled)), // 第 3 層照列但變灰（2026-10-29）
  }));

  let s = await info();
  ok(s.trailHidden && s.headTitle === '首頁' && !s.headChip && !s.bar && s.cells === 2, '主頁：標頭只有主頁名稱、沒有頂欄、2 格');
  await page.click('#canvas .cell[data-path="a"]'); await sleep(300);
  ok((await info()).hasSubOpt, '點擊動作有「進入子頁」');
  await setTap('OpenSubPage');
  ok(await page.evaluate(() => document.querySelector('.b-modal.is-alert .b-alert-title')?.textContent === '新增子頁'), '選了之後跳出取名視窗');
  await nameDialog('餐廳介紹');
  ok((await info()).bar === '餐廳介紹', '按「建立」直接進子頁');
  await page.evaluate(() => { leaveSubTo(0); }); await sleep(600);
  ok(await page.$('#cellPanel .sub-enter-btn') !== null, '有「編輯子頁」鈕');
  s = await info();
  ok(s.chips.length === 1 && s.chips[0] === 'a', '畫布上那一格有「子頁名稱 ›」');
  ok(s.headChip === '1 個子頁', `主頁標頭顯示子頁數（${s.headChip}）`);
  await shot('01-main-with-chip');

  // 轉場：按下去的當下畫布旁邊有一份舊畫面陪著滑走，動畫完就拿掉
  await page.click('#cellPanel .sub-enter-btn'); await sleep(200);
  ok(await page.evaluate(() => !!document.querySelector('.canvas-frame > .cv-nav-ghost')), '進子頁有推移轉場');
  await shot('00-push-mid');
  await sleep(500);
  ok(await page.evaluate(() => !document.querySelector('.cv-nav-ghost')), '轉場結束舊畫面拿掉');
  s = await info();
  ok(!s.trailHidden && s.trail.join('>') === '首頁>餐廳介紹', `路徑列＝首頁 › 餐廳介紹（${s.trail.join('>')}）`);
  ok(s.bar === '餐廳介紹', '畫布上方畫出子頁頂欄');
  ok(s.cells === 1, '子頁一開始是一格');
  await page.click('#canvas .cell[data-path=""]'); await sleep(300);
  s = await info();
  ok(s.size === '1080×1785 px', `KIOSK 模式：格子尺寸扣掉 135px 頂欄（${s.size}）`);
  ok(!s.headChip, `子頁標頭不放「第 N 層子頁」（2026-10-27 user：太擠）（${s.headChip}）`);
  ok(await page.evaluate(() => !!document.querySelector('#pageHead .ph-lead svg.lucide-morph') && document.querySelector('#pageHead .ph-lead').dataset.icon === 'arrow-left'), '標頭左邊的 ⌂ 變形成 ←');
  await shot('01b-sub-kiosk');
  // 子頁版面＝手機模式：頂欄變矮（64px）
  const kioskBarH = s.barH;
  await page.evaluate(() => { leaveSubTo(0); });
  await sleep(600);
  await page.evaluate(() => { const sel = [...document.querySelectorAll('#cellPanel select')].find((x) => [...x.options].some((o) => o.value === 'Mobile')); sel.value = 'Mobile'; sel.dispatchEvent(new Event('change')); });
  await sleep(300);
  await page.click('#cellPanel .sub-enter-btn'); await sleep(600);
  await page.click('#canvas .cell[data-path=""]'); await sleep(300);
  s = await info();
  ok(s.size === '1080×1856 px' && s.barH < kioskBarH * 0.6, `手機模式：頂欄變矮、格子 ${s.size}`);
  await page.evaluate(() => { leaveSubTo(0); });
  await sleep(600);
  await page.evaluate(() => { const sel = [...document.querySelectorAll('#cellPanel select')].find((x) => [...x.options].some((o) => o.value === 'Mobile')); sel.value = 'Kiosk'; sel.dispatchEvent(new Event('change')); });
  await sleep(300);
  await page.click('#cellPanel .sub-enter-btn'); await sleep(600);
  await page.click('#canvas .cell[data-path=""]'); await sleep(300);
  // 子頁裡分割
  await page.click('#cellPanel .split-dir[data-side="right"]'); await sleep(400);
  s = await info();
  ok(s.cells === 2, '子頁裡可以分割');
  const mainStill = await page.evaluate(() => state.config.pages[0].blocks[0].node.a.sub.node.t === 'split' && state.config.pages[0].blocks[0].node.b.content === 'Text');
  ok(mainStill, '分割寫進那一格的 sub、主頁不受影響');
  // 第二層
  await page.click('#canvas .cell[data-path="b"]'); await sleep(300);
  await setTap('OpenSubPage');
  await nameDialog('菜單');
  s = await info();
  ok(s.trail.join('>') === '首頁>餐廳介紹>菜單', '第三層路徑');
  await page.click('#canvas .cell[data-path=""]'); await sleep(300);
  ok(!(await info()).hasSubOpt, '第 3 層不能再設子頁（變灰）');
  await shot('02-level3');
  // 路徑點「餐廳介紹」回第二層
  await page.evaluate(() => [...document.querySelectorAll('#pageHead .ph-link')][1].click()); await sleep(600);
  s = await info();
  ok(s.trail.join('>') === '首頁>餐廳介紹' && s.head === '格子 2', '點路徑回上一層、選取停在剛剛那格');
  ok(/第 1 層子頁，其中還能再加入一層子頁/.test(await page.$eval('#cellPanel', (p) => p.textContent)), '子頁裡的提示：還能再加入一層');
  await shot('03-level2');
  // 標頭的 ← ＝回上一層（這裡就是主頁）
  await page.click('#pageHead .ph-lead'); await sleep(600);
  ok(await page.evaluate(() => document.querySelector('#pageHead .ph-lead').dataset.icon === 'house' && document.querySelector('#pageHead .ph-lead').disabled), '回主頁 ← 變回 ⌂、不能按');
  s = await info();
  ok(s.trailHidden && s.head === '格子 1', '回主頁、選取在「餐廳」那格');
  // 點兩下進子頁
  // 真人點兩下：兩次點擊間隔約 150ms（puppeteer clickCount:2 是同一瞬間送出，Chrome 只算一次 click）
  await page.click('#canvas .cell[data-path="a"]'); await sleep(150);
  await page.click('#canvas .cell[data-path="a"]'); await sleep(500);
  ok((await info()).bar === '餐廳介紹', '點兩下有子頁的格子直接進去');
  // 頁籤＝回主頁
  await page.evaluate(() => document.querySelector('#pageTabs .tab.active').click()); await sleep(400);
  ok((await info()).trailHidden, '點主頁頁籤回主頁');
  // 改掉動作 → 子頁刪掉、可復原
  await page.click('#canvas .cell[data-path="a"]'); await sleep(300);
  await setTap('OpenWeb');
  ok(await page.evaluate(() => !state.config.pages[0].blocks[0].node.a.sub), '改成別的動作，子頁拿掉');
  ok(await page.evaluate(() => spares().length === 1 && spares()[0].name === '餐廳介紹'), '拿掉的子頁收進未使用的子頁');
  const undone = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('.b-toast button')].filter((x) => x.textContent.trim() === '復原').pop();
    if (!b) return false;
    b.click(); await new Promise((r) => setTimeout(r, 300));
    const a = state.config.pages[0].blocks[0].node.a;
    return a.tap === 'OpenSubPage' && a.sub && a.sub.node.b.sub.name === '菜單';
  });
  ok(undone, 'toast「復原」把子頁（含第二層）找回來');
  // 深色
  await page.click('#canvas .cell[data-path="a"]'); await sleep(150);
  await page.click('#canvas .cell[data-path="a"]'); await sleep(400);
  await page.evaluate(() => window.setColorMode('dark', false)); await sleep(400);
  await shot('04-sub-dark');
  await page.evaluate(() => window.setColorMode('light', false)); await sleep(200);

  // ---------- 播放頁 ----------
  console.log('播放頁');
  const cfg = {
    activePage: 0, idleReturnSec: 30,
    pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: {
      t: 'split', dir: 'Horizontal', ratio: 0.5,
      a: { t: 'cell', bg: 'Solid', bgColor: 4285353025, content: 'Text', text: '餐廳', tap: 'OpenSubPage', sub: { name: '餐廳介紹', layout: 'Kiosk', node: {
        t: 'split', dir: 'Horizontal', ratio: 0.6,
        a: { t: 'cell', bg: 'Solid', bgColor: 4283315246, content: 'Text', text: '藍染餐廳', tap: 'OpenWeb', tapUrl: 'https://example.com/menu' },
        b: { t: 'cell', bg: 'Solid', bgColor: 4278223759, content: 'Text', text: '看菜單', tap: 'OpenSubPage', sub: { name: '菜單', layout: 'Mobile', node: { t: 'cell', bg: 'Solid', bgColor: 4281545523, content: 'Text', text: '[菜名]' } } },
      } } },
      b: { t: 'cell', bg: 'Solid', bgColor: 4279060385, content: 'Text', text: '住宿' },
    } }] }],
  };
  const pp = await browser.newPage();
  pp.on('pageerror', (e) => errs.push('PLAY PAGEERROR: ' + e.message));
  await pp.setViewport({ width: 540, height: 960 });
  await pp.setRequestInterception(true);
  pp.on('request', (req) => {
    const u = req.url();
    const json = (o, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {}), delay);
    if (/\/api\/config\/[^/]+\/version/.test(u)) return json({ version: 5 });
    if (/\/api\/config\/[^/]+\/wait/.test(u)) return json({ version: 5 }, 30000);
    if (/\/api\/config\/[^/?]+$/.test(u) && req.method() === 'GET') return json({ config: cfg, themeColor: '#0051A8' });
    if (/\/api\/config\//.test(u)) return json({ version: 5 });
    if (/\/api\/devices\/.+\/events/.test(u)) return json({ ok: true });
    if (u.startsWith('https://example.com/')) return req.respond({ status: 200, contentType: 'text/html', body: '<h1>menu</h1>' });
    return req.continue();
  });
  await pp.goto(BASE + '/play/?device=subtest&key=test&id=web-subtest', { waitUntil: 'domcontentloaded' });
  await pp.waitForSelector('.page.in .cell', { timeout: 15000 });
  await sleep(600);
  const pInfo = () => pp.evaluate(() => {
    const l = document.querySelector('.sub-layer');
    return {
      open: !!l && !l.hidden,
      title: l?.querySelector('.topbar-title')?.textContent || null,
      barH: l && !l.hidden ? Math.round(l.querySelector('.topbar').getBoundingClientRect().height) : 0,
      texts: l && !l.hidden ? [...l.querySelectorAll('.pv-text')].map((t) => t.textContent) : [],
    };
  });
  const clickText = (scope, text) => pp.evaluate((sc, t) => {
    const root = sc === 'sub' ? document.querySelector('.sub-layer') : document.querySelector('.page.in');
    const c = [...root.querySelectorAll('.cell')].find((x) => x.textContent.includes(t));
    c && c.click();
    return !!c;
  }, scope, text);
  ok(await clickText('main', '餐廳'), '主頁有「餐廳」格');
  await sleep(700);
  let p = await pInfo();
  ok(p.open && p.title === '餐廳介紹' && p.texts.includes('藍染餐廳'), `點了進子頁（${p.title}）`);
  ok(p.barH === 102, `KIOSK 頂欄 64×1.6＝102px（540 寬舞台，${p.barH}）`);
  await pp.screenshot({ path: path.join(OUT, '05-play-sub.png') });
  await clickText('sub', '看菜單'); await sleep(700);
  p = await pInfo();
  ok(p.title === '菜單' && p.texts.includes('[菜名]'), '子頁裡再點進第二層');
  ok(p.barH === 64, `手機模式頂欄 64px（${p.barH}）`);
  await pp.screenshot({ path: path.join(OUT, '05b-play-mobile.png') });
  await pp.click('.sub-layer .sub-back'); await sleep(500);
  p = await pInfo();
  ok(p.open && p.title === '餐廳介紹', '返回＝回上一層');
  await pp.click('.sub-layer .sub-home'); await sleep(700);
  p = await pInfo();
  ok(!p.open, '首頁＝回主頁');
  await pp.screenshot({ path: path.join(OUT, '06-play-home.png') });
  // 從子頁開網頁：← 回子頁、⌂ 直接回主頁（同 App）
  const ovOpen = () => pp.evaluate(() => { const o = document.getElementById('overlay'); return !o.hidden && !o.classList.contains('nav-leave'); });
  await clickText('main', '餐廳'); await sleep(700);
  await clickText('sub', '藍染餐廳'); await sleep(700);
  ok(await ovOpen(), '子頁裡的格子可以開網頁');
  await pp.click('#ovBack'); await sleep(700);
  p = await pInfo();
  ok(!(await ovOpen()) && p.open && p.title === '餐廳介紹', '網頁按 ← 回到子頁');
  await clickText('sub', '藍染餐廳'); await sleep(700);
  await pp.click('#ovHome'); await sleep(800);
  p = await pInfo();
  ok(!(await ovOpen()) && !p.open, '網頁按 ⌂ 直接回主頁');

  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail || errs.length ? 1 : 0);
})();
