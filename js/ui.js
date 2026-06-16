// UI 渲染與互動

const UI = (() => {
  // DOM refs
  const $ = id => document.getElementById(id);

  // 更新頂部時間
  function updateTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    $('updateTime').textContent =
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // 更新位置/速度狀態
  function updateStatus(position) {
    if (!position) return;
    $('currentSpeed').textContent = `${position.speed} km/h`;
    $('currentDirection').textContent =
      `↑ ${Geo.headingToText(position.heading)} (${Math.round(position.heading)}°)`;
    // 路名推算（暫用座標顯示，Worker 回傳後可覆蓋）
    $('roadInfo').textContent =
      `${position.lat.toFixed(4)}°N, ${position.lng.toFixed(4)}°E`;
  }

  // 更新路名（Worker 回傳後呼叫）
  function updateRoadName(name) {
    if (name) $('roadInfo').textContent = name;
  }

  // 更新推播狀態顯示
  function updatePushStatus(state) {
    // state: 'inactive' | 'active' | 'push' | 'error'
    const dot = $('pushStatus').querySelector('.status-dot');
    const text = $('pushStatus').querySelector('.status-text');
    dot.className = 'status-dot';

    const states = {
      inactive: { cls: 'dot-inactive', label: '未啟動' },
      gps:      { cls: 'dot-active',   label: '定位中...' },
      active:   { cls: 'dot-active',   label: '監控中（本地）' },
      push:     { cls: 'dot-push',     label: '監控中 🔔 背景推播已啟用' },
      error:    { cls: 'dot-error',    label: '連線失敗' },
    };
    const s = states[state] || states.inactive;
    dot.classList.add(s.cls);
    text.textContent = s.label;
  }

  // 更新 10 km 路況色塊條
  function updateTrafficBar(segments) {
    const bar = $('trafficBar');
    const segs = bar.querySelectorAll('.traffic-segment');
    segs.forEach((el, i) => {
      const seg = segments[i] || { level: Traffic.LEVEL.UNKNOWN };
      el.className = `traffic-segment ${Traffic.LEVEL_CLASS[seg.level] || 'unknown'}`;
    });
  }

  // 顯示警示卡片
  function showAlert(message, level) {
    const card = $('alertCard');
    const msgEl = $('alertMessage');
    const timeEl = $('alertTime');
    const noAlert = $('noAlertText');

    msgEl.textContent = message;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    card.classList.remove('hidden', 'red-alert');
    if (level >= Traffic.LEVEL.RED) card.classList.add('red-alert');
    noAlert.classList.add('hidden');

    // 5 分鐘後自動清除警示卡（若無新警示）
    clearTimeout(UI._alertTimer);
    UI._alertTimer = setTimeout(() => {
      card.classList.add('hidden');
      noAlert.classList.remove('hidden');
    }, 5 * 60 * 1000);
  }

  function clearAlert() {
    $('alertCard').classList.add('hidden');
    $('noAlertText').classList.remove('hidden');
    clearTimeout(UI._alertTimer);
  }

  // 開始/停止按鈕狀態
  function setMonitoringState(active) {
    const btn = $('monitorBtn');
    const icon = $('btnIcon');
    const text = $('btnText');
    if (active) {
      btn.classList.add('active');
      icon.textContent = '⬛';
      text.textContent = '停止監控';
    } else {
      btn.classList.remove('active');
      icon.textContent = '▶';
      text.textContent = '開始監控';
    }
  }

  // 設定 Drawer
  function openSettings() {
    $('settingsDrawer').classList.remove('hidden');
    $('settingsOverlay').classList.remove('hidden');
    // 填入目前設定值
    const workerInput = $('workerUrlInput');
    const vapidInput = $('vapidKeyInput');
    if (workerInput && APP_CONFIG.WORKER_URL) workerInput.value = APP_CONFIG.WORKER_URL;
    if (vapidInput && APP_CONFIG.VAPID_PUBLIC_KEY) vapidInput.value = APP_CONFIG.VAPID_PUBLIC_KEY;
  }

  function closeSettings() {
    $('settingsDrawer').classList.add('hidden');
    $('settingsOverlay').classList.add('hidden');
  }

  // 儲存設定
  function saveSettings() {
    const workerUrl = $('workerUrlInput').value.trim();
    const vapidKey = $('vapidKeyInput').value.trim();
    const sensitivity = document.querySelector('input[name="sensitivity"]:checked')?.value;
    const lookahead = document.querySelector('input[name="alertDist"]:checked')?.value;

    if (workerUrl) APP_CONFIG.WORKER_URL = workerUrl;
    if (vapidKey) APP_CONFIG.VAPID_PUBLIC_KEY = vapidKey;

    localStorage.setItem('highway_alert_settings', JSON.stringify({
      workerUrl, vapidKey, sensitivity, lookahead,
    }));

    // 測試 Worker 連線
    if (workerUrl) {
      const statusEl = $('workerStatusRow');
      statusEl.textContent = '測試連線中...';
      Push.testWorker(workerUrl).then(ok => {
        statusEl.textContent = ok ? '✓ Worker 連線正常' : '✗ Worker 無法連線，請確認 URL';
        statusEl.style.color = ok ? 'var(--green-light)' : 'var(--red-light)';
      });
    }
  }

  // iOS 加入主畫面提示（Safari 才顯示）
  function maybeShowInstallBanner() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone;
    const dismissed = localStorage.getItem('install_banner_dismissed');

    if (isIOS && !isStandalone && !dismissed) {
      setTimeout(() => {
        $('installBanner')?.classList.remove('hidden');
      }, 3000);
    }
  }

  // 掛載事件
  function bindEvents(callbacks) {
    $('settingsBtn').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', closeSettings);
    $('settingsOverlay').addEventListener('click', closeSettings);
    $('saveSettingsBtn').addEventListener('click', saveSettings);
    $('monitorBtn').addEventListener('click', callbacks.onMonitorToggle);
    $('installClose')?.addEventListener('click', () => {
      $('installBanner')?.classList.add('hidden');
      localStorage.setItem('install_banner_dismissed', '1');
    });

    // 從 localStorage 還原設定 UI
    const saved = JSON.parse(localStorage.getItem('highway_alert_settings') || '{}');
    if (saved.sensitivity) {
      const el = document.querySelector(`input[name="sensitivity"][value="${saved.sensitivity}"]`);
      if (el) el.checked = true;
    }
    if (saved.lookahead) {
      const el = document.querySelector(`input[name="alertDist"][value="${saved.lookahead}"]`);
      if (el) el.checked = true;
    }
  }

  return {
    updateTime,
    updateStatus,
    updateRoadName,
    updatePushStatus,
    updateTrafficBar,
    showAlert,
    clearAlert,
    setMonitoringState,
    bindEvents,
    openSettings,
    closeSettings,
    maybeShowInstallBanner,
    _alertTimer: null,
  };
})();
