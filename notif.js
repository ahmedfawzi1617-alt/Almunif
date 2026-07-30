var _swKeepAlive = null;

/* ---------- المستمع للرسائل الواردة من Service Worker ---------- */
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data;
    if(!d) return;
    if(d.type === 'focus-sheet' && d.sheet){
      showNotifBanner('📊 فتح بيانات ' + d.sheet, 'info');
    }
  });
}

/* ---------- طلب الإذن ---------- */
function requestNotifPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.ready.then(reg => {
      if('periodicSync' in reg){
        try{ reg.periodicSync.register('check-changes', { minInterval: 120000 }); }catch(_){}
      }
    });
  }
  startSWKeepAlive();
}

/* ---------- بصمة البيانات ---------- */
function getDataFingerprint(data){
  if(!data || !data.length) return '';
  return data.length + '|' + data.map(r => (r.date||'') + '|' + (r.order_no||'') + '|' + (r.product||'')).join(',');
}

/* ---------- فحص التغيير ---------- */
function checkChanges(key, data, title, icon, pageUrl){
  if(!data || !data.length) return;
  const prev = localStorage.getItem(key);
  const curr = getDataFingerprint(data);
  localStorage.setItem(key, curr);
  sendToSW('store-fp', { key: 'fp-' + key, fp: curr });

  if(prev === null) return;
  if(prev === curr) return;

  const prevCount = parseInt(prev.split('|')[0]) || 0;
  const currCount = parseInt(curr.split('|')[0]) || 0;
  const diff = currCount - prevCount;
  const lastRow = data[data.length - 1];
  let detail = 'تم تعديل البيانات';
  if(diff > 0){
    detail = 'تمت إضافة ' + diff + ' سجل';
    const extra = [];
    if(lastRow.date) extra.push(lastRow.date);
    if(lastRow.order_no) extra.push(lastRow.order_no);
    if(lastRow.product) extra.push(lastRow.product);
    if(extra.length) detail += '\n' + extra.slice(0,3).join(' | ');
  } else if(diff < 0){
    detail = 'تم حذف ' + Math.abs(diff) + ' سجل';
  }

  const msg = title || 'المنيف للأنابيب';
  if('Notification' in window && Notification.permission === 'granted'){
    try{
      new Notification(msg, {
        body: detail,
        icon: icon || 'icon-192.png',
        tag: key + '-' + Date.now(),
        data: { url: pageUrl || '' }
      });
    }catch(e){}
  }
  showNotifBanner('🔔 ' + detail, 'info');
}

/* ---------- البنر ---------- */
function showNotifBanner(msg, type){
  const el = document.getElementById('notifBanner');
  if(!el) return;
  el.textContent = msg;
  el.className = 'notif-banner ' + (type||'info');
  el.style.display = 'block';
  clearTimeout(el._hide);
  el._hide = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

/* ---------- التواصل مع Service Worker ---------- */
function sendToSW(type, payload){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active && reg.active.postMessage({ type: type, ...payload });
  }).catch(() => {});
}

function startSWKeepAlive(){
  clearInterval(_swKeepAlive);
  _swKeepAlive = setInterval(() => {
    sendToSW('keepalive');
  }, 45000);
}

/* ---------- إعادة تعيين كامل ---------- */
function resetApp(){
  const keys = Object.keys(localStorage).filter(k => k.startsWith('fp-') || k === 'mmp_fp');
  keys.forEach(k => localStorage.removeItem(k));
  if('caches' in window){
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).catch(() => {});
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistration().then(reg => {
      if(reg) reg.unregister();
    }).catch(() => {});
  }
  showNotifBanner('تم مسح التطبيق، انتظر إعادة التحميل...', 'info');
  setTimeout(() => location.reload(), 1000);
}
