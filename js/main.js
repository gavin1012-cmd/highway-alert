// App 主控制器：初始化、監控迴圈

const App = (() => {
  let isMonitoring = false;
  let pollTimer = null;
  let clockTimer = null;
  let lastKnownRoadName = null;

  async function init() {
    // 啟動時鐘
    UI.updateTime();
    clockTimer = setInterval(UI.updateTime, 1000);

    // 綁定 UI 事件
    UI.bindEvents({ onMonitorToggle: toggleMonitoring });

    // iOS 安裝提示
    UI.maybeShowInstallBanner();

    // 初始化 Service Worker & Push
    await Push.init();

    // URL 參數 autostart=1（從主畫面捷徑啟動）
    if (new URLSearchParams(location.search).get('autostart') === '1') {
      await startMonitoring();
    }

    console.log('[App] Ready');
  }

  async function toggleMonitoring() {
    if (isMonitoring) {
      await stopMonitoring();
    } else {
      await startMonitoring();
    }
  }

  async function startMonitoring() {
    isMonitoring = true;
    UI.setMonitoringState(true);
    UI.updatePushStatus('gps');
    Alert.reset();

    try {
      // 通知權限（最多等 5 秒，不卡住主流程）
      if ('Notification' in window && Notification.permission === 'default') {
        await Promise.race([
          Notification.requestPermission(),
          new Promise(r => setTimeout(r, 5000)),
        ]);
      }

      // 啟動 GPS
      const gpsOk = Geo.startTracking(onGpsUpdate);
      if (!gpsOk) {
        alert('無法取得 GPS，請確認位置權限已開啟。');
        await stopMonitoring();
        return;
      }

      // 等待首次 GPS 定位（最多 10 秒）
      await waitForGps();

      const pos = Geo.getState();

      // 啟動 Worker session（背景推播），最多等 10 秒
      let pushOk = false;
      if (APP_CONFIG.WORKER_URL) {
        const result = await Promise.race([
          Push.startSession(pos || { lat: 0, lng: 0, heading: 0, speed: 0 }),
          new Promise(r => setTimeout(() => r({ ok: false, error: 'timeout' }), 10000)),
        ]);
        pushOk = result.ok;
        if (!pushOk) console.warn('[App] Worker session failed:', result.error);
      }

      UI.updatePushStatus(pushOk ? 'push' : 'active');

    } catch (err) {
      console.error('[App] startMonitoring error:', err);
      UI.updatePushStatus('active'); // 確保不會卡在「定位中」
    }

    // 立即查一次路況
    await pollTraffic();

    // 開始 30 秒輪詢
    pollTimer = setInterval(pollTraffic, APP_CONFIG.POLL_INTERVAL_MS);
  }

  async function stopMonitoring() {
    isMonitoring = false;
    lastKnownRoadName = null;
    Traffic.resetCorridor();
    UI.setMonitoringState(false);
    UI.updatePushStatus('inactive');

    Geo.stopTracking();
    await Push.stopSession();
    Alert.reset();
    UI.clearAlert();

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function onGpsUpdate(position) {
    if (position) {
      UI.updateStatus(position, lastKnownRoadName);
    } else {
      document.getElementById('roadInfo').textContent = 'GPS 定位失敗，請確認位置權限';
    }
  }

  async function pollTraffic() {
    const pos = Geo.getState();
    if (!pos) return;

    try {
      await Traffic.updateConditions(pos);
    } catch (err) {
      console.warn('[App] Traffic update error:', err);
      return;
    }

    // 先更新廊道鎖定，再計算色塊條（順序很重要）
    const corridor = Traffic.updateCorridorLock(pos);

    // 取前方 10 km 路況並更新 UI（未在國道上則顯示全灰）
    const testMode = document.getElementById('testMode')?.checked || false;
    const onHighway = testMode || !!corridor;
    const segments = onHighway
      ? Traffic.getAheadSegments(pos)
      : Array(10).fill({ level: Traffic.LEVEL.UNKNOWN });
    UI.updateTrafficBar(segments);

    // 更新路名（廊道鎖定時搜尋範圍放寬；未鎖定時 2km 內才顯示）
    const roadName = Traffic.getNearestRoadName(pos);
    if (roadName) {
      lastKnownRoadName = roadName;
      document.getElementById('roadInfo').textContent = roadName;
    } else if (!corridor && lastKnownRoadName) {
      // 離開國道後清除路名
      lastKnownRoadName = null;
    }

    // 預警邏輯：廊道已鎖定（確實在國道上）且車速 > 10 km/h 才警示
    const alertDist = Geo.getAlertDistance(
      pos.speed,
      document.querySelector('input[name="alertDist"]:checked')?.value || 'auto'
    );
    const relevantSegs = segments.filter(s => s.km <= alertDist);
    const triggered = (onHighway && (testMode || pos.speed > 10)) ? Alert.checkSegments(relevantSegs) : [];

    if (triggered.length > 0) {
      // 取最嚴重的警示顯示
      const worst = triggered.reduce((a, b) => b.level > a.level ? b : a);
      UI.showAlert(worst.message, worst.level);
    }
  }

  // 等待 GPS 定位（最多 10 秒）
  function waitForGps(maxMs = 10000) {
    return new Promise(resolve => {
      const start = Date.now();
      const check = setInterval(() => {
        if (Geo.getState() || Date.now() - start > maxMs) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }

  // 頁面可見性變化時重啟 Push（iOS 返回前景）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isMonitoring) {
      pollTraffic();
    }
  });

  return { init };
})();

// 啟動
document.addEventListener('DOMContentLoaded', () => App.init());
