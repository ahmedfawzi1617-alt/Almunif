const CACHE = 'mmp-cache-v5';
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
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy9XHGoK6iYQSRku-7qWDSaUveGXT1ZjpjRa2Av0cBrsXeljctBGdF7AHOoKaSgoi7Nz2g6djTTZxC/pub?gid=390647355&single=true&output=csv', name: 'إنتاج', key: 'sw-prod', page: 'Production.html' },
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy9XHGoK6iYQSRku-7qWDSaUveGXT1ZjpjRa2Av0cBrsXeljctBGdF7AHOoKaSgoi7Nz2g6djTTZxC/pub?gid=1615042796&single=true&output=csv', name: 'هالك', key: 'sw-scrap', page: 'scrap_dashboard.html' },
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQiYC7XUuYzsqOQkKtxFH667BvpK0sroldpVvGwJ-V4r0bfbA2-ar-ZlsBPyBLcMBDsi5EKFwWTmxC/pub?gid=1555908756&single=true&output=csv', name: 'معمل', key: 'sw-lab', page: 'LAB.html' },
  { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQiYC7XUuYzsqOQkKtxFH667BvpK0sroldpVvGwJ-V4r0bfbA2-ar-ZlsBPyBLcMBDsi5EKFwWTmxC/pub?gid=845489182&single=true&output=csv', name: 'خام', key: 'sw-raw', page: 'RAW.html' }
];

const VAPID_PUBLIC_KEY = 'BFe0Pj5XJd_J_XKStHr4QOBXHqDSqk01A8lGcQqMLBSYkH5sRc_c5r4P7phBO8rBDJFQLQ9FG8DJQqGU82BS0ik';

let bgInterval = null;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE_URLS)));
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
  await Promise.allSettled(CSV_URLS.map(entry => checkCsvChange(entry)));
}

function countRows(text){
  const lines = text.split('\n').filter(l => l.trim());
  return Math.max(0, lines.length - 1);
}

function extractLastRow(text){
  const lines = text.split('\n').filter(l => l.trim());
  if(lines.length < 2) return '';
  const last = lines[lines.length - 1];
  const cols = last.split(',');
  return cols[0] + (cols[2] ? ' | ' + cols[2] : '');
}

async function checkCsvChange(entry){
  try{
    const ts = Date.now();
    const sep = entry.url.includes('?') ? '&' : '?';
    const res = await fetch(entry.url + sep + 'ts=' + ts, { cache: 'no-store' });
    if(!res.ok) return;
    const text = await res.text();
    const newRows = countRows(text);
    const newLast = extractLastRow(text);
    const fp = newRows + '|' + newLast + '|' + text.slice(0, 3000);
    const cache = await caches.open(CACHE);
    const prevReq = new Request('fp-' + entry.key);
    const prevRes = await cache.match(prevReq);
    const prevFp = prevRes ? await prevRes.text() : null;

    if(prevFp && prevFp !== fp){
      const prevRows = parseInt(prevFp.split('|')[0]) || 0;
      const added = newRows - prevRows;
      let detail = '📊 ' + entry.name;
      if(added > 0) detail += ': تمت إضافة ' + added + ' سجل' + (newLast ? '\nآخر إدخال: ' + newLast : '');
      else if(added < 0) detail += ': تم حذف ' + Math.abs(added) + ' سجل';
      else detail += ': تم تعديل البيانات';

      /* تخزين تفاصيل التغيير لإرسالها للصفحة عند الضغط */
      const changeKey = 'chg-' + entry.key + '-' + ts;
      const changeData = {
        sheet: entry.name,
        key: entry.key,
        page: entry.page,
        added: added,
        lastRow: newLast,
        time: ts
      };
      cache.put(new Request('chg-' + entry.key), new Response(JSON.stringify(changeData)));

      self.registration.showNotification('المنيف للأنابيب', {
        body: detail,
        icon: 'icon-192.png',
        tag: changeKey,
        data: { url: entry.page, sheet: entry.name, chgKey: entry.key },
        requireInteraction: true,
        vibrate: [200, 100, 200],
        silent: false,
        actions: [
          { action: 'open', title: 'فتح ' + entry.name },
          { action: 'close', title: 'تجاهل' }
        ]
      });
    }
    cache.put(prevReq, new Response(fp));
  }catch(e){}
}

/* ---------- Push Event ---------- */
self.addEventListener('push', e => {
  let title = 'المنيف للأنابيب';
  let body = 'تحديث في البيانات';
  let targetUrl = 'OVERVIEW.html';
  let chgData = null;
  try{
    if(e.data){
      const d = e.data.json();
      if(d.title) title = d.title;
      if(d.body) body = d.body;
      if(d.url) targetUrl = d.url;
      if(d.chgData) chgData = d.chgData;
    }
  }catch(_){}
  self.registration.showNotification(title, {
    body, icon: 'icon-192.png', tag: 'push-' + Date.now(),
    data: { url: targetUrl, chgData: chgData },
    requireInteraction: true, vibrate: [200, 100, 200], silent: false,
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
  if(data.type === 'keepalive'){ scheduleBgCheck(); return; }
  if(data.type === 'check-now'){ checkAllChanges(); return; }
  if(data.type === 'store-fp' && data.key && data.fp){
    caches.open(CACHE).then(c => c.put(new Request('fp-' + data.key), new Response(data.fp)));
    checkAllChanges();
    return;
  }
  if(data.type === 'show-notif' && data.title && data.body){
    self.registration.showNotification(data.title, {
      body: data.body, icon: data.icon || 'icon-192.png',
      tag: data.tag || 'msg-' + Date.now(),
      data: { url: data.url || '', chgKey: data.chgKey || '' },
      requireInteraction: true, vibrate: [200, 100, 200], silent: false,
      actions: [
        { action: 'open', title: 'فتح' },
        { action: 'close', title: 'تجاهل' }
      ]
    });
    return;
  }
});

/* ---------- Sync / Periodic Sync ---------- */
self.addEventListener('sync', e => {
  if(e.tag === 'check-changes') e.waitUntil(checkAllChanges());
});
self.addEventListener('periodicsync', e => {
  if(e.tag === 'check-changes') e.waitUntil(checkAllChanges());
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('google.com') || url.includes('googleapis.com') || url.includes('gstatic.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  if (url.includes('fonts.googleapis.com')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok && e.request.method === 'GET') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('OVERVIEW.html'))));
});

/* ---------- Notification Click ---------- */
self.addEventListener('notificationclick', e => {
  if(e.action === 'close'){ e.notification.close(); return; }
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || 'OVERVIEW.html';
  const chgKey = (e.notification.data && e.notification.data.chgKey) || '';

  e.waitUntil(
    (async () => {
      /* استرداد تفاصيل التغيير من الكاش */
      let chgData = null;
      if(chgKey){
        try{
          const cache = await caches.open(CACHE);
          const chgRes = await cache.match(new Request('chg-' + chgKey));
          if(chgRes) chgData = await chgRes.json();
        }catch(_){}
      }
      /* فتح أو التركيز على الصفحة */
      const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for(const c of cls){
        if(c.url && c.url.includes(targetUrl)){
          c.focus();
          if(chgData) c.postMessage({ type: 'highlight-changes', chgData });
          return;
        }
      }
      const newClient = await clients.openWindow(targetUrl);
      if(newClient && chgData){
        /* انتظر تحميل الصفحة ثم أرسل التغييرات */
        newClient.postMessage({ type: 'highlight-changes', chgData });
      }
    })()
  );
});
