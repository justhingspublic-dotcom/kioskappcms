/* 保母程序（2026-09-15 揚昇事故）。
 * 以前正式站只有 run.cmd 的迴圈：Node「死掉」才重拉；程序活著但整個卡住（事件迴圈凍結、被晾著沒 CPU）沒人管，
 * 使用者看到頁面轉不出來，要人登進伺服器砍程序。現在 `node src/server.js` 先變成這支保母：
 *   - 用同一支檔案再開一個子程序當真正的後台（環境變數 KIOSK_CHILD=1），stdout／stderr 沿用（server.log 照舊）。
 *   - 保母與子程序的 CPU／I/O／記憶體優先權都拉回「正常」並鎖住常駐記憶體（排程工作預設三項都低，子程序會繼承；
 *     見 src/win-priority.js。子程序在 src/health.js 做自己，保母在這裡做自己）。
 *   - 每 15 秒打 GET /api/health（10 秒逾時），連續 4 次沒回應（約 1 分鐘）就強制結束子程序並重拉。
 *   - 子程序自己結束（POST /api/restart、崩潰、DB 心跳失敗太久）也立刻重拉；10 秒內就掛的話等 5 秒再拉，避免狂轉。
 *   - 保母本身如果被砍，run.cmd 的迴圈會重拉保母。子程序每 5 秒確認保母還在，不在就跟著結束（不留孤兒佔 port）。
 * 本機開發不想多一層：.env 設 KIOSK_SUPERVISOR=0 就直接跑後台。
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const log = require('./log');
const { raisePriority } = require('./health');
const winPriority = require('./win-priority');

const CHECK_MS = 15_000;
const TIMEOUT_MS = 10_000;
const GRACE_MS = 45_000; // 剛啟動先不檢查（啟動＋背景連 DB）
const FAIL_LIMIT = 4; // 2026-09-15 由 8 改 4：/api/health 是純記憶體路由，連 4 次 10 秒不回一定是卡住，別讓使用者等 3 分鐘
const RESPAWN_MS = 2_000;
const CRASH_BACKOFF_MS = 5_000;
const CRASH_WINDOW_MS = 10_000;

function basePath() {
  return String(process.env.BASE_PATH || '').trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/').replace(/^\/$/, '');
}

function run(serverFile) {
  raisePriority('guard');
  const port = Number(process.env.PORT || 3000);
  const url = `http://127.0.0.1:${port}${basePath()}/api/health`;
  let child = null;
  let startedAt = 0;
  let fails = 0;
  let killing = false;

  const spawnChild = () => {
    child = spawn(process.execPath, [serverFile], {
      env: { ...process.env, KIOSK_CHILD: '1' },
      stdio: 'inherit',
      windowsHide: true,
    });
    startedAt = Date.now();
    fails = 0;
    killing = false;
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_NORMAL); } catch { /* 子程序自己也會拉 */ }
    log.info('guard', `已啟動後台子程序 pid=${child.pid}`);
    child.on('exit', (code, signal) => {
      const upMs = Date.now() - startedAt;
      const delay = upMs < CRASH_WINDOW_MS ? CRASH_BACKOFF_MS : RESPAWN_MS;
      const why = killing ? '（保母強制結束）' : code === 0 ? '（正常結束，例如重啟要求）' : '';
      (code === 0 && !killing ? log.info : log.warn)('guard', `子程序 pid=${child.pid} 結束 code=${code} signal=${signal || '-'} 執行 ${Math.round(upMs / 1000)} 秒${why}，${delay / 1000} 秒後重拉`);
      child = null;
      setTimeout(spawnChild, delay);
    });
    child.on('error', (e) => log.error('guard', `子程序啟動失敗：${e.message}`));
  };

  const fail = (why) => {
    if (!child || killing) return;
    fails += 1;
    if (fails === 1 || fails % 4 === 0) log.warn('guard', `健康檢查失敗 ${fails}/${FAIL_LIMIT}：${why}`);
    if (fails >= FAIL_LIMIT) {
      killing = true;
      log.error('guard', `後台子程序 pid=${child.pid} 連續 ${fails} 次沒回應（約 ${Math.round(fails * CHECK_MS / 60000)} 分鐘），強制結束並重拉`);
      try { child.kill(); } catch (e) { log.error('guard', `無法結束子程序：${e.message}`); killing = false; }
    }
  };

  const check = () => {
    if (!child || killing || Date.now() - startedAt < GRACE_MS) return;
    const req = http.get(url, { timeout: TIMEOUT_MS }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        if (fails) log.info('guard', `健康檢查恢復（之前失敗 ${fails} 次）`);
        fails = 0;
      } else {
        fail(`HTTP ${res.statusCode}`);
      }
    });
    req.on('timeout', () => req.destroy(new Error(`${TIMEOUT_MS / 1000} 秒沒回應`)));
    req.on('error', (e) => fail(e.message));
  };

  log.info('guard', `保母程序啟動 pid=${process.pid}，每 ${CHECK_MS / 1000} 秒檢查 ${url}`);
  winPriority.normalize(process.pid, { minWorkingSetMB: 48 }).then((r) => {
    if (r) (winPriority.isNormal(r) ? log.info : log.warn)('guard', `保母程序優先權：${winPriority.describe(r)}`);
  });
  spawnChild();
  setInterval(check, CHECK_MS);
}

module.exports = { run };
