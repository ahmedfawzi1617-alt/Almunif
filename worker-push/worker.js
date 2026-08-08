/* ============================================================
   MMP Push Worker — مجاني على Cloudflare Workers (ES modules)
   يعمل بـ:
   1) POST /subscribe    ← بيستقبل اشتراكات الأجهزة ويخزنها في KV
   2) فحص دوري (كل 5 دقائق) للشيتات وإرسال Web Push عند التغيير
   ============================================================ */

/* المفتاح الخاص — من توليد المفاتيح (نفس زوج المفتاح العام في sw.js) */
const VAPID_PRIVATE_KEY = 'urmrnGa4w5SW6hHwrwYYj3hGA9_9wJt8CxCfKI6Og0M';
const VAPID_PUBLIC_KEY = 'BIGOZIPM9M8RF4lPHj3tfaIFVTAUaBZUL5Fz0kvNfkh5yUaX88KVJ3L6zmXVNXuHViT4dij354qMch3xWcmyhFQ';
const VAPID_SUBJECT = 'mailto:admin@mmp-egypt.com';

/* الشيتات المراقبة — نفس اللي في sw.js */
const SHEETS = [
  { key: 'prod',  name: 'إنتاج', page: 'Production.html',
    url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy9XHGoK6iYQSRku-7qWDSaUveGXT1ZjpjRa2Av0cBrsXeljctBGdF7AHOoKaSgoi7Nz2g6djTTZxC/pub?gid=390647355&single=true&output=csv' },
  { key: 'scrap', name: 'هالك', page: 'scrap_dashboard.html',
    url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy9XHGoK6iYQSRku-7qWDSaUveGXT1ZjpjRa2Av0cBrsXeljctBGdF7AHOoKaSgoi7Nz2g6djTTZxC/pub?gid=1615042796&single=true&output=csv' },
  { key: 'lab', name: 'معمل', page: 'LAB.html',
    url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQiYC7XUuYzsqOQkKtxFH667BvpK0sroldpVvGwJ-V4r0bfbA2-ar-ZlsBPyBLcMBDsi5EKFwWTmxC/pub?gid=1555908756&single=true&output=csv' },
  { key: 'raw', name: 'خام', page: 'RAW.html',
    url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQiYC7XUuYzsqOQkKtxFH667BvpK0sroldpVvGwJ-V4r0bfbA2-ar-ZlsBPyBLcMBDsi5EKFwWTmxC/pub?gid=845489182&single=true&output=csv' }
];

/* ------------------------------------------------------------
   Web Push helpers (Web Crypto — بدون مكتبات خارجية)
   ------------------------------------------------------------ */
const ENC = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

/* جلب زوج المفاتيح P-256 للـ VAPID */
async function vapidKeys(){
  const pub = b64urlDecode(VAPID_PUBLIC_KEY);
  const priv = b64urlDecode(VAPID_PRIVATE_KEY);
  const keyPair = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    d: b64url(priv)
  }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  return keyPair;
}

async function signJwt(){
  const header = b64url(ENC.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const payload = b64url(ENC.encode(JSON.stringify({
    aud: 'https://fcm.googleapis.com',
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT
  })));
  const data = header + '.' + payload;
  const key = await vapidKeys();
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, ENC.encode(data));
  /* تحويل توقيع ECDSA (r,s) إلى تنسيق P1363 */
  const raw = new Uint8Array(sig);
  const r = raw.slice(0, raw.length / 2), s = raw.slice(raw.length / 2);
  const rSig = new Uint8Array(64);
  rSig.set(r, 0); rSig.set(s, 32);
  return data + '.' + b64url(rSig);
}

/* ECDH مشترك (P-256) — بيرجع [sharedSecret, serverPub] */
async function ecdhSharedSecret(clientPubRaw){
  const serverKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey));
  const pub = await crypto.subtle.importKey('raw', clientPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, serverKey.privateKey, 256);
  return { sharedSecret: new Uint8Array(shared), serverPub };
}

/* HKDF عبر Web Crypto */
async function hkdf(salt, ikm, info, len){
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/* تشفير الحمولة حسب RFC 8291 (aes128gcm) */
async function encryptPayload(subscription, payload){
  const p256dh = b64urlDecode(subscription.keys.p256dh);
  const auth = b64urlDecode(subscription.keys.auth);

  const { sharedSecret, serverPub } = await ecdhSharedSecret(p256dh);

  /* 1) PRK_key = HMAC(auth_secret, shared_secret) — زي HKDF-Extract */
  const authKey = await crypto.subtle.importKey('raw', auth, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', authKey, sharedSecret));

  /* 2) IKM = HKDF(salt=PRK_key, ikm=shared_secret, info="WebPush: info\0"||ua_public||as_public) */
  const keyInfo = new Uint8Array([...ENC.encode('WebPush: info\0'), ...p256dh, ...serverPub]);
  const ikm = await hkdf(prk, sharedSecret, keyInfo, 32);

  /* 3) salt عشوائي (بيتكتب في الهيدر) */
  const salt = crypto.getRandomValues(new Uint8Array(16));

  /* 4) key = HKDF(salt, IKM, "Content-Encoding: aes128gcm\0") ، nonce = HKDF(salt, IKM, "Content-Encoding: nonce\0") */
  const cek = await hkdf(salt, ikm, ENC.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, ENC.encode('Content-Encoding: nonce\0'), 12);

  /* 5) تشفير AES-128-GCM */
  const encKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, ENC.encode(payload)));

  /* 6) بناء الهيدر: version(1) + salt(16) + rs(4) + idlen(1) + server_pub(65) */
  const head = new Uint8Array(86);
  head[0] = 0;                                     /* version */
  head.set(salt, 1);                               /* salt 16 */
  new DataView(head.buffer).setUint32(17, 4096);   /* rs = 4096 */
  head[21] = 65;                                   /* idlen */
  head.set(serverPub, 22);                         /* server public key */

  const out = new Uint8Array(head.length + cipher.length);
  out.set(head, 0);
  out.set(cipher, head.length);
  return out;
}

async function sendPush(kv, subscription, title, body, url){
  const payload = JSON.stringify({ title, body, url });
  const bodyEnc = await encryptPayload(subscription, payload);
  const auth = await signJwt();

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Authorization': 'vapid t=' + auth,
      'Content-Encoding': 'aes128gcm'
    },
    body: bodyEnc
  });
  if(res.status === 404 || res.status === 410){
    /* الاشتراك ده غير صالح — نشيله */
    await removeSub(kv, subscription.endpoint);
  }
  return res;
}

/* ------------------------------------------------------------
   تخزين الاشتراكات — KV
   ------------------------------------------------------------ */
async function getSubs(kv){
  const raw = await kv.get('subs', 'json');
  return raw || [];
}
async function saveSubs(kv, list){
  await kv.put('subs', JSON.stringify(list));
}
async function addSub(kv, subscription){
  const list = await getSubs(kv);
  if(!list.some(s => s.endpoint === subscription.endpoint)){
    list.push({ endpoint: subscription.endpoint, keys: subscription.keys });
    await saveSubs(kv, list);
  }
}
async function removeSub(kv, endpoint){
  const list = await getSubs(kv);
  const next = list.filter(s => s.endpoint !== endpoint);
  if(next.length !== list.length) await saveSubs(kv, next);
}

/* ------------------------------------------------------------
   بصمة الشيت — مقارنة عدد الصفوف + حجم البيانات
   ------------------------------------------------------------ */
async function sheetFingerprint(url){
  try{
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now());
    if(!res.ok) return null;
    const text = await res.text();
    const rows = text.trim().split('\n').length;
    return rows + '|' + text.length;
  }catch(e){ return null; }
}

/* ------------------------------------------------------------
   الفحص الدوري — يبعت إشعار لكل جهاز لو الشيت اتغير
   ------------------------------------------------------------ */
async function checkAllChanges(kv){
  for(const s of SHEETS){
    try{
      const fp = await sheetFingerprint(s.url);
      if(!fp) continue;
      const prev = await kv.get('fp-' + s.key, 'text');
      if(prev && prev !== fp){
        const subs = await getSubs(kv);
        const msg = '📊 ' + s.name + ': تمت إضافة بيانات جديدة';
        await Promise.allSettled(subs.map(sub => sendPush(kv, sub, 'المنيف للأنابيب', msg, s.page)));
      }
      await kv.put('fp-' + s.key, fp);
    }catch(e){}
  }
}

/* ------------------------------------------------------------
   Router (ES modules — env فيه الـ KV)
   ------------------------------------------------------------ */
export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    const kv = env.MMP_KV;

    if(request.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: cors });
    }

    if(request.method === 'POST' && url.pathname === '/subscribe'){
      try{
        const body = await request.json();
        if(!body || !body.endpoint || !body.keys){
          return new Response(JSON.stringify({ error: 'missing endpoint/keys' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
        await addSub(kv, body);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      }catch(e){
        return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }

    if(request.method === 'GET' && url.pathname === '/health'){
      const subs = await getSubs(kv);
      return new Response(JSON.stringify({ ok: true, subs: subs.length }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if(url.pathname === '/check'){
      ctx.waitUntil(checkAllChanges(kv));
      return new Response('ok', { headers: cors });
    }

    return new Response('MMP Push Worker — routes: POST /subscribe, GET /health, GET /check', { headers: cors });
  },

  async scheduled(event, env, ctx){
    ctx.waitUntil(checkAllChanges(env.MMP_KV));
  }
};
