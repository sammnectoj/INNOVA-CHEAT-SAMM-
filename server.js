const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ THÔNG TIN SUPABASE
const SUPABASE_URL = 'https://llvlcqfievwtvylsqslm.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_37lYwmdntFwHgspQ7b3vgA_Jna_S5r1'; 

// ✅ TOKEN ADMIN (Đã fix cứng theo yêu cầu)
const ADMIN_TOKEN = 'headlock-admin-2025';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Giới hạn thực tế mỗi lần tạo (tránh sập DB), muốn thêm nhiều thì bấm nhiều lần
const MAX_KEYS_PER_REQUEST = 10000;
const INSERT_BATCH_SIZE = 500;

function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INNOVA-${part()}-${part()}-${part()}`;
}

function calcExpiry(type) {
  const now = Date.now();
  const HOUR = 3600 * 1000, DAY = 24 * HOUR;
  switch (type) {
    case 'hour':  return now + HOUR;
    case 'hour5': return now + 5 * HOUR;
    case 'hour10': return now + 10 * HOUR;
    case 'day':   return now + DAY;
    case 'week':  return now + 7 * DAY;
    case 'month': return now + 30 * DAY;
    case 'forever': return null;
    default: return null;
  }
}

// Middleware xác thực admin
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized - thiếu hoặc sai admin token' });
  }
  next();
}

// Hàm insert key theo batch
async function bulkInsertKeys(totalCount, buildRow) {
  let inserted = 0;
  for (let start = 0; start < totalCount; start += INSERT_BATCH_SIZE) {
    const size = Math.min(INSERT_BATCH_SIZE, totalCount - start);
    const batch = [];
    for (let i = 0; i < size; i++) batch.push(buildRow());
    const { error } = await supabase.from('keys').insert(batch);
    if (error) {
      return { ok: false, inserted, error: error.message };
    }
    inserted += size;
  }
  return { ok: true, inserted };
}

// ================= API KHÁCH HÀNG =================
app.post('/api/shop/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: 'Thiếu thông tin' });
  const { data: exists } = await supabase.from('users').select('*').eq('username', username).single();
  if (exists) return res.json({ ok: false, error: 'Tài khoản đã tồn tại' });
  const { error } = await supabase.from('users').insert([{ username, password, balance: 0 }]);
  if (error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đăng ký thành công' });
});

app.post('/api/shop/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).eq('password', password).single();
  if (!user) return res.json({ ok: false, error: 'Sai tài khoản hoặc mật khẩu' });
  res.json({ ok: true, user: { username: user.username, balance: user.balance } });
});

app.get('/api/shop/notifications', async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5);
  res.json({ ok: true, notifications: data || [] });
});

app.post('/api/bot/buy-multiple', async (req, res) => {
  const { username, type, count, discount } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (!user) return res.json({ ok: false, error: 'Bạn chưa đăng nhập.' });

  let basePrice = 0;
  if (type === 'day') basePrice = 20000;
  else if (type === 'week') basePrice = 50000;
  else if (type === 'month') basePrice = 80000;
  else if (type === 'forever') basePrice = 200000;

  let finalPricePerKey = basePrice;
  if (discount && discount > 0) finalPricePerKey = basePrice - (basePrice * discount / 100);
  const totalPrice = finalPricePerKey * count;

  if (user.balance < totalPrice) return res.json({ ok: false, error: `Số dư không đủ.` });

  const { data: keyDatas } = await supabase.from('keys').select('*').eq('type', type).is('device_id', null).limit(count);
  if (!keyDatas || keyDatas.length < count) return res.json({ ok: false, error: `Kho chỉ còn ${keyDatas ? keyDatas.length : 0} Key.` });

  const newBalance = user.balance - totalPrice;
  await supabase.from('users').update({ balance: newBalance }).eq('username', username);

  const keysToReturn = [];
  for (let keyData of keyDatas) {
    await supabase.from('keys').update({ device_id: 'BOUGHT_' + username }).eq('key', keyData.key);
    keysToReturn.push(keyData.key);
  }
  res.json({ ok: true, keys: keysToReturn, totalPrice, newBalance });
});

app.get('/api/bot/lixi', async (req, res) => {
  const rand = Math.random() * 100;
  let type = 'hour', name = '1 Giờ';
  if (rand > 99.5) { type = 'day'; name = '24 Giờ (Cực hiếm)'; }
  else if (rand > 90) { type = 'hour10'; name = '10 Giờ'; }
  else if (rand > 70) { type = 'hour5'; name = '5 Giờ'; }

  const newKey = generateKey();
  const item = { key: newKey, type, created_at: Date.now(), expires_at: calcExpiry(type), note: 'Lì xì', device_id: null };
  await supabase.from('keys').insert([item]);
  res.json({ ok: true, key: newKey, name });
});

app.get('/api/bot/my-keys', async (req, res) => {
  const { username } = req.query;
  const { data } = await supabase.from('keys').select('*').eq('device_id', 'BOUGHT_' + username).order('created_at', { ascending: false });
  res.json({ ok: true, keys: data || [] });
});

app.post('/api/shop/topup', async (req, res) => {
  const { username, amount } = req.body;
  const { error } = await supabase.from('topups').insert([{ username, amount: parseInt(amount), created_at: Date.now(), status: 'pending' }]);
  if (error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đã gửi yêu cầu' });
});

app.post('/api/shop/check-coupon', async (req, res) => {
  const { code } = req.body;
  const { data } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase()).single();
  if (!data || data.status !== 'active') return res.json({ ok: false, error: 'Mã không hợp lệ' });
  if (data.used_count >= data.max_uses) return res.json({ ok: false, error: 'Mã đã hết lượt' });
  res.json({ ok: true, discount: data.discount });
});

app.get('/api/shop/check-topup-status', async (req, res) => {
  const { username } = req.query;
  const { data: topups } = await supabase.from('topups').select('*').eq('username', username).order('created_at', { ascending: false }).limit(1);
  if (!topups || topups.length === 0) return res.json({ ok: true, status: 'none' });
  const latest = topups[0];
  if (latest.status === 'success') {
    const { data: user } = await supabase.from('users').select('balance').eq('username', username).single();
    return res.json({ ok: true, status: 'success', newBalance: user ? user.balance : 0 });
  }
  res.json({ ok: true, status: latest.status });
});

// ================= API XÁC THỰC =================
app.post('/api/verify', async (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ ok: false, error: 'Thiếu thông tin' });
  const { data: found } = await supabase.from('keys').select('*').eq('key', key.toUpperCase().trim()).single();

  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  if (found.device_id && found.device_id.startsWith('BOUGHT_')) {
    if (found.expires_at && Date.now() > found.expires_at) return res.json({ ok: false, error: 'Key đã hết hạn' });
    return res.json({ ok: true, type: found.type, isForever: !found.expires_at, remainingMs: found.expires_at ? Math.max(0, found.expires_at - Date.now()) : null });
  }
  if (found.expires_at && Date.now() > found.expires_at) return res.json({ ok: false, error: 'Key đã hết hạn' });
  if (found.device_id && found.device_id !== deviceId) return res.json({ ok: false, error: 'Key đã dùng trên thiết bị khác' });
  if (!found.device_id) await supabase.from('keys').update({ device_id: deviceId }).eq('key', found.key);
  res.json({ ok: true, type: found.type, isForever: !found.expires_at, remainingMs: found.expires_at ? Math.max(0, found.expires_at - Date.now()) : null });
});

// ================= ADMIN API =================

// 1. Thêm Key Vào Shop
app.post('/api/admin/add-shop-key', adminAuth, async (req, res) => {
  try {
    const { type, count } = req.body;
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) return res.json({ ok: false, error: 'Số lượng không hợp lệ' });
    if (n > MAX_KEYS_PER_REQUEST) return res.json({ ok: false, error: `Tối đa ${MAX_KEYS_PER_REQUEST} key mỗi lần.` });

    let price = 0, name = '';
    if      (type === 'day')     { price = 20000;  name = 'Key 1 Ngày'; }
    else if (type === 'week')    { price = 50000;  name = 'Key 1 Tuần'; }
    else if (type === 'month')   { price = 80000;  name = 'Key 1 Tháng'; }
    else if (type === 'forever') { price = 200000; name = 'Key Vĩnh Viễn'; }
    else return res.json({ ok: false, error: 'Loại key không hợp lệ' });

    const result = await bulkInsertKeys(n, () => ({
      key: generateKey(), type, created_at: Date.now(), expires_at: calcExpiry(type),
      note: 'Shop Item', device_id: null, name, image: '', price
    }));

    if (!result.ok) {
      return res.json({ ok: false, error: `Đã thêm ${result.inserted} key rồi lỗi: ${result.error}. Kiểm tra bảng 'keys' có đủ cột name/image/price chưa.` });
    }
    res.json({ ok: true, count: result.inserted });
  } catch (e) {
    res.json({ ok: false, error: 'Server error: ' + e.message });
  }
});

// 2. Nạp Tiền Trực Tiếp Cho User
app.post('/api/admin/grant-balance', adminAuth, async (req, res) => {
  try {
    const { username, amount } = req.body;
    const amt = Math.floor(Number(amount));
    if (!username || !Number.isFinite(amt) || amt <= 0) {
      return res.json({ ok: false, error: 'Thiếu tên user hoặc số tiền không hợp lệ' });
    }

    const { data: user, error: e1 } = await supabase.from('users').select('*').eq('username', username).single();
    if (e1 || !user) return res.json({ ok: false, error: 'Không tìm thấy user: ' + username });

    const newBalance = (user.balance || 0) + amt;
    const { error: e2 } = await supabase.from('users').update({ balance: newBalance }).eq('username', username);
    if (e2) return res.json({ ok: false, error: e2.message });

    try {
      await supabase.from('topups').insert([{ username, amount: amt, created_at: Date.now(), status: 'success' }]);
    } catch (_) {}

    res.json({ ok: true, username, newBalance });
  } catch (e) {
    res.json({ ok: false, error: 'Server error: ' + e.message });
  }
});

// 3. Các API Admin khác
app.get('/api/admin/users', adminAuth, async (req, res) => {
  const { data } = await supabase.from('users').select('*');
  res.json({ ok: true, users: data || [] });
});

app.get('/api/admin/topups', adminAuth, async (req, res) => {
  const { data } = await supabase.from('topups').select('*').order('created_at', { ascending: false });
  res.json({ ok: true, topups: data || [] });
});

app.post('/api/admin/approve-topup', adminAuth, async (req, res) => {
  const { id, username, amount } = req.body;
  await supabase.from('topups').update({ status: 'success' }).eq('id', id);
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (user) await supabase.from('users').update({ balance: user.balance + Number(amount) }).eq('username', username);
  res.json({ ok: true });
});

// 4. Tạo Key Thường (Không qua Shop)
app.post('/api/create', adminAuth, async (req, res) => {
  try {
    const { type = 'day', count = 1, note = '' } = req.body;
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) return res.json({ ok: false, error: 'Số lượng không hợp lệ' });
    if (n > MAX_KEYS_PER_REQUEST) return res.json({ ok: false, error: `Tối đa ${MAX_KEYS_PER_REQUEST} key mỗi lần.` });

    const result = await bulkInsertKeys(n, () => ({
      key: generateKey(), type, created_at: Date.now(), expires_at: calcExpiry(type),
      note: String(note).slice(0, 100), device_id: null
    }));

    if (!result.ok) return res.json({ ok: false, error: `Đã thêm ${result.inserted} rồi lỗi: ${result.error}` });
    res.json({ ok: true, inserted: result.inserted });
  } catch (e) {
    res.json({ ok: false, error: 'Server error: ' + e.message });
  }
});

app.get('/api/list', adminAuth, async (req, res) => {
  const { data } = await supabase.from('keys').select('*').order('created_at', { ascending: false });
  res.json({ ok: true, keys: data || [] });
});

app.delete('/api/delete/:key', adminAuth, async (req, res) => {
  await supabase.from('keys').delete().eq('key', req.params.key.toUpperCase());
  res.json({ ok: true });
});

// ================= GIAO DIỆN ADMIN =================
const adminHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Admin - Headlock</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
  body { background: #000; color: #ddd; padding: 20px; max-width: 1000px; margin: auto; }
  h1 { color: #fff; text-align: center; text-shadow: 0 0 10px rgba(255,255,255,0.3); letter-spacing: 2px; }
  .box { background: #0a0a0a; padding: 20px; border-radius: 16px; border: 1px solid #222; margin-bottom: 20px; box-shadow: 0 0 20px rgba(255,255,255,0.05); }
  input,select,button { padding: 12px; border-radius: 8px; border: 1px solid #333; background: #000; color: #fff; font-size: 14px; outline: none; margin-bottom: 5px; transition: 0.3s; }
  input:focus, select:focus { border-color: #fff; box-shadow: 0 0 10px rgba(255,255,255,0.1); }
  button { background: linear-gradient(135deg, #333, #111); color: #fff; font-weight: 800; cursor: pointer; border: 1px solid #444; transition: 0.2s; text-transform: uppercase; letter-spacing: 1px; }
  button:hover { background: #444; transform: scale(1.02); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-gray { background: #1a1a1a; color: #aaa; border: 1px solid #333; }
  .btn-gray:hover { background: #333; color: #fff; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px; align-items: flex-start; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; overflow-x: auto; display: block; margin-top: 10px; }
  th,td { padding: 12px 10px; border-bottom: 1px solid #1a1a1a; text-align: left; white-space: nowrap; }
  th { color: #888; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }
  .key { color: #00ff88; font-family: monospace; font-weight: bold; }
  .tabs { display:flex; flex-wrap: wrap; gap:10px; margin-bottom:20px; padding-bottom: 5px; }
  .tab { padding:12px 20px; background:#0a0a0a; border: 1px solid #222; border-radius:12px; cursor:pointer; font-weight:bold; white-space: nowrap; font-size: 13px; transition: 0.3s; color: #888; }
  .tab:hover { background: #1a1a1a; color: #fff; }
  .tab.active { background:#fff; color:#000; border-color: #fff; }
  .panel { display:none; }
  .panel.active { display:block; animation: fadeIn 0.3s ease; }
  @keyframes fadeIn { from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:translateY(0)} }
  .status-pending { color: #ffaa00; font-weight: bold; }
  .status-success { color: #00ff88; font-weight: bold; }
  .toast-msg { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; font-weight: bold; z-index: 1000; box-shadow: 0 0 20px rgba(0,0,0,0.8); display: none; text-align: center; border: 1px solid #333; max-width: 90%; }
  .toast-msg.success { background: #003311; color: #00ff88; border-color: #00ff88; display: block; }
  .toast-msg.error { background: #331111; color: #ff3366; border-color: #ff3366; display: block; }
</style>
</head>
<body>
<div class="toast-msg" id="toastMsg"></div>
<h1>⚡ HEADLOCK ADMIN ⚡</h1>

<div class="box">
  <div class="row">
    <input id="adminToken" type="password" placeholder="Nhập Admin Token" value="headlock-admin-2025" style="flex:1">
    <button id="btnSaveToken">LƯU TOKEN</button>
  </div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="tab-key">Quản Lý Key</div>
  <div class="tab" data-tab="tab-shop">Thêm Key Shop</div>
  <div class="tab" data-tab="tab-grant">Nạp Tiền Cho User</div>
  <div class="tab" data-tab="tab-user">Khách Hàng</div>
  <div class="tab" data-tab="tab-topup">Duyệt Nạp Tiền</div>
</div>

<div id="tab-key" class="panel active">
  <div class="box">
    <div class="row">
      <select id="type"><option value="hour">1 Giờ</option><option value="day" selected>1 Ngày</option><option value="week">1 Tuần</option><option value="month">1 Tháng</option><option value="forever">Vĩnh viễn</option></select>
      <input id="count" type="number" value="1" min="1" max="10000" style="width:100px">
      <input id="note" type="text" placeholder="Ghi chú" style="flex:1">
      <button id="btnCreateKey">TẠO KEY</button>
      <button class="btn-gray" id="btnLoadList">LOAD DS</button>
    </div>
    <table id="tbl"><thead><tr><th>Key</th><th>Hạn</th><th>Thiết bị</th><th>Ghi chú</th><th>Xóa</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="tab-shop" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#fff">Thêm Key Bán Trong Shop</h3>
    <div class="row">
      <select id="s_type" style="flex:1">
        <option value="day">Key 1 Ngày (20.000đ)</option>
        <option value="week">Key 1 Tuần (50.000đ)</option>
        <option value="month">Key 1 Tháng (80.000đ)</option>
        <option value="forever">Key Vĩnh Viễn (200.000đ)</option>
      </select>
      <input id="s_count" type="number" value="1" min="1" max="10000" style="width:120px" placeholder="Số lượng">
      <button id="btnAddShopKey">THÊM VÀO SHOP</button>
    </div>
    <div style="font-size:12px;color:#888;margin-top:8px">Tối đa 10.000 key/lần để tránh sập server. Muốn thêm nhiều hơn thì bấm nhiều lần.</div>
  </div>
</div>

<div id="tab-grant" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#00ff88">Cộng Số Dư Trực Tiếp Cho User</h3>
    <div class="row">
      <input id="g_username" type="text" placeholder="Tên user" style="flex:1">
      <input id="g_amount" type="number" min="1000" step="1000" placeholder="Số tiền (VNĐ)" style="width:180px">
      <button id="btnGrant">NẠP TIỀN</button>
    </div>
  </div>
</div>

<div id="tab-user" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#fff">Danh Sách Khách Hàng</h3>
    <button class="btn-gray" id="btnLoadUsers" style="margin-bottom:10px;">Tải Danh Sách</button>
    <table id="tbl-users"><thead><tr><th>Tài khoản</th><th>Số dư</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="tab-topup" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#ffaa00">Lịch Sử Nạp Tiền</h3>
    <button class="btn-gray" id="btnLoadTopups" style="margin-bottom:10px;">Tải Lịch Sử</button>
    <table id="tbl-topups"><thead><tr><th>Tài khoản</th><th>Số tiền</th><th>Thời gian</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<script>
function showMsg(text, isError) {
  var el = document.getElementById("toastMsg");
  el.textContent = text;
  el.className = "toast-msg " + (isError ? "error" : "success");
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.className = "toast-msg"; }, 4000);
}
function adminFetch(url, opts) {
  opts = opts || {};
  var token = document.getElementById('adminToken').value.trim() || 'headlock-admin-2025';
  opts.headers = Object.assign({}, opts.headers || {}, { 'x-admin-token': token });
  return fetch(url, opts);
}
function setupTabs() {
  var tabs = document.querySelectorAll(".tab");
  tabs.forEach(function(tab) {
    tab.addEventListener("click", function() {
      var id = this.getAttribute("data-tab");
      tabs.forEach(function(t) { t.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function(p) { p.classList.remove("active"); });
      this.classList.add("active");
      document.getElementById(id).classList.add("active");
    });
  });
}
async function createKey() {
  var btn = document.getElementById("btnCreateKey");
  btn.disabled = true; btn.innerText = "ĐANG TẠO...";
  try {
    var r = await adminFetch("/api/create", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ type: document.getElementById("type").value, count: +document.getElementById("count").value, note: document.getElementById("note").value })
    });
    var d = await r.json();
    if (d.ok) { showMsg("Đã tạo " + d.inserted + " Key!", false); loadList(); }
    else showMsg("Lỗi: " + d.error, true);
  } catch(e) { showMsg("Lỗi kết nối Server! " + e.message, true); }
  btn.disabled = false; btn.innerText = "TẠO KEY";
}
async function addShopKey() {
  var btn = document.getElementById("btnAddShopKey");
  btn.disabled = true; btn.innerText = "ĐANG THÊM...";
  try {
    var r = await adminFetch("/api/admin/add-shop-key", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ type: document.getElementById("s_type").value, count: +document.getElementById("s_count").value })
    });
    var d = await r.json();
    if (d.ok) showMsg("Đã thêm " + d.count + " Key vào Shop!", false);
    else showMsg("Lỗi: " + d.error, true);
  } catch(e) { showMsg("Lỗi kết nối Server! " + e.message, true); }
  btn.disabled = false; btn.innerText = "THÊM VÀO SHOP";
}
async function grantBalance() {
  var btn = document.getElementById("btnGrant");
  var username = document.getElementById("g_username").value.trim();
  var amount = +document.getElementById("g_amount").value;
  if (!username || !amount || amount <= 0) return showMsg("Nhập đủ tên + số tiền", true);
  btn.disabled = true; btn.innerText = "ĐANG NẠP...";
  try {
    var r = await adminFetch("/api/admin/grant-balance", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ username: username, amount: amount })
    });
    var d = await r.json();
    if (d.ok) {
      showMsg("Đã cộng " + amount.toLocaleString("vi-VN") + "đ cho " + d.username + ". Số dư mới: " + d.newBalance.toLocaleString("vi-VN") + "đ", false);
      document.getElementById("g_username").value = "";
      document.getElementById("g_amount").value = "";
    } else showMsg("Lỗi: " + d.error, true);
  } catch(e) { showMsg("Lỗi kết nối Server! " + e.message, true); }
  btn.disabled = false; btn.innerText = "NẠP TIỀN";
}
async function loadList() {
  try {
    var r = await adminFetch("/api/list");
    var d = await r.json();
    var tb = document.querySelector("#tbl tbody"); tb.innerHTML = "";
    if (d.ok) {
      if (d.keys.length === 0) tb.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#555;'>Chưa có Key nào</td></tr>";
      else d.keys.forEach(function(k) {
        var tr = document.createElement("tr");
        var exp = k.expires_at ? new Date(k.expires_at).toLocaleString("vi-VN") : "∞";
        var dev = k.device_id ? k.device_id.slice(0,15) : "<span style='color:#00ff88'>Trống</span>";
        tr.innerHTML = "<td class='key'>" + k.key + "</td><td>" + exp + "</td><td>" + dev + "</td><td>" + (k.note || "—") + "</td><td><button class='btnDelKey' data-key='" + k.key + "' style='background:#ff3366;padding:4px 8px;color:#fff;border:none;border-radius:5px;cursor:pointer;'>X</button></td>";
        tb.appendChild(tr);
      });
      document.querySelectorAll(".btnDelKey").forEach(function(b) {
        b.addEventListener("click", async function() {
          var key = this.getAttribute("data-key");
          await adminFetch("/api/delete/" + key, { method: "DELETE" });
          loadList();
        });
      });
      showMsg("Đã tải " + d.keys.length + " Key!", false);
    } else showMsg("Lỗi: " + d.error, true);
  } catch(e) { showMsg("Lỗi kết nối Server! " + e.message, true); }
}
async function loadUsers() {
  try {
    var r = await adminFetch("/api/admin/users");
    var d = await r.json();
    var tb = document.querySelector("#tbl-users tbody"); tb.innerHTML = "";
    if (d.ok) {
      if (d.users.length === 0) tb.innerHTML = "<tr><td colspan='2' style='text-align:center;color:#555;'>Chưa có khách hàng</td></tr>";
      else d.users.forEach(function(u) {
        tb.innerHTML += "<tr><td>" + u.username + "</td><td style='color:#00ff88'>" + u.balance.toLocaleString("vi-VN") + "đ</td></tr>";
      });
      showMsg("Đã tải " + d.users.length + " khách hàng!", false);
    } else showMsg("Lỗi: " + d.error, true);
  } catch(e) { showMsg("Lỗi kết nối Server! " + e.message, true); }
}
async function loadTopups() {
  try {
    var r = await adminFetch("/api/admin/topups");
    var d = await r.json();
    var tb = document.querySelector("#tbl-topups tbody"); tb.innerHTML = "";
    if (d.ok) {
      if (d.topups.length === 0) tb.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#555;'>Chưa có lịch sử nạp</td></tr>";
      else d.topups.forEach(function(t) {
        var statusHtml = t.status === "success" ? "<span class='status-success'>Đã duyệt</span>" : "<span class='status-pending'>Chờ duyệt</span>";
        var actionHtml = t.status === "success" ? "" : "<button class='btnApprove' data-id='" + t.id + "' data-user='" + t.username + "' data-amount='" + t.amount + "' style='background:#00ff88;padding:4px 8px;color:#000;border:none;border-radius:5px;cursor:pointer;'>DUYỆT</button>";
        tb.innerHTML += "<tr><td>" + t.username + "</td><td style='color:#ffaa00'>+" + t.amount.toLocaleString("vi-VN") + "đ</td><td>" + new Date(t.created_at).toLocaleString("vi-VN") + "</td><td>" + statusHtml + "</td><td>" + actionHtml + "</td></tr>";
      });
      document.querySelectorAll(".btnApprove").forEach(function(b) {
        b.addEventListener("click", async function() {
          var id = this.getAttribute("data-id");
          var username = this.getAttribute("data-user");
          var amount = this.getAttribute("data-amount");
          await adminFetch("/api/admin/approve-topup", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ id: id, username: username, amount: amount })
          });
          loadTopups();
        });
      });
      showMsg("Đã tải " + d.topups.length + " đơn nạp!", false);
    } else showMsg("Lỗi: " + d.error, true);
  } catch(e) { showMsg("Lỗi kết nối Server! " + e.message, true); }
}
document.addEventListener("DOMContentLoaded", function() {
  setupTabs();
  document.getElementById("btnCreateKey").addEventListener("click", createKey);
  document.getElementById("btnAddShopKey").addEventListener("click", addShopKey);
  document.getElementById("btnGrant").addEventListener("click", grantBalance);
  document.getElementById("btnLoadList").addEventListener("click", loadList);
  document.getElementById("btnLoadUsers").addEventListener("click", loadUsers);
  document.getElementById("btnLoadTopups").addEventListener("click", loadTopups);
});
</script>
</body>
</html>`;

app.get('/admin', (req, res) => res.send(adminHtml));
app.get('/', (req, res) => res.json({ ok: true, status: 'Running' }));
app.listen(PORT, () => console.log('Server chạy tại cổng ' + PORT));
