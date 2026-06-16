// ============================================================
// 設定檔 - 部署後請修改以下值
// ============================================================

const APP_CONFIG = {
  // Cloudflare Worker URL（部署後填入）
  // 格式: https://highway-alert.YOUR_NAME.workers.dev
  WORKER_URL: '',

  // VAPID 公鑰（與 Worker 的 VAPID_PUBLIC_KEY 環境變數相同）
  // 用 `npx web-push generate-vapid-keys` 產生，或在 Worker 部署說明中取得
  VAPID_PUBLIC_KEY: '',

  // 路況警示設定
  ALERT: {
    // 警示觸發等級：'yellow' | 'orange'（預設 orange = 只在壅塞時警示）
    SENSITIVITY: 'orange',
    // 同一路段最短警示間隔（毫秒）
    COOLDOWN_MS: 5 * 60 * 1000,
    // 前方監控距離（km）- auto 依車速，固定值為數字
    LOOKAHEAD: 'auto',
  },

  // 速度 → 路況色彩閾值（km/h）
  SPEED_THRESHOLDS: {
    GREEN:  80,  // > 80 = 綠（暢通）
    YELLOW: 50,  // 50-80 = 黃（車多）
    ORANGE: 20,  // 20-50 = 橘（壅塞）
               // < 20  = 紅（嚴重壅塞）
  },

  // TISVCLOUD API（Worker 端使用，前端不直接呼叫）
  TISVCLOUD_BASE: 'https://tisvcloud.freeway.gov.tw',

  // 前端輪詢間隔（螢幕亮時本地刷新，毫秒）
  POLL_INTERVAL_MS: 30 * 1000,

  // GPS 更新傳送到 Worker 的間隔（毫秒）
  GPS_UPDATE_INTERVAL_MS: 30 * 1000,
};

// 從 localStorage 讀取使用者覆蓋設定
(function loadUserSettings() {
  const saved = localStorage.getItem('highway_alert_settings');
  if (!saved) return;
  try {
    const settings = JSON.parse(saved);
    if (settings.workerUrl) APP_CONFIG.WORKER_URL = settings.workerUrl;
    if (settings.vapidKey) APP_CONFIG.VAPID_PUBLIC_KEY = settings.vapidKey;
    if (settings.sensitivity) APP_CONFIG.ALERT.SENSITIVITY = settings.sensitivity;
    if (settings.lookahead) APP_CONFIG.ALERT.LOOKAHEAD = settings.lookahead;
  } catch (_) {}
})();
