/* EGX Daily, online copy: the small program that lets the Home Screen app open at once, with or without internet.
   It keeps one saved copy of the (encrypted) page and the app icons, and nothing else; the saved page lives in its own store, so a newer
   version of this program never throws it away.
   - opening the app shows the saved copy straight away (the page itself looks for newer numbers and saves them for the next opening);
   - ./?fresh=... always asks the web first and saves what it gets; without internet that request fails, so the page can tell.
   - alerts: the owner's PC sends notifications (encrypted, through Apple's push service; see phone_alerts.py). This program shows each one, and a tap on it opens the app
     at the page it is about. It keeps one small number, how many alerts have not been looked at yet, for the badge on the app icon. */
'use strict';
const STATIC = 'egx-web-static-v1';                              // icons and manifest: replaced when this program changes
const PAGES = 'egx-web-page';                                    // the saved page: kept across updates of this program
const STATE = 'egx-web-state';                                   // the count on the app icon: kept across updates of this program
const SCOPE = self.registration.scope;                           // e.g. https://name.github.io/repo/
const PAGE = new URL('./', SCOPE).href;
const PAGE2 = new URL('index.html', SCOPE).href;
const MANIFEST = new URL('manifest.webmanifest', SCOPE).href;
const ICONS = new URL('icons/', SCOPE).pathname;
const STARTUP = new URL('startup/', SCOPE).pathname;
const net = () => fetch(PAGE + '?t=' + Date.now(), { cache: 'no-store' });   // a new address every time, so no cache on the way (the browser's or the host's) can hand back an old page
const KEEP = ['manifest.webmanifest', 'icons/apple-touch-icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png']
  .map(u => new URL(u, SCOPE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    await Promise.all(KEEP.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    try { const r = await net(); if (r.ok) await (await caches.open(PAGES)).put(PAGE, r); } catch (e) { /* offline just now: the copy already saved stays, or the next visit saves one */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== STATIC && k !== PAGES && k !== STATE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function offlinePage() {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>EGX Daily</title><style>html,body{height:100%;margin:0;background:#0d1015;color:#eceef3;font:16px/1.5 -apple-system,system-ui,sans-serif}' +
    'main{min-height:100%;display:grid;place-content:center;gap:12px;padding:24px;text-align:center}h1{margin:0;font-size:22px}p{margin:0;color:#b6bcc8;max-width:30em}' +
    'button{justify-self:center;margin-top:8px;padding:11px 20px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#eceef3;font:inherit;font-weight:600}</style></head>' +
    '<body><main><h1>No internet, and nothing saved yet</h1><p>EGX Daily saves a copy the first time it opens with internet. Connect once, then it also opens without.</p>' +
    '<button type="button" onclick="location.reload()">Try again</button></main></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function saved(event) {                                    // open at once from the saved copy; only when there is none, ask the web
  const cache = await caches.open(PAGES);
  const hit = await cache.match(PAGE, { ignoreVary: true });
  if (hit) return hit;
  try {
    const r = await net();
    if (r && r.ok) { await cache.put(PAGE, r.clone()); return r; }
  } catch (e) { /* fall through */ }
  return offlinePage();
}

async function fresh(event) {                                    // the newest page from the web, saved for next time
  const cache = await caches.open(PAGES);
  try {
    const r = await net();
    if (r && r.ok) { await cache.put(PAGE, r.clone()); return r; }
    throw new Error('status ' + (r && r.status));
  } catch (e) {
    if (event.request.mode === 'navigate') return (await cache.match(PAGE, { ignoreVary: true })) || offlinePage();
    throw e;                                                     // a background check must be able to tell the web could not be reached
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) cache.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const bare = url.origin + url.pathname;
  if (bare === PAGE || bare === PAGE2) {
    if (url.searchParams.has('fresh')) { event.respondWith(fresh(event)); return; }
    if (req.mode === 'navigate') event.respondWith(saved(event));
    return;
  }
  if (bare === MANIFEST || url.pathname.startsWith(ICONS) || url.pathname.startsWith(STARTUP)) event.respondWith(cacheFirst(req));
});

// ---------------------------------------------------------------------------------------------- alerts
const BADGE = new URL('__badge', SCOPE).href;
const HREF_OK = /^#[A-Za-z0-9%_.\/-]{0,120}$/;
async function badgeGet() { try { const r = await (await caches.open(STATE)).match(BADGE); return r ? (parseInt(await r.text(), 10) || 0) : 0; } catch (e) { return 0; } }
async function badgeSet(n) { try { await (await caches.open(STATE)).put(BADGE, new Response(String(n))); } catch (e) { /* only the number on the icon is lost */ } }
// The number on the icon is an iPhone and iPad feature (Home Screen apps). Other browsers are left alone: a few of them, and the browsers used for automatic testing, handle a badge
// request from a background program badly (one of them stops the whole tab), and there is nothing to show there anyway.
const BADGE_OK = /\b(iPhone|iPad|iPod)\b/.test(String(self.navigator && self.navigator.userAgent));
async function badgeShow(n) {
  if (!BADGE_OK) return;
  try {
    if (n > 0) { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n); }
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (e) { /* the badge is optional */ }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
    if (!d || typeof d !== 'object') d = {};
    const title = String(d.t || 'EGX Daily').slice(0, 120);
    const body = String(d.b || 'Open the app to see what changed.').slice(0, 500);
    const href = HREF_OK.test(String(d.h || '')) ? String(d.h) : '';
    const tag = String(d.k || '').replace(/[^A-Za-z0-9:_.\/-]/g, '').slice(0, 64) || ('egx-' + Date.now());
    // Safari takes the permission away from a site that receives a push and shows nothing, so something is always shown.
    await self.registration.showNotification(title, { body, tag, icon: new URL('icons/icon-192.png', SCOPE).href, data: { href } });
    const total = Math.min(999, (await badgeGet()) + Math.max(1, Math.min(99, parseInt(d.n, 10) || 1)));
    await badgeSet(total);
    await badgeShow(total);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || '';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = list.filter(c => c.url.startsWith(SCOPE));
    if (mine.length) {
      const c = mine.find(x => x.focused) || mine[0];
      try { await c.focus(); } catch (e) { /* not always allowed */ }
      try { c.postMessage({ type: 'egx-go', href }); } catch (e) { /* the app stays where it was */ }
      return;
    }
    try { await self.clients.openWindow(SCOPE + (HREF_OK.test(href) ? href : '')); } catch (e) { /* nothing more to do */ }
  })());
});

self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'hello') {                                      // the app asks whether this program can show alerts (an older one cannot)
    try { (event.ports && event.ports[0] ? event.ports[0] : event.source).postMessage({ type: 'hello', push: true }); } catch (e) { /* it asks again */ }
    return;
  }
  if (d.type === 'badge-clear') event.waitUntil((async () => { await badgeSet(0); await badgeShow(0); })());
});
