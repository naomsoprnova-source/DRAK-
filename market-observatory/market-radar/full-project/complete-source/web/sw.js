'use strict';

const CACHE_NAME = 'market-radar-shell-v13';
const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './chart.js',
  './app.css',
  './engine.js',
  './manifest.webmanifest',
  './pwa.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('market-radar-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Market prices are fetched from Binance and are deliberately never cached here.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('غير متصل بالإنترنت. افتح التطبيق عند عودة الاتصال لجلب بيانات السوق.', {
        status: 503,
        headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}
      });
    }
  })());
});
