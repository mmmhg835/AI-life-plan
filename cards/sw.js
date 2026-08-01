/* オフラインで動かすための Service Worker。
   本体は index.html 1枚なので、やることは少ない。

   - HTML は「まずネットワーク、ダメならキャッシュ」。更新をすぐ拾いたいので。
   - アイコンなどの静的ファイルは「まずキャッシュ」。
   - 外部（Webフォント）は触らない。取れなければ端末のフォントに落ちるだけ。

   データ（名刺・接点・写真）は localStorage と IndexedDB にあり、
   ここでは一切扱わない。キャッシュを消してもデータは消えない。 */

const VERSION = 'meishi-coverage-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* 1つでも取れなければ諦める。動作自体は続く */ })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 外部はそのまま通す

  const isHtml = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isHtml) {
    // 更新を優先しつつ、圏外ではキャッシュを出す
    e.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
