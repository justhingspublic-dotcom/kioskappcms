'use strict';
// Read-only UI verification. Only creates and closes its own admin login sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('../../node_modules/dotenv');
const puppeteer = require('puppeteer-core');
(async () => {
  const version = process.argv[2] || '1.5.0';
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const [site, envFile] of [['joye', '.env'], ['sunrise', '.env.sunrise']]) {
      const credentials = dotenv.parse(await fs.readFile(path.resolve(__dirname, '../..', envFile)));
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      let apkRequests = 0;
      page.on('request', req => { if (new URL(req.url()).pathname.endsWith('.apk')) apkRequests++; });
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(`https://justdisplay.justhings.com.tw/${site}/admin/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#username', { visible: true });
      await page.type('#username', credentials.ADMIN_USERNAME);
      await page.type('#password', credentials.ADMIN_PASSWORD);
      await page.click('.btn-login');
      await page.waitForSelector('#mainView:not(.hidden)', { timeout: 30000 });
      await page.click('#appDownloadBtn');
      await page.waitForSelector('#appDownloadDetails:not([hidden])');
      assert.equal(await page.$eval('#appReleaseVersion', el => el.textContent), `版本 ${version}`);
      assert.equal(await page.$eval('#appDownloadFile', el => el.textContent), '下載 APK');
      assert.equal(await page.$eval('#appDownloadModal .b-modal-head', el => getComputedStyle(el).borderBottomWidth), '0px');
      assert.equal(await page.$eval('#appDownloadModal .b-modal-foot', el => getComputedStyle(el).borderTopWidth), '0px');
      assert.ok(await page.$eval('#appDownloadBtn', el => el.previousElementSibling.classList.contains('header-sep')));
      assert.ok(await page.$eval('#appDownloadBtn', el => getComputedStyle(el).color === getComputedStyle(document.querySelector('#playLink')).color));
      assert.ok(await page.$eval('#appDownloadBtn svg', el => getComputedStyle(el).width === getComputedStyle(document.querySelector('#playLink svg')).width));
      assert.equal(await page.$eval('#appDownloadFile', el => new URL(el.href).pathname), `/downloads/app/${version}/kiosk-app-${version}.apk`);
      assert.equal(apkRequests, 0);
      assert.ok(await page.$eval('#appReleaseNotes', el => el.children.length >= 3));
      await page.screenshot({ path: path.join(__dirname, `shots/app-update-prod-${site}.png`) });
      const animation = await page.evaluate(() => {
        const modal = document.querySelector('#appDownloadModal');
        document.querySelector('#appDownloadClose').click();
        return { name: getComputedStyle(modal).animationName, duration: getComputedStyle(modal).animationDuration, visible: modal.classList.contains('is-visible') };
      });
      assert.equal(animation.name, 'ws-overlay-out');
      assert.equal(animation.duration, '0.12s');
      assert.ok(animation.visible);
      await page.waitForSelector('#appDownloadModal:not(.is-visible)');
      await page.click('.header-user-btn');
      await page.click('#logoutBtn');
      await page.waitForSelector('#loginView:not(.hidden)');
      console.log(`PASS ${site}: actual login, download modal, real ${version} metadata, animated close, no automatic APK download, logout`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
