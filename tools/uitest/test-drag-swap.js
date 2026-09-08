/* 驗證：畫布格子拖曳交換 + 面板「區塊上移／下移」。不按儲存，state 只在瀏覽器裡改。
   用法：BASE=http://localhost:3177 node test-drag-swap.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 佈置：3 個大塊，中間那塊左右分割；每格用純色＋文字標記
  await page.evaluate(() => {
    const mk = (text, color) => ({ ...DEFAULT_CELL(), content: 'Text', text, bgColor: color });
    page().blocks = [
      { id: 1, w: 1, node: mk('A', 0xFF1B5E20) },
      { id: 2, w: 1.4, node: { t: 'split', dir: 'Vertical', ratio: 0.5, a: mk('B', 0xFF0D47A1), b: mk('C', 0xFF4A148C) } },
      { id: 3, w: 0.8, node: mk('D', 0xFFB71C1C) },
    ];
    selected = { bi: 1, sub: 'a' };
    renderCanvas(); renderPanel();
  });
  await sleep(400);
  const layout = () => page.evaluate(() => page().blocks.map((b) => (b.node.t === 'split' ? `[${b.node.a.text}|${b.node.b.text}]` : b.node.text) + `(w${b.w})`).join(' '));
  const sel = () => page.evaluate(() => JSON.stringify(selected));
  console.log('初始:', await layout(), 'selected', await sel());
  await page.screenshot({ path: __dirname + '/shots/drag-0-before.png' });

  const center = async (bi, sub) => {
    const r = await page.evaluate((bi, sub) => {
      const el = document.querySelector(`#canvas .cell[data-bi="${bi}"][data-sub="${sub}"]`);
      const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, bi, sub);
    return r;
  };

  // 1) 拖 B（bi1/a，目前選取）到 D（bi2）：B↔D 對調、選取跟到 bi2
  let from = await center(1, 'a'), to = await center(2, '');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await sleep(150);
  const mid = await page.evaluate(() => ({
    ghost: !!document.querySelector('.drag-ghost'),
    source: document.querySelector('#canvas .cell.drag-source')?.dataset.bi,
    target: document.querySelector('#canvas .cell.drop-target')?.dataset.bi,
    cursor: document.body.style.cursor,
  }));
  console.log('拖曳中:', JSON.stringify(mid));
  await page.screenshot({ path: __dirname + '/shots/drag-1-mid.png' });
  await page.mouse.up();
  await sleep(300);
  console.log('B→D 後:', await layout(), 'selected', await sel(), 'dirty', await page.evaluate(() => dirty),
    'leftover', await page.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), src: !!document.querySelector('.drag-source'), tgt: !!document.querySelector('.drop-target'), cursor: document.body.style.cursor })));
  await page.screenshot({ path: __dirname + '/shots/drag-2-after.png' });

  // 2) 拖到空白處放開：不變、選取不變
  from = await center(0, '');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 300, from.y, { steps: 8 }); // 畫布右邊的面板
  await page.mouse.up(); await sleep(200);
  console.log('拖到外面:', await layout(), 'selected', await sel());

  // 3) 小位移＝一般點選：點 A 只換選取
  from = await center(0, '');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 1); await page.mouse.up(); await sleep(200);
  console.log('小位移點選:', await layout(), 'selected', await sel());

  // 4) 面板「區塊下移」：A 塊往下 → 選取 bi 跟到 1；到底時鈕 disabled
  const clickBtn = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('#cellPanel button')].find((x) => x.textContent.trim() === t); if (!b || b.disabled) return false; b.click(); return true; }, t);
  const btnState = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#cellPanel button')].filter((b) => /區塊[上下]移/.test(b.textContent)).map((b) => [b.textContent.trim(), b.disabled])));
  console.log('鈕(選 bi0):', JSON.stringify(await btnState()));
  console.log('下移 clicked:', await clickBtn('區塊下移')); await sleep(200);
  console.log('下移後:', await layout(), 'selected', await sel());
  console.log('下移 clicked:', await clickBtn('區塊下移')); await sleep(200);
  console.log('再下移後:', await layout(), 'selected', await sel(), '鈕', JSON.stringify(await btnState()));
  console.log('上移 clicked:', await clickBtn('區塊上移')); await sleep(200);
  console.log('上移後:', await layout(), 'selected', await sel());
  await page.screenshot({ path: __dirname + '/shots/drag-3-panel.png' });

  // 5) 分割格內 a↔b 對調
  from = await center(0, 'a'); to = await center(0, 'b');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up(); await sleep(200);
  console.log('a↔b 後:', await layout(), 'selected', await sel());

  console.log('page errors:', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
