// 온트랙 서비스워커 — 앱 셸 오프라인 캐시(로컬 우선). 데이터는 localStorage에만 저장.
const CACHE = 'ontrack-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './push.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 앱 셸 파일명 — 재배포 즉시 반영을 위해 네트워크 우선(실패 시 캐시).
const FRESH_NAMES = ['index.html', 'app.js', 'config.js', 'push.js', 'styles.css', 'manifest.webmanifest'];
const networkFirst = (req) => fetch(req).then((res) => {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}).catch(() => caches.match(req).then((h) => h || caches.match('./index.html')));
const cacheFirst = (req) => caches.match(req).then((hit) => hit || fetch(req).then((res) => {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}).catch(() => caches.match('./index.html')));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부(Supabase 등)는 관여 안 함
  const last = url.pathname.split('/').pop() || '';
  const isShell = last === '' || FRESH_NAMES.includes(last);
  e.respondWith(isShell ? networkFirst(req) : cacheFirst(req));
});

// ── 푸시 수신: 알림 표시 ──
self.addEventListener('push', (e) => {
  let d = { title: '온트랙', body: '', url: '/' };
  try { if (e.data) d = { ...d, ...e.data.json() }; } catch (_) { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/' },
  }));
});

// ── 알림 클릭: 앱 포커스/열기 ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
