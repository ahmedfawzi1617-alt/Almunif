function requestNotifPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
}

function getDataFingerprint(data){
  if(!data || !data.length) return '';
  return data.length + '|' + data.map(r => r.date + (r.order_no||'') + (r.product||'') + (r.qty_kg||0)).join(',');
}

function checkChanges(key, data, title, icon){
  if(!data || !data.length) return;
  const prev = localStorage.getItem(key);
  const curr = getDataFingerprint(data);
  localStorage.setItem(key, curr);
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
