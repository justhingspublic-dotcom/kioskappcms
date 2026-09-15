/* Express 4 不接 async 路由的 rejected promise（2026-09-15 揚昇事故）：
 * 路由裡 `await db.getPool().request()…` 一丟錯，Express 4 只會走 process 的 unhandledRejection，
 * 那個 HTTP 請求永遠不回應——使用者看到的就是「頁面轉不出來」而不是錯誤訊息。
 * 這支把 Router 的 Layer.handle_request 包一層：handler 回傳 promise 就接住 rejection 轉給 next(err)，
 * 讓 server.js 最下面的錯誤中介層回 500＋中性文案＋requestId。作法同 express-async-errors 套件，
 * 但不多裝一個依賴。必須在 require('express') 之後、註冊任何路由之前 require 這支。
 */
const Layer = require('express/lib/router/layer');

const original = Layer.prototype.handle_request;

Layer.prototype.handle_request = function handleRequestAsync(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // 4 個參數＝錯誤中介層，與原本一樣略過
  let out;
  try {
    out = fn(req, res, next);
  } catch (err) {
    return next(err);
  }
  if (out && typeof out.then === 'function') {
    out.then(undefined, (err) => next(err instanceof Error ? err : new Error(String(err ?? 'async handler rejected'))));
  }
};

module.exports = { original };
