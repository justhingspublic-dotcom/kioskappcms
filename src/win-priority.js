/* Windows 程序優先權全面拉回正常＋鎖住常駐記憶體（2026-09-15 揚昇凍結事故後續）。
 * 實測：工作排程器用預設設定（Priority 7）啟動的程序，不只 CPU 是「低於正常」，連 I/O 優先權＝低(1)、
 * 記憶體優先權＝低(2)，而且子程序全部繼承。os.setPriority 只改得到 CPU。
 * 記憶體優先權低＝伺服器一缺記憶體，這個程序的分頁最先被收走；I/O 優先權低＝要讀回來時排在所有網站後面。
 * 兩者加起來就是「程式整段停住好幾秒到幾分鐘」。這支用 PowerShell 呼叫 Win32 API：
 *   - CPU 低於正常／閒置 → 正常；I/O 優先權 < 正常 → 正常；記憶體優先權 < 正常 → 正常（只往上拉到正常，不會更高）
 *   - 常駐記憶體硬下限（SetProcessWorkingSetSizeEx HARDWS_MIN）：這個大小以內的記憶體系統不會收走
 * 非 Windows 直接回 null。非同步執行，不擋啟動；失敗只回錯誤訊息，由呼叫端記 log。
 */
const { spawn } = require('child_process');
const path = require('path');

const CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class KioskPrio {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint GetPriorityClass(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetPriorityClass(IntPtr h, uint cls);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref int info, int len, IntPtr retLen);
  [DllImport("ntdll.dll")] static extern int NtSetInformationProcess(IntPtr h, int cls, ref int info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref int info, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref int info, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessWorkingSetSizeEx(IntPtr h, IntPtr min, IntPtr max, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessWorkingSetSizeEx(IntPtr h, out IntPtr min, out IntPtr max, out uint flags);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool LookupPrivilegeValue(string sys, string name, out long luid);
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct TP { public int Count; public long Luid; public int Attr; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TP state, int len, IntPtr prev, IntPtr ret);

  const uint NORMAL = 0x20, BELOW = 0x4000, IDLE = 0x40;

  static void Enable(string name) {
    IntPtr t;
    if (!OpenProcessToken(GetCurrentProcess(), 0x28, out t)) return;
    long luid;
    if (LookupPrivilegeValue(null, name, out luid)) {
      TP tp = new TP(); tp.Count = 1; tp.Luid = luid; tp.Attr = 2;
      AdjustTokenPrivileges(t, false, ref tp, 16, IntPtr.Zero, IntPtr.Zero);
    }
    CloseHandle(t);
  }
  static string Cls(uint c) {
    switch (c) { case IDLE: return "idle"; case BELOW: return "below"; case NORMAL: return "normal"; case 0x8000: return "above"; case 0x80: return "high"; case 0x100: return "realtime"; default: return "0x" + c.ToString("X"); }
  }
  static int Io(IntPtr h) { int v = -1; NtQueryInformationProcess(h, 33, ref v, 4, IntPtr.Zero); return v; }
  static int Mem(IntPtr h) { int v = -1; GetProcessInformation(h, 0, ref v, 4); return v; }

  public static string Run(int pid, long minWsMB, bool apply) {
    Enable("SeIncreaseWorkingSetPrivilege");
    Enable("SeIncreaseBasePriorityPrivilege");
    IntPtr h = OpenProcess(0x0100 | 0x0200 | 0x0400, false, pid);
    if (h == IntPtr.Zero) return "{\"error\":\"OpenProcess " + Marshal.GetLastWin32Error() + "\"}";
    try {
      string cpu0 = Cls(GetPriorityClass(h)); int io0 = Io(h), mem0 = Mem(h);
      string errs = "";
      string ws = "skip";
      if (apply) {
        uint c = GetPriorityClass(h);
        if ((c == BELOW || c == IDLE) && !SetPriorityClass(h, NORMAL)) errs += "cpu:" + Marshal.GetLastWin32Error() + " ";
        if (io0 >= 0 && io0 < 2) { int v = 2; int st = NtSetInformationProcess(h, 33, ref v, 4); if (st != 0) errs += "io:0x" + st.ToString("X") + " "; }
        if (mem0 >= 0 && mem0 < 5) { int v = 5; if (!SetProcessInformation(h, 0, ref v, 4)) errs += "mem:" + Marshal.GetLastWin32Error() + " "; }
        if (minWsMB > 0) {
          long min = minWsMB * 1024L * 1024L, max = Math.Max(min * 4, 1024L * 1024L * 1024L);
          if (SetProcessWorkingSetSizeEx(h, new IntPtr(min), new IntPtr(max), 0x1 | 0x8)) ws = "locked";
          else ws = "err" + Marshal.GetLastWin32Error();
        }
      }
      IntPtr mn, mx; uint fl; long wsMin = 0; bool hard = false;
      if (GetProcessWorkingSetSizeEx(h, out mn, out mx, out fl)) { wsMin = mn.ToInt64() / 1048576; hard = (fl & 0x1) != 0; }
      return "{\"pid\":" + pid + ",\"cpu\":[\"" + cpu0 + "\",\"" + Cls(GetPriorityClass(h)) + "\"],\"io\":[" + io0 + "," + Io(h) +
        "],\"mem\":[" + mem0 + "," + Mem(h) + "],\"ws\":\"" + ws + "\",\"wsMinMB\":" + wsMin + ",\"wsHard\":" + (hard ? "true" : "false") +
        ",\"errors\":\"" + errs.Trim() + "\"}";
    } finally { CloseHandle(h); }
  }
}
`;

const IO_NAMES = { 0: '很低', 1: '低', 2: '正常', 3: '高' };
const MEM_NAMES = { 1: '很低', 2: '低', 3: '中', 4: '低於正常', 5: '正常' };
const CPU_NAMES = { idle: '閒置', below: '低於正常', normal: '正常', above: '高於正常', high: '高', realtime: '即時' };

/** 查（apply=false）或拉回正常並鎖常駐記憶體（apply=true）。回傳解析後的結果物件，失敗回 { error }。 */
function normalize(pid, { minWorkingSetMB = 0, apply = true } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = `$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${CS}\n'@\n[KioskPrio]::Run(${Number(pid)}, ${Number(minWorkingSetMB)}, $${apply ? 'true' : 'false'})\n`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const ps = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    const timer = setTimeout(() => { try { ps.kill(); } catch { /* ignore */ } finish({ error: 'PowerShell 90 秒沒完成' }); }, 90_000);
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', (e) => finish({ error: e.message }));
    ps.on('close', () => {
      const line = out.trim().split(/\r?\n/).pop() || '';
      try { finish(JSON.parse(line)); } catch { finish({ error: (err || out || '沒有輸出').replace(/\s+/g, ' ').trim().slice(0, 300) }); }
    });
  });
}

/** 結果 → 一句中文（log 用）。 */
function describe(r) {
  if (!r) return '非 Windows，略過';
  if (r.error) return `無法調整：${r.error}`;
  const pair = (names, [a, b]) => (a === b ? `${names[a] || a}` : `${names[a] || a}→${names[b] || b}`);
  const ws = r.ws === 'locked' ? `常駐記憶體下限 ${r.wsMinMB}MB 已鎖定` : r.ws === 'skip' ? '' : `常駐記憶體下限鎖定失敗（${r.ws}）`;
  return [`CPU ${pair(CPU_NAMES, r.cpu)}`, `I/O ${pair(IO_NAMES, r.io)}`, `記憶體 ${pair(MEM_NAMES, r.mem)}`, ws, r.errors ? `錯誤 ${r.errors}` : '']
    .filter(Boolean).join('、');
}

/** 調整後是否三項都已是正常以上。 */
const isNormal = (r) => !!r && !r.error && ['normal', 'above', 'high', 'realtime'].includes(r.cpu[1]) && r.io[1] >= 2 && r.mem[1] >= 5;

module.exports = { normalize, describe, isNormal };
