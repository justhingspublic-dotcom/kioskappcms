/* 客服主題色列的「JustAI」色票（橘底 J 標）目視檢查：登入後把 swatchRow 渲染到頁面上截圖。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = process.argv[2] || 'http://localhost:3177';
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 900, height: 300 } });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 20000 });
  const stamped = await page.evaluate(() => Array.from(document.scripts).map((s) => s.getAttribute('src')).filter((s) => s && s.includes('app.js')));
  console.log('app.js src =', stamped);
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForFunction(() => document.getElementById('whoami').textContent.trim() !== '—', { timeout: 10000 });
  const html = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'inspector';
    host.style.cssText = 'position:fixed;left:0;top:0;width:300px;bottom:0;z-index:9999;background:#fff;padding:24px;display:flex;flex-direction:column;gap:16px';
    host.appendChild(swatchRow(ACCENT_SWATCHES, null, true, () => {}, '自動', [JUSTAI_CHIP]));
    host.appendChild(swatchRow(ACCENT_SWATCHES, 0, true, () => {}, '自動', [JUSTAI_CHIP]));
    host.appendChild(swatchRow(ACCENT_SWATCHES, 0xFF123456, true, () => {}, '自動', [JUSTAI_CHIP]));
    document.body.appendChild(host);
    return host.querySelector('.swatch.justai').outerHTML.slice(0, 120);
  });
  console.log(html);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'justai-swatch.png') });
  await browser.close();
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
