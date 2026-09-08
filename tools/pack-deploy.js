/* 打包部署 zip 到桌面（user 2026-09-07 指示）：
   - 解開就是檔案、不多包一層（伺服器端解到 IIS 站台根目錄 D:\WebSite\JustDisplay 直接覆蓋）
   - 檔名固定 KioskAdmin.zip（不帶日期）
   - 預設「增量」：只包上次打包（tools/last-deploy.txt 記的 commit）之後有改的檔案，含未 commit 的修改與新檔
     package-lock.json 有變才會連 node_modules 整包附上；zip 內附 CHANGES.txt 列出檔案與需手動刪除的檔
   用法：node tools/pack-deploy.js                 → 增量（沒有 last-deploy.txt 時自動改完整包）
        node tools/pack-deploy.js --full          → 完整包（不含 uploads）
        node tools/pack-deploy.js --full --with-uploads → 完整包＋本機 uploads（第一次部署用）
        node tools/pack-deploy.js --since <commit> → 指定基準 commit 的增量
   打包成功後把目前 HEAD 寫進 tools/last-deploy.txt（記得一起 commit）。
   永遠不包：.env（含密碼）、tools/、files/、log、shots。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const full = args.includes('--full');
const withUploads = args.includes('--with-uploads');
const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
const LAST = path.join(__dirname, 'last-deploy.txt');
const DEPLOY_PATHS = ['src', 'public', 'docs', 'package.json', 'package-lock.json', 'API.md', '.env.example', 'deploy'];

const git = (...a) => execFileSync('git', a, { cwd: ROOT }).toString().split(/\r?\n/).filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
// 桌面在 OneDrive\桌面（中文）：PowerShell 輸出要先切 UTF-8，不然 node 讀到亂碼路徑
const desktop = execFileSync('powershell', ['-NoProfile', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"]).toString().trim();
const zip = path.join(desktop, 'KioskAdmin.zip'); // 檔名固定 KioskAdmin.zip（user 2026-09-07 指示，不帶日期）
const stage = path.join(os.tmpdir(), 'KioskAdmin-deploy-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// deploy/ 裡的附件平放到 zip 最外層（web.config＝IIS 站台根目錄用）
const dest = (rel) => (rel.startsWith('deploy/') ? rel.slice('deploy/'.length) : rel);
const put = (rel) => {
  const to = path.join(stage, dest(rel));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(path.join(ROOT, rel), to, { recursive: true });
};

const since = sinceArg || (fs.existsSync(LAST) ? fs.readFileSync(LAST, 'utf8').trim() : '');
let mode;
let files = [];
let deleted = [];
if (full || !since) {
  mode = full ? '完整' : '完整（沒有 last-deploy.txt）';
  files = ['src', 'public', 'docs', 'node_modules', 'package.json', 'package-lock.json', 'API.md', '.env.example', 'deploy'].concat(withUploads ? ['uploads'] : []);
  files.forEach(put);
} else {
  mode = `增量（自 ${since.slice(0, 7)}）`;
  // 工作樹 vs 基準 commit（含未 commit 的修改）＋ 未追蹤的新檔；刪除的另列
  const changed = git('diff', '--name-only', '--diff-filter=d', since, '--', ...DEPLOY_PATHS);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...DEPLOY_PATHS);
  deleted = git('diff', '--name-only', '--diff-filter=D', since, '--', ...DEPLOY_PATHS).map(dest);
  files = [...new Set([...changed, ...untracked])].filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (files.includes('package-lock.json')) files.push('node_modules');
  if (!files.length && !deleted.length) { console.log(`自 ${since.slice(0, 7)} 之後沒有可部署的變更，不打包。`); process.exit(0); }
  files.forEach(put);
  const head = git('rev-parse', 'HEAD')[0];
  const lines = [
    `KioskAdmin 增量更新 ${date}（基準 ${since.slice(0, 7)} → ${head.slice(0, 7)}）`,
    '解壓到站台根目錄直接覆蓋，覆蓋前先停服務、覆蓋後重啟。',
    '',
    '更新的檔案：',
    ...files.map((f) => '  ' + dest(f)),
  ];
  if (deleted.length) lines.push('', '已刪除、請在伺服器手動刪掉：', ...deleted.map((f) => '  ' + f));
  fs.writeFileSync(path.join(stage, 'CHANGES.txt'), lines.join('\r\n') + '\r\n');
}

fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });
fs.writeFileSync(LAST, git('rev-parse', 'HEAD')[0] + '\n');
console.log(`${mode}：${zip}  ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);
if (mode.startsWith('增量')) { console.log('檔案：'); files.forEach((f) => console.log('  ' + dest(f))); if (deleted.length) console.log('需手動刪除：', deleted.join(', ')); }
