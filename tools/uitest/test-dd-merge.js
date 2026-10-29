/* 下拉選單「鈕跟清單連成一體」（2026-10-29 user：同子頁收納匣）：打開＝選單從鈕的上緣開始、跟鈕一樣寬、鈕變透明疊在上面；
   空間不夠往上開＝鈕在選單底部；選項滑過不加底色、灰字亮成系統文字色。逐一打開格子設定與機器設定裡的每個下拉量位置、截圖。
   只改本機畫面、不存檔（攔 PUT）。用法：node test-dd-merge.js（BASE 預設本機 3177；USER_／PASS_ 換帳號） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'dd-merge');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1512, height: 828, deviceScaleFactor: 2 },
  });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.method() === 'PUT' ? req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : req.continue()));

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await page.evaluate((m) => window.setColorMode(m, false), process.env.MODE || 'light');
  await sleep(400);
  await page.evaluate(async () => {
    const list = await api('GET', '/api/devices');
    await enterWorkspace(list.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || list[0]);
  });
  await sleep(1200);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const home = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '客服', tap: 'OpenAssistant' }), b: c({ content: 'Weather' }) };
    state.config.pages = [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: home }] }];
    pageIndex = 0; subStack = []; selected = null; render();
  });
  await sleep(500);
  await page.click('#canvas .cell[data-path="a"]'); await sleep(600);

  const dds = () => page.evaluate(() => [...document.querySelectorAll('#cellPanel .b-dd, #settingsBody .b-dd')].filter((d) => d.offsetParent).map((d) => d.querySelector('.b-dd-value').textContent.trim()));
  const measure = (i) => page.evaluate((i) => {
    const d = [...document.querySelectorAll('#cellPanel .b-dd, #settingsBody .b-dd')].filter((x) => x.offsetParent)[i];
    const t = d.querySelector('.b-dd-trigger').getBoundingClientRect(), menu = d.querySelector('.b-dd-menu'), m = menu.getBoundingClientRect();
    const list = menu.querySelector('.b-dd-list');
    const items = [...list.querySelectorAll('.b-dd-item')];
    const tcs = getComputedStyle(d.querySelector('.b-dd-trigger'));
    return {
      t: t.toJSON(), m: m.toJSON(), up: menu.classList.contains('is-up'), shown: menu.classList.contains('is-shown'),
      trigBorder: tcs.borderTopColor, trigBg: tcs.backgroundColor, z: tcs.zIndex,
      overflow: items.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent),
      firstText: items[0] && items[0].getBoundingClientRect().left, valueLeft: d.querySelector('.b-dd-value').getBoundingClientRect().left,
      vh: innerHeight, n: items.length,
    };
  }, i);
  const toggle = (i) => page.evaluate((i) => [...document.querySelectorAll('#cellPanel .b-dd, #settingsBody .b-dd')].filter((x) => x.offsetParent)[i].querySelector('.b-dd-trigger').click(), i);
  // 截圖會觸發 resize（下拉遇到 resize 會自己收起）：截完圖要收的時候先確認還開著
  const closeIt = (i) => page.evaluate((i) => { const d = [...document.querySelectorAll('#cellPanel .b-dd, #settingsBody .b-dd')].filter((x) => x.offsetParent)[i]; if (d.classList.contains('open')) d.querySelector('.b-dd-trigger').click(); }, i);

  const runAll = async (tag) => {
    const names = await dds();
    console.log(`${tag}：${names.length} 個下拉（${names.join('、')}）`);
    for (let i = 0; i < names.length; i++) {
      await page.evaluate((i) => { const d = [...document.querySelectorAll('#cellPanel .b-dd, #settingsBody .b-dd')].filter((x) => x.offsetParent)[i]; d.scrollIntoView({ block: 'center' }); }, i);
      await sleep(150);
      await toggle(i); await sleep(450);
      const r = await measure(i);
      const edgeOk = r.up ? Math.abs(r.m.bottom - r.t.bottom) < 1 : Math.abs(r.m.top - r.t.top) < 1;
      ok(r.shown && edgeOk && Math.abs(r.m.left - r.t.left) < 1 && Math.abs(r.m.width - r.t.width) < 1 && r.m.top >= 0 && r.m.bottom <= r.vh,
        `「${names[i]}」${r.up ? '往上' : '往下'}開、鈕＝選單${r.up ? '底部' : '頂端'}（鈕 ${r.t.width.toFixed(0)}×${r.t.height.toFixed(0)}、選單 ${r.m.width.toFixed(0)}×${r.m.height.toFixed(0)}、${r.n} 項）`);
      ok(r.trigBorder === 'rgba(0, 0, 0, 0)' && r.trigBg === 'rgba(0, 0, 0, 0)' && r.z === '1201', '  鈕打開＝外框底色淡掉、疊在選單上（不變藍）');
          if (r.overflow.length) console.log('    ⚠ 選項比鈕寬：', r.overflow.join('、'));
      if (i < 3 || r.up) await page.screenshot({ path: path.join(OUT, `${tag}-${i}.png`), captureBeyondViewport: false, clip: { x: Math.max(0, r.t.left - 40), y: Math.max(0, Math.min(r.m.top, r.t.top) - 40), width: r.t.width + 80, height: r.m.height + 80 } });
      await closeIt(i); await sleep(320);
      const closed = await page.evaluate((i) => { const d = [...document.querySelectorAll('#cellPanel .b-dd, #settingsBody .b-dd')].filter((x) => x.offsetParent)[i]; return { hidden: d.querySelector('.b-dd-menu').hidden, b: getComputedStyle(d.querySelector('.b-dd-trigger')).borderTopColor, open: d.classList.contains('open') }; }, i);
      ok(closed.hidden && closed.b !== 'rgba(0, 0, 0, 0)', '  再按一次＝收回、鈕的外框回來 ' + JSON.stringify(closed));
    }
  };

  await runAll('格子-客服');
  // 滑過選項：不加底色、灰字亮成系統文字色
  await page.evaluate(() => [...document.querySelectorAll('#cellPanel .b-dd')].filter((x) => x.offsetParent)[0].scrollIntoView({ block: 'center' })); await sleep(200);
  await toggle(0); await sleep(500);
  const hov = await page.evaluate(() => {
    const d = [...document.querySelectorAll('#cellPanel .b-dd')].filter((x) => x.offsetParent)[0];
    const it = [...d.querySelectorAll('.b-dd-item')].find((x) => !x.classList.contains('active') && !x.disabled);
    const r = it.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2, txt: it.textContent, before: getComputedStyle(it).color, heading: getComputedStyle(document.documentElement).getPropertyValue('--text-heading').trim() };
  });
  await page.mouse.move(hov.x, hov.y); await sleep(300);
  const after = await page.evaluate((x, y) => { const it = document.elementFromPoint(x, y).closest('.b-dd-item'); const cs = getComputedStyle(it); return { color: cs.color, bg: cs.backgroundColor }; }, hov.x, hov.y);
  ok(after.bg === 'rgba(0, 0, 0, 0)' && after.color !== hov.before, `滑過「${hov.txt}」：沒有底色（${after.bg}）、字色 ${hov.before} → ${after.color}`);
  const d0 = await measure(0);
  await page.screenshot({ path: path.join(OUT, 'hover.png'), captureBeyondViewport: false, clip: { x: d0.t.left - 40, y: Math.min(d0.m.top, d0.t.top) - 40, width: d0.t.width + 80, height: d0.m.height + 80 } });
  await closeIt(0); await sleep(320);

  // 打開途中（鈕已透明、框正在長、選項正在落下）
  await toggle(0); await sleep(90);
  const mid = await measure(0);
  await page.screenshot({ path: path.join(OUT, 'mid.png'), captureBeyondViewport: false, clip: { x: mid.t.left - 40, y: mid.t.top - 40, width: mid.t.width + 80, height: 260 } });
  await sleep(500); await closeIt(0); await sleep(320);

  await page.click('#canvas .cell[data-path="b"]'); await sleep(600);
  await runAll('格子-天氣');

  // 機器設定：閒置返回
  await page.evaluate(() => [...document.querySelectorAll('.ws-tabs .seg')].find((b) => b.textContent.includes('機器設定')).click());
  await sleep(700);
  await runAll('機器設定');

  console.log('errors', JSON.stringify(errs));
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
