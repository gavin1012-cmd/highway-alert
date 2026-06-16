// Web Push 訂閱管理 & Session 與 Worker 同步

const Push = (() => {
  let swRegistration = null;
  let pushSubscription = null;
  let gpsUpdateTimer = null;

  // 初始化 Service Worker
  async function init() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[Push] Service Worker not supported');
      return false;
    }
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('[Push] SW registered');

      // 接收 SW 的 postMessage（push 觸發語音播報）
      navigator.serviceWorker.addEventListener('message', onSwMessage);
      return true;
    } catch (err) {
      console.error('[Push] SW registration failed:', err);
      return false;
    }
  }

  function onSwMessage(event) {
    const { type, data } = event.data || {};
    if (type === 'PUSH_ALERT') {
      // 螢幕亮時，把 push 通知的文字也用語音播報
      if (document.visibilityState === 'visible') {
        Alert.speak(data.message);
      }
      UI.showAlert(data.message, data.level);
    }
  }

  // 訂閱 Web Push
  async function subscribePush() {
    if (!swRegistration) {
      console.warn('[Push] No SW registration');
      return null;
    }
    if (!APP_CONFIG.VAPID_PUBLIC_KEY) {
      console.warn('[Push] VAPID public key not set');
      return null;
    }

    // 已有訂閱則取消後重新訂閱（確保 key 正確）
    const existing = await swRegistration.pushManager.getSubscription();
    if (existing) {
      const existingKey = btoa(String.fromCharCode(
        ...new Uint8Array(existing.options.applicationServerKey)
      ));
      if (existingKey === APP_CONFIG.VAPID_PUBLIC_KEY) {
        pushSubscription = existing;
        return existing;
      }
      await existing.unsubscribe();
    }

    try {
      const keyBytes = urlBase64ToUint8Array(APP_CONFIG.VAPID_PUBLIC_KEY);
      pushSubscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes,
      });
      console.log('[Push] Subscribed:', pushSubscription.endpoint);
      return pushSubscription;
    } catch (err) {
      console.error('[Push] Subscribe failed:', err);
      return null;
    }
  }

  // 啟動監控：傳送 session 到 Worker
  async function startSession(position) {
    const workerUrl = APP_CONFIG.WORKER_URL;
    if (!workerUrl) return { ok: false, error: 'Worker URL 未設定' };

    const sub = await subscribePush();
    const body = {
      lat: position.lat,
      lng: position.lng,
      heading: position.heading,
      speed: position.speed,
      sensitivity: document.querySelector('input[name="sensitivity"]:checked')?.value || 'orange',
      lookahead: document.querySelector('input[name="alertDist"]:checked')?.value || 'auto',
      pushSub: sub ? sub.toJSON() : null,
    };

    try {
      const res = await fetch(`${workerUrl}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // 開始定期更新 GPS 位置到 Worker
      startGpsUpdates();

      return { ok: true, sessionId: data.sessionId };
    } catch (err) {
      console.error('[Push] startSession failed:', err);
      return { ok: false, error: err.message };
    }
  }

  // 停止監控：通知 Worker 結束 session
  async function stopSession() {
    stopGpsUpdates();
    const workerUrl = APP_CONFIG.WORKER_URL;
    if (!workerUrl || !pushSubscription) return;

    try {
      await fetch(`${workerUrl}/session/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: pushSubscription.endpoint }),
        keepalive: true,
      });
    } catch (_) {}
  }

  // 定期發送 GPS 更新到 Worker（修正推算位置）
  function startGpsUpdates() {
    stopGpsUpdates();
    gpsUpdateTimer = setInterval(sendGpsUpdate, APP_CONFIG.GPS_UPDATE_INTERVAL_MS);
  }

  function stopGpsUpdates() {
    if (gpsUpdateTimer) {
      clearInterval(gpsUpdateTimer);
      gpsUpdateTimer = null;
    }
  }

  async function sendGpsUpdate() {
    const pos = Geo.getState();
    const workerUrl = APP_CONFIG.WORKER_URL;
    if (!pos || !workerUrl || !pushSubscription) return;

    try {
      await fetch(`${workerUrl}/session/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: pushSubscription.endpoint,
          lat: pos.lat,
          lng: pos.lng,
          heading: pos.heading,
          speed: pos.speed,
        }),
      });
    } catch (_) {}
  }

  // 測試 Worker 連線
  async function testWorker(url) {
    try {
      const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  // Base64URL → Uint8Array（VAPID key 轉換）
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  }

  return { init, startSession, stopSession, testWorker, subscribePush };
})();
