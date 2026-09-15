/* ==========================================================================
   站台主題色 → 整組 CSS 變數（2026-09-14）
   後台 nav「主題色」選一個 --accent，後台深淺色、展示機 App 都跟它走（品牌一致、又能自己改）。
   淺色：--accent 直接用，brand 家族由 admin-kit tokens.css 的 color-mix 衍生；
         文字用的 --accent-text／--fg-brand 若在白底上對比不到 4.5:1（例：橘 #E07800 只有 3.0），
         就沿同色相壓暗到及格（藍、綠本來就及格，維持原色）。
   深色：kit 的 oklch(from …) Safari 不吃、×1.5 又會螢光，所以這裡用 JS 算 oklch 再寫死 hex，
         公式與 style.css／themes/sunrise.css 手調那組完全相同（用 #0051A8 可還原 style.css 的值）：
         brand L.55 c×.95｜strong L.60 c×.95｜medium L.40 c×.70｜soft L.31 c×.55｜softer L.25 c×.45
         fg L.78 c×.70｜fg-strong L.85 c×.50｜border L.48 c×.70｜border-subtle L.33 c×.50｜accent-text L.62 c×.80
   同一支檔案瀏覽器（即時預覽）與 Node（server.js 出頁面時內嵌 <style>）都能載。
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KioskThemeColor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT = '#E07800'; // JusThings 公司橘：新場域沒設定時的預設

  function normalize(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    return m ? '#' + m[1].toUpperCase() : null;
  }

  // ---- sRGB ↔ OKLCH（Björn Ottosson 的 OKLab 矩陣） ----
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); }
  function rgbToHex(rgb) { return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  function rgbToOklab([r, g, b]) {
    r = lin(r); g = lin(g); b = lin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  function oklabToRgb([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [
      gam(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
  }
  const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
  function toLch(hex) {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    return { L, c: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
  }
  /** oklch → hex；超出 sRGB 色域時照 CSS 的做法把彩度往下收到剛好進得來（色相、亮度不動）。 */
  function fromLch(L, c, h) {
    const rad = h * Math.PI / 180;
    let lo = 0, hi = c, rgb = oklabToRgb([L, c * Math.cos(rad), c * Math.sin(rad)]);
    if (inGamut(rgb)) return rgbToHex(rgb);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const t = oklabToRgb([L, mid * Math.cos(rad), mid * Math.sin(rad)]);
      if (inGamut(t)) { lo = mid; rgb = t; } else hi = mid;
    }
    return rgbToHex(rgb);
  }

  // ---- WCAG 對比：淺色文字用的主題色要在白底上讀得清楚 ----
  function luminance(hex) { const [r, g, b] = hexToRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function contrastOnWhite(hex) { return 1.05 / (luminance(hex) + 0.05); }
  /** 文字用色：對比夠就是 accent 本身；不夠就沿同色相、同彩度逐步壓暗到 4.5:1。 */
  function textTone(hex) {
    if (contrastOnWhite(hex) >= 4.5) return hex;
    const { c, h } = toLch(hex);
    let { L } = toLch(hex);
    let out = hex;
    for (let i = 0; i < 60 && contrastOnWhite(out) < 4.5; i++) { L -= 0.01; out = fromLch(L, c, h); }
    return out;
  }

  /** 由 accent 推整組：淺色只換 accent／文字色，深色整個 brand 家族寫死。 */
  function derive(hex) {
    const accent = normalize(hex) || DEFAULT;
    const { c, h } = toLch(accent);
    const t = (L, k) => fromLch(L, c * k, h);
    return {
      accent,
      accentText: textTone(accent),
      dark: {
        brand: t(0.55, 0.95), brandStrong: t(0.60, 0.95), brandMedium: t(0.40, 0.70),
        brandSoft: t(0.31, 0.55), brandSofter: t(0.25, 0.45),
        fgBrand: t(0.78, 0.70), fgBrandStrong: t(0.85, 0.50),
        borderBrand: t(0.48, 0.70), borderBrandSubtle: t(0.33, 0.50),
        accentText: t(0.62, 0.80),
      },
    };
  }

  /** 接在 style.css 之後的 CSS 文字（伺服器包成 <style id="siteTheme">，後台預覽直接改 textContent）。 */
  function css(hex) {
    const d = derive(hex);
    const k = d.dark;
    return `:root{--accent:${d.accent};--accent-text:${d.accentText};--fg-brand:${d.accentText};}\n` +
      `html:root[data-color-mode="dark"]{--brand:${k.brand};--brand-strong:${k.brandStrong};--brand-medium:${k.brandMedium};` +
      `--brand-soft:${k.brandSoft};--brand-softer:${k.brandSofter};--fg-brand:${k.fgBrand};--fg-brand-strong:${k.fgBrandStrong};` +
      `--border-brand:${k.borderBrand};--border-brand-subtle:${k.borderBrandSubtle};--accent-text:${k.accentText};}`;
  }

  /** 只套在 [sel] 底下的預覽版（modal 樣本列用）：淺色 brand 家族在 :root 是由 --accent color-mix 出來的，
   *  只在子元素改 --accent 不會重算，所以這裡把 tokens.css 那組公式一起寫在 [sel] 上。 */
  function scopedCss(hex, sel) {
    const d = derive(hex);
    const k = d.dark;
    const a = d.accent;
    return `${sel}{--accent:${a};--accent-text:${d.accentText};--fg-brand:${d.accentText};` +
      `--brand:${a};--brand-strong:color-mix(in srgb, ${a} 84%, #000);--brand-medium:color-mix(in srgb, ${a} 36%, #fff);` +
      `--brand-soft:color-mix(in srgb, ${a} 18%, #fff);--brand-softer:color-mix(in srgb, ${a} 10%, #fff);` +
      `--fg-brand-strong:color-mix(in srgb, ${a} 88%, #000);--border-brand:${a};--border-brand-subtle:color-mix(in srgb, ${a} 32%, #fff);}\n` +
      `html[data-color-mode="dark"] ${sel}{--brand:${k.brand};--brand-strong:${k.brandStrong};--brand-medium:${k.brandMedium};` +
      `--brand-soft:${k.brandSoft};--brand-softer:${k.brandSofter};--fg-brand:${k.fgBrand};--fg-brand-strong:${k.fgBrandStrong};` +
      `--border-brand:${k.borderBrand};--border-brand-subtle:${k.borderBrandSubtle};--accent-text:${k.accentText};}`;
  }

  return { DEFAULT, normalize, derive, css, scopedCss, contrastOnWhite };
});
