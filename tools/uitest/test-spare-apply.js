/* 共用版面的子頁套用到機器（2026-10-27 user）：「加入機器」與「批量調整展示畫面」
   ① 舊版 App（1.59 以前）的機器先提醒「App 需更新才能開啟子頁」（照樣可以加入）
   ② 版面的未使用的子頁一起放進機器的未使用的子頁（同名同內容已經有了就不再放）
   ③ 「展示版面」把機器那一頁換成版面內容前，機器自己的子頁先收進未使用的子頁（跟版面一模一樣的不收）
   機器清單、機器設定都是假的（攔 API），PUT 攔下來看內容，不寫 DB。用法：node test-spare-apply.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

const cell = (o) => ({ content: 'Text', bgColor: 4283315246, tap: 'None', ...o });
const sub = (name, text) => ({ name, node: cell({ text }), layout: 'Kiosk' });
const split = (a, b) => ({ t: 'split', dir: 'Horizontal', ratio: 0.5, a, b });
const LAYOUT = {
  id: 9995, name: '活動版面', screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString(),
  pages: [{ id: 1, name: '活動版面', blocks: [{ id: 1, w: 1, node: split(cell({ text: '報名', tap: 'OpenSubPage', sub: sub('活動報名', '填表') }), cell({ text: '交通' })) }] }],
  spareSubs: [{ id: 1, name: '菜單', node: cell({ text: '今日菜單' }), layout: 'Kiosk', from: '原本在「活動版面」的「交通」格' }, { id: 2, name: '停車', node: cell({ text: '停車場' }), layout: 'Kiosk', from: '' }],
};
const DEVICES = [
  { DeviceId: 't-old', DeviceName: '舊機', LastAppVersion: '1.59', UpdatedAt: new Date().toISOString(), LastSeenAt: new Date().toISOString() },
  { DeviceId: 't-new', DeviceName: '新機', LastAppVersion: '1.60', UpdatedAt: new Date().toISOString(), LastSeenAt: new Date().toISOString() },
];
const CONFIGS = {
  't-old': { pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: cell({ text: '歡迎' }) }] }], activePage: 0 },
  // 新機：已有「活動版面」那一頁（被改過）：報名＝跟版面一模一樣的子頁、交通＝機器自己加的子頁；未使用的子頁裡已有一樣的「菜單」
  't-new': {
    pages: [
      { id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: cell({ text: '歡迎' }) }] },
      { id: 2, name: '活動版面', layoutId: 9995, blocks: [{ id: 1, w: 1, node: split(cell({ text: '報名', tap: 'OpenSubPage', sub: sub('活動報名', '填表') }), cell({ text: '交通', tap: 'OpenSubPage', sub: sub('接駁車', '時刻表') })) }] },
    ],
    activePage: 0,
    spareSubs: [{ id: 3, name: '菜單', node: cell({ text: '今日菜單' }), layout: 'Kiosk', from: '' }],
  },
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  let puts = {};
  let fake = false; // 登入後才換成假的機器清單
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    const json = (body) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'PUT') {
      const m = u.pathname.match(/\/api\/config\/([^/]+)$/);
      if (m) puts[decodeURIComponent(m[1])] = JSON.parse(req.postData());
      return json({ ok: true });
    }
    if (fake && req.method() === 'GET') {
      if (/\/api\/devices$/.test(u.pathname)) return json(DEVICES);
      const m = u.pathname.match(/\/api\/config\/([^/]+)$/);
      if (m && CONFIGS[decodeURIComponent(m[1])]) return json({ config: JSON.parse(JSON.stringify(CONFIGS[decodeURIComponent(m[1])])) });
    }
    return req.continue();
  });

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);
  fake = true;
  await page.evaluate((L) => { shared = { layouts: [L] }; window.__L = L; }, LAYOUT);

  console.log('1. 版面設定「加入機器」');
  await page.evaluate(() => { applySharedLayout(window.__L); });
  await page.waitForSelector('.copy-modal .copy-list', { visible: true });
  await sleep(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.copy-modal .copy-list > *')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  ok(rows.some((r) => r.includes('舊機') && r.includes('App 需更新才能開啟子頁')), `舊版 App 的機器有提醒（${rows.join('｜')}）`);
  ok(rows.some((r) => r.includes('新機') && !r.includes('App 需更新')), '新版 App 的機器沒有提醒');
  await page.evaluate(() => { document.querySelectorAll('.copy-modal .copy-list input').forEach((c) => { if (!c.checked) c.click(); }); });
  await page.evaluate(() => [...document.querySelectorAll('.copy-modal .b-alert-foot button')].pop().click());
  await sleep(800);
  let o = puts['t-old'] && puts['t-old'].config, n = puts['t-new'] && puts['t-new'].config;
  ok(!!o && !!n, '兩台都送出');
  ok(o && o.pages.length === 2 && o.pages[1].layoutId === 9995 && o.pages[1].blocks[0].node.a.sub.name === '活動報名', '舊機：版面加在後面、接在格子上的子頁跟著過去');
  ok(o && o.spareSubs && o.spareSubs.map((s) => s.name).join() === '菜單,停車', `舊機：版面未使用的子頁一起放進來（${o && o.spareSubs && o.spareSubs.map((s) => s.name).join()}）`);
  ok(o && o.spareSubs && o.spareSubs.every((s) => s.from === '來自共用版面「活動版面」'), `標明來自哪個版面（${o && o.spareSubs && o.spareSubs[0].from}）`);
  ok(n && n.spareSubs && n.spareSubs.map((s) => `${s.id}:${s.name}`).join() === '4:停車,3:菜單', `新機：已有一樣的「菜單」不再放、只放「停車」（${n && n.spareSubs && n.spareSubs.map((s) => `${s.id}:${s.name}`).join()}）`);

  console.log('2. 批量調整展示畫面');
  puts = {};
  await page.click('#showLayoutBtn');
  await page.waitForSelector('.b-modal.is-batch thead input', { visible: true });
  await sleep(300);
  await page.click('.b-modal.is-batch thead input'); await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll('.b-modal.is-batch .b-modal-foot button')].pop().click());
  await page.waitForSelector('.b-modal.is-batch input[name="pick-layout"]', { visible: true });
  await sleep(300);
  const note = await page.evaluate(() => document.querySelector('.b-modal.is-batch .layout-pick-note').textContent);
  ok(/舊機 的 App 需更新才能開啟子頁/.test(note), `狀況欄提醒舊版 App（${note}）`);
  const help = await page.evaluate(() => document.querySelector('.b-modal.is-batch .page-help-panel').textContent);
  ok(/該頁原有的子頁會移至機器的「未使用的子頁」/.test(help), '使用說明寫了子頁會收進未使用的子頁');
  await page.evaluate(() => document.querySelector('.b-modal.is-batch input[name="pick-layout"]').click());
  await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll('.b-modal.is-batch .b-modal-foot button')].pop().click());
  await sleep(1000);
  o = puts['t-old'] && puts['t-old'].config; n = puts['t-new'] && puts['t-new'].config;
  ok(o && o.pages.length === 2 && o.activePage === 1 && o.spareSubs.map((s) => s.name).join() === '菜單,停車', '舊機：先加入再切過去，未使用的子頁一起放進來');
  ok(n && n.activePage === 1 && n.pages[1].blocks[0].node.b.tap === 'None', '新機：那一頁更新成版面內容並切過去');
  const ns = n && n.spareSubs ? n.spareSubs.map((s) => `${s.name}|${s.from}`) : [];
  ok(ns.includes('接駁車|原本在「活動版面」的「交通」格'), `機器自己加的子頁收進未使用的子頁（${ns.join('，')}）`);
  ok(!ns.some((s) => s.startsWith('活動報名')), '跟版面一模一樣的子頁不收（新的那頁裡就有）');
  ok(ns.filter((s) => s.startsWith('菜單')).length === 1 && ns.some((s) => s.startsWith('停車')), '版面未使用的子頁：已有的不重複、沒有的放進來');
  const toast = await page.evaluate(() => [...document.querySelectorAll('.b-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).pop() || '');
  ok(/機器上原本的 1 個子頁已移至未使用的子頁/.test(toast), `完成提示寫出收了幾個（${toast}）`);

  ok(!errs.length, `沒有 JS 錯誤${errs.length ? '：' + errs.join(' | ') : ''}`);
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
