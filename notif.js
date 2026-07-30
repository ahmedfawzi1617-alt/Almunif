var _swKeepAlive = null;
var _lastChg = null;

/* ========== فلوتنج بزر الإشعارات (فوق اليسار) ========== */
(function injectNotifBtn(){
  const div = document.createElement('div');
  div.id = 'mmpNotifBtn';
  div.innerHTML = '<button id="mmpNotifBtnInner" title="تفعيل الإشعارات" style="background:var(--teal,#2dd4bf);color:#000;width:40px;height:40px;border:none;border-radius:50%;font-size:20px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;transition:transform .2s">🔔</button>';
  div.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;';
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(div);
    document.getElementById('mmpNotifBtnInner').onclick = function(){
      if(!('Notification' in window)) return;
      Notification.requestPermission().then(p => {
        if(p === 'granted') this.textContent = '✅';
      });
    };
    if('Notification' in window && Notification.permission === 'granted'){
      document.getElementById('mmpNotifBtnInner').textContent = '✅';
    }
  });
})();

/* ========== المستمع لرسائل SW ========== */
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data;
    if(!d) return;
    if(d.type === 'focus-sheet' && d.sheet){
      showNotifBanner('📊 فتح بيانات ' + d.sheet, 'info');
    }
    if(d.type === 'highlight-changes' && d.chgData){
      _lastChg = d.chgData;
      highlightRows(d.chgData);
    }
  });
}

/* ========== الإذن ========== */
function requestNotifPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'granted'){
    const btn = document.getElementById('mmpNotifBtnInner');
    if(btn) btn.textContent = '✅';
    return;
  }
  if(Notification.permission === 'denied'){
    showNotifBanner('⚠️ الإشعارات مرفوضة — اذهب إلى إعدادات الموقع واسمح بها', 'warn');
    return;
  }
  Notification.requestPermission().then(p => {
    if(p === 'granted'){
      const btn = document.getElementById('mmpNotifBtnInner');
      if(btn) btn.textContent = '✅';
    }
  }).catch(() => {});
}

function requestNotifPermissionClick(){
  if(!('Notification' in window)) return;
  Notification.requestPermission().then(p => {
    if(p === 'granted'){
      const btn = document.getElementById('mmpNotifBtnInner');
      if(btn) btn.textContent = '✅';
      showNotifBanner('✅ تم تفعيل الإشعارات', 'info');
    }
  }).catch(() => {});
}

/* ========== بصمة البيانات ========== */
function getDataFingerprint(data){
  if(!data || !data.length) return '';
  const rows = data.map(r => [r.date||'', r.order_no||'', r.product||'', r.qty_kg||0, r.customer||''].join('||')).join('\x01');
  return data.length + '|' + rows;
}

/* ========== فحص التغيير ========== */
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

  /* إظهار الصفوف الجديدة في الصفحة الحالية */
  const chgData = {
    sheet: title || '',
    key: key, page: pageUrl || '',
    added: diff, lastRow: lastRow ? ((lastRow.date||'') + ' | ' + (lastRow.product||'') + ' | ' + (lastRow.order_no||'')) : '',
    time: Date.now()
  };
  _lastChg = chgData;
  setTimeout(() => highlightRows(chgData), 500);

  sendToSW('show-notif', {
    title: title || 'المنيف للأنابيب',
    body: detail, icon: icon || 'icon-192.png',
    tag: 'page-' + key + '-' + Date.now(),
    url: pageUrl || ''
  });
  showNotifBanner('🔔 ' + detail, 'info');
}

/* ========== إظهار الصفوف الجديدة ========== */
function highlightRows(chgData){
  if(!chgData) return;

  /* شيل التظليل القديم */
  document.querySelectorAll('.highlight-new').forEach(el => el.classList.remove('highlight-new'));

  /* انتظر شوية لو الصفحة لسه بتتحمل */
  const doHighlight = () => {
    const table = document.querySelector('table');
    if(!table){
      /* لو مش فيه جدول (مثل OVERVIEW)، جرب تاني بعد ثانية */
      if(!window._hlRetry){
        window._hlRetry = setTimeout(doHighlight, 1000);
        return;
      }
      window._hlRetry = null;
      showNotifBanner('📊 تم التحديث', 'info');
      return;
    }
    window._hlRetry = null;

    const tbody = table.querySelector('tbody') || table;
    const rows = tbody.querySelectorAll('tr');
    if(!rows.length) return;

    const numToHighlight = Math.min(chgData.added > 0 ? chgData.added : 3, rows.length);
    const start = rows.length - numToHighlight;

    /* ظلل آخر N صفوف (اللي اتضافت) */
    for(let i = start; i < rows.length; i++){
      rows[i].classList.add('highlight-new');
    }

    /* حاول كمان تطابق النص في الخلايا */
    if(chgData.lastRow){
      const parts = chgData.lastRow.split('|').map(s => s.trim()).filter(Boolean);
      for(const p of parts){
        if(p.length < 3) continue;
        let found = 0;
        for(let i = start; i < rows.length; i++){
          const cells = rows[i].querySelectorAll('td, th');
          for(const cell of cells){
            if((cell.textContent || '').trim().includes(p)){
              rows[i].classList.add('highlight-new');
              found++;
              break;
            }
          }
          if(found >= numToHighlight) break;
        }
      }
    }

    /* لف للجدول */
    table.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showNotifBanner('✨ تم إظهار ' + numToHighlight + ' سجل جديد', 'info');
  };

  doHighlight();
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

/* ========== التواصل مع SW ========== */
function sendToSW(type, payload){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    if(reg.active) reg.active.postMessage({ type: type, ...payload });
  }).catch(() => {});
}

function startSWKeepAlive(){
  clearInterval(_swKeepAlive);
  _swKeepAlive = setInterval(() => { sendToSW('keepalive'); }, 45000);
}

/* ========== إعادة تعيين ========== */
function resetApp(){
  Object.keys(localStorage).filter(k => !k.startsWith('mmp_')).forEach(k => localStorage.removeItem(k));
  if('caches' in window) caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).catch(() => {});
  if('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(reg => { if(reg) reg.unregister(); }).catch(() => {});
  showNotifBanner('تم المسح، انتظر...', 'info');
  setTimeout(() => location.reload(), 1000);
}

/* حقن CSS التظليل */
(function injectCSS(){
  const style = document.createElement('style');
  style.textContent = `
    @keyframes highlightPulse {
      0% { background: rgba(45,212,191,0.5) !important; box-shadow: inset 0 0 0 3px #2dd4bf, 0 0 20px rgba(45,212,191,0.3) !important; }
      25% { background: rgba(45,212,191,0.25) !important; box-shadow: inset 0 0 0 2px rgba(45,212,191,0.8) !important; }
      50% { background: rgba(45,212,191,0.12) !important; }
      100% { background: transparent !important; box-shadow: none !important; }
    }
    .highlight-new {
      animation: highlightPulse 3s ease-out forwards !important;
      border-radius: 4px;
    }
    #mmpNotifBtnInner:hover { transform:scale(1.1); }
    #mmpNotifBtnInner:active { transform:scale(0.95); }
  `;
  document.head.appendChild(style);
})();
