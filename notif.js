var _swKeepAlive = null;

function requestNotifPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.ready.then(reg => {
      /* Periodic Background Sync — يدعمه كروم في الـ PWA المثبتة */
      if('periodicSync' in reg){
        try{ reg.periodicSync.register('check-changes', { minInterval: 120000 }); }catch(_){}
      }
    });
  }
  /* بدء إرسال إشارات حياة للـ SW */
  startSWKeepAlive();
}

function getDataFingerprint(data){
  if(!data || !data.length) return '';
  return data.length + '|' + data.map(r => r.date + (r.order_no||'') + (r.product||'') + (r.qty_kg||0)).join(',');
}

function checkChanges(key, data, title, icon){
  if(!data || !data.length) return;
  const curr = getDataFingerprint(data);
  /* حفظ البصمة في localStorage */
  const prev = localStorage.getItem(key);
  localStorage.setItem(key, curr);
  /* إرسال البصمة للـ Service Worker */
  sendToSW('store-fp', { key: 'fp-' + key, fp: curr });
  if(prev === null) return;
  if(prev === curr) return;
  const msg = 'تم تعديل البيانات';
  if('Notification' in window && Notification.permission === 'granted'){
    try{ new Notification(title || 'MMP Egypt', { body: msg, icon: icon || 'icon-192.png', tag: key }); }catch(e){}
  }
  showNotifBanner(msg, 'info');
}

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
