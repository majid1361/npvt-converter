/* =========================================================
   Service Worker — NPVT Converter
   Strategy: precache shell + stale-while-revalidate assets
             + network-first navigation with offline fallback
   ========================================================= */

const CACHE_VERSION  = 'v2';
const CACHE_PREFIX   = 'npvt-converter-';
const CACHE_NAME     = `${CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_URL    = './index.html';
const MAX_ENTRIES    = 60;   // سقف تعداد آیتم در runtime cache

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',      // <-- آیکون جدید اضافه شد
  './icon-192.png',
  './icon-512.png'
];

/* ---------------- INSTALL ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // هر ورودی جداگانه با catch تا یک خطا کل نصب را نشکند
    await Promise.all(
      PRECACHE_URLS.map(async (url) => {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (err) {
          console.warn('[SW] precache miss:', url, err);
        }
      })
    );
    await self.skipWaiting();
  })());
});

/* ---------------- ACTIVATE ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------------- FETCH ROUTER ---------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // فقط GET
  if (request.method !== 'GET') return;

  // فقط هم‌منبع
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation → Network-First با fallback آفلاین
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // بقیهٔ دارایی‌ها (شامل icon.svg) → Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request, event));
});

/* ---------------- STRATEGIES ---------------- */

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
        await trimCache(cache, MAX_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // پاسخ تازه در پس‌زمینه کش می‌شود
    event.waitUntil(networkPromise);
    return cached;
  }

  const fresh = await networkPromise;
  return fresh || Response.error();
}

/* ---------------- CACHE TRIMMING (LRU-lite) ---------------- */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // قدیمی‌ترین‌ها را حذف کن (تقریبی)
  const toDelete = keys.slice(0, keys.length - max);
  await Promise.all(toDelete.map((k) => cache.delete(k)));
}

/* ---------------- MESSAGE ---------------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => caches.delete(k)))
      )
    );
  }
});
