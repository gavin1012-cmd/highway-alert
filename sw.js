// Service Worker：快取 App Shell + 接收 Web Push

const CACHE_NAME = 'highway-alert-v5';
const SHELL_FILES = [
  '/highway-alert/',
  '/highway-alert/index.html',
  '/highway-alert/style.css',
  '/highway-alert/config.js',
  '/highway-alert/manifest.json',
  '/highway-alert/js/geo.js',
  '/highway-alert/js/traffic.js',
  '/highway-alert/js/alert.js',
  '/highway-alert/js/push.js',
  '/highway-alert/js/ui.js',
  '/highway-alert/js/main.js',
  '/highway-alert/icons/icon-192.png',
  '/highway-alert/icons/icon-512.png',
];

// ─── Install：快取 App Shell ───────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 非關鍵資源（icons）允許失敗
      return cache.addAll(SHELL_FILES.filter(f => !f.includes('icon'))).then(() =>
        cache.addAll(SHELL_FILES.filter(f => f.includes('icon'))).catch(() => {})
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate：清理舊快取 ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch：Cache-first for shell, network for API ────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API 呼叫（Worker / TISVCLOUD）不走快取
  if (url.pathname.startsWith('/session') ||
      url.pathname.startsWith('/traffic') ||
      url.hostname.includes('tisvcloud') ||
      url.hostname.includes('workers.dev')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App Shell：Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok && event.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        // 離線 fallback
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ─── Push：接收來自 Cloudflare Worker 的通知 ──────────────
self.addEventListener('push', event => {
  let data = { message: '前方路況有變化，請注意', level: 2, sectionId: 'unknown' };

  if (event.data) {
    try { data = event.data.json(); } catch (_) {
      data.message = event.data.text() || data.message;
    }
  }

  const levelEmoji = { 0: '🟢', 1: '🟡', 2: '🟠', 3: '🔴' };
  const emoji = levelEmoji[data.level] ?? '⚠';

  const notifOptions = {
    body: data.message,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: `highway-alert-${data.sectionId}`,
    renotify: true,
    silent: false,
    data: { message: data.message, level: data.level },
    actions: [
      { action: 'open', title: '查看路況' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(`${emoji} 國道路況警示`, notifOptions)
      .then(() => {
        // 通知已開啟的頁面（螢幕亮時觸發語音播報）
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'PUSH_ALERT', data });
        });
      })
  );
});

// ─── Notification Click：點通知開啟 App ───────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
