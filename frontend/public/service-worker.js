// Very simple service worker to cache the app shell for offline use.
// This is not a full PWA setup, but enough to allow reloads while offline
// after the app has been loaded once.

const CACHE_NAME = 'documoto-shell-v1'
const APP_SHELL_URLS = [
  '/',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_URLS)
    })
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET requests
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Let API calls and non-same-origin requests hit the network as usual
  if (!url.origin.includes(self.location.origin) || url.pathname.startsWith('/api/')) {
    return
  }

  // Network-first for everything other than the root; fallback to cache
  if (url.pathname !== '/') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // For '/', use cache-first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
    })
  )
})
