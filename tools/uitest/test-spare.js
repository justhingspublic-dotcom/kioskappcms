/* 子頁新流程＋未使用的子頁（2026-10-27）：取名視窗建子頁、格子上「名稱 ›」進子頁、標頭刪除收進未使用的子頁、
   收納列（開關、點選編輯、拖到格子接回、＋ 新增子頁）、取名視窗挑未使用的子頁、刪格子／刪整頁收進來、清單裡刪除要確認、
   共用版面存檔帶 spareSubs（攔 PUT 不寫 DB）、舊版 App 不給設子頁。
   用法：node test-spare.js（BASE 預設本機 3177；USER_／PASS_ 換帳號） */
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
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); // 轉場直接換，測試不用等動畫
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
  // 共用版面存檔：攔下來看內容，不寫進資料庫
  let savedShared = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/api/shared-settings')) {
      try { savedShared = JSON.parse(req.postData()).settings; } catch { savedShared = 'bad'; }
      return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return req.continue();
  });

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
    const L = { id: 9997, name: '子頁流程測試', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString() };
    (shared.layouts ||= []).push(L);
    enterSharedLayoutEditor(L);
  });
  await sleep(800);

  const info = () => page.evaluate(() => ({
    title: document.querySelector('#pageHead .ph-title')?.textContent || '',
    path: [...document.querySelectorAll('#pageHead .ph-sub > :not(.ph-sep)')].map((x) => x.textContent.trim()),
    inSub: !!document.querySelector('#pageHead .ph-lead:not(:disabled)'),
    acts: document.querySelectorAll('#pageHead .ph-body:not(.is-leaving) .ph-act').length,
    pills: [...document.querySelectorAll('#canvas .pv-sub-pill .pv-sub-name')].map((x) => x.textContent),
    spares: spares().map((s) => ({ name: s.name, from: s.from })),
    trayShown: !!document.querySelector('#wsModal .ws-head-actions > #spareBox:not([hidden])'), // 共用版面：收納匣在標題列
    trayOpen: sparePopOpen && !document.getElementById('sparePop').hidden,
    trayItems: [...document.querySelectorAll('#sparePop .spare-item .spare-item-name')].map((x) => x.textContent),
    trayWheres: [...document.querySelectorAll('#sparePop .spare-item .spare-item-where')].map((x) => x.textContent),
    trayCount: document.querySelector('#spareBtn .spare-tray-count')?.textContent || '',
    chip: document.querySelector('#pageHead .ph-body:not(.is-leaving) .ph-chip')?.textContent || '',
    dialog: document.querySelector('.b-modal.is-alert .b-alert-title')?.textContent || '',
    pickRows: document.querySelectorAll('.b-modal.is-alert .spare-pick-row').length,
    toast: [...document.querySelectorAll('.b-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).pop() || '',
  }));
  const cellCenter = (text) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('#canvas .cell')].find((c) => c.textContent.includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  // 收納匣面板沒開就先打開（點子頁進去編輯、點外面都會收起）
  const openTray = async () => { if (!(await page.evaluate(() => sparePopOpen))) { await page.click('#spareBtn'); await sleep(400); } };
  // 拖曳：開始拖就出現放大預覽，目標格子要在放大預覽裡找
  const dragOnto = async (text) => {
    await openTray();
    const from = await page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y - 20, { steps: 4 });
    await sleep(450); // 放大預覽放大完
    const to = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.drop-board .cell')].find((c) => c.textContent.includes(t));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    if (to) await page.mouse.move(to.x, to.y, { steps: 10 });
    await sleep(100);
    return to;
  };
  const clickCell = async (text) => { const p = await cellCenter(text); await page.mouse.click(p.x, p.y); await sleep(350); };
  const setTap = async (v) => {
    await page.evaluate((val) => {
      const s = [...document.querySelectorAll('#cellPanel select')].find((x) => [...x.options].some((o) => o.value === 'OpenWeb'));
      s.value = val; s.dispatchEvent(new Event('change'));
    }, v);
    await sleep(400);
  };
  const dialogType = async (text) => {
    await page.waitForSelector('.b-modal.is-alert input', { visible: true });
    await page.type('.b-modal.is-alert input', text);
  };
  const dialogOk = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll('.b-modal.is-alert .b-alert-foot button')].pop(); b.click(); });
    await sleep(500);
  };

  // ---------- 1. 點擊動作選「進入子頁」→ 取名視窗 → 建立直接進去 ----------
  console.log('1. 取名視窗建子頁');
  await clickCell('餐廳');
  await setTap('OpenSubPage');
  let s = await info();
  ok(s.dialog === '新增子頁', '跳出「新增子頁」視窗');
  ok(s.pickRows === 0, '還沒有未使用的子頁，視窗不列清單');
  await dialogType('餐廳介紹');
  await shot('1-dialog');
  await dialogOk();
  s = await info();
  ok(s.inSub && s.title === '餐廳介紹', `建立後直接進子頁（標題 ${s.title}）`);
  ok(s.path.join('>') === '首頁>餐廳介紹', `路徑 ${s.path.join(' › ')}`);
  ok(s.acts === 2, '子頁標頭有改名、刪除兩顆鈕');
  ok(!s.chip, '子頁標頭沒有「第 N 層子頁」標籤');
  // 子頁裡放點東西（有內容的子頁拿掉時才會收進未使用的子頁）
  await page.evaluate(() => { const c = getCell({ bi: 0, path: '' }); c.content = 'Text'; c.text = '菜單'; setDirty(true); renderCanvas(); });
  await sleep(200);

  // ---------- 2. 回主頁：格子上「名稱 ›」，點一下進去 ----------
  console.log('2. 格子上的子頁鈕');
  await page.click('#pageHead .ph-lead'); await sleep(500);
  s = await info();
  ok(!s.inSub && s.pills.join() === '餐廳介紹', `主頁格子上有「餐廳介紹 ›」（${s.pills.join()}）`);
  await page.click('#canvas .pv-sub-pill'); await sleep(500);
  s = await info();
  ok(s.inSub && s.title === '餐廳介紹', '點一下就進子頁');

  // ---------- 3. 子頁標頭改名 ----------
  console.log('3. 標頭改名');
  await page.evaluate(() => [...document.querySelectorAll('#pageHead .ph-body:not(.is-leaving) .ph-act')][0].click());
  await page.waitForSelector('.b-modal.is-alert input', { visible: true });
  await page.evaluate(() => { const i = document.querySelector('.b-modal.is-alert input'); i.value = '美食介紹'; });
  await dialogOk();
  s = await info();
  ok(s.title === '美食介紹', `改名成功（${s.title}）`);

  // ---------- 3b. 收納匣列出使用中的子頁；拖到別格＝移過去（先確認、可復原）；點一下＝進去 ----------
  console.log('3b. 收納匣裡的使用中子頁');
  await page.click('#pageHead .ph-lead'); await sleep(500);
  s = await info();
  ok(s.trayShown && !s.trayOpen && s.trayCount === '1', `標題列有收納匣、預設收起、數字 1（${s.trayCount}）`);
  await page.click('#spareBtn'); await sleep(400);
  s = await info();
  ok(s.trayOpen && s.trayItems.join() === '美食介紹' && s.trayWheres.join() === '首頁 › 餐廳', `列出使用中的子頁與位置（${s.trayWheres.join()}）`);
  await shot('3b-used');
  // 拖到子頁原本所在的那一格：紅色遮罩＋「已套用這個子頁」，放不上去
  {
    await dragOnto('餐廳');
    await sleep(250);
    const here = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.drop-board .cell')].find((x) => x.textContent.includes('餐廳'));
      const l = c && c.querySelector('.drop-here-label');
      return { cls: c ? c.className : '', label: l ? `${getComputedStyle(l).opacity}|${l.textContent}` : '' };
    });
    ok(/is-drop-here/.test(here.cls) && here.label === '1|已套用這個子頁', `原本那一格：紅色＋「已套用這個子頁」（${here.label}）`);
    await shot('3b-here');
    await page.keyboard.press('Escape'); await sleep(450);
    await page.mouse.up(); await sleep(200);
  }
  {
    await dragOnto('住宿');
    await page.mouse.up(); await sleep(450);
  }
  s = await info();
  ok(/將子頁「美食介紹」移到這一格/.test(s.dialog), `移動前先確認（${s.dialog}）`);
  await shot('3b-confirm');
  await dialogOk();
  s = await info();
  const tapsAfterMove = await page.evaluate(() => Object.fromEntries(leavesOf(page().blocks[0].node).map((l) => [l.cell.text, l.cell.tap])));
  ok(tapsAfterMove['住宿'] === 'OpenSubPage' && tapsAfterMove['餐廳'] === 'None', `移過去：住宿接上、餐廳不再進入子頁（${JSON.stringify(tapsAfterMove)}）`);
  ok(/已將子頁「美食介紹」移到這一格/.test(s.toast), `提示：${s.toast}`);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.b-toast button')].filter((x) => x.textContent.includes('復原')).pop(); b && b.click(); });
  await sleep(400);
  const tapsUndo = await page.evaluate(() => Object.fromEntries(leavesOf(page().blocks[0].node).map((l) => [l.cell.text, l.cell.tap])));
  ok(tapsUndo['餐廳'] === 'OpenSubPage' && tapsUndo['住宿'] === 'None', '復原：回到餐廳那一格');
  {
    const p = await page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
    await page.mouse.click(p.x, p.y); await sleep(500);
  }
  s = await info();
  ok(s.inSub && s.path.join('>') === '首頁>美食介紹', `點使用中的子頁＝進去編輯（${s.path.join(' › ')}）`);
  // 自己不能拖進自己裡面
  ok(await page.evaluate(() => document.querySelector('#sparePop .spare-item').classList.contains('is-current')), '正在編輯的那一個標成目前');
  ok((await info()).trayOpen, '點進去編輯後面板還開著（手動關）');
  await page.keyboard.press('Escape'); await sleep(350);

  // ---------- 4. 標頭刪除 → 收進未使用的子頁、回上一層 ----------
  console.log('4. 標頭刪除');
  await page.evaluate(() => [...document.querySelectorAll('#pageHead .ph-body:not(.is-leaving) .ph-act')][1].click());
  await sleep(600);
  s = await info();
  ok(!s.inSub, '回到主頁');
  ok(s.spares.length === 1 && s.spares[0].name === '美食介紹', '子頁收進未使用的子頁');
  ok(s.spares[0] && s.spares[0].from === '原本在「首頁」的「餐廳」格', `記下原本在哪（${s.spares[0] && s.spares[0].from}）`);
  ok(/已移至未使用的子頁/.test(s.toast), `提示：${s.toast}`);
  ok(s.pills.length === 0, '餐廳那一格不再有子頁');
  ok(s.trayCount === '1', `收納匣數字 1（${s.trayCount}）`);

  // ---------- 5. 收納列：打開、點選進去編輯、返回 ----------
  console.log('5. 收納列');
  ok(!s.trayOpen, '收納匣收起');
  await page.click('#spareBtn'); await sleep(400);
  s = await info();
  ok(s.trayOpen && s.trayItems.join() === '美食介紹' && s.trayWheres.join() === '未使用', `展開、列出未使用的子頁（${s.trayItems.join()}／${s.trayWheres.join()}）`);
  await shot('5-tray');
  const itemPos = () => page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  let p = await itemPos();
  await page.mouse.click(p.x, p.y); await sleep(500);
  s = await info();
  ok(s.inSub && s.path.join('>') === '未使用的子頁>美食介紹', `點縮圖進去編輯（路徑 ${s.path.join(' › ')}）`);
  await shot('5-spare-edit');
  await page.click('#pageHead .ph-lead'); await sleep(500);
  s = await info();
  ok(!s.inSub, '← 回到主頁');

  // ---------- 6. 拖到格子上接回 ----------
  console.log('6. 拖到格子接回');
  const boardTo = await dragOnto('住宿');
  const board = await page.evaluate(() => {
    const b = document.querySelector('.drop-board .drop-board-canvas'), small = document.querySelector('#canvas');
    return {
      open: !!b, ratio: b && small ? b.getBoundingClientRect().height / small.getBoundingClientRect().height : 0,
      marked: !!document.querySelector('.drop-board .cell.is-drop-ok'),
      noText: !document.querySelector('.drop-board .drop-label'),
      mask: (() => { const m = document.querySelector('.drop-board .cell.is-drop-ok > .drop-mask'); return m ? getComputedStyle(m).backgroundColor : ''; })(),
      lifted: !!document.querySelector('.spare-ghost.is-lifted'),
    };
  });
  ok(!!boardTo && board.open && board.ratio > 1.5, `一拖就出現放大預覽（${board.ratio.toFixed(2)} 倍）`);
  ok(board.marked && board.noText && /^(rgba?|color)\(/.test(board.mask), `滑到的格子蓋半透明主題色遮罩、不寫字（${board.mask}）`);
  ok(board.lifted, '抓起的縮圖微微放大');
  await shot('6-drag');
  await page.mouse.up(); await sleep(500);
  ok(await page.evaluate(() => !document.querySelector('.drop-board') && !document.querySelector('.spare-ghost')), '放開後放大預覽與縮圖都收掉');
  s = await info();
  ok(s.spares.length === 0 && s.pills.join() === '美食介紹', `接到「住宿」那一格（${s.pills.join()}）`);
  ok(/已將子頁「美食介紹」接到這一格/.test(s.toast), `提示：${s.toast}`);
  ok(await page.evaluate(() => leavesOf(page().blocks[0].node).find((l) => l.cell.text === '住宿').cell.tap === 'OpenSubPage'), '住宿的點擊動作變成進入子頁');
  // 復原
  await page.evaluate(() => { const b = [...document.querySelectorAll('.b-toast button')].filter((x) => x.textContent.includes('復原')).pop(); b && b.click(); }); // 最新那一則
  await sleep(400);
  s = await info();
  ok(s.spares.length === 1 && s.pills.length === 0, '復原：子頁回到未使用的子頁');

  // ---------- 6a. 取消：拖到預覽外面放開、或按 Esc ----------
  console.log('6a. 取消拖曳');
  {
    await dragOnto('不存在的格子'); // 只開始拖、不滑到格子上
    await page.mouse.move(20, 20, { steps: 6 });
    await page.mouse.up(); await sleep(500);
    s = await info();
    ok(s.spares.length === 1 && s.pills.length === 0 && await page.evaluate(() => !document.querySelector('.drop-board')), '拖到外面放開＝不接上、放大預覽收掉');
    await dragOnto('住宿');
    await page.keyboard.press('Escape'); await sleep(450);
    await page.mouse.up(); await sleep(200);
    s = await info();
    ok(s.spares.length === 1 && s.pills.length === 0 && await page.evaluate(() => !document.querySelector('.drop-board') && !document.querySelector('.spare-ghost')), 'Esc＝取消');
    // 不會卡在半路（2026-10-27 user 回報偶爾卡住）：一下甩離卡片、拖曳被系統打斷、切到別的視窗
    const gone = () => page.evaluate(() => !document.querySelector('.drop-board') && !document.querySelector('.spare-ghost') && !document.body.classList.contains('is-spare-dragging'));
    const from = await page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
    await page.evaluate(() => { const it = document.querySelector('#sparePop .spare-item'); it.setPointerCapture = () => { throw new Error('lost'); }; }); // 模擬拿不到 pointer capture
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 300, from.y - 300); // 一下就離開卡片
    await sleep(350);
    const follow = await page.evaluate(() => { const g = document.querySelector('.spare-ghost'); return g ? g.style.translate : ''; });
    await page.mouse.move(40, 40); await sleep(120);
    const follow2 = await page.evaluate(() => { const g = document.querySelector('.spare-ghost'); return g ? g.style.translate : ''; });
    ok(!!follow && follow !== follow2, `一下甩離卡片：縮圖照樣跟著走（${follow} → ${follow2}）`);
    await page.mouse.up(); await sleep(450);
    ok(await gone(), '放開後收乾淨');
    await page.evaluate(() => { delete document.querySelector('#sparePop .spare-item').setPointerCapture; });
    await dragOnto('住宿');
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
    await sleep(450);
    s = await info();
    ok(s.spares.length === 1 && s.pills.length === 0 && await gone(), '拖曳被打斷＝取消、收乾淨');
    await page.mouse.up();
    await dragOnto('住宿');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(450);
    s = await info();
    ok(s.spares.length === 1 && s.pills.length === 0 && await gone(), '切到別的視窗＝取消、收乾淨');
    await page.mouse.up(); await sleep(200);
  }

  // ---------- 6b. 拖到點擊動作是別的的格子：先確認（2026-10-27 user）----------
  console.log('6b. 拖到有別的點擊動作的格子');
  await page.evaluate(() => { const c = leavesOf(page().blocks[0].node).find((l) => l.cell.text === '住宿').cell; c.tap = 'OpenWeb'; c.tapUrl = 'https://example.com/room'; render(); });
  await sleep(300);
  const dragTo = async (text) => { await dragOnto(text); await page.mouse.up(); await sleep(450); };
  await dragTo('住宿');
  s = await info();
  ok(/接到這一格/.test(s.dialog), `先確認（${s.dialog}）`);
  ok(await page.evaluate(() => /目前點擊會「開啟網頁」/.test(document.querySelector('.b-modal.is-alert .b-alert-desc')?.textContent || '')), '寫出原本的點擊動作');
  await shot('6b-confirm');
  await page.evaluate(() => [...document.querySelectorAll('.b-modal.is-alert .b-alert-foot button')][0].click()); // 取消
  await sleep(400);
  s = await info();
  ok(s.spares.length === 1 && s.pills.length === 0, '取消＝不接上');
  await dragTo('住宿');
  await dialogOk();
  const room = await page.evaluate(() => leavesOf(page().blocks[0].node).find((l) => l.cell.text === '住宿').cell);
  ok(room.tap === 'OpenSubPage' && room.tapUrl === 'https://example.com/room', '確認後接上，原本的網址留著');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.b-toast button')].filter((x) => x.textContent.includes('復原')).pop(); b && b.click(); });
  await sleep(400);
  ok(await page.evaluate(() => leavesOf(page().blocks[0].node).find((l) => l.cell.text === '住宿').cell.tap === 'OpenWeb'), '復原：回到開啟網頁');
  await page.evaluate(() => { const c = leavesOf(page().blocks[0].node).find((l) => l.cell.text === '住宿').cell; c.tap = 'None'; render(); });
  await sleep(300);

  // ---------- 7. 收納列「＋ 新增子頁」（預先建好）----------
  console.log('7. 預先新增子頁');
  await openTray();
  await page.click('#sparePop .spare-add'); await sleep(300);
  s = await info();
  ok(s.dialog === '新增子頁', '跳出新增子頁視窗');
  await dialogType('交通資訊');
  await dialogOk();
  s = await info();
  ok(s.inSub && s.path.join('>') === '未使用的子頁>交通資訊', '建好直接進去編輯');
  ok(s.spares.length === 2 && s.spares[0].from === '', '放進未使用的子頁（尚未接到格子）');
  await page.click('#pageHead .ph-lead'); await sleep(500);

  // ---------- 8. 點擊動作選「進入子頁」→ 視窗下面挑未使用的子頁 ----------
  console.log('8. 取名視窗挑未使用的子頁');
  await clickCell('餐廳');
  await setTap('OpenSubPage');
  s = await info();
  ok(s.pickRows === 2, `視窗列出 2 個未使用的子頁（${s.pickRows}）`);
  await shot('8-pick');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.b-modal.is-alert .spare-pick-row')].find((r) => r.textContent.includes('交通資訊'));
    row.querySelector('button').click();
  });
  await sleep(500);
  s = await info();
  ok(!s.inSub && s.pills.join() === '交通資訊' && s.spares.length === 1, '挑了就接到這一格、留在主頁');

  // ---------- 9. 刪格子：子頁收進未使用的子頁 ----------
  console.log('9. 刪格子');
  // 先讓「交通資訊」有內容，刪格子時才會收（空白子頁直接丟）
  await page.evaluate(() => { const c = leavesOf(page().blocks[0].node).find((l) => l.cell.text === '餐廳').cell; c.sub.node.content = 'Text'; c.sub.node.text = '公車'; });
  await clickCell('餐廳');
  await page.evaluate(() => [...document.querySelectorAll('#cellPanel button')].find((b) => b.textContent.trim() === '刪除這格').click());
  await sleep(500);
  s = await info();
  ok(s.spares.length === 2 && s.spares[0].name === '交通資訊', '格子刪掉，子頁收進未使用的子頁');
  ok(/已刪除這一格/.test(s.toast) && /已移至未使用的子頁/.test(s.toast), `提示：${s.toast}`);

  // ---------- 10. 收納列裡刪除：要確認 ----------
  console.log('10. 清單裡刪除');
  await openTray();
  await page.evaluate(() => [...document.querySelectorAll('#sparePop .spare-item')][1].querySelector('.spare-item-act.is-danger').click());
  await sleep(300);
  s = await info();
  ok(/刪除子頁「美食介紹」/.test(s.dialog), `先確認（${s.dialog}）`);
  await dialogOk();
  s = await info();
  ok(s.spares.length === 1 && s.spares[0].name === '交通資訊', '確認後真的刪掉');

  // ---------- 11. 刪整頁：那一頁的子頁收進來 ----------
  console.log('11. 刪整頁');
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    state.config.pages.push({ id: 2, name: '夏季活動', blocks: [{ id: 1, w: 1, node: c({ content: 'Text', text: '活動', tap: 'OpenSubPage', sub: { name: '去年活動', node: c({ content: 'Text', text: '照片' }), layout: 'Kiosk' } }) }] });
    pageIndex = 1; setDirty(true); render();
    // 共用版面沒有頁籤列：直接走頁籤的刪除
    const tab = [...document.querySelectorAll('#pageTabs .tab')][1];
    tab.querySelector('button[aria-label="刪除此頁"]').click();
  });
  await sleep(500);
  s = await info();
  ok(s.spares.length === 2 && s.spares[0].name === '去年活動' && s.spares[0].from === '原本在「夏季活動」頁（已刪除）', `整頁刪掉，子頁收進來（${s.spares[0] && s.spares[0].from}）`);
  ok(/1 個子頁已移至未使用的子頁/.test(s.toast), `提示：${s.toast}`);

  // ---------- 12. 層數：第 2 層裡不能再接有子頁的子頁 ----------
  console.log('12. 層數');
  const fits = await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const deep = { id: 99, name: '兩層', node: c({ tap: 'OpenSubPage', sub: { name: '內層', node: c(), layout: 'Kiosk' } }), layout: 'Kiosk' };
    const main = spareFits(deep);
    subStack = []; spareEdit = spares()[0].id; // 進到未使用的子頁＝第 2 層
    const inSpare = spareFits(deep);
    spareEdit = 0; render();
    return { main, inSpare };
  });
  ok(fits.main === true && fits.inSpare === false, `主頁可接兩層的子頁、第 2 層不行（${JSON.stringify(fits)}）`);

  // ---------- 13. 存檔帶 spareSubs ----------
  console.log('13. 存檔');
  await page.evaluate(() => saveSharedLayout());
  await sleep(600);
  const L = savedShared && savedShared.layouts && savedShared.layouts.find((x) => x.id === 9997);
  ok(!!L && Array.isArray(L.spareSubs) && L.spareSubs.length === 2, `存檔帶未使用的子頁（${L && L.spareSubs && L.spareSubs.length}）`);

  // ---------- 14. 舊版 App 不給設子頁 ----------
  console.log('14. 版本判斷');
  const sup = await page.evaluate(() => {
    const keep = [wsMode, wsAppVer];
    const out = {};
    wsMode = 'device';
    for (const v of ['1.59', '1.60', '1.61', '2.0', 'web-1.0', '', '1.8']) { wsAppVer = v; out[v || '(空)'] = subsSupported(); }
    [wsMode, wsAppVer] = keep;
    return out;
  });
  ok(sup['1.59'] === false && sup['1.60'] && sup['1.61'] && sup['2.0'] && sup['web-1.0'] && sup['(空)'] === false && sup['1.8'] === false, `1.60 起與網頁播放頁才可以（${JSON.stringify(sup)}）`);

  ok(!errs.length, `沒有 JS 錯誤${errs.length ? '：' + errs.join(' | ') : ''}`);
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
