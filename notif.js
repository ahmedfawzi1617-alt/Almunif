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

/* ========== الإذن ========== */
function requestNotifPermission(){
  const n = ('Notification' in window);
  if(!n) return;
  if(Notification.permission === 'granted') return;
  if(Notification.permission === 'denied'){
    console.warn('⚠️ الإشعارات مرفوضة. اذهب إلى إعدادات الموقع وافتح الإذن.');
    showNotifBanner('⚠️ الإشعارات مرفوضة — اذهب إلى إعدادات الموقع واسمح بها', 'warn');
    return;
  }
  /* default — اطلب الإذن الآن */
  Notification.requestPermission().then(p => {
    if(p === 'granted'){
      showNotifBanner('✅ تم قبول الإشعارات', 'info');
    } else {
      showNotifBanner('⚠️ تم رفض الإشعارات — لو عايز تغير رأيك، اذهب إلى إعدادات الموقع', 'warn');
    }
  }).catch(() => {});
}

/* زر طلب الإذن (للاستخدام مع onclick) */
function requestNotifPermissionClick(){
  if(!('Notification' in window)) return;
  Notification.requestPermission().then(p => {
    if(p === 'granted'){
      showNotifBanner('✅ تم تفعيل الإشعارات', 'info');
    }
  }).catch(() => {});
}

/* ========== البصمة ========== */
function getDataFingerprint(data){
  if(!data || !data.length) return '';
  const rows = data.map(r => [
    r.date || '',
    r.order_no || '',
    r.product || '',
    r.qty_kg || 0,
    r.customer || ''
  ].join('||')).join('\x01');
  return data.length + '|' + rows;
}

/* ========== الفحص ========== */
function checkChanges(key, data, title, icon, pageUrl){
  if(!data || !data.length) return;
  const prev = localStorage.getItem(key);
  const curr = getDataFingerprint(data);
  localStorage.setItem(key, curr);
  sendToSW('store-fp', { key: 'sw-' + key, fp: curr });

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

  /* إرسال الإشعار عن طريق Service Worker (يدعم الخلفية والموبايل) */
  sendToSW('show-notif', {
    title: title || 'المنيف للأنابيب',
    body: detail,
    icon: icon || 'icon-192.png',
    tag: 'page-' + key + '-' + Date.now(),
    url: pageUrl || ''
  });
  showNotifBanner('🔔 ' + detail, 'info');
}

/* ========== البنر ========== */
function showNotifBanner(msg, type){
  const el = document.getElementById('notifBanner');
  if(!el) return;
  el.textContent = msg;
  el.className = 'notif-banner ' + (type||'info');
  el.style.display = 'block';
  clearTimeout(el._hide);
  el._hide = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

/* ========== التواصل مع Service Worker ========== */
function sendToSW(type, payload){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    if(reg.active){
      reg.active.postMessage({ type: type, ...payload });
    }
  }).catch(() => {});
}

function startSWKeepAlive(){
  clearInterval(_swKeepAlive);
  _swKeepAlive = setInterval(() => {
    sendToSW('keepalive');
  }, 45000);
}

/* ========== إعادة تعيين كامل ========== */
function resetApp(){
  const keys = Object.keys(localStorage).filter(k => k.startsWith('fp-') || k === 'mmp_fp' || k.startsWith('prod') || k.startsWith('scrap') || k.startsWith('lab') || k.startsWith('raw') || k.startsWith('overview'));
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
