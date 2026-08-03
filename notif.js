var _swKeepAlive = null;
var _lastChg = null;

/* ========== خريطة "الرقم المهم" لكل شيت — عشان الإشعار يوري القيمة الفعلية مش بس عدد السجلات ========== */
var VALUE_FIELD_MAP = {
  'sw-prod':  { field:'qty_kg',  unit:'كجم', noun:'عملية إنتاج' },
  'sw-scrap': { field:'weight',  unit:'كجم', noun:'عملية هالك'  },
  'sw-lab':   { field:null,      unit:'',    noun:'اختبار'      },
  'sw-raw':   { field:null,      unit:'',    noun:'عينة'        }
};
function fmtNum(n){
  if(n === null || n === undefined || isNaN(n)) return '';
  return Math.round(n * 10) / 10;
}

/* ========== فلوتنج بزر الإشعارات ========== */
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

/* ========== فحص التغيير بالـ order_no ========== */
function checkChanges(key, data, title, icon, pageUrl){
  if(!data || !data.length) return;

  /* بصمة معرفات الصفوف (order_no أو defect+product+weight) */
  const idKey = key + '_ids';
  const oldIdSet = localStorage.getItem(idKey);
  const currIds = data.map(r => r.order_no || (r.defect_ar||'') + '|' + (r.product||'') + '|' + (r.weight||''));
  localStorage.setItem(idKey, JSON.stringify(currIds));

  /* بصمة البيانات الكاملة */
  const prev = localStorage.getItem(key);
  const curr = getDataFingerprint(data);
  localStorage.setItem(key, curr);
  sendToSW('store-fp', { key: 'sw-' + key, fp: curr });

  if(prev === null) return;
  if(prev === curr) return;

  /* استخراج المعرفات الجديدة */
  let newIds = [];
  if(oldIdSet){
    try{
      const oldIds = JSON.parse(oldIdSet);
      const oldSet = new Set(oldIds);
      newIds = currIds.filter(o => o && !oldSet.has(o));
    }catch(_){}
  }

  /* بيانات التغيير */
  const diff = data.length - parseInt(prev.split('|')[0]) || 0;
  const lastRow = data[data.length - 1];
  const cfg = VALUE_FIELD_MAP['sw-' + key] || { field:null, unit:'', noun:'سجل' };

  let detail = 'تم تعديل البيانات';
  if(diff > 0){
    /* الصفوف الجديدة (افتراض إن البيانات بتتضاف في الآخر) */
    const newRows = data.slice(-diff);

    if(cfg.field){
      const sum = newRows.reduce((s,r) => s + (parseFloat(r[cfg.field]) || 0), 0);
      detail = 'تمت إضافة ' + diff + ' ' + cfg.noun +
               (sum ? ' — إجمالي ' + fmtNum(sum) + ' ' + cfg.unit : '');
      const bits = [];
      if(lastRow.product_type) bits.push(lastRow.product_type);
      if(lastRow.machine) bits.push(lastRow.machine);
      if(lastRow.customer) bits.push(lastRow.customer);
      if(lastRow.defect_ar) bits.push(lastRow.defect_ar);
      const lastVal = parseFloat(lastRow[cfg.field]);
      if(!isNaN(lastVal)) bits.push(fmtNum(lastVal) + ' ' + cfg.unit);
      if(bits.length) detail += '\nآخر إدخال: ' + bits.slice(0,4).join(' — ');
    }else{
      /* شيتات من غير رقم واحد واضح (زي المعملي/الخام) — نوري أهم تفاصيل آخر صف بدل كده */
      detail = 'تمت إضافة ' + diff + ' ' + cfg.noun;
      const bits = [];
      if(lastRow.date) bits.push(lastRow.date);
      if(lastRow.order_no) bits.push(lastRow.order_no);
      if(lastRow.product) bits.push(lastRow.product);
      if(lastRow.grade) bits.push(lastRow.grade);
      if(lastRow.overall_result) bits.push(String(lastRow.overall_result).toUpperCase());
      if(bits.length) detail += '\n' + bits.slice(0,3).join(' | ');
    }
  } else if(diff < 0){
    detail = 'تم حذف ' + Math.abs(diff) + ' ' + cfg.noun;
  }

  let lastRowStr = '';
  if(lastRow){
    const parts = [];
    if(lastRow.date) parts.push(lastRow.date);
    if(lastRow.product) parts.push(lastRow.product);
    if(lastRow.order_no) parts.push(lastRow.order_no);
    if(lastRow.defect_ar) parts.push(lastRow.defect_ar);
    if(lastRow.machine) parts.push(lastRow.machine);
    if(lastRow.weight) parts.push(lastRow.weight);
    lastRowStr = parts.slice(0,4).join(' | ');
  }

  const chgData = {
    sheet: title || '', key: key, page: pageUrl || '',
    added: diff,
    lastRow: lastRowStr,
    newIds: newIds.slice(-5),
    field: cfg.field || null,
    fieldValues: diff > 0 ? data.slice(-diff).map(r => parseFloat(r[cfg.field])).filter(v => v !== null && !isNaN(v)) : [],
    time: Date.now()
  };
  _lastChg = chgData;
  setTimeout(() => highlightRows(chgData), 800);

  /* لو الـ SW عمل إشعار للتغيير ده قبل كده، الصفحة ما تعملش إشعار مكرر */
  swSeenCount(key).then(swCount => {
    if(swCount === null || swCount < data.length){
      sendToSW('show-notif', {
        title: title || 'المنيف للأنابيب',
        body: detail, icon: icon || 'icon-192.png',
        tag: 'page-' + key + '-' + Date.now(),
        url: pageUrl || ''
      });
      showNotifBanner('🔔 ' + detail, 'info');
    }
  });
}

/* عدد الصفوف اللي الـ SW شافها آخر مرة — من الكاش بتاعه */
function swSeenCount(key){
  if(!('caches' in window)) return Promise.resolve(null);
  return caches.keys().then(names => {
    for(const n of names){
      if(n.indexOf('mmp-cache-') === 0){
        return caches.open(n).then(c => c.match('fp-sw-' + key).then(r => r ? r.text() : null));
      }
    }
    return null;
  }).then(txt => {
    if(!txt) return null;
    const p = parseInt(txt.split('|')[0]);
    return isNaN(p) ? null : p;
  }).catch(() => null);
}

/* ========== بصمة البيانات ========== */
function getDataFingerprint(data){
  if(!data || !data.length) return '';
  return data.length + '|' + JSON.stringify(data);
}

/* ========== إظهار الصفوف الجديدة (تظليل إنذار) ========== */
function markCell(el){
  el.classList.add('highlight-new', 'highlight-settled');
  clearTimeout(el._settledTimer);
  el._settledTimer = setTimeout(() => el.classList.remove('highlight-settled'), 20000);
}
function markRow(row, chgData){
  /* لو في قيمة رقمية محددة للصفوف الجديدة — حط الهالة على الخلية اللي محتواها القيمة دي */
  if(chgData && chgData.fieldValues && chgData.fieldValues.length){
    const cells = row.querySelectorAll('td');
    for(const cell of cells){
      const num = parseFloat((cell.textContent || '').replace(/,/g, '').replace(/%/g, ''));
      if(!isNaN(num) && chgData.fieldValues.some(v => Math.abs(num - v) < 0.01)){
        markCell(cell);
        return;
      }
    }
  }
  markCell(row);
}
function highlightRows(chgData){
  if(!chgData) return;
  document.querySelectorAll('.highlight-new').forEach(el => el.classList.remove('highlight-new'));
  document.querySelectorAll('.highlight-settled').forEach(el => el.classList.remove('highlight-settled'));
  if(window._hlRetry){ clearTimeout(window._hlRetry); window._hlRetry = null; }

    const doHL = () => {
      /* اختر الجدول المناسب: dailyScrapTableBody → defectTableBody → أول جدول */
      let table = document.getElementById('dailyScrapTableBody');
      if(!table || !table.closest('table')) table = document.querySelector('table:not(.info-header-table):not(.summary-table)');
      if(!table) table = document.querySelector('table');
      if(!table){
        window._hlRetry = setTimeout(doHL, 800);
        return;
      }
      table = table.closest ? (table.closest('table') || table) : table;
      const tbody = table.querySelector('tbody') || table;
      const rows = [...tbody.querySelectorAll('tr')].filter(r => !r.querySelector('th'));
    if(!rows.length){ showNotifBanner('📊 تم التحديث', 'info'); return; }

    let highlighted = 0;

    /* 1. دور على المعرفات الجديدة (order_no أو defect+product+weight) */
    const ids = (chgData.newIds || chgData.newOrders || []).filter(Boolean);
    for(const id of ids){
      const parts = id.split('|').map(s => s.trim()).filter(Boolean);
      for(const p of parts){
        if(p.length < 2) continue;
        for(const row of rows){
          const cells = row.querySelectorAll('td');
          for(const cell of cells){
            const txt = (cell.textContent || '').trim();
            if(txt === p || txt.includes(p) || p.includes(txt)){
              markRow(row, chgData);
              highlighted++;
              break;
            }
          }
          if(highlighted) break;
        }
        if(highlighted) break;
      }
      if(highlighted) break;
    }

    /* 2. لو ما لقاش، دور على lastRow */
    if(!highlighted && chgData.lastRow){
      const parts = chgData.lastRow.split('|').map(s => s.trim()).filter(s => s.length > 3);
      for(const p of parts){
        for(const row of rows){
          const cells = row.querySelectorAll('td');
          for(const cell of cells){
            if((cell.textContent || '').includes(p)){
              markRow(row, chgData);
              highlighted++;
              break;
            }
          }
          if(highlighted >= 3) break;
        }
        if(highlighted) break;
      }
    }

    /* 3. ظلل أول صفوف (الأحدث) */
    if(!highlighted){
      const n = Math.max(1, chgData.added > 0 ? chgData.added : 3);
      for(let i = 0; i < Math.min(n, rows.length); i++){
        markRow(rows[i], chgData);
        highlighted++;
      }
    }

    if(highlighted){
      showNotifBanner('🚨 تم إظهار ' + highlighted + ' صف', 'info');
    }
  };

  doHL();
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
  Object.keys(localStorage).forEach(k => { if(!k.startsWith('mmp_')) localStorage.removeItem(k); });
  if('caches' in window) caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).catch(() => {});
  if('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(reg => { if(reg) reg.unregister(); }).catch(() => {});
  showNotifBanner('تم المسح، انتظر...', 'info');
  setTimeout(() => location.reload(), 1000);
}

/* ========== حقن CSS ========== */
(function injectCSS(){
  const style = document.createElement('style');
  style.textContent = `
    @keyframes alarmBlink {
      0%, 100% { background: rgba(242,103,139,0.5) !important; box-shadow: 0 0 25px rgba(242,103,139,0.6), inset 0 0 0 2px #f2678b !important; }
      12% { background: rgba(242,167,59,0.5) !important; box-shadow: 0 0 25px rgba(242,167,59,0.6), inset 0 0 0 2px #f2a93b !important; }
      25% { background: rgba(45,212,191,0.5) !important; box-shadow: 0 0 25px rgba(45,212,191,0.6), inset 0 0 0 2px #2dd4bf !important; }
      37% { background: rgba(155,140,242,0.5) !important; box-shadow: 0 0 25px rgba(155,140,242,0.6), inset 0 0 0 2px #9b8cf2 !important; }
      50% { background: rgba(242,103,139,0.5) !important; box-shadow: 0 0 25px rgba(242,103,139,0.6), inset 0 0 0 2px #f2678b !important; }
    }
    .highlight-new { animation: alarmBlink 1.2s ease-in-out 3 !important; border-radius: 4px; position: relative; }
    /* هالة على الخلية الرقمية (الرقم اللي زاد) */
    td.highlight-new { border-radius: 6px; display: table-cell; }
    td.highlight-settled {
      box-shadow: 0 0 0 2px rgba(45,212,191,0.55), 0 0 12px rgba(45,212,191,0.45) !important;
      background: rgba(45,212,191,0.14) !important;
      border-radius: 6px !important;
      font-weight: 800 !important;
    }
    /* دائرة حمراء على الخلية الرقمية المتعدلة */
    td.highlight-settled { position: relative !important; }
    td.highlight-settled::after {
      content: '●';
      position: absolute; top: 2px; left: 2px;
      color: #f2678b; font-size: 11px; line-height: 1;
      text-shadow: 0 0 6px rgba(242,103,139,0.9);
      animation: redDot 1s ease-in-out infinite;
    }
    @keyframes redDot {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.35); opacity: .7; }
    }
    /* الصف كامل (حالة احتياطية) */
    tr.highlight-settled {
      box-shadow: inset 3px 0 0 0 #2dd4bf !important;
      background: rgba(45,212,191,0.08) !important;
      position: relative;
    }
    tr.highlight-settled td:first-child{ position: relative; }
    tr.highlight-settled td:first-child::before {
      content: 'جديد';
      position: absolute; top: 2px; right: 2px;
      background: #2dd4bf; color: #04211d;
      font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 8px;
      line-height: 1.4; z-index: 2;
    }
    tr.highlight-settled td:first-child::after {
      content: '●';
      position: absolute; top: 2px; left: 2px;
      color: #f2678b; font-size: 11px; line-height: 1;
      text-shadow: 0 0 6px rgba(242,103,139,0.9);
      animation: redDot 1s ease-in-out infinite;
    }
    #mmpNotifBtnInner:hover { transform:scale(1.1); }
    #mmpNotifBtnInner:active { transform:scale(0.95); }
  `;
  document.head.appendChild(style);
})();
