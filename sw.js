const CACHE = 'mmp-cache-v2';
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

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => {
      startBackgroundCheck();
      return self.clients.claim();
    })
  );
});

function startBackgroundCheck(){
  setInterval(() => {
    CSV_URLS.forEach(entry => checkCsvChange(entry.url, entry.name, entry.key));
  }, 120000);
}

async function checkCsvChange(url, name, key){
  try{
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now());
    const text = await res.text();
    const fp = text.length + '|' + text.slice(0, 500);
    const cache = await caches.open(CACHE);
    const prevReq = new Request('fp-' + key);
    const prevRes = await cache.match(prevReq);
    const prevFp = prevRes ? await prevRes.text() : null;
    if(prevFp && prevFp !== fp){
      self.registration.showNotification('المنيف للأنابيب', {
        body: 'تحديث في بيانات ' + name,
        icon: 'icon-192.png',
        tag: key,
        requireInteraction: true
      });
    }
    cache.put(prevReq, new Response(fp));
  }catch(e){
    console.error('SW check failed:', name, e);
  }
}

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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(cls => {
      if(cls.length > 0){ cls[0].focus(); return; }
      clients.openWindow('OVERVIEW.html');
    })
  );
});
