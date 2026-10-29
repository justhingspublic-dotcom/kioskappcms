/* 畫布標頭「N 個子頁」點開＝這一頁的子頁（2026-10-29 user 試過三案選這個，取代頁面地圖圓鈕與右欄地圖）。不存檔（攔 PUT）。
   BASE=https://justdisplay.justhings.com.tw/joye 可以跑正式站。截圖在 shots/sub-pop/。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'sub-pop');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.method() === 'PUT' ? r.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : r.continue()));

  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.goto(page.url().split(/[?#]/)[0] + '?maptrial=1', { waitUntil: 'networkidle2' }); // 試用網址已經沒有作用
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(400);
  await page.evaluate(async () => { const l = await api('GET', '/api/devices'); await enterWorkspace(l.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || l[0]); });
  await sleep(1200);
  await page.evaluate(() => {
    document.querySelectorAll('.b-toast').forEach((t) => t.remove());
    wsAppVer = '1.60';
    const c = (color, o) => Object.assign(DEFAULT_CELL(), { bgColor: color }, o || {});
    const sp = (a, b, dir) => ({ t: 'split', dir: dir || 'Horizontal', ratio: 0.5, a, b });
    const sub = (name, node) => ({ tap: 'OpenSubPage', sub: { name, node, layout: 'Kiosk' } });
    const home = sp(c(4278210984), sp(c(4293964395, sub('餐廳介紹', sp(c(4284301367, sub('菜單', c(4278223759))), c(4293911508)))), c(4283198346, sub('交通資訊', c(4282735204)))));
    state.config.pages = [
      { id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: home }] },
      { id: 2, name: '活動公告', blocks: [{ id: 1, w: 1, node: c(4280250251) }] },
    ];
    state.config.spareSubs = [{ id: 1, name: '停車場', node: c(4283723386), layout: 'Kiosk', from: '' }];
    pageIndex = 0; subStack = []; spareEdit = 0; selected = null; render();
  });
  await sleep(500);

  console.log('頁面地圖拿掉');
  const gone = await page.evaluate(() => ({
    mapBtn: !!document.getElementById('mapBtn'), bar: !!document.getElementById('mapTrialBar'),
    segs: [...document.querySelectorAll('.ws-tabs .seg')].map((s) => s.textContent),
    globals: ['mapVariant', 'setMapView', 'renderMapPanel', 'renderMapTab'].filter((k) => { try { return typeof eval(k) !== 'undefined'; } catch { return false; } }),
  }));
  ok(!gone.mapBtn && !gone.bar, '標題列沒有圓鈕、底部沒有試用切換', gone);
  ok(gone.segs.join('|') === '版面|機器設定', '標題列只有〔版面｜機器設定〕', gone.segs);
  ok(gone.globals.length === 0, '舊的地圖程式都拿掉了', gone.globals);
  const head = await page.evaluate(() => { const t = document.querySelector('.ws-tabs').getBoundingClientRect(), m = document.querySelector('#wsModal .b-modal').getBoundingClientRect(); return Math.abs((t.left + t.right) / 2 - (m.left + m.right) / 2); });
  ok(head < 2, '〔版面｜機器設定〕置中', head);

  console.log('標頭「N 個子頁」');
  const chip = await page.evaluate(() => { const c = document.querySelector('#pageHead .ph-chip'); return { tag: c.tagName, text: c.textContent.replace('layers', '').trim(), exp: c.getAttribute('aria-expanded') }; });
  ok(chip.tag === 'BUTTON' && chip.text === '3 個子頁' && chip.exp === 'false', '「3 個子頁」是鈕', chip);
  const frame0 = await page.evaluate(() => { const r = document.querySelector('#editor .canvas-frame').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; });
  await page.click('#pageHead .ph-chip');
  await sleep(450);
  const a1 = await page.evaluate(() => {
    const p = $('subPop');
    const items = [...p.querySelectorAll('.spare-item')].map((i) => [i.querySelector('.spare-item-name').textContent, i.querySelector('.spare-item-where').textContent, !!i.closest('.sub-indent')]);
    const h = $('pageHead').getBoundingClientRect(), r = p.getBoundingClientRect();
    const c = document.querySelector('#pageHead .ph-chip');
    const fr = document.querySelector('#editor .canvas-frame').getBoundingClientRect();
    return {
      shown: !p.hidden && p.classList.contains('is-shown'), items, inHead: p.parentElement === $('pageHead'), pos: getComputedStyle(p).position,
      under: Math.round(r.top - h.bottom), flush: [Math.round(r.left - h.left), Math.round(r.right - h.right)], over: r.bottom > fr.top + 20,
      line: getComputedStyle($('pageHead')).borderBottomColor, open: c.classList.contains('is-open') && c.getAttribute('aria-expanded') === 'true',
      frame: [Math.round(fr.top), Math.round(fr.height), Math.round(fr.width)],
    };
  });
  ok(a1.shown && a1.open, '點了打開清單、鈕變打開的樣子', a1);
  ok(JSON.stringify(a1.items) === JSON.stringify([['餐廳介紹', '格子 2', false], ['菜單', '格子 1', true], ['交通資訊', '格子 3', false]]), '列出這一頁的子頁（第二層縮排、寫格子），未使用的不列', a1.items);
  ok(a1.inHead && a1.pos === 'absolute', '清單是標頭的一部分（不是浮出的面板）', a1);
  ok(a1.under >= -1 && a1.under <= 0 && a1.flush[0] === 0 && a1.flush[1] === 0, '緊接標頭底下往下長、左右跟標頭切齊', a1);
  ok(a1.line === 'rgba(0, 0, 0, 0)', '打開時標頭的底線讓給清單下緣', a1.line);
  ok(a1.over && JSON.stringify(a1.frame) === JSON.stringify(frame0), '蓋在預覽上方、預覽不縮小不移動', { frame0, frame: a1.frame });
  await shot('open');
  await page.click('#pageHead .ph-chip');
  await sleep(350);
  ok(await page.evaluate(() => $('subPop').hidden && !document.querySelector('#pageHead .ph-chip').classList.contains('is-open') && !$('pageHead').classList.contains('is-open') && getComputedStyle($('pageHead')).borderBottomColor !== 'rgba(0, 0, 0, 0)'), '再按一次收起、標頭底線回來');
  await page.click('#pageHead .ph-chip');
  await sleep(400);
  await page.mouse.click(...(await page.evaluate(() => { const r = document.querySelector('#pageHead .ph-title').getBoundingClientRect(); return [r.left + 5, r.top + r.height / 2]; })));
  await sleep(350);
  ok(await page.evaluate(() => !$('subPop').hidden), '點標頭的其他地方不收');
  await page.click('#pageHead .ph-chip');
  await sleep(350);
  await page.click('#pageHead .ph-chip');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(350);
  ok(await page.evaluate(() => $('subPop').hidden && $('wsModal').classList.contains('is-visible')), 'Esc 收清單、工作區還開著');
  await page.click('#pageHead .ph-chip');
  await sleep(400);
  await page.mouse.click(1000, 600); // 右欄空白
  await sleep(350);
  ok(await page.evaluate(() => $('subPop').hidden), '點外面收清單');
  await page.click('#pageHead .ph-chip');
  await sleep(400);
  await page.evaluate(() => document.querySelector('.ws-tabs .seg[data-wstab="settings"]').click());
  await sleep(400);
  ok(await page.evaluate(() => $('subPop').hidden), '切到機器設定：清單收起');
  await page.evaluate(() => document.querySelector('.ws-tabs .seg[data-wstab="layout"]').click());
  await sleep(400);
  await page.click('#pageHead .ph-chip');
  await sleep(400);
  await page.evaluate(() => [...$('subPop').querySelectorAll('.spare-item')].find((i) => i.textContent.includes('菜單')).click());
  await sleep(700);
  const a2 = await page.evaluate(() => ({ depth: subStack.length, name: subLabel(page().name), hidden: $('subPop').hidden, chip: !!document.querySelector('#pageHead .ph-chip') }));
  ok(a2.depth === 2 && a2.name === '菜單' && a2.hidden, '點卡片進到那個子頁、清單收起', a2);
  ok(!a2.chip, '子頁裡標頭不放子頁數');
  await page.evaluate(() => { pageIndex = 1; subStack = []; render(); });
  await sleep(300);
  ok(await page.evaluate(() => !document.querySelector('#pageHead .ph-chip')), '沒有子頁的頁面不放鈕');
  await page.evaluate(() => { pageIndex = 0; render(); });
  await sleep(300);

  console.log('右欄與收納匣照舊');
  await page.evaluate(() => { selected = null; render(); });
  await sleep(300);
  ok(await page.evaluate(() => $('cellPanel').classList.contains('is-empty') && !$('cellPanel').classList.contains('is-map')), '沒選格子＝原本的空狀態');
  await page.click('#spareBtn');
  await sleep(900);
  const tray = await page.evaluate(() => ({ grp: !!$('sparePopList').querySelector('.spare-grp'), n: $('sparePopList').querySelectorAll('.spare-item').length, sep: !!$('sparePopList').querySelector('.spare-sep') }));
  ok(!tray.grp && tray.n === 4 && tray.sep, '收納匣跟原本一樣（不分組，使用中｜未使用一條線）', tray);
  await page.evaluate(() => setSparePop(false, true));

  console.log('共用版面');
  await page.evaluate(() => exitWorkspace());
  await sleep(500);
  await page.evaluate(() => enterSharedLayoutEditor({ id: 9996, name: '測試', pages: [{ id: 1, name: '', blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] }], screen: { w: 1080, h: 1920 }, spareSubs: [] }));
  await sleep(900);
  await page.evaluate(() => { wsAppVer = '1.60'; state.config.pages[0].blocks = [{ id: 1, w: 1, node: Object.assign(DEFAULT_CELL(), { tap: 'OpenSubPage', sub: { name: '子頁', node: DEFAULT_CELL(), layout: 'Kiosk' } }) }]; render(); });
  await sleep(300);
  await page.click('#pageHead .ph-chip');
  await sleep(450);
  ok(await page.evaluate(() => !$('subPop').hidden && $('subPop').querySelectorAll('.spare-item').length === 1), '共用版面也能點開');
  await shot('shared');
  await page.evaluate(() => exitWorkspace());
  await sleep(500);
  ok(await page.evaluate(() => $('subPop').hidden), '關掉工作區：清單一起收');

  ok(errs.length === 0, '沒有錯誤', errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
