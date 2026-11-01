/* Bump CACHE_VERSION whenever you ship a change to any cached asset.
   With network-first HTML below, code updates land immediately online;
   the version bump matters mainly for icons / manifest / offline fallback. */
const CACHE_VERSION = 'v2';
const CACHE_NAME = `npvt-converter-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ---------- install: resilient pre-cache ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Promise.allSettled → one 404 never breaks the whole install
    await Promise.allSettled(APP_SHELL.map(url =>
      fetch(url, { cache: 'reload' })
        .then(res => (res && res.ok ? cache.put(url, res) : null))
        .catch(() => null)
    ));
    await self.skipWaiting();
  })());
});

/* ---------- activate: drop old caches + take control ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- fetch: smart routing ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore cross-origin

  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  event.respondWith(isNavigation ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    const cached =
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    return (
      cached ||
      new Response('Offline — please reconnect once to cache the app.', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    );
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline'
    });
  }
}

/* ---------- allow page to force-activate a new worker ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
