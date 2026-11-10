const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ ĐỔI TOKEN NÀY THÀNH CỦA BẠN
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'samm-admin-2026';

app.use(cors());
app.use(express.json());

// Quản lý Database bằng file JSON (không cần setup DB phức tạp)
const DB_FILE = path.join(__dirname, 'keys.json');
function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
  return { keys: [] };
}
function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SAM-${part()}-${part()}-${part()}`;
}

function calcExpiry(type) {
  const now = Date.now();
  const HOUR = 3600 * 1000, DAY = 24 * HOUR;
  switch (type) {
    case 'hour': return now + HOUR;
    case 'hour5': return now + 5 * HOUR;
    case 'hour10': return now + 10 * HOUR;
    case 'day': return now + DAY;
    case 'week': return now + 7 * DAY;
    case 'month': return now + 30 * DAY;
    case 'forever': return null;
    default: return null;
  }
}

function typeLabel(type) {
  return {
    hour: '1 Giờ', hour5: '5 Giờ', hour10: '10 Giờ',
    day: '1 Ngày', week: '1 Tuần', month: '1 Tháng', forever: 'Vĩnh Viễn'
  }[type] || type;
}

// Middleware bảo mật cho Admin
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Sai Admin Token' });
  next();
}

// ================= API CHO HTML GỌI =================

// 1. API Kích hoạt Key
app.post('/api/verify', (req, res) => {
  const { key, deviceId = 'UNKNOWN' } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Thiếu key' });

  const db = loadDB();
  const found = db.keys.find(k => k.key.toUpperCase() === key.toUpperCase().trim());

  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  if (found.status === 'locked' || found.status === 'banned') return res.json({ ok: false, error: 'Key đã bị khóa' });
  if (found.expires_at && Date.now() > found.expires_at) return res.json({ ok: false, error: 'Key đã hết hạn sử dụng' });

  // Ghi nhận thiết bị đã dùng key
  found.used_devices = found.used_devices || {};
  found.used_devices[deviceId] = Date.now();
  found.last_used = Date.now();
  saveDB(db);

  res.json({
    ok: true,
    type: found.type,
    name: found.name,
    isForever: !found.expires_at,
    expiresAt: found.expires_at
  });
});

// ================= API ADMIN =================

// 2. API Tạo Key
app.post('/api/admin/create', adminAuth, (req, res) => {
  const { type = 'day', count = 1, note = '' } = req.body;
  const n = Math.max(1, Math.min(parseInt(count) || 1, 5000));
  const validTypes = ['hour', 'hour5', 'hour10', 'day', 'week', 'month', 'forever'];
  
  if (!validTypes.includes(type)) return res.json({ ok: false, error: 'Loại key không hợp lệ' });

  const db = loadDB();
  const created = [];
  for (let i = 0; i < n; i++) {
    const k = {
      key: generateKey(),
      type: type,
      name: typeLabel(type),
      note: String(note).slice(0, 100),
      status: 'active',
      created_at: Date.now(),
      expires_at: calcExpiry(type),
      used_devices: {}
    };
    db.keys.push(k);
    created.push(k);
  }
  saveDB(db);
  res.json({ ok: true, count: created.length, keys: created });
});

// 3. API Danh sách Key
app.get('/api/admin/list', adminAuth, (req, res) => {
  const db = loadDB();
  res.json({ ok: true, total: db.keys.length, keys: db.keys.slice().reverse() });
});

// 4. API Xóa Key
app.delete('/api/admin/delete/:key', adminAuth, (req, res) => {
  const db = loadDB();
  const before = db.keys.length;
  db.keys = db.keys.filter(k => k.key !== req.params.key);
  saveDB(db);
  res.json({ ok: true, deleted: before - db.keys.length });
});

// ================= GIAO DIỆN ADMIN =================
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAMM VIP - Quản Trị</title>
<style>
  * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; }
  body { background: #0a0a14; color: #e8e8f0; padding: 20px; max-width: 900px; margin: auto; }
  h1 { text-align: center; color: #00e8a0; margin-bottom: 20px; text-shadow: 0 0 10px #00e8a0; }
  .card { background: #13132a; border: 1px solid #2a2a4a; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  input, select, button { padding: 10px; border-radius: 8px; border: 1px solid #333; background: #0a0a14; color: #fff; margin: 5px; }
  input:focus, select:focus { outline: none; border-color: #00e8a0; }
  button { background: #00e8a0; color: #000; font-weight: bold; cursor: pointer; border: none; transition: 0.2s; }
  button:hover { background: #00ffb3; box-shadow: 0 0 15px #00e8a0; }
  button.gray { background: #333; color: #fff; } button.gray:hover { background: #555; box-shadow: none; }
  table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
  th, td { padding: 10px; border-bottom: 1px solid #2a2a4a; text-align: left; }
  th { color: #888; font-size: 12px; text-transform: uppercase; }
  .key { color: #00e8a0; font-family: monospace; font-weight: bold; }
  .msg { padding: 10px; border-radius: 8px; margin-bottom: 15px; display: none; text-align: center; }
  .msg.ok { display: block; background: #003322; color: #00e8a0; border: 1px solid #00e8a0; }
  .msg.err { display: block; background: #331122; color: #ff3366; border: 1px solid #ff3366; }
</style>
</head>
<body>
<h1>🔑 SAMM VIP - TẠO KEY</h1>
<div id="msg" class="msg"></div>

<div class="card">
  <input id="token" type="password" placeholder="Nhập Admin Token" style="width: 250px;">
  <button onclick="saveToken()">Lưu Token</button>
</div>

<div class="card">
  <h3 style="margin-bottom:10px; color:#00e8a0">Tạo Key Mới</h3>
  <select id="type">
    <option value="hour">1 Giờ</option><option value="hour5">5 Giờ</option><option value="hour10">10 Giờ</option>
    <option value="day" selected>1 Ngày</option><option value="week">1 Tuần</option>
    <option value="month">1 Tháng</option><option value="forever">Vĩnh Viễn</option>
  </select>
  <input id="count" type="number" value="1" min="1" max="5000" style="width: 100px;">
  <input id="note" type="text" placeholder="Ghi chú (tùy chọn)" style="width: 200px;">
  <button onclick="createKey()">TẠO KEY</button>
</div>

<div class="card">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <h3 style="color:#00e8a0">Danh Sách Key</h3>
    <button class="gray" onclick="loadList()">↻ Tải lại</button>
  </div>
  <div id="listArea" style="overflow-x:auto; max-height: 400px;">
    <p style="color:#666; text-align:center; padding:20px;">Bấm Tải Lại để xem</p>
  </div>
</div>

<script>
function showMsg(t, err) {
  const m = document.getElementById('msg');
  m.textContent = t; m.className = 'msg ' + (err ? 'err' : 'ok');
  setTimeout(() => m.className = 'msg', 3000);
}
function saveToken() {
  localStorage.setItem('samm_token', document.getElementById('token').value.trim());
  showMsg('Đã lưu Token', false);
}
const getToken = () => localStorage.getItem('samm_token') || '';

async function createKey() {
  const body = {
    type: document.getElementById('type').value,
    count: +document.getElementById('count').value,
    note: document.getElementById('note').value
  };
  try {
    const r = await fetch('/api/admin/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': getToken() },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if(d.ok) { showMsg('✅ Đã tạo ' + d.count + ' Key!', false); loadList(); }
    else showMsg('❌ ' + d.error, true);
  } catch(e) { showMsg('❌ Lỗi kết nối', true); }
}

async function loadList() {
  try {
    const r = await fetch('/api/admin/list?token=' + getToken());
    const d = await r.json();
    if(!d.ok) { showMsg('❌ ' + d.error, true); return; }
    if(!d.keys.length) { document.getElementById('listArea').innerHTML = '<p style="text-align:center;color:#666">Chưa có key nào</p>'; return; }
    
    let html = '<table><tr><th>Key</th><th>Loại</th><th>Hạn</th><th>Thao tác</th></tr>';
    d.keys.forEach(k => {
      const exp = k.expires_at ? new Date(k.expires_at).toLocaleString('vi-VN') : 'Vĩnh viễn';
      html += `<tr><td class="key">${k.key}</td><td>${k.name}</td><td>${exp}</td>
               <td><button style="background:#ff3366;color:#fff;padding:5px 10px;font-size:12px;" onclick="delKey('${k.key}')">Xóa</button></td></tr>`;
    });
    html += '</table>';
    document.getElementById('listArea').innerHTML = html;
  } catch(e) { showMsg('❌ Lỗi tải danh sách', true); }
}

async function delKey(key) {
  if(!confirm('Xóa key này?')) return;
  try {
    await fetch('/api/admin/delete/' + key, { method: 'DELETE', headers: { 'x-admin-token': getToken() } });
    loadList();
  } catch(e) {}
}

window.onload = () => {
  document.getElementById('token').value = getToken();
  if(getToken()) loadList();
};
</script>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}. Admin: http://localhost:${PORT}/admin`));
