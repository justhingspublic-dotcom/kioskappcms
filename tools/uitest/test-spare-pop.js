/* 子頁收納匣（2026-10-27 user：收納匣是整台機器共用，不放在頁面畫框底下）：機器＝頁籤列旁自己一個容器（頁籤與重新載入中間）、共用版面＝標題列，
   點開浮出面板；打開＝微擬物浮起（不變藍）；點外面、Esc、再按一次鈕才收起（點子頁進去編輯不收，2026-10-29 user）；拖到格子照樣接上。
   只改本機畫面、不存檔（攔 PUT）。用法：node test-spare-pop.js（BASE 預設本機 3177；USER_／PASS_ 換帳號） */
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
  await page.evaluate(() => {
    wsAppVer = '1.60';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const sub = (name, color) => ({ name, node: c({ content: 'Text', text: name, bgColor: color }), layout: 'Kiosk' });
    const home = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '餐廳', bgColor: 4285353025, tap: 'OpenSubPage', sub: sub('餐廳介紹', 4283321390) }), b: c({ content: 'Text', text: '住宿', bgColor: 4279060385 }) };
    const summer = c({ content: 'Text', text: '夏季活動', bgColor: 4281545523, tap: 'OpenSubPage', sub: sub('活動報名', 4284367411) });
    state.config.pages = [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: home }] }, { id: 2, name: '夏季活動', blocks: [{ id: 1, w: 1, node: summer }] }];
    state.config.spareSubs = [{ id: 1, name: '菜單', node: c({ content: 'Text', text: '菜單', bgColor: 4278223759 }), layout: 'Kiosk', from: '' }];
    pageIndex = 0; subStack = []; spareEdit = 0; selected = null; render();
  });
  await sleep(500);

  const info = () => page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const pop = document.getElementById('sparePop');
    return {
      boxShown: !document.getElementById('spareBox').hidden,
      count: document.querySelector('#spareBtn .spare-tray-count').textContent,
      order: [...document.querySelector('.page-tabs-row').children].filter((el) => !el.hidden && el.id !== 'sparePop').map((el) => el.id),
      tabs: r(document.getElementById('pageTabs')), box: r(document.getElementById('spareBox')), btn: r(document.getElementById('spareBtn')), reload: r(document.getElementById('reloadBtn')), row: r(document.querySelector('.page-tabs-row')),
      popOpen: !pop.hidden && pop.classList.contains('is-shown'), popHidden: pop.hidden, pop: r(pop),
      expanded: document.getElementById('spareBtn').getAttribute('aria-expanded'),
      items: [...pop.querySelectorAll('.spare-item')].map((x) => `${x.querySelector('.spare-item-name').textContent}|${x.querySelector('.spare-item-where').textContent}`),
      hint: pop.querySelector('.spare-pop-hint').textContent, hintShown: !!pop.querySelector('.spare-pop-hint').offsetParent, listShown: !!document.getElementById('sparePopList').offsetParent,
      trayBelow: !!document.querySelector('#spareTray'), boxInHead: !!document.querySelector('#wsModal .ws-head-actions > #spareBox'),
      head: r(document.querySelector('#wsModal .b-modal-head')), body: r(document.querySelector('#layoutTab')),
      btnBg: getComputedStyle(document.getElementById('spareBtn')).backgroundColor, tabsBg: getComputedStyle(document.getElementById('pageTabs')).backgroundColor, btnBorder: getComputedStyle(document.getElementById('spareBtn')).borderTopWidth, boxBorder: getComputedStyle(document.getElementById('spareBox')).borderTopWidth, popBg: getComputedStyle(pop).backgroundImage, btnScale: getComputedStyle(document.getElementById('spareBtn')).scale,
      btnBorderColor: getComputedStyle(document.getElementById('spareBtn')).borderTopColor, popShadow: getComputedStyle(pop).boxShadow,
      add: r(document.getElementById('spareAddBtn')), list: r(document.getElementById('sparePopList')), listMax: getComputedStyle(document.getElementById('sparePopList')).maxHeight,
      firstInPop: pop.querySelector('button, .spare-item')?.id || '',
      wsOpen: document.getElementById('wsModal').classList.contains('is-visible'),
      pageIndex, inSub: subStack.length > 0, title: document.querySelector('#pageHead .ph-title')?.textContent || '',
    };
  });

  console.log('1. 位置：頁籤列旁自己一個容器');
  let s = await info();
  ok(s.boxShown && s.count === '3', `收納匣鈕出現、數字＝所有頁面的子頁 3 個（${s.count}）`);
  ok(s.order.join() === 'pageTabs,spareBox,reloadBtn', `在頁籤與重新載入中間（${s.order.join(' → ')}）`);
  ok(s.box.left >= s.tabs.right && s.box.right <= s.reload.left && Math.abs(s.box.height - s.reload.height) < 1, `獨立容器、跟重新載入同高（${s.box.width.toFixed(0)}×${s.box.height.toFixed(0)}）`);
  ok(!s.trayBelow, '畫框底下不再有收納匣那一條');
  ok(s.boxBorder === '0px' && s.btnBorder === '1px' && s.btnBg === s.tabsBg, '單層：外框與底色畫在鈕上（同頁籤列），外面那層不畫框');
  ok(s.popHidden && s.expanded === 'false', '面板預設收起');

  console.log('2. 點開：浮出所有頁面的子頁');
  await page.click('#spareBtn'); await sleep(400);
  s = await info();
  ok(s.popOpen && s.expanded === 'true', '點一下就浮出面板');
  const enter = await page.evaluate(() => { const p = document.getElementById('sparePop'); return { on: p.classList.contains('is-entering'), idx: [...p.querySelectorAll('.spare-add, .spare-item, .spare-pop-hint')].map((x) => x.style.getPropertyValue('--i')).join() }; });
  ok(enter.idx.startsWith('0,1,2') && enter.idx.endsWith(',5'), `裡面一個接一個落下（編號 ${enter.idx}）`);
  ok(Math.abs(s.pop.top - s.btn.top) < 1 && Math.abs(s.pop.left - s.btn.left) < 1 && Math.abs(s.pop.width - s.btn.width) < 1 && s.pop.bottom > s.btn.bottom + 100, `直式下拉：從鈕的上緣往下長、跟鈕一樣寬（${s.pop.width.toFixed(0)}×${s.pop.height.toFixed(0)}）`);
  ok(s.firstInPop === 'spareAddBtn' && s.add.top >= s.box.bottom && s.add.bottom <= s.list.top + 1, '「新增子頁」在最上面（清單外面，不跟著捲）');
  ok(s.listMax === '278px', `清單最多約五個再捲動（${s.listMax}）`);
  ok(s.items.join() === '餐廳介紹|首頁 › 餐廳,活動報名|夏季活動 › 夏季活動,菜單|未使用', `每一頁的子頁都在（${s.items.join('，')}）`);
  ok(s.hint === '拖曳套用', `提示：${s.hint}`);
  await sleep(400); // 浮起的過場跑完
  s = await info();
  ok(s.btnBg === 'rgba(0, 0, 0, 0)' && s.btnBorderColor === 'rgba(0, 0, 0, 0)', '打開＝鈕的外框與底淡掉，鈕就是清單的頂端（連成一體、不變藍）');
  ok(/linear-gradient/.test(s.popBg) && s.popShadow.includes('rgba(16, 24, 40, 0.16) 0px 0px 8px'), `清單＝微擬物（漸層底、陰影在正下方）`);
  ok(await page.evaluate(() => { const b = document.getElementById('spareBtn').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!el.closest('#spareBtn'); }), '鈕疊在清單上面，點得到（再按一次收起）');
  await shot('pop-open');

  console.log('3. 收起');
  const panel = await page.evaluate(() => { const r = document.querySelector('.panel-col').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 40 }; });
  await page.mouse.click(panel.x, panel.y); await sleep(400);
  s = await info();
  ok(s.popHidden && s.expanded === 'false', '點面板外面＝收起');
  await page.click('#spareBtn'); await sleep(350);
  await page.keyboard.press('Escape'); await sleep(400);
  s = await info();
  ok(s.popHidden && s.wsOpen, 'Esc＝收起面板，工作區不會跟著關');
  await page.click('#spareBtn'); await sleep(350);
  await page.click('#spareBtn'); await sleep(400);
  s = await info();
  ok(s.popHidden, '再按一次鈕＝收起');

  console.log('4. 點別頁的子頁＝跳過去編輯');
  await page.click('#spareBtn'); await sleep(350);
  await page.evaluate(() => [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('活動報名')).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 })));
  await sleep(700);
  s = await info();
  ok(s.pageIndex === 1 && s.inSub && s.title === '活動報名', `換到「夏季活動」頁並進到子頁（${s.title}）`);
  ok(s.popOpen && await page.evaluate(() => [...document.querySelectorAll('#sparePop .spare-item.is-current')].map((x) => x.querySelector('.spare-item-name').textContent).join() === '活動報名'), '跳過去後面板還開著，那張變成正在編輯');
  await page.keyboard.press('Escape'); await sleep(350);
  await page.evaluate(() => { pageIndex = 0; subStack = []; spareEdit = 0; selected = null; render(); });
  await sleep(300);

  console.log('5. 從面板拖到格子');
  await page.click('#spareBtn'); await sleep(350);
  const from = await page.evaluate(() => { const r = [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('菜單')).getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 }); await sleep(450);
  const to = await page.evaluate(() => { const r = [...document.querySelectorAll('.drop-board .cell')].find((c) => c.textContent.includes('住宿')).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(to.x, to.y, { steps: 10 }); await sleep(150);
  await page.mouse.up(); await sleep(600);
  s = await info();
  const tap = await page.evaluate(() => leavesOf(page().blocks[0].node).find((l) => l.cell.text === '住宿').cell);
  ok(tap.tap === 'OpenSubPage' && tap.sub && tap.sub.name === '菜單', '「菜單」接到「住宿」那一格');
  ok(s.popOpen, '拖完面板還開著（可以接著拖下一個）');
  ok(s.items.some((x) => x === '菜單|首頁 › 住宿'), `面板更新成使用中（${s.items.join('，')}）`);
  ok(await page.evaluate(() => !document.querySelector('.drop-board') && !document.querySelector('.spare-ghost')), '放大預覽與縮圖都收掉');

  console.log('5b. 滑過卡片右邊出現一顆：使用中＝移到未使用（收起來圖示）、未使用＝刪除（垃圾桶）；滑過有小小的文字提示；游標不亂跳');
  const card = await page.evaluate(() => { const r = [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('餐廳介紹')).getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2, left: r.left, right: r.right }; });
  await page.mouse.move(card.x, card.y); await sleep(250);
  const hov = await page.evaluate(() => {
    const it = [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('餐廳介紹'));
    const act = it.querySelector('.spare-item-act');
    const list = document.getElementById('sparePopList');
    return { act: !!act, shown: act ? getComputedStyle(it.querySelector('.spare-item-acts')).opacity : '', actRight: act ? act.getBoundingClientRect().right : 0,
      tip: act && act.dataset.tip, danger: act && act.classList.contains('is-danger'), icon: act && !!act.querySelector('svg.lucide-archive'), title: act && act.getAttribute('title'),
      cards: [...document.querySelectorAll('#sparePop .spare-item')].map((x) => getComputedStyle(x).cursor), list: getComputedStyle(list).cursor, pop: getComputedStyle(document.getElementById('sparePop')).cursor };
  });
  ok(hov.act && hov.shown === '1' && hov.actRight > card.right - 12, '使用中的卡片滑過，右邊出現一顆鈕');
  ok(hov.tip === '移到未使用' && !hov.danger && hov.icon && hov.title === '', `使用中＝「移到未使用」收起來圖示、不是紅色垃圾桶（${hov.tip}）`);
  ok(hov.cards.every((c) => c === 'default') && hov.list === 'default' && hov.pop === 'default', `卡片與間隙都是箭頭，不會跳來跳去（${[...new Set(hov.cards)].join()}）`);
  const actPos = await page.evaluate(() => { const r = [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('餐廳介紹')).querySelector('.spare-item-act').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(actPos.x, actPos.y); await sleep(700);
  const tip = await page.evaluate(() => { const t = document.querySelector('.tip-bubble.is-on'); if (!t) return null; const r = t.getBoundingClientRect(), p = document.getElementById('sparePop').getBoundingClientRect(); const cs = getComputedStyle(t); return { text: t.textContent, outside: r.left >= p.right, bg: cs.backgroundColor, op: cs.opacity }; });
  ok(!!tip && tip.text === '移到未使用' && tip.outside, `滑過圖示出現小小的提示，放在清單外面不擋字（${tip && tip.text}）`);
  ok(!!tip && tip.bg !== 'rgb(17, 24, 39)', `提示是淺色的，不搶眼（${tip && tip.bg}）`);
  await page.mouse.move(5, 5); await sleep(200);
  ok(await page.evaluate(() => !document.querySelector('.tip-bubble.is-on')), '滑開就收起');
  await page.mouse.move(actPos.x, actPos.y); await sleep(700);
  await shot('card-tip');
  await page.evaluate(() => [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('餐廳介紹')).querySelector('.spare-item-act').click());
  await sleep(500);
  s = await info();
  const restCell = await page.evaluate(() => leavesOf(page().blocks[0].node).find((l) => l.cell.text === '餐廳').cell.tap);
  ok(restCell === 'None' && s.items.includes('餐廳介紹|未使用') && s.popOpen, `「餐廳」那格不再進入子頁、「餐廳介紹」移到未使用、清單還開著（${s.items.join('，')}）`);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.b-toast')].map((x) => x.textContent.replace(/s+/g, ' ').trim()).pop() || '');
  ok(/子頁「餐廳介紹」已移至未使用的子頁/.test(toast), `提示可復原（${toast}）`);
  const un = await page.evaluate(() => { const b = [...document.querySelectorAll('#sparePop .spare-item')].find((x) => x.textContent.includes('餐廳介紹')).querySelector('.spare-item-act'); return { tip: b.dataset.tip, danger: b.classList.contains('is-danger'), icon: !!b.querySelector('svg.lucide-trash-2') }; });
  ok(un.tip === '刪除' && un.danger && un.icon, '移到未使用之後，那張卡片的鈕變成刪除（垃圾桶）');
  await page.evaluate(() => [...document.querySelectorAll('.b-toast button')].filter((b) => b.textContent.trim() === '復原').pop().click());
  await sleep(500);
  const back = await page.evaluate(() => { const c = leavesOf(page().blocks[0].node).find((l) => l.cell.text === '餐廳').cell; return c.tap === 'OpenSubPage' && c.sub && c.sub.name === '餐廳介紹' && !spares().some((x) => x.name === '餐廳介紹'); });
  ok(back, '按復原就接回原本那一格');

  console.log('6. 共用版面：收納匣在標題列');
  await page.evaluate(() => { setDirty(false); });
  await page.evaluate(() => exitWorkspace()); await sleep(700);
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const L = { id: 9996, name: '收納匣位置測試', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: c({ content: 'Text', text: '首頁' }) }] }], screen: { w: 1080, h: 1920 } };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L);
  });
  await sleep(800);
  s = await info();
  ok(s.boxShown && s.boxInHead && !s.trayBelow, '共用版面：收納匣在標題列右邊、畫布下方沒有那一條');
  ok(s.box.top >= s.head.top && s.box.bottom <= s.head.bottom + 1, '鈕在標題列裡');
  await page.click('#spareBtn'); await sleep(450);
  s = await info();
  ok(s.popOpen && Math.abs(s.pop.top - s.btn.top) < 1 && Math.abs(s.pop.width - s.btn.width) < 1 && s.items.length === 0, '點開＝從標題列的鈕往下長、跟鈕一樣寬');
  ok(s.firstInPop === 'spareAddBtn' && s.add.top >= s.box.bottom && !s.hintShown && !s.listShown && Math.abs(s.pop.bottom - s.add.bottom - 10) < 1.5, `沒有子頁：只有「新增子頁」，不寫提示（下緣留 ${(s.pop.bottom - s.add.bottom).toFixed(0)}px）`);
  await shot('pop-shared');
  await page.keyboard.press('Escape'); await sleep(400);
  s = await info();
  ok(s.popHidden && s.wsOpen, 'Esc＝收起，編輯視窗還在');

  ok(!errs.length, `沒有 JS 錯誤${errs.length ? '：' + errs.join(' | ') : ''}`);
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
