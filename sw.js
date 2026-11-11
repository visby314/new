// アプリの画面だけを端末に保存する（GitHubへの送信は保存しない）。電波があるときは、いつも新しいものを取りに行く
const CACHE = 'new-app-v1';
const FILES = ['./', './index.html', './css/app.css', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
  './js/main.js', './js/util.js', './js/merge.js', './js/tt.js', './js/calc.js', './js/store.js', './js/dom.js', './js/shared.js',
  './js/today.js', './js/send.js', './js/rec-time.js', './js/rec-scores.js', './js/rec-kouza.js', './js/settings.js', './js/notify.js', './data/kouza-data.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('new-app') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return res; })
    .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
});
// 知らせを押したら、アプリを前に出す
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => { for (const c of cs) if ('focus' in c) return c.focus(); return self.clients.openWindow('./'); }));
});
