// Works offline after the first visit. Always tries the network first, so updates show up
// right away; the saved copy is only used when there's no connection.
const CACHE = 'ttrt-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

async function ttsResponse(url) {
  const q = (url.searchParams.get('q') || '').slice(0, 180);
  const tl = url.searchParams.get('tl') || 'en';
  const remote = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(remote, { referrerPolicy: 'no-referrer' });
    if (!r.ok) return new Response('', { status: r.status || 502 });
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return new Response('', { status: 502 });
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  } catch {
    return new Response('', { status: 502 });
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/tts')) {
    e.respondWith(ttsResponse(url));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
