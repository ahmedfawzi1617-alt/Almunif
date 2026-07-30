const CACHE = 'mmp-cache-v3';
const CORE_URLS = [
  'OVERVIEW.html',
  'Production.html',
  'scrap_dashboard.html',
  'LAB.html',
  'RAW.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

const CSV_URLS = [
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy9XHGoK6iYQSRku-7qWDSaUveGXT1ZjpjRa2Av0cBrsXeljctBGdF7AHOoKaSgoi7Nz2g6djTTZxC/pub?gid=390647355&single=true&output=csv', name: 'إنتاج', key: 'sw-prod' },
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy9XHGoK6iYQSRku-7qWDSaUveGXT1ZjpjRa2Av0cBrsXeljctBGdF7AHOoKaSgoi7Nz2g6djTTZxC/pub?gid=1615042796&single=true&output=csv', name: 'هالك', key: 'sw-scrap' },
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQiYC7XUuYzsqOQkKtxFH667BvpK0sroldpVvGwJ-V4r0bfbA2-ar-ZlsBPyBLcMBDsi5EKFwWTmxC/pub?gid=1555908756&single=true&output=csv', name: 'معمل', key: 'sw-lab' },
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQiYC7XUuYzsqOQkKtxFH667BvpK0sroldpVvGwJ-V4r0bfbA2-ar-ZlsBPyBLcMBDsi5EKFwWTmxC/pub?gid=845489182&single=true&output=csv', name: 'خام', key: 'sw-raw' }
];

const VAPID_PUBLIC_KEY = 'BFe0Pj5XJd_J_XKStHr4QOBXHqDSqk01A8lGcQqMLBSYkH5sRc_c5r4P7phBO8rBDJFQLQ9FG8DJQqGU82BS0ik';

let bgInterval = null;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE_URLS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => {
      subscribeToPush();
      scheduleBgCheck();
      return self.clients.claim();
    })
  );
});

/* ---------- Push Subscription ---------- */
function subscribeToPush(){
  if(!self.registration.pushManager) return;
  self.registration.pushManager.getSubscription().then(sub => {
    if(sub) return sub;
    return self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY
    });
  }).then(sub => {
    if(!sub) return;
    caches.open(CACHE).then(c => c.put('push-sub', new Response(JSON.stringify(sub.toJSON()))));
    self.clients.matchAll().then(cls => {
      cls.forEach(c => c.postMessage({ type: 'push-sub', sub: sub.toJSON() }));
    });
  }).catch(() => {});
}

/* ---------- Background Check ---------- */
function scheduleBgCheck(){
  if(bgInterval) clearInterval(bgInterval);
  bgInterval = setInterval(checkAllChanges, 60000);
}

async function checkAllChanges(){
  await Promise.allSettled(CSV_URLS.map(entry => checkCsvChange(entry.url, entry.name, entry.key)));
}

async function checkCsvChange(url, name, key){
  try{
    const ts = Date.now();
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(url + sep + 'ts=' + ts, { cache: 'no-store' });
    if(!res.ok) return;
    const text = await res.text();
    const fp = text.length + '|' + text.slice(0, 800);
    const cache = await caches.open(CACHE);
    const prevReq = new Request('fp-' + key);
    const prevRes = await cache.match(prevReq);
    const prevFp = prevRes ? await prevRes.text() : null;
    if(prevFp && prevFp !== fp){
      self.registration.showNotification('المنيف للأنابيب', {
        body: '🔔 تحديث في بيانات ' + name,
        icon: 'icon-192.png',
        tag: 'chg-' + key + '-' + ts,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        silent: false,
        actions: [
          { action: 'open', title: 'فتح التطبيق' },
          { action: 'close', title: 'تجاهل' }
        ]
      });
    }
    cache.put(prevReq, new Response(fp));
  }catch(e){
    /* silent */
  }
}

/* ---------- Push Event ---------- */
self.addEventListener('push', e => {
  let title = 'المنيف للأنابيب';
  let body = 'تحديث في البيانات';
  try{
    if(e.data){
      const d = e.data.json();
      if(d.title) title = d.title;
      if(d.body) body = d.body;
    }
  }catch(_){}
  self.registration.showNotification(title, {
    body,
    icon: 'icon-192.png',
    tag: 'push-' + Date.now(),
    requireInteraction: true,
    vibrate: [200, 100, 200],
    silent: false,
    actions: [
      { action: 'open', title: 'فتح التطبيق' },
      { action: 'close', title: 'تجاهل' }
    ]
  });
});

/* ---------- Message from Page ---------- */
self.addEventListener('message', e => {
  const data = e.data;
  if(!data) return;
  if(data.type === 'keepalive'){
    scheduleBgCheck();
    return;
  }
  if(data.type === 'check-now'){
    checkAllChanges();
    return;
  }
  if(data.type === 'store-fp' && data.key && data.fp){
    caches.open(CACHE).then(c => c.put(new Request('fp-' + data.key), new Response(data.fp)));
    checkAllChanges();
    return;
  }
});

/* ---------- Sync / Periodic Sync ---------- */
self.addEventListener('sync', e => {
  if(e.tag === 'check-changes'){
    e.waitUntil(checkAllChanges());
  }
});

self.addEventListener('periodicsync', e => {
  if(e.tag === 'check-changes'){
    e.waitUntil(checkAllChanges());
  }
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  if (url.includes('google.com') || url.includes('googleapis.com') || url.includes('gstatic.com')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  if (url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('OVERVIEW.html')))
  );
});

/* ---------- Notification Click ---------- */
self.addEventListener('notificationclick', e => {
  if(e.action === 'close'){ e.notification.close(); return; }
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      if(cls.length > 0){ cls[0].focus(); return; }
      clients.openWindow('OVERVIEW.html');
    })
  );
});
