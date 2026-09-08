/* 驗證：右側面板的自訂下拉在視窗底部附近打開時不超出視窗（往上開或限高捲動），上半部的則往下開。
   用法：BASE=http://localhost:3177 USER_=joyeadmin PASS_=xxx node test-dd-overflow.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 面板裡的下拉用「目前顯示值」找：內容＝'無'、顯示方式＝'填滿裁切'
const findDD = (label) => `[...document.querySelectorAll('#cellPanel .b-dd')].find((d) => d.querySelector('.b-dd-value')?.textContent.trim() === ${JSON.stringify(label)})`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'admin'); await page.type('#password', process.env.PASS_ || 'kiosk#2026'); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(600);
  // 圖片背景格 → 面板夠長，內容下拉會落在下半部
  await page.evaluate(() => {
    page().blocks = [{ id: 1, w: 1, node: { ...DEFAULT_CELL(), bg: 'Image', bgImgs: ['/files/_none.png'], content: 'None' } }];
    selected = { bi: 0, sub: null }; renderCanvas(); renderPanel();
  });
  await sleep(300);

  const toggle = async (label) => { await page.evaluate(`${findDD(label)}.querySelector('.b-dd-trigger').click()`); await sleep(250); };
  const measure = async (name, label, expectUp) => {
    const r = await page.evaluate(`(() => { const sel = ${findDD(label)}; const menu = sel.querySelector('.b-dd-menu');
      const t = sel.querySelector('.b-dd-trigger').getBoundingClientRect(), m = menu.getBoundingClientRect();
      return { trigTop: Math.round(t.top), trigBottom: Math.round(t.bottom), menuTop: Math.round(m.top), menuBottom: Math.round(m.bottom), menuH: Math.round(m.height),
        maxH: menu.style.maxHeight, scrollable: menu.scrollHeight > menu.clientHeight + 1, vh: innerHeight, items: menu.querySelectorAll('.b-dd-item').length }; })()`);
    const up = r.menuBottom <= r.trigTop;
    const ok = r.menuTop >= 0 && r.menuBottom <= r.vh && r.menuH > 0 && (expectUp === undefined || up === expectUp);
    console.log(name.padEnd(8), ok ? 'OK  ' : 'FAIL', up ? '往上' : '往下', JSON.stringify(r));
  };
  const scrollTrigTo = async (label, fromBottom) => {
    await page.evaluate(`(() => { const t = ${findDD(label)}.querySelector('.b-dd-trigger').getBoundingClientRect();
      document.getElementById('cellPanel').scrollTop += t.bottom - (innerHeight - ${fromBottom}); })()`);
    await sleep(200);
  };

  // 1) 內容下拉距底 ~300px（使用者截圖情境）：下方不夠、上方夠 → 往上開
  await scrollTrigTo('無', 300); await toggle('無'); await measure('內容距底300', '無', true);
  await page.screenshot({ path: __dirname + '/shots/dd-1-near-bottom.png' });
  await toggle('無');
  // 2) 顯示方式下拉在面板上半部：下方放得下 → 往下開、不限高
  await page.evaluate(() => { document.getElementById('cellPanel').scrollTop = 0; }); await sleep(200);
  await toggle('填滿裁切'); await measure('顯示方式', '填滿裁切', false);
  await toggle('填滿裁切');
  // 3) 矮視窗：兩邊都不夠 → 限高、可捲、仍在視窗內
  await page.setViewport({ width: 1440, height: 520 }); await sleep(300);
  await scrollTrigTo('無', 200); await toggle('無'); await measure('矮視窗', '無');
  await page.screenshot({ path: __dirname + '/shots/dd-3-short.png' });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
