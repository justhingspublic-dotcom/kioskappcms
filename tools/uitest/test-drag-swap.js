/* 驗證：畫布格子拖曳交換。不按儲存，state 只在瀏覽器裡改。
   2026-10-12 排版更自由：沒有「大區塊」了（舊的多區塊頁面打開就併成一個區塊、每一格都能再切），
   「區塊上移／下移」鈕跟著拿掉；格子改用 path 指（data-path），這裡改成用格子上的文字找格子。
   用法：BASE=http://localhost:3177 USER_=joyeadmin PASS_=joye#2026 node test-drag-swap.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  -- ' + extra : ''}`); };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'admin');
  await page.type('#password', process.env.PASS_ || 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(600);

  // 佈置：舊格式 3 個大塊，中間那塊左右分割；每格用純色＋文字標記（畫布一畫就併成一個區塊）
  await page.evaluate(() => {
    const mk = (text, color) => ({ ...DEFAULT_CELL(), content: 'Text', text, bgColor: color });
    page().blocks = [
      { id: 1, w: 1, node: mk('A', 0xFF1B5E20) },
      { id: 2, w: 1.4, node: { t: 'split', dir: 'Vertical', ratio: 0.5, a: mk('B', 0xFF0D47A1), b: mk('C', 0xFF4A148C) } },
      { id: 3, w: 0.8, node: mk('D', 0xFFB71C1C) },
    ];
    selected = { bi: 1, sub: 'a' }; // 舊格式的選取：併成一個區塊時換成 path
    renderCanvas(); renderPanel();
  });
  await sleep(400);
  // 依閱讀順序列出每格的文字（格位不變，只看內容怎麼跑）
  const layout = () => page.evaluate(() => leavesOf(page().blocks[0].node).map((l) => l.cell.text).join(' '));
  const selText = () => page.evaluate(() => (selected ? getCell(selected)?.text : null));
  const pathOfText = (t) => page.evaluate((x) => leavesOf(page().blocks[0].node).find((l) => l.cell.text === x).path, t);
  check('舊的 3 個大區塊打開 → 併成一個區塊，選取換成 path 仍指 B', await page.evaluate(() => page().blocks.length === 1 && typeof selected.path === 'string') && (await selText()) === 'B', `${await layout()} sel=${await page.evaluate(() => JSON.stringify(selected))}`);
  await page.screenshot({ path: __dirname + '/shots/drag-0-before.png' });

  const center = async (text) => {
    const p = await pathOfText(text);
    return page.evaluate((q) => {
      const el = document.querySelector(`#canvas .cell[data-path="${q}"]`);
      const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, p);
  };

  // 1) 拖 B（目前選取）到 D：B↔D 對調、選取跟著 B 走
  const before = await layout();
  let from = await center('B'), to = await center('D');
  const dPath = await pathOfText('D');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await sleep(150);
  const mid = await page.evaluate(() => ({
    ghost: !!document.querySelector('.drag-ghost'),
    source: document.querySelector('#canvas .cell.drag-source')?.querySelector('.pv-text')?.textContent,
    target: document.querySelector('#canvas .cell.drop-target')?.querySelector('.pv-text')?.textContent,
    cursor: document.body.style.cursor,
  }));
  check('拖曳中：幽靈、來源 B 淡出、目標 D 亮框、游標 grabbing', mid.ghost && mid.source === 'B' && mid.target === 'D' && mid.cursor === 'grabbing', JSON.stringify(mid));
  await page.screenshot({ path: __dirname + '/shots/drag-1-mid.png' });
  await page.mouse.up();
  await sleep(300);
  const after = await layout();
  const leftover = await page.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), src: !!document.querySelector('.drag-source'), tgt: !!document.querySelector('.drop-target'), cursor: document.body.style.cursor }));
  check('B→D 放開：兩格內容對調、選取跟著 B 到 D 的位置、標成未儲存', before === 'A B C D' && after === 'A D C B' && (await page.evaluate(() => selected.path)) === dPath && (await selText()) === 'B' && (await page.evaluate(() => dirty)), `${before} → ${after}`);
  check('沒有殘留（幽靈／來源／目標／游標）', !leftover.ghost && !leftover.src && !leftover.tgt && !leftover.cursor, JSON.stringify(leftover));
  await page.screenshot({ path: __dirname + '/shots/drag-2-after.png' });

  // 2) 拖到空白處放開：不變、選取不變
  from = await center('A');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 300, from.y, { steps: 8 }); // 畫布右邊的面板
  await page.mouse.up(); await sleep(200);
  check('拖到畫布外放開：不變、選取不變', (await layout()) === 'A D C B' && (await selText()) === 'B', await layout());

  // 3) 小位移＝一般點選：點 A 只換選取
  from = await center('A');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 1); await page.mouse.up(); await sleep(200);
  check('小位移＝點選：只換選取到 A', (await layout()) === 'A D C B' && (await selText()) === 'A', await layout());

  // 4) 「區塊上移／下移」跟大區塊一起拿掉了
  const moveBtns = await page.evaluate(() => [...document.querySelectorAll('#cellPanel button')].filter((b) => /區塊[上下]移|刪除區塊/.test(b.textContent)).length);
  check('面板沒有「區塊上移／下移／刪除區塊」', moveBtns === 0, moveBtns);
  await page.screenshot({ path: __dirname + '/shots/drag-3-panel.png' });

  // 5) 同一個分割裡左右兩格對調（D|C → C|D）
  from = await center('D'); to = await center('C');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up(); await sleep(200);
  check('分割格內左右對調', (await layout()) === 'A C D B', await layout());

  check('沒有頁面錯誤', !errs.length, JSON.stringify(errs));
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
