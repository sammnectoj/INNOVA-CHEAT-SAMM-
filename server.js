// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, 'keys.json');

// Admin password để tạo key (ĐỔI NGAY khi deploy!)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'innova-admin-2024';

app.use(cors());
app.use(express.json());

// ===== Load / save keys =====
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

// ===== Sinh key ngẫu nhiên =====
function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INNOVA-${part()}-${part()}-${part()}`;
}

// ===== Tính thời gian hết hạn =====
// type: 'hour' | 'day' | 'week' | 'month' | 'forever'
function calcExpiry(type) {
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  switch (type) {
    case 'hour':  return now + HOUR;
    case 'day':   return now + DAY;
    case 'week':  return now + 7 * DAY;
    case 'month': return now + 30 * DAY;
    case 'forever': return null; // null = vĩnh viễn
    default: return null;
  }
}

// ===== Middleware check admin =====
function requireAdmin(req, res, next) {
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Sai mật khẩu admin' });
  }
  next();
}

// ============================================================
// API: TẠO KEY
// POST /api/create
// body: { type: 'hour'|'day'|'week'|'month'|'forever', count: 1..100, note?: string }
// header: x-admin-pass: <ADMIN_PASSWORD>
// ============================================================
app.post('/api/create', requireAdmin, (req, res) => {
  const { type = 'day', count = 1, note = '' } = req.body;
  const validTypes = ['hour', 'day', 'week', 'month', 'forever'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ ok: false, error: 'type không hợp lệ' });
  }
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 100);

  const db = loadKeys();
  const created = [];
  for (let i = 0; i < n; i++) {
    const key = generateKey();
    const item = {
      key,
      type,
      createdAt: Date.now(),
      expiresAt: calcExpiry(type),
      note: String(note).slice(0, 100),
      used: false,
      usedAt: null,
      deviceId: null
    };
    db.keys.push(item);
    created.push(item);
  }
  saveKeys(db);
  res.json({ ok: true, created });
});

// ============================================================
// API: KIỂM TRA KEY + gắn thiết bị (dùng ở client index.html)
// POST /api/verify
// body: { key: string, deviceId: string }
// ============================================================
app.post('/api/verify', (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) {
    return res.status(400).json({ ok: false, error: 'Thiếu key hoặc deviceId' });
  }

  const db = loadKeys();
  const found = db.keys.find(k => k.key === key.toUpperCase().trim());
  if (!found) {
    return res.json({ ok: false, error: 'Key không tồn tại' });
  }

  // Kiểm tra hết hạn
  if (found.expiresAt !== null && Date.now() > found.expiresAt) {
    return res.json({ ok: false, error: 'Key đã hết hạn' });
  }

  // Nếu key đã gắn thiết bị khác → chặn
  if (found.deviceId && found.deviceId !== deviceId) {
    return res.json({ ok: false, error: 'Key đã được dùng trên thiết bị khác' });
  }

  // Gắn thiết bị lần đầu
  if (!found.deviceId) {
    found.deviceId = deviceId;
    found.used = true;
    found.usedAt = Date.now();
    saveKeys(db);
  }

  // Trả về thông tin
  res.json({
    ok: true,
    type: found.type,
    expiresAt: found.expiresAt,
    isForever: found.expiresAt === null,
    remainingMs: found.expiresAt ? Math.max(0, found.expiresAt - Date.now()) : null
  });
});

// ============================================================
// API: LIỆT KÊ KEY (admin)
// GET /api/list?pass=<ADMIN_PASSWORD>
// ============================================================
app.get('/api/list', requireAdmin, (req, res) => {
  const db = loadKeys();
  res.json({ ok: true, keys: db.keys });
});

// ============================================================
// API: XÓA KEY (admin)
// DELETE /api/delete/:key?pass=<ADMIN_PASSWORD>
// ============================================================
app.delete('/api/delete/:key', requireAdmin, (req, res) => {
  const db = loadKeys();
  const before = db.keys.length;
  db.keys = db.keys.filter(k => k.key !== req.params.key.toUpperCase());
  saveKeys(db);
  res.json({ ok: true, deleted: before - db.keys.length });
});

// ============================================================
// Trang admin tạo key đơn giản (truy cập /admin)
// ============================================================
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Admin - Innova Key</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui;background:#0a0f17;color:#cfefff;padding:20px;max-width:820px;margin:auto}
  h1{color:#00f0ff;letter-spacing:2px}
  input,select,button{padding:10px;border-radius:8px;border:1px solid #2a3a4d;background:#101a24;color:#cfefff;font-size:14px}
  button{background:linear-gradient(135deg,#00f0ff,#0099cc);color:#001a22;font-weight:800;cursor:pointer}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
  th,td{padding:6px;border-bottom:1px solid #1a2a3d;text-align:left}
  .key{color:#00ff88;font-family:monospace}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
</style></head><body>
<h1>⚡ INNOVA KEY ADMIN</h1>
<div class="row">
  <input id="pass" type="password" placeholder="Admin password" value="">
  <select id="type">
    <option value="hour">1 Giờ</option>
    <option value="day" selected>1 Ngày</option>
    <option value="week">1 Tuần</option>
    <option value="month">1 Tháng</option>
    <option value="forever">Vĩnh viễn</option>
  </select>
  <input id="count" type="number" value="1" min="1" max="100" style="width:80px">
  <input id="note" type="text" placeholder="Ghi chú (tuỳ chọn)" style="flex:1;min-width:150px">
  <button onclick="createKey()">TẠO KEY</button>
  <button onclick="loadList()" style="background:#334">LOAD</button>
</div>
<div id="out" style="margin-top:12px;color:#00ff88;font-family:monospace;white-space:pre-wrap"></div>
<table id="tbl"><thead><tr><th>Key</th><th>Loại</th><th>Hết hạn</th><th>Device</th><th></th></tr></thead><tbody></tbody></table>
<script>
async function createKey(){
  const pass=document.getElementById('pass').value;
  const body={type:document.getElementById('type').value,
              count:+document.getElementById('count').value,
              note:document.getElementById('note').value};
  const r=await fetch('/api/create',{method:'POST',
      headers:{'Content-Type':'application/json','x-admin-pass':pass},
      body:JSON.stringify(body)});
  const d=await r.json();
  document.getElementById('out').textContent = JSON.stringify(d,null,2);
  if(d.ok) loadList();
}
async function loadList(){
  const pass=document.getElementById('pass').value;
  const r=await fetch('/api/list?pass='+encodeURIComponent(pass));
  const d=await r.json();
  const tb=document.querySelector('#tbl tbody');tb.innerHTML='';
  if(!d.ok){document.getElementById('out').textContent=JSON.stringify(d,null,2);return;}
  d.keys.forEach(k=>{
    const tr=document.createElement('tr');
    const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : '∞ Vĩnh viễn';
    tr.innerHTML='<td class="key">'+k.key+'</td><td>'+k.type+'</td><td>'+exp+'</td><td>'+(k.deviceId?k.deviceId.slice(0,10)+'…':'—')+'</td><td><button style="padding:4px 8px;font-size:11px" onclick="delKey(\\''+k.key+'\\')">X</button></td>';
    tb.appendChild(tr);
  });
}
async function delKey(key){
  const pass=document.getElementById('pass').value;
  const r=await fetch('/api/delete/'+key+'?pass='+encodeURIComponent(pass),{method:'DELETE'});
  loadList();
}
</script></body></html>`);
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Innova Key Server',
    endpoints: ['POST /api/create', 'POST /api/verify', 'GET /api/list', 'DELETE /api/delete/:key', 'GET /admin']
  });
});

app.listen(PORT, () => {
  console.log(`⚡ Innova Key Server chạy tại http://localhost:${PORT}`);
  console.log(`🔑 Admin password: ${ADMIN_PASSWORD}`);
  console.log(`🖥️  Trang admin: http://localhost:${PORT}/admin`);
});
