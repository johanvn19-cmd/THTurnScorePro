/*
 * TH TurnScore Pro - service worker
 *
 * Zorgt dat de app offline werkt: alle bestanden worden bij de eerste keer
 * openen opgeslagen en daarna uit die opslag geladen (ook zonder internet).
 *
 * Updates: de pagina vraagt de service worker na het starten om te kijken of
 * index.html online is veranderd. Zo ja, dan worden alle bestanden opnieuw
 * opgehaald en krijgt de gebruiker een melding "Bijwerken".
 *
 * De versie komt uit de registratie (sw.js?v=...) en staat als APP_VERSION
 * in index.html. Een nieuwe versie daar = alle bestanden opnieuw ophalen.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'turnscore-' + VERSION;
const INDEX_KEY = new URL('./', self.location.href).href;

const PRECACHE = [
  './',
  'manifest.json',
  'thlogo.jpg',
  'Vloer.jpg', 'Voltige.jpg', 'Ringen.jpg', 'Sprong.jpg', 'Brug.jpg', 'Rek.jpg',
  'libs/jspdf.umd.min.js',
  'libs/html2canvas.min.js',
  'libs/FileSaver.min.js',
  'libs/exceljs.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' = altijd de echte nieuwste versie van de server, niet uit de browsercache
    await cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('turnscore-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isIndexUrl(url) {
  const root = new URL(INDEX_KEY);
  return url.origin === root.origin &&
    (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html');
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isIndexUrl(url)) {
    event.respondWith(serveIndex(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(INDEX_KEY)));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function serveIndex(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(INDEX_KEY);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(INDEX_KEY, response.clone());
  return response;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'CHECK_UPDATE') event.waitUntil(checkForUpdate(event.source));
});

async function checkForUpdate(client) {
  try {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(INDEX_KEY);
    const response = await fetch(INDEX_KEY, { cache: 'no-cache' });
    if (!response.ok) return;
    const fresh = await response.clone().text();
    const current = cached ? await cached.text() : null;
    if (current === fresh) return;

    // Nieuwe versie gevonden: eerst de andere bestanden verversen, dan pas index.html.
    await Promise.all(PRECACHE.filter(url => url !== './').map(async url => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* offline of tijdelijk niet bereikbaar: oude versie blijft */ }
    }));
    await cache.put(INDEX_KEY, response);
    if (current !== null && client) client.postMessage({ type: 'UPDATE_AVAILABLE' });
  } catch (e) {
    // Geen internet: niets aan de hand, de opgeslagen versie blijft werken.
  }
}
