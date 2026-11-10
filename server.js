const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ ĐỔI TOKEN NÀY THÀNH CỦA BẠN (Dùng để đăng nhập trang Admin tạo Key)
const ADMIN_TOKEN = 'samm-admin-2026';

app.use(cors());
app.use(express.json());

// Quản lý Database (Lưu bằng file JSON)
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

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Sai Admin Token' });
  next();
}

// ================= API =================
app.post('/api/verify', (req, res) => {
  const { key, deviceId = 'UNKNOWN' } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Thiếu key' });
  const db = loadDB();
  const found = db.keys.find(k => k.key.toUpperCase() === key.toUpperCase().trim());
  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  if (found.status === 'locked') return res.json({ ok: false, error: 'Key đã bị khóa' });
  if (found.expires_at && Date.now() > found.expires_at) return res.json({ ok: false, error: 'Key đã hết hạn' });
  
  found.used_devices = found.used_devices || {};
  found.used_devices[deviceId] = Date.now();
  saveDB(db);
  res.json({ ok: true, type: found.type, name: found.name, isForever: !found.expires_at, expiresAt: found.expires_at });
});

app.post('/api/admin/create', adminAuth, (req, res) => {
  const { type = 'day', count = 1, note = '' } = req.body;
  const n = Math.max(1, Math.min(parseInt(count) || 1, 5000));
  const validTypes = ['hour', 'hour5', 'hour10', 'day', 'week', 'month', 'forever'];
  if (!validTypes.includes(type)) return res.json({ ok: false, error: 'Loại key không hợp lệ' });
  const db = loadDB();
  const created = [];
  for (let i = 0; i < n; i++) {
    const k = { key: generateKey(), type, name: typeLabel(type), note: String(note).slice(0, 100), status: 'active', created_at: Date.now(), expires_at: calcExpiry(type), used_devices: {} };
    db.keys.push(k);
    created.push(k);
  }
  saveDB(db);
  res.json({ ok: true, count: created.length, keys: created });
});

app.get('/api/admin/list', adminAuth, (req, res) => {
  const db = loadDB();
  res.json({ ok: true, total: db.keys.length, keys: db.keys.slice().reverse() });
});

// ================= GIAO DIỆN ADMIN TẠO KEY =================
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAMM VIP - Admin</title>
<style>
  * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; }
  body { background: #0a0a14; color: #e8e8f0; padding: 20px; max-width: 900px; margin: auto; }
  h1 { text-align: center; color: #00e8a0; margin-bottom: 20px; }
  .card { background: #13132a; border: 1px solid #2a2a4a; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  input, select, button { padding: 10px; border-radius: 8px; border: 1px solid #333; background: #0a0a14; color: #fff; margin: 5px; }
  button { background: #00e8a0; color: #000; font-weight: bold; cursor: pointer; border: none; }
  button:hover { background: #00ffb3; }
  button.gray { background: #333; color: #fff; }
  table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
  th, td { padding: 10px; border-bottom: 1px solid #2a2a4a; text-align: left; }
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
  <select id="type">
    <option value="hour">1 Giờ</option><option value="hour5">5 Giờ</option><option value="hour10">10 Giờ</option>
    <option value="day" selected>1 Ngày</option><option value="week">1 Tuần</option>
    <option value="month">1 Tháng</option><option value="forever">Vĩnh Viễn</option>
  </select>
  <input id="count" type="number" value="1" style="width: 80px;">
  <input id="note" type="text" placeholder="Ghi chú" style="width: 150px;">
  <button onclick="createKey()">TẠO KEY</button>
  <button class="gray" onclick="loadList()" style="float:right;">↻ Tải lại</button>
</div>
<div class="card">
  <div id="listArea" style="overflow-x:auto; max-height: 400px;">
    <p style="color:#666; text-align:center; padding:20px;">Bấm Tải Lại để xem</p>
  </div>
</div>
<script>
function showMsg(t, err) { const m = document.getElementById('msg'); m.textContent = t; m.className = 'msg ' + (err ? 'err' : 'ok'); setTimeout(() => m.className = 'msg', 3000); }
function saveToken() { localStorage.setItem('samm_token', document.getElementById('token').value.trim()); showMsg('Đã lưu Token', false); }
const getToken = () => localStorage.getItem('samm_token') || '';
async function createKey() {
  const body = { type: document.getElementById('type').value, count: +document.getElementById('count').value, note: document.getElementById('note').value };
  try {
    const r = await fetch('/api/admin/create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': getToken() }, body: JSON.stringify(body) });
    const d = await r.json();
    if(d.ok) { showMsg('✅ Đã tạo ' + d.count + ' Key!', false); loadList(); } else showMsg('❌ ' + d.error, true);
  } catch(e) { showMsg('❌ Lỗi kết nối', true); }
}
async function loadList() {
  try {
    const r = await fetch('/api/admin/list?token=' + getToken());
    const d = await r.json();
    if(!d.ok) return showMsg('❌ ' + d.error, true);
    if(!d.keys.length) return document.getElementById('listArea').innerHTML = '<p style="text-align:center;color:#666">Chưa có key nào</p>';
    let html = '<table><tr><th>Key</th><th>Loại</th><th>Hạn</th></tr>';
    d.keys.forEach(k => {
      const exp = k.expires_at ? new Date(k.expires_at).toLocaleString('vi-VN') : 'Vĩnh viễn';
      html += `<tr><td class="key">${k.key}</td><td>${k.name}</td><td>${exp}</td></tr>`;
    });
    html += '</table>';
    document.getElementById('listArea').innerHTML = html;
  } catch(e) { showMsg('❌ Lỗi tải', true); }
}
window.onload = () => { document.getElementById('token').value = getToken(); if(getToken()) loadList(); };
</script>
</body>
</html>
  `);
});

// ================= GIAO DIỆN APP (HTML SẠCH) =================
// Đây là giao diện sẽ hiển thị khi bạn vào link gốc (không có /admin)
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>SAMM VIP</title>
<style>
  :root { --bg: #050b14; --bg2: #0b1220; --bg3: #101a2d; --text: #f8fbff; --text2: #9eb3cc; --red: #ff4d6d; --green: #00e5a0; --cyan: #00d4ff; --border: rgba(255,255,255,0.06); }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
  body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
  #loadingScreen { position: fixed; inset: 0; background: #050505; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; transition: opacity 0.5s; }
  .loader { width: 50px; height: 50px; border: 3px solid rgba(255, 77, 109, 0.2); border-top: 3px solid var(--red); border-radius: 50%; animation: spinR 1s linear infinite; margin-bottom: 15px; }
  @keyframes spinR { to { transform: rotate(360deg); } }
  .loading-text { color: var(--red); font-size: 14px; font-weight: 700; }
  #mainApp { display: none; height: 100%; flex-direction: column; }
  .header { padding: 15px 20px; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .header-title { font-size: 20px; font-weight: 900; }
  .header-title span { color: var(--red); }
  .btn-logout { background: transparent; border: 1px solid var(--red); color: var(--red); padding: 5px 10px; border-radius: 5px; cursor: pointer; display: none; }
  .main-content { flex: 1; padding: 20px; overflow-y: auto; }
  .welcome-box { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 30px 20px; text-align: center; margin-top: 50px; }
  .key-input { width: 100%; padding: 15px; background: #000; border: 1px solid #333; border-radius: 10px; color: #fff; font-size: 16px; text-align: center; margin-bottom: 15px; text-transform: uppercase; outline: none; }
  .key-input:focus { border-color: var(--green); }
  .btn-activate { width: 100%; padding: 15px; background: linear-gradient(135deg, var(--red), #aa0022); border: none; border-radius: 10px; color: #fff; font-size: 16px; font-weight: 900; cursor: pointer; }
  .feature-card { background: var(--bg3); border: 1px solid var(--border); border-radius: 12px; padding: 15px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
  .toggle { width: 40px; height: 20px; background: #333; border-radius: 20px; position: relative; cursor: pointer; }
  .toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: 0.3s; }
  .toggle.active { background: var(--green); }
  .toggle.active::after { transform: translateX(20px); }
  .msg-box { padding: 10px; border-radius: 8px; margin-bottom: 15px; display: none; font-size: 13px; font-weight: bold; }
  .msg-err { background: rgba(255,77,109,0.1); color: var(--red); border: 1px solid var(--red); display: block; }
  .msg-ok { background: rgba(0,229,160,0.1); color: var(--green); border: 1px solid var(--green); display: block; }
</style>
</head>
<body>
<div id="loadingScreen"><div class="loader"></div><div class="loading-text">Đang khởi tạo SAMM VIP...</div></div>
<div id="mainApp">
  <div class="header">
    <div class="header-title">SAMM<span> VIP</span></div>
    <button class="btn-logout" onclick="logoutKey()" id="btnLogout">Đăng Xuất</button>
  </div>
  <div class="main-content">
    <div id="authArea" class="welcome-box">
      <h2>Nhập Key Bản Quyền</h2>
      <p style="color:var(--text2); font-size:13px; margin-bottom:15px;">Vui lòng nhập key hợp lệ để sử dụng.</p>
      <div id="msgBox" class="msg-box"></div>
      <input type="text" id="keyInput" class="key-input" placeholder="SAM-XXXX-XXXX-XXXX">
      <button class="btn-activate" id="btnActivate" onclick="activateKey()">KÍCH HOẠT NGAY</button>
    </div>
    <div id="appArea" style="display:none;">
      <div style="text-align:center; margin-bottom:20px;">
        <h2 style="color:var(--green);">Đã Kích Hoạt</h2>
        <p style="color:var(--text2); font-size:13px;" id="keyInfoDisplay">Hạng: ...</p>
      </div>
      <div class="feature-card"><div><h3>Aimlock Pro</h3><p style="font-size:12px;color:#aaa">Khóa mục tiêu tự động</p></div><div class="toggle" onclick="this.classList.toggle('active')"></div></div>
      <div class="feature-card"><div><h3>ESP / Xuyên Tường</h3><p style="font-size:12px;color:#aaa">Nhìn thấy địch xuyên vật thể</p></div><div class="toggle" onclick="this.classList.toggle('active')"></div></div>
      <div class="feature-card"><div><h3>Antiban Protect</h3><p style="font-size:12px;color:#aaa">Chống quét hệ thống</p></div><div class="toggle" onclick="this.classList.toggle('active')"></div></div>
    </div>
  </div>
</div>
<script>
// Vì HTML và Server chạy chung 1 link, không cần điền link server nữa!
const SERVER_URL = window.location.origin; 

function getDeviceId() {
  let id = localStorage.getItem('samm_dev_id');
  if(!id) { id = 'DEV-' + Math.random().toString(36).substr(2, 8).toUpperCase(); localStorage.setItem('samm_dev_id', id); }
  return id;
}
const DEVICE_ID = getDeviceId();

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const loader = document.getElementById('loadingScreen');
    if(loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 500); }
    document.getElementById('mainApp').style.display = 'flex';
    const savedKey = localStorage.getItem('samm_saved_key');
    if(savedKey) verifyKey(savedKey, true);
  }, 1200);
});

function showMsg(text, isOk) {
  const box = document.getElementById('msgBox');
  box.innerHTML = text;
  box.className = 'msg-box ' + (isOk ? 'msg-ok' : 'msg-err');
  setTimeout(() => box.className = 'msg-box', 4000);
}

async function activateKey() {
  const key = document.getElementById('keyInput').value.trim();
  if(!key) return showMsg('Vui lòng nhập Key!', false);
  const btn = document.getElementById('btnActivate');
  btn.innerHTML = 'Đang kiểm tra...'; btn.disabled = true;
  await verifyKey(key, false);
  btn.innerHTML = 'KÍCH HOẠT NGAY'; btn.disabled = false;
}

async function verifyKey(key, isAutoLogin) {
  try {
    const res = await fetch(SERVER_URL + '/api/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, deviceId: DEVICE_ID })
    });
    const data = await res.json();
    if(data.ok) {
      localStorage.setItem('samm_saved_key', key);
      if(!isAutoLogin) showMsg('Kích hoạt thành công!', true);
      setTimeout(() => {
        document.getElementById('authArea').style.display = 'none';
        document.getElementById('appArea').style.display = 'block';
        document.getElementById('btnLogout').style.display = 'block';
        let timeStr = data.isForever ? 'Vĩnh Viễn' : new Date(data.expiresAt).toLocaleString('vi-VN');
        document.getElementById('keyInfoDisplay').innerHTML = `Hạng: <b>${data.name}</b> | Hạn: <b>${timeStr}</b>`;
      }, 500);
    } else {
      if(isAutoLogin) localStorage.removeItem('samm_saved_key');
      else showMsg(data.error, false);
    }
  } catch(e) { if(!isAutoLogin) showMsg('Lỗi kết nối đến Server!', false); }
}

function logoutKey() {
  if(!confirm('Đăng xuất và xóa key khỏi thiết bị?')) return;
  localStorage.removeItem('samm_saved_key');
  location.reload();
}
</script>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
