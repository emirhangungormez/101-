self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Oyun çevrimiçidir; istekler önbelleğe alınmadan doğrudan sunucuya gider.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
