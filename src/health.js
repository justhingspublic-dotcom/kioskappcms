/* 程序自我健康監測（2026-09-15 揚昇事故）。
 * 事故：揚昇的 Node 程序在上班時間整段凍結（連純記憶體的路由都要等好幾秒到兩分鐘），DB 連線因而「15 秒逾時」、
 * 靜態檔吐不出來、頁面轉不出來；記憶體只有 48 MB，不是漏記憶體。同時段卓也讀圖片也慢到 14 秒＝整台機器（兩百多個
 * IIS 站台）記憶體／磁碟有壓力；閒置一整晚的程序 working set 被換出，早上一用就整段等磁碟。
 * 已實證（2026-09-15 部署 log＋本機排程實測）：排程工作（Priority 7）啟動的程序 CPU＝低於正常、I/O＝低、記憶體優先權＝低，
 * 子程序全部繼承——記憶體最先被收走、讀回來又排在所有網站後面。卓也那份是用 DCOM 啟動的，三項都正常，所以沒事。
 * 這支做四件事：
 *   1. raisePriority()＋src/win-priority.js：啟動時把 CPU／I/O／記憶體優先權拉回「正常」並鎖住 256MB 常駐記憶體，不必動排程。
 *   2. 每 15 秒量事件迴圈延遲（p50／p99／最大）、CPU、記憶體、分頁錯誤數（pf；高＝被換出／磁碟忙），
 *      卡頓立刻記 warn，平時每 5 分鐘記一行摘要。
 *   3. 每 15 秒對 DB 打 SELECT 1 當心跳：連線池永遠有一條熱的（不用每次重新握手），斷線也能立刻看出來；
 *      連續失敗 1 分鐘記 error，連續失敗 5 分鐘自行結束讓保母（src/supervisor.js）重拉。
 *   4. snapshot()：GET /api/health 回的內容，保母程序拿它判斷子程序活著沒。
 */
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');
const db = require('./db');
const log = require('./log');
const winPriority = require('./win-priority');

const SAMPLE_MS = 15_000;
const REPORT_MS = 5 * 60_000;
const LAG_WARN_MS = 1000;
const DB_FAIL_WARN = 4; // 1 分鐘
const DB_FAIL_EXIT = 20; // 5 分鐘

const state = {
  startedAt: Date.now(),
  priority: null,
  winPriority: null, // src/win-priority.js 的結果（Windows）
  loop: { p50: 0, p99: 0, max: 0 },
  cpuPct: 0,
  pageFaults: 0, // 這 15 秒內的分頁錯誤數（Windows：libuv 用 PageFaultCount）
  mem: { rssMB: 0, heapMB: 0 },
  db: { ok: null, ms: null, failures: 0, lastOkAt: null, lastError: null },
};

const PRIORITY_NAMES = { 19: '閒置', 10: '低於正常', 0: '正常', '-7': '高於正常', '-14': '高', '-20': '即時' };
const priorityName = (p) => PRIORITY_NAMES[p] || String(p);

/** 把目前程序的優先權拉回「正常」（只往上拉到正常，不會更高）。排程工作啟動的程序預設是低於正常。 */
function raisePriority(cat = 'sys') {
  try {
    const before = os.getPriority();
    if (before > os.constants.priority.PRIORITY_NORMAL) os.setPriority(os.constants.priority.PRIORITY_NORMAL);
    const after = os.getPriority();
    state.priority = after;
    if (after !== before) log.info(cat, `程序優先權由「${priorityName(before)}」調回「${priorityName(after)}」（排程工作預設用低優先權，伺服器忙時會被晾著）`);
    else log.info(cat, `程序優先權＝「${priorityName(after)}」`);
  } catch (e) {
    log.warn(cat, `無法調整程序優先權：${e.message}`);
  }
}

const nsToMs = (n) => Math.round((Number(n) || 0) / 1e6);

let histogram = null;
let lastCpu = null;
let lastSampleAt = 0;
let lastReportAt = 0;
let pingInFlight = false;

async function pingDb() {
  if (!db.isReady()) { state.db.ok = null; return; }
  if (pingInFlight) return;
  pingInFlight = true;
  const t0 = Date.now();
  try {
    await db.ping();
    const wasFailing = state.db.failures;
    state.db = { ok: true, ms: Date.now() - t0, failures: 0, lastOkAt: Date.now(), lastError: null };
    if (wasFailing >= DB_FAIL_WARN) log.info('health', `資料庫心跳恢復（之前連續失敗 ${wasFailing} 次）`);
  } catch (e) {
    state.db.ok = false;
    state.db.ms = Date.now() - t0;
    state.db.failures += 1;
    state.db.lastError = e.message;
    if (state.db.failures === DB_FAIL_WARN) log.error('health', `資料庫心跳連續失敗 ${DB_FAIL_WARN} 次：${e.message}`);
    if (state.db.failures >= DB_FAIL_EXIT) {
      log.error('health', `資料庫心跳連續失敗 ${state.db.failures} 次（約 ${Math.round(state.db.failures * SAMPLE_MS / 60000)} 分鐘），自行結束程序讓保母重拉`);
      log.flush(() => process.exit(1));
      setTimeout(() => process.exit(1), 1000).unref();
    }
  } finally {
    pingInFlight = false;
  }
}

function summaryLine() {
  const d = state.db;
  const dbText = d.ok === null ? 'db=未連線' : d.ok ? `db=${d.ms}ms` : `db=失敗x${d.failures}`;
  return `loop p50=${state.loop.p50}ms p99=${state.loop.p99}ms max=${state.loop.max}ms cpu=${state.cpuPct}% pf=${state.pageFaults} rss=${state.mem.rssMB}MB heap=${state.mem.heapMB}MB ${dbText}`;
}

let lastPageFaults = null;
function samplePageFaults() {
  try {
    const now = process.resourceUsage().majorPageFault;
    const delta = lastPageFaults === null ? 0 : Math.max(0, now - lastPageFaults);
    lastPageFaults = now;
    return delta;
  } catch { return 0; }
}

async function sample() {
  const now = Date.now();
  if (histogram) {
    state.loop = { p50: nsToMs(histogram.percentile(50)), p99: nsToMs(histogram.percentile(99)), max: nsToMs(histogram.max) };
    histogram.reset();
  }
  const cpu = process.cpuUsage(lastCpu || undefined);
  lastCpu = process.cpuUsage();
  const wall = Math.max(1, now - (lastSampleAt || state.startedAt));
  lastSampleAt = now;
  state.cpuPct = Math.min(999, Math.round(((cpu.user + cpu.system) / 1000) / wall * 100));
  state.pageFaults = samplePageFaults();
  const m = process.memoryUsage();
  state.mem = { rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576) };
  await pingDb();
  if (state.loop.p99 >= LAG_WARN_MS) {
    log.warn('health', `事件迴圈卡頓：${summaryLine()}`);
    lastReportAt = now;
  } else if (now - lastReportAt >= REPORT_MS) {
    log.info('health', summaryLine());
    lastReportAt = now;
  }
}

/** 啟動監測（伺服器 listen 之後呼叫一次）。 */
function start() {
  try {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
  } catch (e) {
    log.warn('health', `事件迴圈延遲監測無法啟動：${e.message}`);
  }
  lastCpu = process.cpuUsage();
  lastSampleAt = Date.now();
  lastReportAt = Date.now();
  setInterval(() => { sample().catch((e) => log.warn('health', `健康取樣失敗：${e.message}`)); }, SAMPLE_MS).unref();
  winPriority.normalize(process.pid, { minWorkingSetMB: 256 }).then((r) => {
    state.winPriority = r;
    if (r) (winPriority.isNormal(r) ? log.info : log.warn)('health', `後台程序優先權：${winPriority.describe(r)}`);
  });
}

/** GET /api/health 的內容（不含任何機密）。 */
function snapshot() {
  return {
    ok: true,
    pid: process.pid,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    priority: state.priority === null ? null : priorityName(state.priority),
    // CPU／I/O／記憶體優先權與常駐記憶體下限（Windows；io 2＝正常、mem 5＝正常）
    winPriority: state.winPriority && (state.winPriority.error
      ? { error: state.winPriority.error }
      : { cpu: state.winPriority.cpu[1], io: state.winPriority.io[1], mem: state.winPriority.mem[1], wsMinMB: state.winPriority.wsMinMB, wsHard: state.winPriority.wsHard }),
    loop: state.loop,
    cpuPct: state.cpuPct,
    pageFaults: state.pageFaults,
    mem: state.mem,
    db: { ok: state.db.ok, ms: state.db.ms, failures: state.db.failures, lastOkAt: state.db.lastOkAt ? new Date(state.db.lastOkAt).toISOString() : null },
  };
}

module.exports = { raisePriority, start, snapshot, priorityName };
