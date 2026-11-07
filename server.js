const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, 'keys.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'innova-admin-2024';

app.use(cors());
app.use(express.json());

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: [] }, null, 2));
    return { keys: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return { keys: [] };
  }
}

function saveKeys(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
}

function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INNOVA-${part()}-${part()}-${part()}`;
}

function calcExpiry(type) {
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  switch (type) {
    case 'hour':  return now + HOUR;
    case 'day':   return now + DAY;
    case 'week':  return now + 7 * DAY;
    case 'month': return now + 30 * DAY;
    case 'forever': return null;
    default: return null;
  }
}

app.post('/api/create', (req, res) => {
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });

  const { type = 'day', count = 1, note = '' } = req.body;
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 100);
  const db = loadKeys();
  const created = [];

  for (let i = 0; i < n; i++) {
    const key = generateKey();
    db.keys.push({ key, type, createdAt: Date.now(), expiresAt: calcExpiry(type), note: String(note).slice(0, 100), used: false, usedAt: null, deviceId: null });
    created.push(key);
  }
  saveKeys(db);
  res.json({ ok: true, created });
});

app.post('/api/verify', (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ ok: false, error: 'Thiếu key hoặc deviceId' });

  const db = loadKeys();
  const found = db.keys.find(k => k.key === key.toUpperCase().trim());
  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  if (found.expiresAt !== null && Date.now() > found.expiresAt) return res.json({ ok: false, error: 'Key đã hết hạn' });
  if (found.deviceId && found.deviceId !== deviceId) return res.json({ ok: false, error: 'Key đã dùng trên thiết bị khác' });

  if (!found.deviceId) {
    found.deviceId = deviceId;
    found.used = true;
    found.usedAt = Date.now();
    saveKeys(db);
  }

  res.json({ ok: true, type: found.type, isForever: found.expiresAt === null, remainingMs: found.expiresAt ? Math.max(0, found.expiresAt - Date.now()) : null });
});

app.get('/api/list', (req, res) => {
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  const db = loadKeys();
  res.json({ ok: true, keys: db.keys.sort((a, b) => b.createdAt - a.createdAt) });
});

app.delete('/api/delete/:key', (req, res) => {
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  const db = loadKeys();
  db.keys = db.keys.filter(k => k.key !== req.params.key.toUpperCase());
  saveKeys(db);
  res.json({ ok: true });
});

app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Admin - Innova Key</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; font-family: system-ui, sans-serif; }
  body { background: #0a0f17; color: #cfefff; padding: 20px; max-width: 800px; margin: auto; }
  h1 { color: #00f0ff; text-align: center; text-shadow: 0 0 10px #00f0ff80; }
  .box { background: #101a24; padding: 20px; border-radius: 12px; border: 1px solid #1a2a3d; margin-bottom: 20px; }
  input,select,button { padding: 10px; border-radius: 8px; border: 1px solid #2a3a4d; background: #0a0f17; color: #cfefff; font-size: 14px; outline: none; }
  button { background: linear-gradient(135deg, #00f0ff, #0099cc); color: #001a22; font-weight: 800; cursor: pointer; border: none; }
  .btn-gray { background: #2a3a4d; color: #fff; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th,td { padding: 10px; border-bottom: 1px solid #1a2a3d; text-align: left; }
  .key { color: #00ff88; font-family: monospace; font-weight: bold; }
  #msg { color: #00ff88; margin-top: 10px; font-weight: bold; }
</style></head><body>
<h1>⚡ INNOVA KEY ADMIN ⚡</h1>
<div class="box">
  <div class="row"><input id="pass" type="password" placeholder="Mật khẩu Admin..." style="flex:1"></div>
  <div class="row">
    <select id="type"><option value="hour">1 Giờ</option><option value="day" selected>1 Ngày</option><option value="week">1 Tuần</option><option value="month">1 Tháng</option><option value="forever">Vĩnh viễn</option></select>
    <input id="count" type="number" value="1" min="1" max="100" style="width:80px">
    <input id="note" type="text" placeholder="Ghi chú" style="flex:1">
    <button onclick="createKey()">TẠO KEY</button>
    <button class="btn-gray" onclick="loadList()">LOAD DS</button>
  </div>
  <div id="msg"></div>
</div>
<div class="box">
  <table id="tbl"><thead><tr><th>Key</th><th>Hạn dùng</th><th>Thiết bị</th><th>Ghi chú</th><th>Xóa</th></tr></thead><tbody></tbody></table>
</div>
<script>
async function createKey(){
  const pass=document.getElementById('pass').value;
  if(!pass) return alert('Nhập mật khẩu!');
  const btn=event.target; btn.innerText='...'; btn.disabled=true;
  try {
    const r=await fetch('/api/create',{method:'POST',headers:{'Content-Type':'application/json','x-admin-pass':pass},body:JSON.stringify({type:document.getElementById('type').value,count:+document.getElementById('count').value,note:document.getElementById('note').value})});
    const d=await r.json();
    document.getElementById('msg').innerHTML = d.ok ? '✅ Đã tạo '+d.created.length+' key!' : '❌ Lỗi: '+d.error;
    if(d.ok) loadList();
  } catch(e) { document.getElementById('msg').innerHTML='❌ Lỗi kết nối!'; }
  btn.innerText='TẠO KEY'; btn.disabled=false;
}
async function loadList(){
  const pass=document.getElementById('pass').value;
  if(!pass) return alert('Nhập mật khẩu!');
  try {
    const r=await fetch('/api/list?pass='+encodeURIComponent(pass));
    const d=await r.json();
    const tb=document.querySelector('#tbl tbody'); tb.innerHTML='';
    if(!d.ok) return document.getElementById('msg').innerHTML='❌ '+d.error;
    d.keys.forEach(k=>{
      const tr=document.createElement('tr');
      const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : '∞ Vĩnh viễn';
      const dev = k.deviceId ? k.deviceId.slice(0,10)+'...' : 'Chưa dùng';
      tr.innerHTML='<td class="key">'+k.key+'</td><td>'+exp+'</td><td>'+dev+'</td><td>'+(k.note||'—')+'</td><td><button style="padding:4px 8px;font-size:12px;background:#ff3366;color:#fff" onclick="delKey(\\''+k.key+'\\')">X</button></td>';
      tb.appendChild(tr);
    });
  } catch(e) { document.getElementById('msg').innerHTML='❌ Lỗi kết nối!'; }
}
async function delKey(key){
  const pass=document.getElementById('pass').value;
  if(!confirm('Xóa key '+key+'?')) return;
  await fetch('/api/delete/'+key+'?pass='+encodeURIComponent(pass),{method:'DELETE'});
  loadList();
}
</script></body></html>`);
});

app.get('/', (req, res) => res.json({ ok: true, service: 'Innova Key Server', status: 'Running' }));
app.listen(PORT, () => console.log('Server chạy tại cổng ' + PORT));
