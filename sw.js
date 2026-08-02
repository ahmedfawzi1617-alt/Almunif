importScripts('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js');

const CACHE = 'mmp-cache-v5';
const CORE_URLS = [
  'OVERVIEW.html',
  'Production.html',
  'scrap_dashboard.html',
  'LAB.html',
  'RAW.html',
  'Orders.html',
  'notif.js',
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

/* خريطة "الرقم المهم" لكل شيت — بأسماء الأعمدة الحقيقية في ملف الإكسل/الشيت */
const VALUE_FIELD_MAP = {
  'sw-prod':  { fields:['Pro. Quantity Kg','pro. quantity kg'], unit:'كجم', noun:'عملية إنتاج' },
  'sw-scrap': { fields:['defect weight (Kg)','scrap'],          unit:'كجم', noun:'عملية هالك'  },
  'sw-lab':   { fields:null,                                    unit:'',    noun:'اختبار'      },
  'sw-raw':   { fields:null,                                    unit:'',    noun:'عينة'        }
};
function pickField(row, names){
  for(const n of names){ if(row[n] !== undefined && row[n] !== '') return row[n]; }
  const norm = s => String(s).replace(/\s+/g,' ').trim().toLowerCase();
  for(const n of names){
    const t = norm(n);
    const k = Object.keys(row).find(k => norm(k) === t);
    if(k && row[k] !== '') return row[k];
  }
  return '';
}
function fmtNum(n){ return Math.round(n*10)/10; }

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

function parseCsv(text){
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  return res.data || [];
}

async function checkCsvChange(entry){
  try{
    const ts = Date.now();
    const sep = entry.url.includes('?') ? '&' : '?';
    const res = await fetch(entry.url + sep + 'ts=' + ts, { cache: 'no-store' });
    if(!res.ok) return;
    const text = await res.text();
    const rows = parseCsv(text);
    const newRows = rows.length;

    const cache = await caches.open(CACHE);
    const prevReq = new Request('fp-' + entry.key);
    const prevRes = await cache.match(prevReq);
    const prevFp = prevRes ? await prevRes.text() : null;
    const fp = newRows + '|' + text.slice(0, 4000);

    if(prevFp && prevFp !== fp){
      const prevRows = parseInt(prevFp.split('|')[0]) || 0;
      const added = newRows - prevRows;
      const cfg = VALUE_FIELD_MAP[entry.key] || { fields:null, unit:'', noun:'سجل' };
      const lastRow = rows[rows.length - 1] || {};

      let detail = '📊 ' + entry.name;
      if(added > 0){
        const newAdded = rows.slice(-added);
        if(cfg.fields){
          const sum = newAdded.reduce((s,r) => s + (parseFloat(pickField(r, cfg.fields)) || 0), 0);
          detail += ': تمت إضافة ' + added + ' ' + cfg.noun +
                    (sum ? ' — إجمالي ' + fmtNum(sum) + ' ' + cfg.unit : '');
          const lastVal = parseFloat(pickField(lastRow, cfg.fields));
          const bits = [];
          const pType = pickField(lastRow, ['product type','Product Type']);
          const cust = pickField(lastRow, ['customer (vlook)','customer']);
          const mach = pickField(lastRow, ['machine']);
          if(pType) bits.push(pType);
          if(mach) bits.push(mach);
          if(cust) bits.push(cust);
          if(!isNaN(lastVal)) bits.push(fmtNum(lastVal) + ' ' + cfg.unit);
          if(bits.length) detail += '\nآخر إدخال: ' + bits.slice(0,4).join(' — ');
        }else{
          detail += ': تمت إضافة ' + added + ' ' + cfg.noun;
          const bits = [];
          const dt = pickField(lastRow, ['date','Date']);
          const grade = pickField(lastRow, ['Raw material grade']);
          const result = pickField(lastRow, ['Overall\nResult','Overall Result']);
          if(dt) bits.push(dt);
          if(grade) bits.push(grade);
          if(result) bits.push(String(result).toUpperCase());
          if(bits.length) detail += '\n' + bits.slice(0,3).join(' | ');
        }
      } else if(added < 0){
        detail += ': تم حذف ' + Math.abs(added) + ' ' + cfg.noun;
      } else {
        detail += ': تم تعديل البيانات';
      }

      const lastRowSummary = [
        pickField(lastRow, ['date','Date']),
        pickField(lastRow, ['order number','Order number','order no'])
      ].filter(Boolean).join(' | ');

      self.registration.showNotification('المنيف للأنابيب', {
        body: detail.replace(/\n/g, ' • '),
        icon: 'icon-192.png',
        tag: 'chg-' + entry.key + '-' + ts,
        data: {
          url: entry.page,
          sheet: entry.name,
          chgData: { sheet: entry.name, key: entry.key, page: entry.page, added: added, lastRow: lastRowSummary, time: ts }
        },
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
    caches.open(CACHE).then(c => c.put(new Request('page-fp-' + data.key), new Response(data.fp)));
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
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  if (url.includes('google.com') || url.includes('googleapis.com') || url.includes('gstatic.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
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

  e.waitUntil(
    (async () => {
      const chgData = (e.notification.data && e.notification.data.chgData) || null;
      /* فتح أو التركيز على الصفحة */
      const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for(const c of cls){
        if(c.url && c.url.includes(targetUrl)){
          c.focus();
          if(chgData) setTimeout(() => c.postMessage({ type: 'highlight-changes', chgData }), 300);
          return;
        }
      }
      const newClient = await clients.openWindow(targetUrl);
      if(newClient && chgData){
        setTimeout(() => newClient.postMessage({ type: 'highlight-changes', chgData }), 1500);
      }
    })()
  );
});
