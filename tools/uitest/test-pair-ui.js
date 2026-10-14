/* 機器總覽「新增機器」（2026-10-13 配對碼）實測：按鈕 → 6 格配對碼（打一個跳一格、打滿自動查；打錯紅框搖晃＋說明；
   可整組貼上「482 913」）→ 顯示機型、取名 → 新增 → 原地「正在新增」（轉圈）→ 機器連上後「已新增」（打勾）→ 自己關 →
   清單已經有這台而且在線 → 金鑰是配對發的專屬金鑰。
   CODE 不給＝自己用 API 開一組假的配對（只驗後台畫面；沒有真機器連上，最後會停在「機器還沒連上」）。
   模擬機器時再多驗兩種（2026-10-13）：這台按「重新配對」又輸入到同一個場域 → 停在號碼這一步、琥珀字「此機器已在清單中」、
   格子琥珀框淡淡亮一次不搖晃（2026-10-14 改，原本是另一個畫面），機器收到 already；
   機器連在別的場域 → 取名那一步提醒「新增後將從該場域移除」。每一步對話框高度都不變。
   用法：BASE=http://localhost:3177 CODE=016849 NAME=測試手機（配對） node test-pair-ui.js */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3177';
const USER = process.env.USER_NAME || 'joyeadmin';
const PASS = process.env.PASS || 'joye#2026';
const NAME = process.env.NAME || '配對測試';
const OUT = path.join(__dirname, 'shots', 'pair');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`);
}
const DLG = '.b-modal-overlay.is-open .pair-dlg';
const state = (page) => page.$eval(DLG, (m) => ({
  title: m.querySelector('.b-alert-title')?.textContent || '',
  desc: m.querySelector('.b-alert-desc')?.textContent || '',
  descError: m.querySelector('.b-alert-desc')?.classList.contains('is-error') || false,
  boxes: [...m.querySelectorAll('.otp-box')].map((b) => b.value).join('|'),
  otpShown: !m.querySelector('.otp').hidden,
  otpError: m.querySelector('.otp').classList.contains('is-error'),
  nameShown: !m.querySelector('.pair-name').hidden,
  ok: m.querySelector('.b-alert-foot button:last-child')?.textContent || '',
  okDisabled: m.querySelector('.b-alert-foot button:last-child')?.disabled || false,
  focus: document.activeElement?.getAttribute('aria-label') || '',
}));
async function clearBoxes(page) {
  await page.$$eval(`${DLG} .otp-box`, (bs) => bs.forEach((b) => { b.value = ''; }));
  await page.click(`${DLG} .otp-box`);
}
const dlgHeight = (page) => page.$eval(DLG, (m) => Math.round(m.getBoundingClientRect().height));
const rand6 = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
/** 模擬機器登記一組配對碼（extra＝current／currentSite，key＝目前的金鑰） */
async function startPair(extra, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-Device-Key'] = key;
  return (await fetch(BASE + '/api/pair/start', { method: 'POST', headers, body: JSON.stringify({ code: rand6(), suggestedId: 'uitest-pair', model: 'UITest Model', ...extra }) })).json();
}
/** 開「新增機器」、打號碼、按下一步，等到換成 title 那一步 */
async function enterCode(page, code, title) {
  await page.click('#addDeviceBtn');
  await page.waitForSelector(DLG, { timeout: 5000 });
  await sleep(300);
  const h0 = await dlgHeight(page);
  await page.keyboard.type(code);
  await page.click(`${DLG} .b-alert-foot button:last-child`);
  await page.waitForFunction((t) => document.querySelector('.pair-dlg .b-alert-title')?.textContent === t, { timeout: 5000 }, title).catch(() => {});
  await sleep(400);
  return h0;
}

(async () => {
  let code = process.env.CODE;
  const sim = {}; // 模擬的機器配對完拿到的 { deviceId, deviceKey }
  if (!code) {
    // 沒給 CODE：自己當一台機器——登記號碼、掛長輪詢等結果，拿到金鑰就用它問一次版本（＝連上、清單變在線）
    const r = await (await fetch(BASE + '/api/pair/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suggestedId: 'uitest-pair', model: 'UITest Model' }) })).json();
    code = r.code;
    console.log('（沒給 CODE，模擬一台機器：' + code + '）');
    (async () => {
      for (;;) {
        const w = await fetch(`${BASE}/api/pair/${r.pairId}/wait`).then((x) => x.json()).catch(() => null);
        if (!w) return;
        if (w.status === 'done') {
          Object.assign(sim, { deviceId: w.deviceId, deviceKey: w.deviceKey });
          await fetch(`${BASE}/api/config/${encodeURIComponent(w.deviceId)}/version`, { headers: { 'X-Device-Key': w.deviceKey } });
          return;
        }
      }
    })();
  }
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1512, height: 828 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', USER);
  await page.type('#password', PASS);
  await page.click('.btn-login');
  await page.waitForSelector('#addDeviceBtn', { visible: true, timeout: 10000 });
  await sleep(800);

  check('機器總覽有「新增機器」鈕', (await page.$eval('#addDeviceBtn', (b) => b.textContent.trim())) === '新增機器');
  await page.click('#addDeviceBtn');
  await page.waitForSelector(DLG, { timeout: 5000 });
  await sleep(300);
  let s = await state(page);
  check('第一步：6 格、游標在第 1 格、下一步先不能按', s.title === '新增機器' && s.boxes.split('|').length === 6 && s.focus === '第 1 碼' && s.okDisabled, JSON.stringify(s));

  await page.keyboard.type('12');
  s = await state(page);
  check('打一個跳一格（打 2 碼後在第 3 格）', s.boxes === '1|2||||' && s.focus === '第 3 碼' && s.okDisabled, `${s.boxes} ${s.focus}`);
  await page.keyboard.press('Backspace');
  s = await state(page);
  check('空格按退格回上一格並清掉', s.boxes === '1|||||' && s.focus === '第 2 碼', `${s.boxes} ${s.focus}`);
  await page.keyboard.type('a');
  s = await state(page);
  check('打非數字不收', s.boxes === '1|||||', s.boxes);
  await page.screenshot({ path: path.join(OUT, '1-typing.png') });

  await clearBoxes(page);
  await page.keyboard.type('000000');
  await sleep(500);
  s = await state(page);
  check('打滿不自動查：還在第一步、下一步可以按', s.title === '新增機器' && !s.descError && !s.okDisabled, JSON.stringify(s));
  await page.click(`${DLG} .b-alert-foot button:last-child`); // 下一步
  await page.waitForFunction(() => document.querySelector('.pair-dlg .b-alert-desc')?.classList.contains('is-error'), { timeout: 5000 }).catch(() => {});
  s = await state(page);
  check('按下一步才查；號碼不對：紅框搖晃＋說明', s.otpError && s.descError && /找不到這組配對碼/.test(s.desc), s.desc);
  await page.screenshot({ path: path.join(OUT, '2-wrong-code.png') });

  await page.keyboard.press('Backspace');
  s = await state(page);
  check('改號碼時錯誤說明收回', !s.descError && /6 位數配對碼/.test(s.desc), s.desc);

  // 整組貼上（照機器畫面抄，中間有空格）
  await clearBoxes(page);
  await page.$eval(`${DLG} .otp-box`, (b, text) => {
    const dt = new DataTransfer();
    dt.setData('text', text);
    b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, code.slice(0, 3) + ' ' + code.slice(3));
  await sleep(300);
  s = await state(page);
  check('整組貼上「123 456」6 格都填好、停在第一步', s.boxes === code.split('').join('|') && s.title === '新增機器' && !s.okDisabled, s.boxes);
  await page.click(`${DLG} .b-alert-foot button:last-child`); // 下一步
  await sleep(160);
  await page.screenshot({ path: path.join(OUT, '3a-transition.png') });
  await page.waitForFunction(() => document.querySelector('.pair-dlg .b-alert-title')?.textContent === '幫這台機器取個名字', { timeout: 5000 }).catch(() => {});
  s = await state(page);
  check('按下一步 → 過場 → 取名（顯示機型）', s.title === '幫這台機器取個名字' && !s.otpShown && s.nameShown && /機型：/.test(s.desc) && s.ok === '新增', JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, '3-name.png') });

  await page.click(`${DLG} .b-alert-foot button:last-child`); // 空白名稱
  s = await state(page);
  check('沒取名：提示「請幫這台機器取個名字」', /請幫這台機器取個名字/.test(s.desc), s.desc);

  await page.type(`${DLG} .pair-name`, NAME);
  const t0 = Date.now();
  await page.click(`${DLG} .b-alert-foot button:last-child`);
  const busy = await page.waitForFunction(() => document.querySelector('.pair-dlg .pair-dlg-icon.is-busy') && document.querySelector('.pair-dlg .b-alert-title')?.textContent, { timeout: 3000 })
    .then((h) => h.jsonValue()).catch(() => '');
  await page.screenshot({ path: path.join(OUT, '4-busy.png') });
  check('按新增後原地顯示「正在新增」（轉圈）', busy === '正在新增', busy);
  const doneTitle = await page.waitForFunction(() => document.querySelector('.pair-dlg .pair-dlg-icon.is-done, .pair-dlg .pair-dlg-icon.is-slow') && document.querySelector('.pair-dlg .b-alert-title')?.textContent, { timeout: 25000 })
    .then((h) => h.jsonValue()).catch(() => '');
  const doneMs = Date.now() - t0;
  await page.screenshot({ path: path.join(OUT, '5-done.png') });
  const slow = !!(await page.$('.pair-dlg .pair-dlg-icon.is-slow'));
  check(`機器連上後顯示「已新增」（${(doneMs / 1000).toFixed(1)} 秒）`, doneTitle === `已新增「${NAME}」` && !slow, slow ? '機器 20 秒沒連上（slow）' : doneTitle);
  const closed = await page.waitForFunction(() => !document.querySelector('.pair-dlg'), { timeout: 4000 }).then(() => true).catch(() => false);
  check('「已新增」停一下就自己關', closed);
  await sleep(600);

  const row = await page.$$eval('#deviceTable tbody tr.device-row', (trs, name) => {
    const tr = trs.find((r) => r.children[1] && r.children[1].textContent.trim() === name);
    return tr ? { id: tr.children[2].textContent.trim(), status: tr.querySelector('.b-badge')?.textContent.trim() } : null;
  }, NAME);
  check('對話框關掉時清單已經有這台、而且在線', !!row && row.status === '在線', JSON.stringify(row));
  if (row) {
    const H = { Authorization: 'Bearer ' + (await page.evaluate(() => sessionStorage.getItem('token'))) };
    const d = (await (await fetch(BASE + '/api/devices', { headers: H })).json()).find((x) => x.DeviceId === row.id);
    check('新機器用的是配對發的專屬金鑰', d && d.KeyKind === 'own' && d.KeySource === 'pair', d && `${d.KeyKind}/${d.KeySource}`);
  }
  await page.screenshot({ path: path.join(OUT, '6-listed.png') });

  if (sim.deviceKey) {
    // 這台按「重新配對」，又輸入到同一個場域（機器帶目前的編號＋金鑰）
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); // 無頭 Chrome 預設減少動態，要看呼吸光
    const H = { Authorization: 'Bearer ' + (await page.evaluate(() => sessionStorage.getItem('token'))) };
    const countDevices = async () => (await (await fetch(BASE + '/api/devices', { headers: H })).json()).length;
    const before = await countDevices();
    const r2 = await startPair({ current: sim.deviceId }, sim.deviceKey);
    const waited = fetch(`${BASE}/api/pair/${r2.pairId}/wait`).then((x) => x.json()).catch(() => null);
    await page.click('#addDeviceBtn');
    await page.waitForSelector(DLG, { timeout: 5000 });
    await sleep(300);
    const h0 = await dlgHeight(page);
    await page.keyboard.type(r2.code);
    await page.click(`${DLG} .b-alert-foot button:last-child`);
    await page.waitForFunction(() => document.querySelector('.pair-dlg .b-alert-desc')?.classList.contains('is-exists'), { timeout: 5000 }).catch(() => {});
    await sleep(1000); // 呼吸光最亮的時候拍（2 秒呼吸一次，約 1 秒最亮）
    await page.screenshot({ path: path.join(OUT, '7-exists.png') });
    s = await state(page);
    const h1 = await dlgHeight(page);
    const look = await page.$eval(DLG, (m) => {
      const box = getComputedStyle(m.querySelector('.otp-box'));
      return {
        descColor: getComputedStyle(m.querySelector('.b-alert-desc')).color, border: box.borderTopColor,
        anim: box.animationName, times: box.animationIterationCount, otpExists: m.querySelector('.otp').classList.contains('is-exists'),
        cancelShown: !m.querySelector('.b-alert-foot button:first-child').hidden,
      };
    });
    check('同一場域再輸入一次：停在號碼這一步，說明改成「已在清單中」與清單上的名稱',
      s.title === '新增機器' && s.otpShown && !s.nameShown && s.desc.includes('已在清單中') && s.desc.includes(`「${NAME}」`) && s.ok === '下一步' && look.cancelShown, JSON.stringify(s));
    check('琥珀字、琥珀框、格子淡淡亮一次、不搖晃（不是紅色錯誤）',
      look.otpExists && !s.otpError && !s.descError && look.descColor === 'rgb(199, 124, 0)' && look.border === 'rgb(245, 160, 15)' && look.anim === 'otp-breathe' && look.times === '1', JSON.stringify(look));
    check('對話框高度不變', h0 === h1, `${h0} → ${h1}`);
    const w2 = await waited;
    check('機器那邊收到「已經在這裡」（already）', w2 && w2.status === 'already', JSON.stringify(w2));
    await sleep(1500);
    await page.click(`${DLG} .b-alert-foot button:last-child`); // 沒改號碼再按一次下一步
    await sleep(400);
    s = await state(page);
    check('沒改號碼再按下一步：還是「已在清單中」（不會變成找不到）', s.desc.includes('已在清單中') && !s.descError, s.desc);
    await page.keyboard.press('Backspace');
    s = await state(page);
    check('改號碼時橘色說明收回', !s.desc.includes('已在清單中') && /6 位數配對碼/.test(s.desc), s.desc);
    await page.click(`${DLG} .b-alert-foot button:first-child`); // 取消
    await page.waitForFunction(() => !document.querySelector('.pair-dlg'), { timeout: 3000 }).catch(() => {});
    await sleep(300);
    const after = await countDevices();
    check('清單沒有多一台', after === before, `${before} → ${after}`);

    // 機器連在別的場域：取名時提醒
    const r3 = await startPair({ currentSite: '揚昇高爾夫球場' });
    const h2 = await enterCode(page, r3.code, '幫這台機器取個名字');
    s = await state(page);
    const h3 = await dlgHeight(page);
    await page.screenshot({ path: path.join(OUT, '8-other-site.png') });
    check('連在別的場域的機器：取名時提醒會從那邊移除', /目前連線到「揚昇高爾夫球場」，新增後將從該場域移除/.test(s.desc) && s.nameShown, s.desc);
    check('取名（含提醒）對話框高度不變', h2 === h3, `${h2} → ${h3}`);
    await page.click(`${DLG} .b-alert-foot button:first-child`); // 取消
    await fetch(`${BASE}/api/pair/${r3.pairId}`, { method: 'DELETE' });
  }

  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `\n${failed} 項失敗` : `\n全部通過（${results.length} 項）`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
