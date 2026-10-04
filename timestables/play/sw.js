// Works offline after the first visit. Always tries the network first, so updates show up
// right away; the saved copy is only used when there's no connection.
const CACHE = 'ttrt-v3b';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Google will speak if we do not send our site as the referer. The browser will not
  // let this worker read that file, so hand the response through unread and do not cache it.
  if (url.pathname.endsWith('/tts')) {
    const q = (url.searchParams.get('q') || '').slice(0, 180);
    const tl = url.searchParams.get('tl') || 'en';
    const remote = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`;
    e.respondWith(fetch(remote, { mode: 'no-cors', referrerPolicy: 'no-referrer' }));
    return;
  }
  // no-cache: always ask the server whether there's something newer, so fixes show up on the next load.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
