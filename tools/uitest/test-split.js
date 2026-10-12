/* 排版更自由（2026-10-12）：每一格都能再切。
   版面編輯器：選取格四邊的「＋」（滑上去預覽新格子）、右側十字、同排自動平均、平均分配、刪除後重新平均／旁邊接手、
   12 格上限與太小不能切、分隔線拖曳吸附 1/3＋比例小標籤、跨層拖曳交換、舊的多大區塊頁面打開就併成一個區塊（看起來一樣）、
   所有比例在 0.1–0.9；播放頁（play.js）畫巢狀分割跟編輯畫布同比例，舊頁面併前併後畫起來一模一樣。
   只在瀏覽器裡改編輯器的 state、新增的頁面都不存：config／共用設定的 PUT 全部被攔下（保險），dev DB 不會被動到。
   播放頁的設定用 request interception 假造。截圖：shots/split/
   用法：node test-split.js（BASE 預設 http://localhost:3177；DEVICE 預設 dev DB 的 uitest 測試機） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/+$/, '');
const USER = process.env.USER_ || 'joyeadmin';
const PASS = process.env.PASS_ || 'joye#2026';
const DEVICE = process.env.DEVICE || '2312dra50g-01c1'; // dev DB 的「uitest」測試機（找不到就用第一台）
const OUT = path.join(__dirname, 'shots', 'split');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  -- ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1512,828'], defaultViewport: { width: 1512, height: 828 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errs.push('console: ' + m.text()); });
  // 保險：這支測試不存檔——config／共用設定的 PUT 一律攔下並記下來
  const blockedPuts = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/api\/(config|shared-settings)/.test(req.url())) {
      blockedPuts.push(req.url());
      return req.respond({ status: 500, contentType: 'application/json', body: '{"error":"test-split 不存檔"}' });
    }
    req.continue();
  });
  const shot = (name, clip) => page.screenshot({ path: path.join(OUT, name + '.png'), ...(clip ? { clip } : {}) });
  const safe = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, 'exception: ' + e.message.split('\n')[0]); } };

  // ---------- 登入 → 開測試機的工作區 ----------
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', USER); await page.type('#password', PASS); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => window.setColorMode && window.setColorMode('light', false));
  const dev = await page.evaluate(async (id) => { const list = await api('GET', '/api/devices'); return list.find((d) => d.DeviceId === id) || list[0]; }, DEVICE);
  console.log('測試機：', dev.DeviceName || '', dev.DeviceId);
  await page.evaluate((d) => enterWorkspace(d), dev);
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible') && !document.getElementById('editor').classList.contains('hidden'), { timeout: 10000 });
  await sleep(700);

  // ---------- 小工具（頁面裡）----------
  const tree = () => page.evaluate(() => JSON.parse(JSON.stringify(page().blocks[0].node)));
  /** 模型：每格佔整頁的比例（閱讀順序）＋文字標記 */
  const model = () => page.evaluate(() => { const root = page().blocks[0].node; const r = layoutRects(root); return leavesOf(root).map((l) => ({ path: l.path, text: l.cell.text || '', ...r.get(l.path) })); });
  /** 畫布 DOM：每格加回縫（內側邊各 4px）後佔畫布的比例 */
  const dom = () => page.evaluate(() => {
    const root = document.querySelector('#canvas .cv-root').getBoundingClientRect();
    return [...document.querySelectorAll('#canvas .cell')].map((c) => {
      const b = c.getBoundingClientRect(), x = b.left - root.left, y = b.top - root.top, E = 0.6, g = 4;
      const l = x > E ? g : 0, t = y > E ? g : 0, r = x + b.width < root.width - E ? g : 0, bt = y + b.height < root.height - E ? g : 0;
      return { path: c.dataset.path, x: (x - l) / root.width, y: (y - t) / root.height, w: (b.width + l + r) / root.width, h: (b.height + t + bt) / root.height, text: c.querySelector('.pv-text')?.textContent || '' };
    });
  });
  const sel = () => page.evaluate(() => selected && selected.path);
  // 能切的方向＝右側十字能按的那幾顆（畫布上的＋ 2026-10-12 拿掉）
  const handleSides = () => page.$$eval('#cellPanel .split-dir', (els) => els.filter((e) => !e.disabled).map((e) => e.dataset.side).sort().join(','));
  const cross = () => page.$$eval('#cellPanel .split-dir', (els) => Object.fromEntries(els.map((e) => [e.dataset.side, !e.disabled])));
  const clickCell = async (p) => { await page.evaluate((q) => document.querySelector(`#canvas .cell[data-path="${q}"]`).click(), p); await sleep(250); };
  const clickHandle = async (side) => { await page.click(`#cellPanel .split-dir[data-side="${side}"]`); await sleep(250); };
  const clickPanelBtn = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('#cellPanel button')].find((x) => x.textContent.trim() === t); if (!b || b.disabled) return false; b.click(); return true; }, text);
  const panelBtnDisabled = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('#cellPanel button')].find((x) => x.textContent.trim() === t); return b ? b.disabled : null; }, text);
  const cellAt = (cells, fx, fy) => cells.find((c) => fx >= c.x - 1e-6 && fx < c.x + c.w && fy >= c.y - 1e-6 && fy < c.y + c.h);
  const canvasClip = async () => page.evaluate(() => { const f = document.querySelector('.canvas-col').getBoundingClientRect(), p = document.querySelector('.panel-col').getBoundingClientRect(); return { x: Math.max(0, f.left - 12), y: f.top - 12, width: p.right - f.left + 24, height: f.height + 24 }; });
  const ratiosBad = () => page.evaluate(() => {
    const bad = [];
    state.config.pages.forEach((pg, i) => (pg.blocks || []).forEach((b) => (function walk(n, p) {
      if (!isSplit(n)) return;
      if (!(n.ratio >= 0.1 && n.ratio <= 0.9)) bad.push(`頁${i + 1}:${p || '根'}=${n.ratio}`);
      walk(n.a, p + 'a'); walk(n.b, p + 'b');
    })(b.node, '')));
    return bad;
  });

  // 「新增大區塊」整個不見了，工作區在 828 高的視窗不用捲
  check('沒有「新增大區塊」鈕', await page.evaluate(() => !document.getElementById('addBlockBtn') && ![...document.querySelectorAll('#wsModal button')].some((b) => b.textContent.includes('大區塊'))));
  check('版面頁籤在 1512×828 不用捲（body 不溢出）', await page.evaluate(() => { const b = document.querySelector('#wsModal .b-modal-body'); return b.scrollHeight <= b.clientHeight + 1; }),
    await page.evaluate(() => { const b = document.querySelector('#wsModal .b-modal-body'); return { sh: b.scrollHeight, ch: b.clientHeight }; }));

  // ---------- 1) 新頁面＝一整格；選取 → 四顆「＋」 ----------
  // 給播放頁比對的巢狀頁（連同當下編輯畫布量到的位置）：平均分配後的 4 格頁、12 格頁
  const snaps = [];
  const snapPage = async (name) => snaps.push({ name, pg: await page.evaluate(() => JSON.parse(JSON.stringify(page()))), editor: await dom() });
  await safe('新頁面與＋', async () => {
    await page.click('.page-tabs .add-page'); await sleep(450);
    const st = await page.evaluate(() => ({ blocks: page().blocks.length, cells: document.querySelectorAll('#canvas .cell').length, divs: document.querySelectorAll('#canvas .cv-divider').length, handles: document.querySelectorAll('#canvas .cv-handle').length }));
    check('新頁面＝一個區塊、一整格、沒有分隔線；畫布上沒有＋', st.blocks === 1 && st.cells === 1 && st.divs === 0 && st.handles === 0, st);
    await clickCell('');
    check('選取一整格 → 十字四邊都能按、畫布上沒有＋', (await handleSides()) === 'bottom,left,right,top' && (await page.$$('#canvas .cv-handle')).length === 0, await handleSides());
    check('右側十字四邊都能按、格數 1', JSON.stringify(await cross()) === JSON.stringify({ top: true, left: true, right: true, bottom: true }) && (await page.$eval('#cellPanel .split-count', (e) => e.textContent)).includes('目前 1 格（最多 12 格；太小的格子不能再切）'));
    check('只有一格：刪除這格、平均分配都不能按', (await panelBtnDisabled('刪除這格')) === true && (await panelBtnDisabled('平均分配')) === true);
    await shot('01-selected-handles', await canvasClip());

    // 滑到右側十字的「右邊」：畫布右半邊出現虛線「新格子」預覽
    const hb = await page.$eval('#cellPanel .split-dir[data-side="right"]', (h) => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(hb.x, hb.y); await sleep(250);
    const g = await page.evaluate(() => {
      const gh = document.querySelector('#canvas .cv-ghost'), root = document.querySelector('#canvas .cv-root').getBoundingClientRect(), r = gh.getBoundingClientRect(), cs = getComputedStyle(gh);
      return { visible: !gh.hidden && cs.display !== 'none', text: gh.textContent, x0: (r.left - root.left) / root.width, x1: (r.right - root.left) / root.width, y0: (r.top - root.top) / root.height, y1: (r.bottom - root.top) / root.height, dashed: cs.borderTopStyle };
    });
    check('滑到十字的「右邊」→ 畫布右半邊出現虛線「新格子」預覽', g.visible && g.text === '新格子' && g.dashed === 'dashed' && near(g.x0, 0.5, 0.03) && near(g.x1, 1, 0.01) && near(g.y0, 0, 0.01) && near(g.y1, 1, 0.01), g);
    await shot('02-hover-preview', await canvasClip());
    await page.mouse.move(hb.x, hb.y + 160); await sleep(200);
    check('滑開 → 預覽消失', await page.$eval('#canvas .cv-ghost', (e) => e.hidden));
  });

  // ---------- 2) 往右切 → 50/50；再往右切 → 三等分 ----------
  await safe('往右切', async () => {
    await clickHandle('right');
    let m = await model();
    check('往右切 → 兩格 50/50、新格子在右邊且被選取', m.length === 2 && near(m[0].w, 0.5, 0.01) && near(m[1].w, 0.5, 0.01) && m[1].x > 0.4 && (await sel()) === m[1].path, { m, sel: await sel() });
    check('面板標題＝格子 2', (await page.$eval('#cellPanel .panel-head h3', (e) => e.textContent)) === '格子 2');
    await clickHandle('right');
    m = await model();
    const d = await dom();
    check('右邊那格再往右切 → 三欄等寬（模型 ±1%）', m.length === 3 && m.every((c) => near(c.w, 1 / 3, 0.01) && near(c.h, 1, 1e-6)), m.map((c) => +c.w.toFixed(4)));
    check('三欄等寬（畫布 DOM ±1%）', d.length === 3 && d.every((c) => near(c.w, 1 / 3, 0.01)), d.map((c) => +c.w.toFixed(4)));
    const divs = await page.evaluate(() => { const root = document.querySelector('#canvas .cv-root').getBoundingClientRect(); return [...document.querySelectorAll('#canvas .cv-divider')].map((e) => { const r = e.getBoundingClientRect(); return +(((r.left + r.width / 2) - root.left) / root.width).toFixed(4); }).sort(); });
    check('兩條分隔線在 1/3、2/3', divs.length === 2 && near(divs[0], 1 / 3, 0.01) && near(divs[1], 2 / 3, 0.01), divs);
    check('選取跟著新格子（最右邊）', (await sel()) === m[2].path);
    await shot('03-three-columns', await canvasClip());
  });

  // ---------- 3) 中間那格往下切（用右側十字）→ 上下兩格 ----------
  await safe('往下切', async () => {
    let m = await model();
    await clickCell(m[1].path);
    await page.click('#cellPanel .split-dir[data-side="bottom"]'); await sleep(300);
    m = await model();
    const mid = m.filter((c) => near(c.x, 1 / 3, 0.01));
    check('中間那格往下切 → 中欄上下兩格各半、三欄仍等寬', m.length === 4 && mid.length === 2 && mid.every((c) => near(c.h, 0.5, 0.01) && near(c.w, 1 / 3, 0.01)), m.map((c) => [c.path, +c.x.toFixed(3), +c.y.toFixed(3), +c.w.toFixed(3), +c.h.toFixed(3)]));
    check('新格子（下面那格）被選取', (await sel()) === mid.find((c) => c.y > 0.4).path);
    check('格數文字＝目前 4 格', (await page.$eval('#cellPanel .split-count', (e) => e.textContent)).startsWith('目前 4 格'));
    // 角標＝機器實際像素（App cellPixelSize 同算法，每層四捨五入）；1080×1920 的機器＝360×1920／360×960
    const px = await page.evaluate(() => ({
      scr: state.config.screen,
      badges: [...document.querySelectorAll('#canvas .cell')].map((c) => (c.querySelector('.pv-size-badge span').textContent.match(/\d+×\d+/) || [''])[0]),
      calc: [...document.querySelectorAll('#canvas .cell')].map((c) => { const p = cellPixelSizeOf({ bi: 0, path: c.dataset.path }); return `${p.w}×${p.h}`; }),
      panel: document.querySelector('#cellPanel .panel-size').textContent,
    }));
    const is1080 = px.scr && px.scr.w === 1080 && px.scr.h === 1920;
    check('每格角標＝機器實際像素（巢狀也一層層算）', JSON.stringify(px.badges) === JSON.stringify(px.calc) && (!is1080 || JSON.stringify(px.badges) === JSON.stringify(['360×1920', '360×960', '360×960', '360×1920'])) && px.panel === `${px.calc[2]} px`, px);
    const eq = await page.evaluate(() => {
      const c = document.querySelector('#cellPanel .split-cross').getBoundingClientRect(), sd = document.querySelector('#cellPanel .split-side');
      const s = sd.getBoundingClientRect(), hintTop = sd.firstElementChild.getBoundingClientRect().top, acts = sd.querySelector('.split-acts').getBoundingClientRect();
      return { sameRow: Math.abs(s.top - c.top) < 1, top: Math.round(hintTop - c.top), bottom: Math.round(c.bottom - acts.bottom), crossH: Math.round(c.height), sideH: Math.round(s.height) };
    });
    check('版面區段：右欄跟十字一樣高（說明貼齊上緣、按鈕貼齊下緣）', !eq.sameRow || (Math.abs(eq.top) <= 1 && Math.abs(eq.bottom) <= 1 && Math.abs(eq.crossH - eq.sideH) <= 1), eq);
    const panelClip = await page.evaluate(() => { const p = document.getElementById('cellPanel').getBoundingClientRect(); const s = document.querySelector('#cellPanel .split-tools').getBoundingClientRect(); return { x: p.left - 8, y: p.top - 8, width: p.width + 16, height: s.bottom - p.top + 24 }; });
    await shot('05-inspector-cross', panelClip);
    await page.evaluate(() => window.setColorMode && window.setColorMode('dark', false)); await sleep(300);
    await shot('05b-inspector-cross-dark', await canvasClip());
    await page.evaluate(() => window.setColorMode && window.setColorMode('light', false)); await sleep(300);
  });

  // ---------- 4) 跨層拖曳交換：左欄（第 1 層）↔ 中欄下格（第 3 層）----------
  await safe('拖曳交換', async () => {
    await page.evaluate(() => {
      const root = page().blocks[0].node, r = layoutRects(root);
      leavesOf(root).forEach((l) => { const q = r.get(l.path); Object.assign(l.cell, { content: 'Text', text: q.x < 0.2 ? 'A' : q.x > 0.6 ? 'C' : q.y < 0.4 ? 'Bt' : 'Bb' }); });
      renderCanvas(); renderPanel();
    });
    await sleep(300);
    const before = await model();
    const pa = before.find((c) => c.text === 'A').path, pb = before.find((c) => c.text === 'Bb').path;
    const center = (p) => page.$eval(`#canvas .cell[data-path="${p}"]`, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const from = await center(pa), to = await center(pb);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 12 }); await sleep(120);
    const mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), target: document.querySelector('#canvas .cell.drop-target')?.dataset.path }));
    await page.mouse.up(); await sleep(300);
    const after = await model();
    check('拖曳中：幽靈跟著、目標格亮框', mid.ghost && mid.target === pb, mid);
    check('拖到另一層的格子放開 → 兩格設定對調、格位不變', after.find((c) => c.path === pa).text === 'Bb' && after.find((c) => c.path === pb).text === 'A'
      && JSON.stringify(after.map((c) => [c.path, c.x, c.w])) === JSON.stringify(before.map((c) => [c.path, c.x, c.w])), after.map((c) => `${c.path}:${c.text}`));
    check('拖曳結束沒有殘留（幽靈／來源／目標）', await page.evaluate(() => !document.querySelector('.drag-ghost') && !document.querySelector('.drag-source') && !document.querySelector('.drop-target')));
  });

  // ---------- 5) 拖分隔線：只動線兩邊緊鄰的兩格（2026-10-12 user：拖一條線不該影響別的格子）；
  //      吸附與標籤以「這兩格」為準（1:1、1:2、1:3…）；放開後平均分配拉回三等分 ----------
  await safe('分隔線', async () => {
    const rootBox = await page.$eval('#canvas .cv-root', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const atX = (f) => rootBox.left + rootBox.width * f;
    const tip = () => page.evaluate(() => { const t = document.querySelector('.cv-drag-tip'); return t ? { text: t.textContent, snap: t.classList.contains('is-snap') } : null; });
    // 三欄寬度（同一欄上下切開的格子 x、w 一樣）
    const cols = async () => { const m = await model(); return [...new Map(m.map((c) => [+c.x.toFixed(3), +c.w.toFixed(4)])).entries()].sort((p, q) => p[0] - q[0]).map((e) => e[1]); };
    // 找最靠近某個 x 的直分隔線（不靠路徑：平均分配後樹的形狀不一定）
    const divAt = (fx) => page.evaluate((fx) => {
      const root = document.querySelector('#canvas .cv-root').getBoundingClientRect();
      const ds = [...document.querySelectorAll('#canvas .cv-divider.is-v')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.25, f: (r.left + r.width / 2 - root.left) / root.width, h: r.height / root.height }; }).filter((d) => d.h > 0.9);
      return ds.sort((p, q) => Math.abs(p.f - fx) - Math.abs(q.f - fx))[0];
    }, fx);
    const c0 = await cols();
    check('起點：三欄等寬', c0.length === 3 && c0.every((w) => near(w, 1 / 3, 0.003)), c0);

    // A) 左邊那條線（左欄｜中欄）：右欄不動
    const d1 = await divAt(1 / 3);
    await page.mouse.move(d1.x, d1.y); await page.mouse.down();
    await page.mouse.move(atX(0.48), d1.y, { steps: 10 }); await sleep(80);
    const tA45 = await tip(), cA45 = await cols();
    await page.mouse.move(atX(0.34), d1.y, { steps: 10 }); await sleep(80);
    const tA34 = await tip(), cA34 = await cols();
    await page.mouse.move(atX(0.40), d1.y, { steps: 6 }); await sleep(80);
    await page.mouse.up(); await sleep(300);
    const cA = await cols();
    check('拖左邊那條線到 48% → 左欄 48%、中欄 19%、右欄不動（33%）', near(cA45[0], 0.48, 0.006) && near(cA45[1], 2 / 3 - 0.48, 0.006) && near(cA45[2], 1 / 3, 0.003), cA45);
    check('標籤＝這兩格的比例（左欄佔兩格的 72%）、不吸附', tA45 && tA45.text.startsWith('72%') && !tA45.snap, tA45);
    check('拖到 34% → 兩格一樣大時吸附（標籤 50%、主題色），右欄不動', tA34 && tA34.text.startsWith('50%') && tA34.snap && near(cA34[0], 1 / 3, 0.002) && near(cA34[2], 1 / 3, 0.003), { tA34, cA34 });
    check('放開在 40% → 40／27／33，右欄完全沒變、標籤收掉', near(cA[0], 0.4, 0.006) && near(cA[1], 0.2667, 0.006) && near(cA[2], 1 / 3, 0.003) && !(await tip()), cA);

    // B) 右邊那條線（中欄｜右欄）：左欄不動（user 回報的情況）
    const d2 = await divAt(cA[0] + cA[1]);
    await page.mouse.move(d2.x, d2.y); await page.mouse.down();
    const pairStart = cA[0];
    const pairW = cA[1] + cA[2];
    await page.mouse.move(atX(pairStart + pairW * 0.505), d2.y, { steps: 10 }); await sleep(80);
    const tB50 = await tip(), cB50 = await cols();
    await page.mouse.move(atX(pairStart + pairW * 0.26), d2.y, { steps: 10 }); await sleep(120);
    const tB25 = await tip(), cB25 = await cols();
    await shot('04-dragging-label', await canvasClip());
    await page.mouse.move(atX(pairStart + pairW * 0.4), d2.y, { steps: 6 }); await sleep(80);
    const tB40 = await tip();
    await page.mouse.up(); await sleep(300);
    const cB = await cols();
    check('拖右邊那條線 → 左欄完全不動（40%）', [cB50, cB25, cB].every((c) => near(c[0], 0.4, 0.003)), { cB50, cB25, cB });
    check('中欄、右欄一樣大時吸附（50%）', tB50 && tB50.text.startsWith('50%') && tB50.snap && near(cB50[1], cB50[2], 0.002), { tB50, cB50 });
    check('中欄佔兩格 1/4 時吸附（25%）', tB25 && tB25.text.startsWith('25%') && tB25.snap && near(cB25[1] / (cB25[1] + cB25[2]), 0.25, 0.002), { tB25, cB25 });
    check('放開 → 中欄佔兩格 40%，三欄加起來還是 100%', near(cB[1] / (cB[1] + cB[2]), 0.4, 0.01) && near(cB[0] + cB[1] + cB[2], 1, 0.002), cB);
    const allOk = await page.evaluate(() => { const bad = []; (function walk(n) { if (n && n.t === 'split') { if (n.ratio < 0.1 || n.ratio > 0.9) bad.push(n.ratio); walk(n.a); walk(n.b); } })(page().blocks[0].node); return bad; });
    check('拖完每一刀的比例都還在 0.1–0.9', allOk.length === 0, allOk);
    const m = await model();
    // 平均分配：拖完分隔線不用重新點格子，面板的按鈕狀態就跟著更新
    check('拖完分隔線 → 面板「平均分配」立刻亮起（選取格在被拖的那一排）', (await sel()) === m.find((c) => c.x < 0.1).path && (await panelBtnDisabled('平均分配')) === false, await sel());
    await clickCell(m.find((c) => c.x < 0.1).path);
    check('這一排不平均 → 平均分配可以按', (await panelBtnDisabled('平均分配')) === false);
    {
      // 滑到「平均分配」→ 畫布框出按下去之後的三欄（一樣寬），移開就收掉
      const eb = await page.evaluate(() => { const b = [...document.querySelectorAll('#cellPanel button')].find((x) => x.textContent.trim() === '平均分配'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.move(eb.x, eb.y); await sleep(200);
      const pv = await page.evaluate(() => {
        const root = document.querySelector('#canvas .cv-root').getBoundingClientRect();
        return [...document.querySelectorAll('#canvas .cv-ghost.is-even')].map((g) => { const r = g.getBoundingClientRect(); return { text: g.textContent, x: +((r.left - root.left) / root.width).toFixed(3), w: +(r.width / root.width).toFixed(3), dashed: getComputedStyle(g).borderTopStyle }; }).sort((p, q) => p.x - q.x);
      });
      check('滑到「平均分配」→ 畫布框出三個「一樣寬」的虛線框、三等分（扣掉格子間的縫）', pv.length === 3 && pv.every((g) => g.text === '一樣寬' && g.dashed === 'dashed' && near(g.w, 1 / 3, 0.04)) && near(pv[1].x, 1 / 3, 0.02) && near(pv[2].x, 2 / 3, 0.02), pv);
      await shot('05c-even-preview', await canvasClip());
      await page.mouse.move(eb.x, eb.y + 140); await sleep(200);
      check('移開 → 預覽框收掉', (await page.$$('#canvas .cv-ghost.is-even')).length === 0);
    }
    await clickPanelBtn('平均分配'); await sleep(300);
    const m2 = await model();
    const nCols = [...new Set(m2.map((c) => +c.x.toFixed(3)))].length;
    check('平均分配 → 三欄回到等寬（±1%）', nCols === 3 && m2.every((c) => near(c.w, 1 / 3, 0.01)), m2.map((c) => +c.w.toFixed(4)));
    check('平均分配後選取還在同一格、按鈕變灰', (await sel()) === m2.find((c) => c.x < 0.1).path && (await panelBtnDisabled('平均分配')) === true);
    await snapPage('4 格三層');
  });

  // ---------- 6) 刪除：那一排原本平均 → 重新平均（有內容的格子先確認）----------
  await safe('刪除', async () => {
    let m = await model();
    const c = m.find((x) => x.text === 'C');
    await clickCell(c.path);
    await clickPanelBtn('刪除這格'); await sleep(400);
    const dlg = await page.evaluate(() => { const a = document.querySelector('.b-modal.is-alert'); return a ? a.querySelector('.b-alert-title')?.textContent : null; });
    check('有內容的格子刪除前先確認', dlg === '刪除這一格？', dlg);
    await page.evaluate(() => [...document.querySelectorAll('.b-modal.is-alert .b-alert-foot .b-btn')].find((b) => b.textContent.trim() === '刪除').click());
    await sleep(500);
    m = await model();
    const xs = [...new Set(m.map((x) => +x.x.toFixed(3)))];
    check('刪掉右欄（原本三等分）→ 剩下兩欄重新平均成 50/50', m.length === 3 && xs.length === 2 && m.every((x) => near(x.w, 0.5, 0.01)) && !m.some((x) => x.text === 'C'), m.map((x) => [x.text, +x.x.toFixed(3), +x.w.toFixed(3)]));
    // 原本不平均的那一排：被刪的位置交給旁邊那一格（模型層：A 40%、B 30%、C 30%，刪 C → B 接手變 60%）
    const uneq = await page.evaluate(() => {
      const mk = (t) => ({ ...DEFAULT_CELL(), text: t });
      const root = { t: 'split', dir: 'Vertical', ratio: 0.4, a: mk('A'), b: { t: 'split', dir: 'Vertical', ratio: 0.5, a: mk('B'), b: mk('C') } };
      const out = deleteFromTree(root, 'bb').root, r = layoutRects(out);
      return leavesOf(out).map((l) => [l.cell.text, +r.get(l.path).w.toFixed(3)]);
    });
    check('那一排原本不平均 → 刪掉後旁邊那格接手（不重新平均）', JSON.stringify(uneq) === JSON.stringify([['A', 0.4], ['B', 0.6]]), uneq);
    // 空白格直接刪、不跳確認
    await page.evaluate(() => { const root = page().blocks[0].node; const l = leavesOf(root).find((x) => x.cell.text === 'Bt'); Object.assign(l.cell, DEFAULT_CELL()); renderCanvas(); renderPanel(); });
    const bt = (await model()).find((x) => x.x > 0.4 && x.y < 0.1);
    await clickCell(bt.path);
    await clickPanelBtn('刪除這格'); await sleep(400);
    const m3 = await model();
    check('空白格直接刪（不確認），下面那格接手、被選取', !(await page.$('.b-modal.is-alert')) && m3.length === 2 && m3.every((x) => near(x.h, 1, 1e-6)) && (await sel()) === m3[1].path, m3.map((x) => [x.text, x.path]));
  });

  // ---------- 7) 上限：一排最多到 12.5%（8 欄），第 9 欄不給切；滿 12 格全部不給切 ----------
  await safe('上限', async () => {
    await page.click('.page-tabs .add-page'); await sleep(450);
    await clickCell('');
    for (let i = 0; i < 7; i++) await clickHandle('right');
    let m = await model();
    check('連切 7 次往右 → 8 欄各 12.5%', m.length === 8 && m.every((c) => near(c.w, 0.125, 0.002)), m.map((c) => +c.w.toFixed(4)));
    check('8 欄（再切會小於 12%）→ 十字左右變灰；上下還能切', (await handleSides()) === 'bottom,top' && JSON.stringify(await cross()) === JSON.stringify({ top: true, left: false, right: false, bottom: true }), { h: await handleSides(), c: await cross() });
    {
      const hb2 = await page.$eval('#cellPanel .split-dir[data-side="right"]', (h) => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.move(hb2.x, hb2.y); await sleep(200);
      check('滑到變灰的方向鈕不出預覽', await page.$eval('#canvas .cv-ghost', (e) => e.hidden));
    }
    check('變灰的按鈕有說明', (await page.$eval('#cellPanel .split-dir[data-side="right"]', (e) => e.title)).includes('太小'));
    for (let i = 0; i < 4; i++) { m = await model(); await clickCell(m.filter((c) => near(c.h, 1, 1e-6))[0].path); await clickHandle('bottom'); }
    m = await model();
    check('再往下切 4 次 → 12 格', m.length === 12, m.length);
    check('滿 12 格：十字全灰、格數文字「目前 12 格」', (await handleSides()) === '' && Object.values(await cross()).every((v) => !v) && (await page.$eval('#cellPanel .split-count', (e) => e.textContent)).startsWith('目前 12 格'));
    check('滿 12 格時十字的說明＝一頁最多 12 格', (await page.$eval('#cellPanel .split-dir[data-side="top"]', (e) => e.title)) === '一頁最多 12 格');
    await page.evaluate(() => splitSelectedCell('bottom')); await sleep(400);
    const toast = await page.evaluate(() => [...document.querySelectorAll('.b-toast-msg')].map((t) => t.textContent).join('|'));
    check('硬叫切第 13 格 → 不切、跳提示', (await model()).length === 12 && toast.includes('一頁最多 12 格'), toast);
    await shot('06-twelve-cells', await canvasClip());
    await snapPage('12 格');
    // 上下 6%：上面一大格（90%）、下面 10% 高的一列左右兩格；下面那格往上／下切會只剩 5% 高 → 不給
    const six = await page.evaluate(() => {
      const root = { t: 'split', dir: 'Horizontal', ratio: 0.9, a: DEFAULT_CELL(), b: { t: 'split', dir: 'Vertical', ratio: 0.5, a: DEFAULT_CELL(), b: DEFAULT_CELL() } };
      page().blocks[0].node = root; selected = { bi: 0, path: 'ba' }; renderCanvas(); renderPanel();
      return splitSides(root, 'ba');
    });
    await sleep(250);
    check('切完會矮於畫面高 6% → 上下不給切（左右可以）', !six.top && !six.bottom && six.left && six.right && (await handleSides()) === 'left,right', { six, h: await handleSides() });
    const big = await page.evaluate(() => splitSides(page().blocks[0].node, 'a'));
    check('上面 90% 那格可以往上／下切', big.top && big.bottom, big);
    // 自動平均只在「這一排原本一樣大」時（2026-10-12）：不一樣大就只切選的那一格，其他格子不動
    const rule = await page.evaluate(() => {
      const shares = (root) => { const r = layoutRects(root); return leavesOf(root).map((l) => +r.get(l.path).h.toFixed(4)); };
      const uneven = { t: 'split', dir: 'Horizontal', ratio: 0.1, a: DEFAULT_CELL(), b: { t: 'split', dir: 'Horizontal', ratio: 0.15, a: DEFAULT_CELL(), b: DEFAULT_CELL() } };
      const even = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: DEFAULT_CELL(), b: DEFAULT_CELL() };
      return { before: shares(uneven), uneven: shares(splitTree(uneven, 'bb', 'bottom').root), even: shares(splitTree(even, 'b', 'bottom').root) };
    });
    check('一排不平均（跑馬燈 10%、天氣、大圖）→ 在大圖下面加一格只把大圖對半，跑馬燈和天氣不變', rule.uneven.length === 4 && Math.abs(rule.uneven[0] - rule.before[0]) < 0.002 && Math.abs(rule.uneven[1] - rule.before[1]) < 0.002 && Math.abs(rule.uneven[2] - rule.before[2] / 2) < 0.002 && Math.abs(rule.uneven[3] - rule.before[2] / 2) < 0.002, rule);
    check('一排原本平均（上下各半）→ 往下加一格變成三等分', rule.even.length === 3 && rule.even.every((h) => Math.abs(h - 1 / 3) < 0.003), rule.even);
    // 很扁的格子（5% 高、貼著畫布底，這一排不平均）：上下切會矮於 6% → 十字上下變灰、左右可以
    const flat = await page.evaluate(() => {
      page().blocks[0].node = { t: 'split', dir: 'Horizontal', ratio: 0.9, a: DEFAULT_CELL(), b: { t: 'split', dir: 'Horizontal', ratio: 0.5, a: DEFAULT_CELL(), b: DEFAULT_CELL() } };
      selected = { bi: 0, path: 'bb' }; renderCanvas(); renderPanel();
      return splitSides(page().blocks[0].node, 'bb');
    });
    await sleep(150);
    check('很扁的格子：上下切會太矮 → 十字上下變灰、左右可以', !flat.top && !flat.bottom && flat.left && flat.right && (await handleSides()) === 'left,right', flat);
    await shot('06b-flat-cell-handles', await canvasClip());
  });

  // ---------- 7b) 左邊／上方：新格子在左／上（分割的 a），原本那格到右／下 ----------
  await safe('左邊上方', async () => {
    await page.click('.page-tabs .add-page'); await sleep(450);
    await page.evaluate(() => { Object.assign(page().blocks[0].node, { content: 'Text', text: 'OLD' }); selected = { bi: 0, path: '' }; renderCanvas(); renderPanel(); });
    await sleep(200);
    await clickHandle('left');
    let t = await tree(), m = await model();
    check('往左切 → 左右並排（Vertical）、新格子在左（a）且被選取、原本那格到右邊', t.dir === 'Vertical' && t.b.text === 'OLD' && !t.a.text && (await sel()) === 'a' && near(m[0].w, 0.5, 0.01), { dir: t.dir, sel: await sel() });
    await page.evaluate(() => { getCell(selected).text = 'L'; getCell(selected).content = 'Text'; renderCanvas(); renderPanel(); });
    await page.click('#cellPanel .split-dir[data-side="top"]'); await sleep(300);
    t = await tree(); m = await model();
    check('左邊那格往上切（十字的上方）→ 上下疊（Horizontal）、新格子在上（a）、L 到下面', t.a.dir === 'Horizontal' && t.a.b.text === 'L' && !t.a.a.text && (await sel()) === 'aa' && m.length === 3 && near(m[0].h, 0.5, 0.01), { a: t.a.dir, sel: await sel() });
  });

  // ---------- 8) 舊的多大區塊頁面：打開就併成一個區塊，畫起來一樣 ----------
  let legacyPage = null, normalizedPage = null;
  await safe('舊頁面', async () => {
    legacyPage = await page.evaluate(() => {
      const mk = (text, color) => ({ ...DEFAULT_CELL(), content: 'Text', text, bgColor: color });
      const pg = { id: 90, name: '舊版面', blocks: [
        { id: 1, w: 1, node: mk('A', 0xFF1B5E20) },
        { id: 2, w: 1.4, node: { t: 'split', dir: 'Vertical', ratio: 0.3, a: mk('B', 0xFF0D47A1), b: mk('C', 0xFF4A148C) } },
        { id: 3, w: 0.8, node: { t: 'split', dir: 'Horizontal', ratio: 0.6, a: mk('D', 0xFFB71C1C), b: mk('E', 0xFF00838F) } },
      ] };
      state.config.pages.push(JSON.parse(JSON.stringify(pg)));
      setDirty(false);
      renderTabs();
      return pg;
    });
    await page.evaluate(() => [...document.querySelectorAll('#pageTabs .tab')].find((t) => t.textContent.includes('舊版面')).click());
    await sleep(500);
    const st = await page.evaluate(() => ({ blocks: page().blocks.length, dirty, tree: JSON.stringify(page().blocks[0].node, (k, v) => (v && v.t === 'cell' ? v.text : v)) }));
    check('打開舊頁面 → 併成一個區塊、不算修改（儲存鈕不亮）', st.blocks === 1 && st.dirty === false, st);
    // 舊的畫法（大區塊照權重直向堆疊、區塊內再切一次）算出來的位置
    const W = [1, 1.4, 0.8], T = W.reduce((a, b) => a + b, 0);
    const y1 = 1 / T, y2 = 2.4 / T;
    const expect = { A: [0, 0, 1, y1], B: [0, y1, 0.3, y2 - y1], C: [0.3, y1, 0.7, y2 - y1], D: [0, y2, 1, (1 - y2) * 0.6], E: [0, y2 + (1 - y2) * 0.6, 1, (1 - y2) * 0.4] };
    const d = await dom();
    const diffs = d.map((c) => { const e = expect[c.text]; return e ? Math.max(Math.abs(c.x - e[0]), Math.abs(c.y - e[1]), Math.abs(c.w - e[2]), Math.abs(c.h - e[3])) : 1; });
    const cvH = await page.$eval('#canvas .cv-root', (e) => e.getBoundingClientRect().height);
    check('併完的畫布位置＝舊的畫法（每格誤差 < 1px）', d.length === 5 && diffs.every((x) => x * cvH < 1), { maxPx: +(Math.max(...diffs) * cvH).toFixed(3) });
    normalizedPage = await page.evaluate(() => JSON.parse(JSON.stringify(page())));
    await shot('07-legacy-normalized', await canvasClip());
    // 選取舊頁面的格子也能繼續切
    await clickCell(d.find((c) => c.text === 'A').path);
    check('併完的舊頁面每一格都能再切', (await handleSides()) === 'bottom,left,right,top', await handleSides());
  });

  check('所有頁面所有分割的比例都在 0.1–0.9', !(await ratiosBad()).length, await ratiosBad());
  // 極端的舊權重（App 會夾到 ≥0.1）換成樹也守在 0.1–0.9
  const extreme = await page.evaluate(() => { const n = blocksToNode([{ w: 0.1, node: DEFAULT_CELL() }, { w: 5, node: DEFAULT_CELL() }, { w: 0.1, node: DEFAULT_CELL() }, { w: 3, node: DEFAULT_CELL() }]); const out = []; (function walk(x) { if (!isSplit(x)) return; out.push(x.ratio); walk(x.a); walk(x.b); })(n); return out; });
  check('極端權重的舊頁面換成樹，比例也都在 0.1–0.9', extreme.every((r) => r >= 0.1 && r <= 0.9), extreme);

  check('整段沒有任何存檔請求（PUT 都被攔下＝0 次）', blockedPuts.length === 0, blockedPuts);
  check('編輯器沒有頁面錯誤', !errs.length, errs);

  // ---------- 9) 播放頁：巢狀頁跟編輯畫布同比例；舊頁面併前併後一模一樣 ----------
  const player = await browser.newPage();
  await player.setViewport({ width: 540, height: 960, deviceScaleFactor: 1 });
  const perrs = [];
  player.on('pageerror', (e) => perrs.push('PAGEERROR: ' + e.message));
  player.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) perrs.push('console: ' + m.text()); });
  const deviceId = 'web-uitest-split';
  let cur = null;
  await player.setRequestInterception(true);
  player.on('request', (req) => {
    const url = new URL(req.url());
    const json = (o, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(o) }).catch(() => {}), delay);
    if (url.origin !== BASE || !url.pathname.startsWith('/api/')) return req.continue();
    const p = url.pathname, m = req.method();
    if (p === `/api/config/${deviceId}/version`) return json({ version: 5 });
    if (p === `/api/config/${deviceId}/wait`) return json({ version: 5 }, 20000);
    if (p === `/api/config/${deviceId}` && m === 'GET') return json({ version: 5, config: { activePage: 0, deviceName: 'uitest-split', screen: { w: 1080, h: 1920 }, idleReturnSec: -1, pages: [cur] } });
    return json({ ok: true });
  });
  const renderPlayer = async (pg) => {
    cur = pg;
    await player.goto(`${BASE}/play/?device=uitest-split&key=uitest-key`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await player.waitForFunction(() => document.querySelectorAll('#stage .page .cell').length > 0, { timeout: 10000 });
    await sleep(700);
    return player.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect();
      return [...document.querySelectorAll('#stage .page .cell')].map((c) => { const r = c.getBoundingClientRect(); return { text: c.querySelector('.pv-text')?.textContent || '', x: r.left - st.left, y: r.top - st.top, w: r.width, h: r.height, W: st.width, H: st.height }; });
    });
  };
  await safe('播放頁', async () => {
    for (const [i, sn] of snaps.entries()) {
      const got = await renderPlayer(sn.pg);
      await player.screenshot({ path: path.join(OUT, `${String(8 + i).padStart(2, '0')}-player-${i ? 'twelve' : 'nested'}.png`) });
      const pf = got.map((c) => ({ x: c.x / c.W, y: c.y / c.H, w: c.w / c.W, h: c.h / c.H }));
      const diff = pf.length === sn.editor.length ? Math.max(...pf.map((c, k) => Math.max(...['x', 'y', 'w', 'h'].map((q) => Math.abs(c[q] - sn.editor[k][q]))))) : 1;
      check(`播放頁畫巢狀頁（${sn.name}）：格數、位置與比例跟編輯畫布一樣（±1%）`, sn.editor.length > 1 && diff <= 0.01, { cells: pf.length, editor: sn.editor.length, maxDiff: +diff.toFixed(4) });
    }
    const legacy = await renderPlayer(legacyPage);
    const norm = await renderPlayer(normalizedPage);
    await player.screenshot({ path: path.join(OUT, '10-player-legacy-normalized.png') });
    const byText = (list) => Object.fromEntries(list.map((c) => [c.text, c]));
    const L = byText(legacy), N = byText(norm);
    const keys = Object.keys(L).sort();
    const px = keys.map((k) => (N[k] ? Math.max(...['x', 'y', 'w', 'h'].map((q) => Math.abs(L[k][q] - N[k][q]))) : 99));
    check('播放頁：舊頁面（多個大區塊）跟併成一個區塊後畫起來一模一樣（每格 ≤ 1px）', keys.join() === 'A,B,C,D,E' && Object.keys(N).sort().join() === 'A,B,C,D,E' && px.every((v) => v <= 1), { keys, px: px.map((v) => +v.toFixed(3)) });
    check('播放頁沒有錯誤', !perrs.length, perrs);
  });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} 通過${pass === results.length ? '' : '　FAIL'}　截圖：${OUT}`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
