const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, 'keys.json');

// Mật khẩu Admin (Ưu tiên lấy từ biến môi trường trên Render, nếu không có thì dùng mặc định)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'innova-admin-2024';

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// HÀM XỬ LÝ LƯU TRỮ (DATABASE JSON)
// ==========================================
function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: [] }, null, 2));
    return { keys: [] };
  }
  try {
    const data = fs.readFileSync(KEYS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Lỗi đọc file keys.json:", error);
    return { keys: [] };
  }
}

function saveKeys(data) {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Lỗi ghi file keys.json:", error);
  }
}

// ==========================================
// HÀM TẠO KEY & TÍNH THỜI GIAN
// ==========================================
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
    case 'forever': return null; // null = vĩnh viễn
    default: return null;
  }
}

// ==========================================
// MIDDLEWARE CHECK ADMIN
// ==========================================
function requireAdmin(req, res, next) {
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Sai mật khẩu admin!' });
  }
  next();
}

// ==========================================
// CÁC API
// ==========================================

// 1. Tạo Key (Admin)
app.post('/api/create', requireAdmin, (req, res) => {
  const { type = 'day', count = 1, note = '' } = req.body;
  const validTypes = ['hour', 'day', 'week', 'month', 'forever'];
  
  if (!validTypes.includes(type)) {
    return res.status(400).json({ ok: false, error: 'Loại thời gian không hợp lệ' });
  }
  
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 100); // Tối đa 100 key 1 lần

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

// 2. Kiểm tra Key (Client gọi khi nhập key)
app.post('/api/verify', (req, res) => {
  const { key, deviceId } = req.body || {};
  
  if (!key || !deviceId) {
    return res.status(400).json({ ok: false, error: 'Thiếu key hoặc mã thiết bị' });
  }

  const db = loadKeys();
  const found = db.keys.find(k => k.key === key.toUpperCase().trim());
  
  if (!found) {
    return res.json({ ok: false, error: 'Key không tồn tại trên hệ thống' });
  }

  // Kiểm tra hết hạn
  if (found.expiresAt !== null && Date.now() > found.expiresAt) {
    return res.json({ ok: false, error: 'Key đã hết hạn sử dụng' });
  }

  // Kiểm tra khóa thiết bị (1 key chỉ dùng 1 máy)
  if (found.deviceId && found.deviceId !== deviceId) {
    return res.json({ ok: false, error: 'Key này đã được sử dụng trên thiết bị khác' });
  }

  // Nếu là lần đầu dùng, gắn thiết bị vào key
  if (!found.deviceId) {
    found.deviceId = deviceId;
    found.used = true;
    found.usedAt = Date.now();
    saveKeys(db);
  }

  res.json({
    ok: true,
    type: found.type,
    expiresAt: found.expiresAt,
    isForever: found.expiresAt === null,
    remainingMs: found.expiresAt ? Math.max(0, found.expiresAt - Date.now()) : null
  });
});

// 3. Lấy danh sách Key (Admin)
app.get('/api/list', requireAdmin, (req, res) => {
  const db = loadKeys();
  // Sắp xếp key mới nhất lên đầu
  const sortedKeys = [...db.keys].sort((a, b) => b.createdAt - a.createdAt);
  res.json({ ok: true, keys: sortedKeys });
});

// 4. Xóa Key (Admin)
app.delete('/api/delete/:key', requireAdmin, (req, res) => {
  const db = loadKeys();
  const before = db.keys.length;
  db.keys = db.keys.filter(k => k.key !== req.params.key.toUpperCase());
  saveKeys(db);
  res.json({ ok: true, deleted: before - db.keys.length });
});

// ==========================================
// GIAO DIỆN ADMIN (TRANG WEB TẠO KEY)
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>INNOVA KEY - ADMIN</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    body { background: #0a0f17; color: #cfefff; padding: 20px; max-width: 900px; margin: auto; }
    h1 { color: #00f0ff; text-shadow: 0 0 10px #00f0ff80; letter-spacing: 2px; text-align: center; }
    .box { background: #101a24; padding: 20px; border-radius: 12px; border: 1px solid #1a2a3d; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    input, select, button { padding: 10px; border-radius: 8px; border: 1px solid #2a3a4d; background: #0a0f17; color: #cfefff; font-size: 14px; outline: none; }
    input:focus, select:focus { border-color: #00f0ff; box-shadow: 0 0 8px #00f0ff50; }
    button { background: linear-gradient(135deg, #00f0ff, #0099cc); color: #001a22; font-weight: 800; cursor: pointer; transition: 0.2s; border: none; }
    button:hover { transform: scale(1.02); box-shadow: 0 0 15px #00f0ff; }
    .btn-gray { background: #2a3a4d; color: #fff; }
    .btn-red { background: #ff3366; color: #fff; padding: 6px 10px; font-size: 12px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 15px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px; border-bottom: 1px solid #1a2a3d; text-align: left; }
    th { color: #5e7a94; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }
    .key-text { color: #00ff88; font-family: monospace; font-weight: bold; font-size: 14px; }
    .status-used { color: #ffaa00; }
    .status-new { color: #00ff88; }
    #out { margin-top: 15px; color: #00ff88; font-family: monospace; white-space: pre-wrap; background: #000; padding: 10px; border-radius: 8px; min-height: 40px; }
    @media (max-width: 600px) { .row { flex-direction: column; align-items: stretch; } }
  </style>
</head>
<body>
  <h1>⚡ INNOVA KEY ADMIN ⚡</h1>
  
  <div class="box">
    <div class="row">
      <input id="pass" type="password" placeholder="Nhập mật khẩu Admin..." style="flex:1; min-width: 200px;">
    </div>
    <div class="row">
      <select id="type">
        <option value="hour">1 Giờ</option>
        <option value="day" selected>1 Ngày</option>
        <option value="week">1 Tuần</option>
        <option value="month">1 Tháng</option>
        <option value="forever">Vĩnh viễn</option>
      </select>
      <input id="count" type="number" value="1" min="1" max="100" style="width: 80px;" title="Số lượng">
      <input id="note" type="text" placeholder="Ghi chú (Tên khách, Zalo...)" style="flex:1;">
      <button onclick="createKey()">TẠO KEY</button>
      <button class="btn-gray" onclick="loadList()">TẢI LẠI DS</button>
    </div>
    <div id="out">Sẵn sàng...</div>
  </div>

  <div class="box">
    <table id="tbl">
      <thead>
        <tr>
          <th>Key</th>
          <th>Hạn dùng</th>
          <th>Thiết bị</th>
          <th>Ghi chú</th>
          <th>Xóa</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

  <script>
    async function createKey(){
      const pass = document.getElementById('pass').value;
      if(!pass) { alert("Vui lòng nhập mật khẩu Admin!"); return; }
      
      const body = {
        type: document.getElementById('type').value,
        count: +document.getElementById('count').value,
        note: document.getElementById('note').value
      };
      
      const btn = event.target;
      btn.innerText = "ĐANG TẠO..."; btn.disabled = true;

      try {
        const r = await fetch('/api/create', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'x-admin-pass': pass},
          body: JSON.stringify(body)
        });
        const d = await r.json();
        
        if(d.ok) {
          document.getElementById('out').innerHTML = \`<span style="color:#00ff88">Đã tạo thành công \${d.created.length} key!</span>\`;
          document.getElementById('note').value = '';
          loadList();
        } else {
          document.getElementById('out').innerHTML = \`<span style="color:#ff3366">Lỗi: \${d.error}</span>\`;
        }
      } catch(e) {
        document.getElementById('out').innerHTML = \`<span style="color:#ff3366">Lỗi kết nối Server!</span>\`;
      }
      
      btn.innerText = "TẠO KEY"; btn.disabled = false;
    }

    async function loadList(){
      const pass = document.getElementById('pass').value;
      if(!pass) { alert("Vui lòng nhập mật khẩu Admin!"); return; }
      
      try {
        const r = await fetch('/api/list?pass=' + encodeURIComponent(pass));
        const d = await r.json();
        const tb = document.querySelector('#tbl tbody');
        tb.innerHTML = '';
        
        if(!d.ok) {
          document.getElementById('out').innerHTML = \`<span style="color:#ff3366">Lỗi: \${d.error}</span>\`;
          return;
        }
        
        if(d.keys.length === 0) {
          tb.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#5e7a94;">Chưa có key nào</td></tr>';
          return;
        }

        d.keys.forEach(k => {
          const tr = document.createElement('tr');
          const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleString('vi-VN') : '<span style="color:#00f0ff">∞ Vĩnh viễn</span>';
          const dev = k.deviceId ? \`<span class="status-used">\${k.deviceId.slice(0,12)}...</span>\` : '<span class="status-new">Chưa dùng</span>';
          
          tr.innerHTML = \`
            <td class="key-text">\${k.key}</td>
            <td>\${exp}</td>
            <td>\${dev}</td>
            <td style="color:#5e7a94; font-size:12px;">\${k.note || '—'}</td>
            <td><button class="btn-red" onclick="delKey('\${k.key}')">Xóa</button></td>
          \`;
          tb.appendChild(tr);
        });
        document.getElementById('out').innerHTML = \`<span style="color:#00f0ff">Đã tải \${d.keys.length} key.</span>\`;
      } catch(e) {
        document.getElementById('out').innerHTML = \`<span style="color:#ff3366">Lỗi kết nối Server!</span>\`;
      }
    }

    async function delKey(key){
      if(!confirm("Bạn có chắc muốn xóa key: " + key + " không?")) return;
      const pass = document.getElementById('pass').value;
      await fetch('/api/delete/' + key + '?pass=' + encodeURIComponent(pass), {method: 'DELETE'});
      loadList();
    }
  </script>
</body>
</html>`);
});

// Trang chủ mặc định
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Innova Key Server', status: 'Running' });
});

// Khởi động Server
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`⚡ INNOVA KEY SERVER ĐANG CHẠY`);
  console.log(`👉 Cổng: ${PORT}`);
  console.log(`🔑 Mật khẩu Admin: ${ADMIN_PASSWORD}`);
  console.log(`=================================`);
});
