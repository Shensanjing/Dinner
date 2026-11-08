/* 今晚吃什么 —— service worker
   策略：同源请求 network-first，断网/超时回落到缓存；安装时预缓存整个壳。
   每次发布把 VERSION 改一下即可让旧缓存失效。 */
const VERSION = '202611080703';
const CACHE = 'dinner-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './core.js',
  './data/bundle.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('dinner-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 七鲜等外站一律不管

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await fetch(req, { cache: 'no-cache' });
      if (net && net.ok) cache.put(req, net.clone()).catch(() => {});
      return net;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('离线了，这个资源还没缓存', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
