/* 使用說明手冊截圖用的示範資料（2026-09-23）。
   全部是這裡寫死的假機器、假帳號、假版面，不連資料庫、不含任何客戶內容；
   圖片是 manual-assets/ 的示範海報，由 shoot-manual.js 攔截 /files/ 請求時餵進畫面。
   欄位形狀＝server.js 的 /api/devices、/api/config/:id、/api/users、/api/shared-settings 回應。 */

const DEMO_CHAT = { baseUrl: 'https://chat-api.justhings.ai', email: 'service@example.com', password: 'demo-password' };
const AGENT = { id: 'demo-agent-0001', name: '園區智能客服' };

const cell = (over = {}) => ({
  t: 'cell', bg: 'Solid', bgColor: 4280693304, bgImgs: [], scale: 'Crop', dur: 8, bgBlur: 0,
  content: 'None', mqSpeed: 100, txtSize: 100, glow: false, edgeFade: false, video: '', web: '', text: '',
  wAuto: true, wCounty: '', wDistrict: '', wDynBg: false,
  tap: 'None', tapUrl: '', parkHere: '', parkFx: 'Sweep', parkLayout: 'Auto', parkInfoLayout: 'Kiosk',
  agentId: '', agentName: '', assistantLayout: 'Kiosk', agentSpeak: true, agentSpeakRate: 1, agentUpload: true,
  ...over,
});
const split = (dir, ratio, a, b) => ({ t: 'split', dir, ratio, a, b }); // Vertical＝左右、Horizontal＝上下
const IMG = {
  indigo: '/files/demo-indigo.png', garden: '/files/demo-garden.png',
  food: '/files/demo-food.png', event: '/files/demo-event.png', wide: '/files/demo-wide.png',
};

// ---- 頁面 ----
const pageGuide = () => ({
  id: 1, name: '園區導覽',
  blocks: [
    { id: 1, w: 0.62, node: split('Horizontal', 0.46,
      cell({ content: 'Marquee', text: '歡迎蒞臨　今日開園 09:00 – 17:30　藍染體驗 10:00 / 14:00', bgColor: 4281545523, txtColor: 4294967295 }),
      cell({ content: 'Weather', wAuto: false, wCounty: '苗栗縣', wDistrict: '三義鄉', wDynBg: true })) },
    { id: 2, w: 1.75, node: split('Vertical', 0.6,
      cell({ bg: 'Image', bgImgs: [IMG.indigo, IMG.garden], dur: 10, tap: 'OpenWeb', tapUrl: 'https://example.com/tour', tapHint: 'Badge' }),
      cell({ bg: 'Image', bgImgs: [IMG.garden], bgBlur: 20, content: 'ParkInfo', tap: 'OpenParkInfo', parkHere: 'D2', tapLabel: '點我查看', parkFx: 'Sweep', txtSize: 110 })) },
    { id: 3, w: 0.95, node: split('Vertical', 0.5,
      cell({ bgColor: 4280627254, content: 'Text', text: 'AI 智慧導覽', txtSize: 130, tap: 'OpenAssistant', agentId: AGENT.id, agentName: AGENT.name, tapHint: 'Button', tapLabel: '開始對話' }),
      cell({ bg: 'Image', bgImgs: [IMG.food] })) },
  ],
});

const pageEvent = () => ({
  id: 2, name: '活動公告',
  blocks: [
    { id: 1, w: 2.4, node: cell({ bg: 'Image', bgImgs: [IMG.event], scale: 'Fit', bgBlur: 40, edgeFade: true }) },
    { id: 2, w: 0.5, node: cell({ content: 'Marquee', text: '秋季音樂會 10/18（六）18:30　中庭廣場　自由入座', bgColor: 4283190348, mqSpeed: 120 }) },
  ],
});

const pageFood = () => ({
  id: 3, name: '餐飲資訊',
  blocks: [
    { id: 1, w: 1.4, node: cell({ bg: 'Image', bgImgs: [IMG.food] }) },
    { id: 2, w: 1, node: split('Vertical', 0.55,
      cell({ content: 'Text', text: '窯烤披薩　11:30 – 16:30', bgColor: 4281545523, txtSize: 115 }),
      cell({ bg: 'Image', bgImgs: [IMG.garden], tap: 'OpenWeb', tapUrl: 'https://example.com/menu', tapHint: 'Glow' })) },
  ],
});

const sleep = {
  enabled: true, sameEveryDay: true, experimentalSystemSleep: false,
  periods: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, start: 1080, end: 545 })), // 18:00 – 09:05
};

const config = (name, pages, over = {}) => ({
  deviceName: name, adminPin: '0000', chatApi: { ...DEMO_CHAT }, sleep: JSON.parse(JSON.stringify(sleep)),
  idleReturnSec: 90, activePage: 0, pages, ...over,
});

const FARBAR = { w: 1080, h: 1920, inch: 43, model: 'FarBar-YH02' };

const devices = [
  {
    DeviceId: 'farbar-lobby', DeviceName: '大廳展示機', Version: 42,
    UpdatedAt: new Date(Date.now() - 36e5).toISOString(), OwnerUserId: 'u1', OwnerName: 'joyeadmin',
    Screen: { ...FARBAR }, LastSeenAgoSec: 9, LastAppVersion: '1.55', LastServerUrl: null,
    ServerMatch: true, KeyMismatch: false, LastKeyMismatchAt: null,
    config: config('大廳展示機', [pageGuide(), pageEvent(), pageFood()], { screen: { ...FARBAR } }),
  },
  {
    DeviceId: 'farbar-trail', DeviceName: '藍染長廊', Version: 17,
    UpdatedAt: new Date(Date.now() - 3 * 864e5).toISOString(), OwnerUserId: 'u2', OwnerName: 'frontdesk',
    Screen: { ...FARBAR }, LastSeenAgoSec: 726, LastAppVersion: '1.55', LastServerUrl: null,
    ServerMatch: true, KeyMismatch: false, LastKeyMismatchAt: null,
    config: config('藍染長廊', [pageFood(), pageEvent()], { screen: { ...FARBAR }, idleReturnSec: 120 }),
  },
  {
    DeviceId: 'web-櫃台螢幕', DeviceName: '櫃台螢幕', Version: 9,
    UpdatedAt: new Date(Date.now() - 2 * 36e5).toISOString(), OwnerUserId: 'u1', OwnerName: 'joyeadmin',
    Screen: { w: 1080, h: 1920 }, LastSeenAgoSec: 24, LastAppVersion: 'web 1.0', LastServerUrl: null,
    ServerMatch: true, KeyMismatch: false, LastKeyMismatchAt: null,
    config: config('櫃台螢幕', [pageEvent()], { screen: { w: 1080, h: 1920 } }),
  },
];
// 列表縮圖要的摘要（server.js summarizeForList）
devices.forEach((d) => {
  d.PageCount = d.config.pages.length;
  const pg = d.config.pages[d.config.activePage || 0];
  d.ActivePage = { name: pg.name || '', blocks: pg.blocks || [] };
});

const users = [
  { UserId: 'u1', Username: 'joyeadmin', DisplayName: '園區 管理員', IsAdmin: true, Devices: [] },
  { UserId: 'u2', Username: 'frontdesk', DisplayName: '前台 佩珊', IsAdmin: false, Devices: ['farbar-lobby', 'farbar-trail'] },
  { UserId: 'u3', Username: 'marketing', DisplayName: '行銷 育庭', IsAdmin: false, Devices: ['farbar-lobby'] },
];

const shared = {
  layouts: [
    { id: 1, name: '園區導覽（直式）', updatedAt: new Date(Date.now() - 864e5).toISOString(), createdBy: '園區 管理員', pages: [pageGuide()] },
    { id: 2, name: '活動公告', updatedAt: new Date(Date.now() - 5 * 864e5).toISOString(), createdBy: '行銷 育庭', pages: [pageEvent()] },
    { id: 3, name: '餐飲資訊', updatedAt: new Date(Date.now() - 9 * 864e5).toISOString(), createdBy: '園區 管理員', pages: [pageFood()] },
  ],
  chatApi: { ...DEMO_CHAT }, sleep: JSON.parse(JSON.stringify(sleep)), adminPin: '0000', idleReturnSec: 90,
  themeColor: '#E07800',
};

const me = { username: 'joyeadmin', displayName: '園區 管理員', isAdmin: true };
const connectionInfo = { serverUrl: 'https://justdisplay.justhings.com.tw/joye', deviceKey: 'joye-demo-key-2026', parkApi: 'https://example.com/api/telemetry/current' };

module.exports = { devices, users, shared, me, connectionInfo, AGENT, IMG };
