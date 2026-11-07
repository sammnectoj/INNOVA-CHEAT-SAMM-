const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chuoi_bi_mat_cua_ban';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_123';

// Khởi tạo database (file db.sqlite sẽ tự tạo)
const db = new Database('db.sqlite');

// Tạo bảng lưu Key
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    duration_ms INTEGER,   -- 0 là vĩnh viễn
    hwid TEXT,             -- Định danh thiết bị
    created_at INTEGER,
    activated_at INTEGER,
    expires_at INTEGER,
    is_active INTEGER DEFAULT 1
  );
`);

app.use(cors());
app.use(express.json());

// ================= API DÀNH CHO ADMIN (TẠO KEY) =================
app.post('/api/admin/create-key', (req, res) => {
  // Kiểm tra quyền Admin
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, message: 'Sai mã Admin' });
  }

  const { duration, count } = req.body;
  const timeUnits = { h: 3600000, d: 86400000, w: 604800000, m: 2592000000 };
  
  let ms = 0;
  if (duration !== 'forever') {
    const match = String(duration).match(/^(\d+)([hdwm])$/);
    if (!match) return res.status(400).json({ ok: false, message: 'Sai định dạng (VD: 1h, 7d, 30d, forever)' });
    ms = parseInt(match[1]) * timeUnits[match[2]];
  }

  const createdKeys = [];
  const insertStmt = db.prepare(`INSERT INTO licenses (key, duration_ms, created_at) VALUES (?, ?, ?)`);

  for (let i = 0; i < (count || 1); i++) {
    // Tạo key ngẫu nhiên dạng: APP-1234-ABCD-5678
    const randomPart = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    const newKey = `APP-${randomPart()}-${randomPart()}-${randomPart()}`;
    
    insertStmt.run(newKey, ms, Date.now());
    createdKeys.push(newKey);
  }

  res.json({ ok: true, message: 'Tạo thành công', keys: createdKeys });
});

// ================= API XÁC THỰC KEY (DÀNH CHO NGƯỜI DÙNG) =================
app.post('/api/verify-key', (req, res) => {
  const { key, hwid } = req.body;
  if (!key || !hwid) return res.status(400).json({ ok: false, message: 'Thiếu Key hoặc HWID' });

  const row = db.prepare(`SELECT * FROM licenses WHERE key = ? AND is_active = 1`).get(key.trim());

  if (!row) return res.status(404).json({ ok: false, message: 'Key không tồn tại hoặc đã bị khóa' });
  if (row.expires_at && row.expires_at < Date.now()) {
    return res.status(400).json({ ok: false, message: 'Key đã hết hạn' });
  }

  // Nếu key chưa ai dùng (hwid trống) -> Kích hoạt và gắn HWID
  if (!row.hwid) {
    const now = Date.now();
    const expires = row.duration_ms === 0 ? null : now + row.duration_ms;
    db.prepare(`UPDATE licenses SET hwid = ?, activated_at = ?, expires_at = ? WHERE id = ?`)
      .run(hwid, now, expires, row.id);
      
    const ticket = jwt.sign({ key: row.key, hwid }, JWT_SECRET, { expiresIn: '5m' });
    return res.json({ ok: true, ticket, message: 'Kích hoạt thành công' });
  }

  // Nếu key đã dùng -> Kiểm tra xem có đúng máy không
  if (row.hwid !== hwid) {
    return res.status(403).json({ ok: false, message: 'Key đã bị khóa trên thiết bị khác' });
  }

  // Hợp lệ
  const ticket = jwt.sign({ key: row.key, hwid }, JWT_SECRET, { expiresIn: '5m' });
  res.json({ ok: true, ticket, message: 'Xác thực thành công' });
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
