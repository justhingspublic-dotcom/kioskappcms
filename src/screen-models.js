'use strict';
/**
 * 機型 → 螢幕吋數對照（2026-09-15）。
 *
 * 機器總覽「尺寸」欄以 App 自報的吋數為準（EDID／裝置樹／實測 dpi，見 App ScreenInfo.kt）；
 * 但 FarBar 這類 MIPI DSI 面板的機器什麼硬體資料都沒有（EDID 0 位元組、裝置樹沒 width-mm、ROM dpi 是假的），
 * 只能靠機型（Build.MODEL）查表。user 不要每台手填，所以是一張全站的機型表：新機型出現時在這裡或 .env 登記一次。
 *
 * .env 可加：MODEL_INCH=FarBar-YH02=43;OtherModel=55（分號分隔，會蓋掉／補上內建表）。
 */
const BUILTIN = {
  'FarBar-YH02': 43, // FarBar FS003-T2 43 吋直式，卓也小屋／公司測試機
};

function parseEnv(text) {
  const out = {};
  for (const part of String(text || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const inch = Number(part.slice(i + 1).trim());
    if (key && inch > 0) out[key] = inch;
  }
  return out;
}

const TABLE = { ...BUILTIN, ...parseEnv(process.env.MODEL_INCH) };

/** 依機型查吋數；沒有＝null。比對不分大小寫、忽略前後空白。 */
function inchForModel(model) {
  const key = String(model || '').trim().toLowerCase();
  if (!key) return null;
  for (const [k, v] of Object.entries(TABLE)) if (k.toLowerCase() === key) return v;
  return null;
}

module.exports = { inchForModel, TABLE };
