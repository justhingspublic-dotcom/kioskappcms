'use strict';
// Isolated component test using the real admin markup/styles/script, without DB mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('../../node_modules/express');
const puppeteer = require('puppeteer-core');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const notes = JSON.parse(await fs.readFile(path.resolve(root, '../KioskApp/files/app-release-1.5.0.json'), 'utf8'));
  const release = { ...notes, releasedAt: '2026-09-17T09:00:00.000Z', fileSize: 64 * 1024 * 1024,
    apkUrl: '/downloads/app/1.5.0/kiosk-app-1.5.0.apk' };
  const html = (await fs.readFile(path.join(root, 'public/index.html'), 'utf8'))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/\{\{[A-Z_]+\}\}/g, '')
    .replace('</body>', '<script src="app-update.js"></script></body>');
  let unavailable = false, downloads = 0;
  let downloaded;
  const firstDownload = new Promise(resolve => { downloaded = resolve; });
  const app = express();
  app.get('/api/app/releases/latest', (_req, res) => unavailable ? res.status(503).json({}) : res.json(release));
  app.get(release.apkUrl, (_req, res) => { downloads++; res.attachment('test-only.apk').send('test-only'); downloaded(); });
  app.get('/admin/', (_req, res) => res.type('html').send(html));
  app.use('/admin', express.static(path.join(root, 'public')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith('http://127.0.0.1:') ? req.continue() : req.abort());
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
    await page.evaluate(() => {
      document.querySelector('#mainView').classList.remove('hidden');
      document.querySelector('#loginView')?.classList.add('hidden');
    });
    assert.equal(downloads, 0);
    await page.click('#appDownloadBtn');
    await page.waitForSelector('#appDownloadDetails:not([hidden])');
    assert.equal(await page.$eval('#appReleaseVersion', el => el.textContent), '版本 1.5.0');
    assert.equal(await page.$eval('#appDownloadFile', el => el.textContent), '下載 APK');
    assert.equal(await page.$eval('#appDownloadModal .b-modal-head', el => getComputedStyle(el).borderBottomWidth), '0px');
    assert.equal(await page.$eval('#appDownloadModal .b-modal-foot', el => getComputedStyle(el).borderTopWidth), '0px');
    assert.ok(await page.$eval('#appDownloadBtn', el => el.previousElementSibling.classList.contains('header-sep')));
    assert.ok(await page.$eval('#appDownloadBtn', el => getComputedStyle(el).color === getComputedStyle(document.querySelector('#playLink')).color));
    assert.equal(await page.$eval('#appReleaseNotes', el => el.children.length), notes.changelog.length);
    assert.equal(await page.$eval('#appDownloadFile', el => el.getAttribute('href')), release.apkUrl);
    assert.equal(downloads, 0, 'Opening the modal must not download the APK');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'appDownloadClose');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'appDownloadFile');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'appDownloadClose');
    await page.screenshot({ path: path.join(__dirname, 'shots/app-update-desktop.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-color-mode', 'dark'));
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'shots/app-update-mobile-dark.png') });
    assert.ok(await page.$eval('.is-app-download', el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    }), 'Modal fits the mobile viewport');
    const leave = await page.evaluate(() => {
      const overlay = document.querySelector('#appDownloadModal');
      const close = document.querySelector('#appDownloadClose');
      close.click(); close.click(); // Repeated close must not restart the animation.
      const animation = overlay.getAnimations().find(a => a.animationName === 'ws-overlay-out');
      animation?.pause();
      if (animation) animation.currentTime = 60;
      const result = { name: getComputedStyle(overlay).animationName, opacity: +getComputedStyle(overlay).opacity,
        visible: overlay.classList.contains('is-visible'), inert: document.querySelector('#appDownloadBtn').closest('[inert]') !== null };
      animation?.play();
      return result;
    });
    assert.equal(leave.name, 'ws-overlay-out');
    assert.ok(leave.visible && leave.inert && leave.opacity > 0 && leave.opacity < 1, 'Fade is visible and focus isolation remains until animation ends');
    await page.waitForSelector('#appDownloadModal:not(.is-visible)');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'appDownloadBtn');
    assert.equal(await page.$eval('#appDownloadBtn', el => el.closest('[inert]')), null);
    await page.setViewport({ width: 1440, height: 1000 });
    unavailable = true;
    await page.click('#appDownloadBtn');
    await page.waitForSelector('#appDownloadRetry:not([hidden])');
    assert.equal(await page.$eval('#appDownloadFile', el => el.hidden), true);
    unavailable = false;
    await page.click('#appDownloadRetry');
    await page.waitForSelector('#appDownloadDetails:not([hidden])');
    await page.click('#appDownloadFile');
    await firstDownload;
    assert.equal(downloads, 1, 'Only the explicit download button requests an APK');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#appDownloadModal:not(.is-visible)');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.click('#appDownloadBtn');
    await page.waitForSelector('#appDownloadDetails:not([hidden])');
    assert.ok(await page.evaluate(() => {
      document.querySelector('#appDownloadClose').click();
      return !document.querySelector('#appDownloadModal').classList.contains('is-visible') &&
        document.activeElement.id === 'appDownloadBtn';
    }), 'Reduced motion closes immediately without losing focus');
    assert.deepEqual(errors, []);
    console.log('PASS: version/notes, explicit-only download, focus trap/restore, mobile fit, failure/retry, animated close, reduced motion, no JS errors');
  } finally {
    await browser?.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
