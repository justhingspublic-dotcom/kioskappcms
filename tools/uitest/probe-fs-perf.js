/* 切換字級順不順（2026-10-29 user：調整字體大小時網頁切換很不順）：
   1) 只換 data-fs＋強制排版要多久（機器總覽、工作區開著兩種）；2) 從點選項開始每一格畫面的間隔（卡頓＝間隔很長）；
   3) 過場途中逐格截圖（暫停 view transition 的動畫）看是不是兩層字疊在一起。
   用法：node probe-fs-perf.js（CPU=4 模擬慢 4 倍的電腦） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'fs-perf');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026'); await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 }); await sleep(1500);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  console.log('減少動態', await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'VT', await page.evaluate(() => typeof document.startViewTransition));
  const cdp = await page.target().createCDPSession();
  if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });

  const layoutCost = () => page.evaluate(() => {
    const out = [];
    for (const v of ['lg', null, 'sm', null]) {
      const t0 = performance.now();
      if (v) document.documentElement.setAttribute('data-fs', v); else document.documentElement.removeAttribute('data-fs');
      document.body.offsetHeight; // 強制算樣式＋排版
      out.push(Math.round(performance.now() - t0));
    }
    return out;
  });
  console.log('只換字級＋排版（毫秒，大→特大→大→中→大）', await layoutCost());

  // 點選項：記錄之後 1.2 秒每一格的間隔
  const clickAndFrames = async (label) => {
    await page.evaluate(() => {
      window.__f = []; let last = performance.now();
      const loop = (t) => { window.__f.push(Math.round(t - last)); last = t; if (window.__f.length < 200) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await page.evaluate((label) => [...document.querySelectorAll('.fs-seg-opt')].find((o) => o.textContent === label).click(), label);
    await sleep(1300);
    const f = await page.evaluate(() => window.__f);
    const big = f.filter((x) => x > 25);
    return { 最長一格: Math.max(...f), 超過25ms的格數: big.length, 明細: big.join(',') };
  };
  await page.click('.header-fs-wrap .header-icon-btn'); await sleep(500);
  console.log('機器總覽：點特大', JSON.stringify(await clickAndFrames('特大')));
  console.log('機器總覽：點大', JSON.stringify(await clickAndFrames('大')));

  // 過場途中逐格（暫停所有動畫，含 ::view-transition 的）
  await page.evaluate(() => [...document.querySelectorAll('.fs-seg-opt')].find((o) => o.textContent === '特大').click());
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => document.getAnimations().some((a) => a.effect && a.effect.pseudoElement))) break; await sleep(10); }
  const anims = await page.evaluate(() => { const a = document.getAnimations(); a.forEach((x) => x.pause()); return a.map((x) => `${x.effect && x.effect.pseudoElement || (x.effect && x.effect.target && x.effect.target.className) || '?'}:${x.animationName || x.transitionProperty || ''}`); });
  console.log('過場中的動畫', anims.slice(0, 12).join(' | '));
  for (const t of [50, 95, 150, 250]) {
    await page.evaluate((t) => document.getAnimations().forEach((a) => { if (a.effect && a.effect.pseudoElement) a.currentTime = t; }), t);
    await page.screenshot({ path: path.join(OUT, `vt-${t}.png`), clip: { x: 256, y: 0, width: 1256, height: 330 } });
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll('.fs-seg-opt')].find((o) => o.textContent === '大').click());
  await sleep(1000);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
