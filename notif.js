function requestNotifPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
}

function checkChanges(key, data, title, icon){
  if(!data || !data.length) return;
  const prev = JSON.parse(localStorage.getItem(key) || '{}');
  const snapshot = data.slice(-5).map(r => r.date + '|' + (r.order_no||'') + '|' + (r.product||'') + '|' + (r.customer||''));
  const curr = { count: data.length, snapshot };
  localStorage.setItem(key, JSON.stringify(curr));
  if(!prev.count) return;
  if(prev.count === curr.count){
    const same = prev.snapshot && prev.snapshot.length === curr.snapshot.length && prev.snapshot.every((v,i) => v === curr.snapshot[i]);
    if(same) return;
  }
  const added = curr.count - prev.count;
  const msg = added > 0 ? `تمت إضافة ${added} سجل جديد` : `تحديث في البيانات`;
  if('Notification' in window && Notification.permission === 'granted'){
    try{ new Notification(title || 'MMP Egypt', { body: msg, icon: icon || 'icon-192.png' }); }catch(e){}
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
