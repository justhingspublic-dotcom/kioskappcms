/* 後台系統 log（2026-09-10）。
 * 之前只有零星 console.log，正式站由 run.cmd 把 stdout 全導進單一 server.log：不輪替、靜態檔請求洗版、
 * 出錯只印 err 沒有「哪支 API／誰／哪台機器」。這支負責：
 *   - 一行一筆、人可讀：`2026-09-10 10:28:31 INFO  http    GET /api/devices 200 12ms user=joyeadmin rid=1a2b3c4d`
 *   - 等級 debug < info < warn < error，.env 的 LOG_LEVEL 決定門檻（沒設＝info；開發機建議 debug）
 *   - 每日一檔 logs/app-YYYY-MM-DD.log（.env 的 LOG_DIR 可改位置），寫入時跨日自動換檔
 *   - 超過 LOG_KEEP_DAYS（預設 30）的舊檔在啟動與每次換檔時刪掉
 *   - 終端機是 TTY（開發機直接跑）才同時印到螢幕；正式站 stdout 被導到 server.log，不再重複印，
 *     server.log 只剩 run.cmd 的起停與 Node 沒接住的 crash。LOG_STDOUT=1 可強制印。
 * 不裝套件：專案依賴刻意很少，需求也只有這些。
 */
const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_DIR = (process.env.LOG_DIR || '').trim() || path.join(__dirname, '..', 'logs');
const KEEP_DAYS = Math.max(1, Number(process.env.LOG_KEEP_DAYS) || 30);
const levelName = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const THRESHOLD = LEVELS[levelName] || LEVELS.info;
const MIRROR = process.env.LOG_STDOUT === '1' || (process.env.LOG_STDOUT !== '0' && !!process.stdout.isTTY);

let stream = null;
let streamDay = '';
let fileBroken = false;

const two = (n) => String(n).padStart(2, '0');
/** 本地時間的 YYYY-MM-DD（伺服器時區＝台灣；一天一檔以本地日為準才好對）。 */
function localDay(d) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
function stamp(d) {
  return `${localDay(d)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** 刪掉超過保留天數的舊檔（只動 app-YYYY-MM-DD.log 這種命名，別的檔不碰）。 */
function pruneOldFiles() {
  let names;
  try { names = fs.readdirSync(LOG_DIR); } catch { return; }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const cutoffDay = localDay(cutoff);
  for (const name of names) {
    const m = name.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
    if (m && m[1] < cutoffDay) {
      try { fs.unlinkSync(path.join(LOG_DIR, name)); } catch { /* 刪不掉就下次再試 */ }
    }
  }
}

function openStream(day) {
  if (stream) { try { stream.end(); } catch { /* ignore */ } }
  stream = null;
  streamDay = day;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(path.join(LOG_DIR, `app-${day}.log`), { flags: 'a' });
    stream.on('error', (e) => {
      if (!fileBroken) console.error(`log 檔寫入失敗（${LOG_DIR}）：${e.message}`);
      fileBroken = true;
      stream = null;
    });
    fileBroken = false;
    pruneOldFiles();
  } catch (e) {
    if (!fileBroken) console.error(`log 檔開啟失敗（${LOG_DIR}）：${e.message}`);
    fileBroken = true;
  }
}

/** 附加欄位 → `k=v k2=v2`；值有空白或非字串就 JSON 化，避免一行被切歪。 */
function fmtExtra(extra) {
  if (!extra) return '';
  if (typeof extra !== 'object') return ' ' + String(extra);
  const parts = [];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null || v === '') continue;
    const s = typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/**
 * 寫一筆。cat＝分類（http/db/device/auth/upload/justai/station/sys…），msg＝一句話，extra＝附加欄位物件。
 * msg 可以是 Error：印 message，stack 另起一行縮排。
 */
function write(level, cat, msg, extra) {
  if ((LEVELS[level] || LEVELS.info) < THRESHOLD) return;
  const d = new Date();
  let text = msg instanceof Error ? msg.message : String(msg);
  if (msg instanceof Error && msg.stack) text += '\n    ' + msg.stack.split('\n').slice(1).map((l) => l.trim()).join('\n    ');
  const line = `${stamp(d)} ${level.toUpperCase().padEnd(5)} ${String(cat).padEnd(7)} ${text}${fmtExtra(extra)}`;
  if (MIRROR) (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  const day = localDay(d);
  if (day !== streamDay || (!stream && !fileBroken)) openStream(day);
  if (stream) stream.write(line + '\n');
}

/** 把 request body 變成可以放進 log 的摘要：密碼／金鑰類欄位遮掉、太長截斷。 */
function redactBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  const SECRET = /pass|pwd|secret|token|key|pin/i;
  const clean = (v, depth) => {
    if (depth > 2 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return `[${v.length} 筆]`;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? '***' : clean(x, depth + 1);
    return out;
  };
  let s = JSON.stringify(clean(body, 0));
  if (s.length > 400) s = s.slice(0, 400) + '…';
  return s;
}

/** 收尾：程序要結束前把檔案緩衝寫完（uncaughtException 那條會用）。 */
function flush(cb) {
  if (!stream) return cb && cb();
  try { stream.end(cb); } catch { cb && cb(); }
}

module.exports = {
  debug: (cat, msg, extra) => write('debug', cat, msg, extra),
  info: (cat, msg, extra) => write('info', cat, msg, extra),
  warn: (cat, msg, extra) => write('warn', cat, msg, extra),
  error: (cat, msg, extra) => write('error', cat, msg, extra),
  redactBody,
  flush,
  LOG_DIR,
  level: levelName,
};
