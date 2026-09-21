'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('../../node_modules/express');
const puppeteer = require('puppeteer-core');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const template = (await fs.readFile(path.join(root, 'public/play.html'), 'utf8'))
    .replaceAll('{{SITE_NAME}}', 'Park test')
    .replaceAll('{{PLAY_DEFAULT_DEVICE}}', '')
    .replaceAll('{{PARK_API}}', 'https://sensors.example/current');
  const config = {
    activePage: 0,
    pages: [{ id: 1, name: '園區', blocks: [{ id: 1, w: 1, node: {
      t: 'cell', bg: 'Solid', bgColor: 0xFFF8F8F8, content: 'ParkInfo', tap: 'OpenParkInfo', tapHint: 'None',
      wStUrl: 'https://sensors.example/current',
    } }] }],
  };
  const readings = { stations: [{
    station_id: 'D1', name: '遊園入口', status: 'online', received_at_local: '2026-09-18T14:32:00+08:00',
    values: { temperature: 31.5, heat_index: 394, humidity: 80, pm25: 15, hourly_rainfall: 12, daily_rainfall: 99 },
  }] };

  const app = express();
  app.use(express.json());
  app.get('/play/', (_req, res) => res.type('html').send(template));
  app.use('/admin', express.static(path.join(root, 'public')));
  app.get('/api/config/web-park-test/version', (_req, res) => res.json({ version: 1 }));
  app.get('/api/config/web-park-test', (_req, res) => res.json({ themeColor: '#E07800', config }));
  app.put('/api/config/web-park-test', (_req, res) => res.json({ version: 1 }));
  app.post('/api/devices/web-park-test/events', (_req, res) => res.json({ ok: true }));
  app.get('/api/station/current', (_req, res) => res.json(readings));
  app.get('/api/config/web-park-test/wait', () => { /* Keep the real long poll pending. */ });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });

  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('play.device:', 'Park test');
      localStorage.setItem('play.deviceKey:', 'test-only');
    });
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith('http://127.0.0.1:') ? request.continue() : request.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/play/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cell.tappable');
    await page.click('.cell.tappable');
    await page.waitForSelector('.park-metric-status');

    assert.equal(await page.$eval('#ovTitle', el => el.textContent), 'D1  遊園入口');
    assert.deepEqual(await page.$$eval('.park-metric-status', els => els.map(el => el.textContent)),
      ['體感炎熱', '潮濕', '空氣普通', '有雨']);
    assert.deepEqual(await page.$$eval('.park-metric-value', els => els.map(el => el.textContent)),
      ['31.5°C / 體感39.4°C', '80%', '15 μg/m³', '12.0 mm/h']);
    assert.equal(await page.$eval('.park-status-chip', el => el.textContent), '在線');
    assert.equal(await page.$eval('.park-updated', el => el.textContent), '更新時間 14:32');
    assert.equal(await page.$$eval('.park-metric', els => els.length), 4);
    assert.equal(await page.$eval('.park-marker', el => el.tagName), 'BUTTON');
    assert.ok(await page.$eval('.topbar', el => el.getBoundingClientRect().height >= 130), 'Kiosk top bar should match the enlarged assistant scale');
    assert.deepEqual(await page.$eval('.park-metrics', el => {
      const style = getComputedStyle(el);
      return [style.gridTemplateColumns.split(' ').length, style.gridTemplateRows.split(' ').length];
    }), [2, 2]);
    assert.equal(errors.length, 0, errors.join('\n'));
    await fs.mkdir(path.join(__dirname, 'shots'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, 'shots/park-info-sync.png'), fullPage: true });
    console.log('PASS: web park page uses enlarged kiosk nav and Android-aligned 2x2 friendly metrics');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
