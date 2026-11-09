const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'innova-admin-2024';

// ✅ THÔNG TIN SUPABASE CỦA BẠN
const SUPABASE_URL = 'https://llvlcqfievwtvylsqslm.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_37lYwmdntFwHgspQ7b3vgA_Jna_S5r1'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json());

// Hàm tạo Key ngẫu nhiên
function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INNOVA-${part()}-${part()}-${part()}`;
}

// Hàm tính thời gian hết hạn
function calcExpiry(type) {
  const now = Date.now();
  const HOUR = 3600 * 1000, DAY = 24 * HOUR;
  switch (type) {
    case 'hour':  return now + HOUR;
    case 'day':   return now + DAY;
    case 'week':  return now + 7 * DAY;
    case 'month': return now + 30 * DAY;
    case 'forever': return null;
    default: return null;
  }
}

// ================= API DÀNH CHO KHÁCH HÀNG (SHOP) =================
app.post('/api/shop/register', async (req, res) => {
  const { username, password } = req.body;
  if(!username || !password) return res.json({ ok: false, error: 'Thiếu thông tin' });
  
  const { data: exists } = await supabase.from('users').select('*').eq('username', username).single();
  if(exists) return res.json({ ok: false, error: 'Tài khoản đã tồn tại' });

  const { error } = await supabase.from('users').insert([{ username, password, balance: 0 }]);
  if(error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đăng ký thành công' });
});

app.post('/api/shop/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).eq('password', password).single();
  if(!user) return res.json({ ok: false, error: 'Sai tài khoản hoặc mật khẩu' });
  res.json({ ok: true, user: { username: user.username, balance: user.balance } });
});

// Lấy thông báo (cho Chatbot)
app.get('/api/shop/notifications', async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5);
  res.json({ ok: true, notifications: data || [] });
});

// Chatbot mua Key
app.post('/api/bot/buy', async (req, res) => {
  const { username, type } = req.body;
  
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if(!user) return res.json({ ok: false, error: 'Bạn chưa đăng nhập hoặc tài khoản không tồn tại.' });

  let price = 0;
  let typeName = '';
  if(type === 'day') { price = 20000; typeName = '1 Ngày'; }
  else if(type === 'week') { price = 50000; typeName = '1 Tuần'; }
  else if(type === 'month') { price = 80000; typeName = '1 Tháng'; }
  else if(type === 'forever') { price = 200000; typeName = 'Vĩnh Viễn'; }
  else return res.json({ ok: false, error: 'Loại Key không hợp lệ.' });

  if(user.balance < price) {
    return res.json({ ok: false, error: `Số dư không đủ. Bạn cần thêm ${(price - user.balance).toLocaleString('vi-VN')}đ để mua Key ${typeName}.` });
  }

  // Lấy 1 Key trống trong kho
  const { data: keyData } = await supabase.from('keys').select('*').eq('type', type).is('device_id', null).limit(1).single();
  if(!keyData) return res.json({ ok: false, error: 'Rất tiếc, kho đã hết Key loại này. Vui lòng liên hệ Admin.' });

  // Trừ tiền và gán Key cho user
  await supabase.from('users').update({ balance: user.balance - price }).eq('username', username);
  await supabase.from('keys').update({ device_id: 'BOUGHT_' + username }).eq('key', keyData.key);

  res.json({ ok: true, key: keyData.key, price, typeName });
});

// Chatbot nạp tiền
app.post('/api/shop/topup', async (req, res) => {
  const { username, amount } = req.body;
  const { error } = await supabase.from('topups').insert([{ 
    username, amount: parseInt(amount), created_at: Date.now(), status: 'pending' 
  }]);
  if(error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đã gửi yêu cầu' });
});

// Kiểm tra trạng thái nạp (Polling cho Chatbot)
app.get('/api/shop/check-topup-status', async (req, res) => {
  const { username } = req.query;
  const { data: topups } = await supabase.from('topups')
    .select('*').eq('username', username).order('created_at', { ascending: false }).limit(1);

  if (!topups || topups.length === 0) return res.json({ ok: true, status: 'none' });
  const latest = topups[0];
  
  if (latest.status === 'success') {
    const { data: user } = await supabase.from('users').select('balance').eq('username', username).single();
    return res.json({ ok: true, status: 'success', newBalance: user ? user.balance : 0 });
  }
  res.json({ ok: true, status: latest.status });
});

// ================= API XÁC THỰC KEY =================
app.post('/api/verify', async (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ ok: false, error: 'Thiếu key hoặc deviceId' });
  const { data: found } = await supabase.from('keys').select('*').eq('key', key.toUpperCase().trim()).single();
  
  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  
  // Nếu là Key mua từ Shop/Chatbot -> Tự động cho qua
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
app.post('/api/create', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu Admin' });
  const { type = 'day', count = 1, note = '' } = req.body;
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 100);
  const created = [];
  for (let i = 0; i < n; i++) {
    const item = { key: generateKey(), type, created_at: Date.now(), expires_at: calcExpiry(type), note: String(note).slice(0, 100), device_id: null };
    await supabase.from('keys').insert([item]);
    created.push(item);
  }
  res.json({ ok: true, created });
});

app.post('/api/admin/add-shop-key', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });

  const { name, image, price, type } = req.body;
  const item = {
    key: generateKey(), type, created_at: Date.now(), expires_at: calcExpiry(type),
    note: 'Shop Item', device_id: null, name, image, price: parseInt(price)
  };
  
  const { error } = await supabase.from('keys').insert([item]);
  if(error) return res.json({ ok: false, error: error.message });
  
  await supabase.from('notifications').insert([{ message: `SAMM VIP ĐÃ THÊM 1 sản phẩm ${name}`, created_at: Date.now() }]);
  
  res.json({ ok: true, item });
});

app.get('/api/admin/users', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  const { data } = await supabase.from('users').select('*');
  res.json({ ok: true, users: data || [] });
});

app.get('/api/admin/topups', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  const { data } = await supabase.from('topups').select('*').order('created_at', { ascending: false });
  res.json({ ok: true, topups: data || [] });
});

app.post('/api/admin/approve-topup', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });

  const { id, username, amount } = req.body;
  await supabase.from('topups').update({ status: 'success' }).eq('id', id);
  
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if(user) {
    await supabase.from('users').update({ balance: user.balance + amount }).eq('username', username);
  }
  res.json({ ok: true });
});

app.post('/api/admin/edit-topup', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });

  const { id, amount, status, username } = req.body;
  const { data: oldTopup } = await supabase.from('topups').select('*').eq('id', id).single();
  if(!oldTopup) return res.json({ ok: false, error: 'Không tìm thấy đơn' });

  await supabase.from('topups').update({ amount: parseInt(amount), status }).eq('id', id);

  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if(user) {
    let balanceChange = 0;
    if(oldTopup.status !== 'success' && status === 'success') balanceChange = parseInt(amount);
    else if(oldTopup.status === 'success' && status !== 'success') balanceChange = -oldTopup.amount;
    else if(oldTopup.status === 'success' && status === 'success' && oldTopup.amount !== parseInt(amount)) balanceChange = parseInt(amount) - oldTopup.amount;

    if(balanceChange !== 0) await supabase.from('users').update({ balance: user.balance + balanceChange }).eq('username', username);
  }
  res.json({ ok: true });
});

app.get('/api/admin/coupons', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  const { data } = await supabase.from('coupons').select('*').order('id', { ascending: false });
  res.json({ ok: true, coupons: data || [] });
});

app.post('/api/admin/add-coupon', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });

  const { code, discount, max_uses } = req.body;
  const item = { code: code.toUpperCase(), discount: parseInt(discount), max_uses: parseInt(max_uses), used_count: 0, status: 'active' };
  
  const { error } = await supabase.from('coupons').insert([item]);
  if(error) return res.json({ ok: false, error: error.message });
  
  await supabase.from('notifications').insert([{ message: `SAMM VIP ĐÃ CẬP NHẬP MÃ GIẢM GIÁ MỚI: ${code.toUpperCase()}`, created_at: Date.now() }]);
  
  res.json({ ok: true });
});

app.delete('/api/admin/delete-coupon/:id', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  await supabase.from('coupons').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

app.get('/api/list', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  const { data } = await supabase.from('keys').select('*').order('created_at', { ascending: false });
  res.json({ ok: true, keys: data || [] });
});

app.delete('/api/delete/:key', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  await supabase.from('keys').delete().eq('key', req.params.key.toUpperCase());
  res.json({ ok: true });
});

// ================= GIAO DIỆN ADMIN =================
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Admin - Innova</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; font-family: system-ui, sans-serif; }
  body { background: #0a0f17; color: #cfefff; padding: 20px; max-width: 1000px; margin: auto; }
  h1 { color: #00f0ff; text-align: center; text-shadow: 0 0 10px #00f0ff80; }
  .box { background: #101a24; padding: 20px; border-radius: 12px; border: 1px solid #1a2a3d; margin-bottom: 20px; }
  input,select,button { padding: 10px; border-radius: 8px; border: 1px solid #2a3a4d; background: #0a0f17; color: #cfefff; font-size: 14px; outline: none; margin-bottom: 5px;}
  button { background: linear-gradient(135deg, #00f0ff, #0099cc); color: #001a22; font-weight: 800; cursor: pointer; border: none; transition: 0.2s;}
  button:hover { transform: scale(1.02); }
  .btn-gray { background: #2a3a4d; color: #fff; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px; align-items: flex-start; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; overflow-x: auto; display: block; margin-top: 10px;}
  th,td { padding: 10px; border-bottom: 1px solid #1a2a3d; text-align: left; white-space: nowrap; }
  .key { color: #00ff88; font-family: monospace; font-weight: bold; }
  .tabs { display:flex; gap:10px; margin-bottom:20px; overflow-x: auto; padding-bottom: 5px;}
  .tab { padding:10px 20px; background:#1a2a3d; border-radius:8px; cursor:pointer; font-weight:bold; white-space: nowrap;}
  .tab.active { background:#00f0ff; color:#000; }
  .panel { display:none; }
  .panel.active { display:block; }
  .status-pending { color: #ffaa00; font-weight: bold; }
  .status-success { color: #00ff88; font-weight: bold; }
  .status-cancel { color: #ff3366; font-weight: bold; }
  .modal-edit { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); align-items: center; justify-content: center; z-index: 100; }
  .modal-box { background: #101a24; padding: 20px; border-radius: 12px; border: 1px solid #00f0ff; width: 100%; max-width: 400px; }
</style></head><body>
<h1>⚡ INNOVA ADMIN ⚡</h1>
<div class="row"><input id="pass" type="password" placeholder="Mật khẩu Admin..." style="flex:1; max-width: 300px;"></div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('tab-key')">Quản Lý Key</div>
  <div class="tab" onclick="switchTab('tab-shop')">Thêm Key Shop</div>
  <div class="tab" onclick="switchTab('tab-user')">Khách Hàng</div>
  <div class="tab" onclick="switchTab('tab-topup')">Duyệt Nạp Tiền</div>
  <div class="tab" onclick="switchTab('tab-coupon')">Mã Giảm Giá</div>
</div>

<div class="modal-edit" id="editModal">
  <div class="modal-box">
    <h3 style="color:var(--neon); margin-bottom: 15px;">SỬA ĐƠN NẠP</h3>
    <input type="hidden" id="edit-id">
    <input type="hidden" id="edit-username">
    <div style="margin-bottom:10px;">
      <label style="font-size:12px;color:#8ba0b8">Số tiền (VNĐ)</label>
      <input type="number" id="edit-amount" class="form-input" style="width:100%">
    </div>
    <div style="margin-bottom:20px;">
      <label style="font-size:12px;color:#8ba0b8">Trạng thái</label>
      <select id="edit-status" class="form-input" style="width:100%">
        <option value="pending">Chờ duyệt</option>
        <option value="success">Thành công</option>
        <option value="cancel">Đã hủy</option>
      </select>
    </div>
    <div class="row" style="margin-bottom:0;">
      <button onclick="saveEditTopup()" style="flex:1; background:#00ff88;">LƯU THAY ĐỔI</button>
      <button onclick="document.getElementById('editModal').style.display='none'" style="flex:1; background:#ff3366;">HỦY</button>
    </div>
  </div>
</div>

<div id="tab-key" class="panel active">
  <div class="box">
    <div class="row">
      <select id="type"><option value="hour">1 Giờ</option><option value="day" selected>1 Ngày</option><option value="week">1 Tuần</option><option value="month">1 Tháng</option><option value="forever">Vĩnh viễn</option></select>
      <input id="count" type="number" value="1" min="1" max="100" style="width:80px">
      <input id="note" type="text" placeholder="Ghi chú" style="flex:1">
      <button onclick="createKey()">TẠO KEY</button>
      <button class="btn-gray" onclick="loadList()">LOAD DS</button>
    </div>
    <table id="tbl"><thead><tr><th>Key</th><th>Hạn</th><th>Thiết bị</th><th>Ghi chú</th><th>Xóa</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="tab-shop" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#00ff88">Thêm Key Bán Trong Shop</h3>
    <div class="row">
      <input id="s_name" type="text" placeholder="Tên gói (VD: Gói VIP 1 Tháng)" style="flex:1">
      <input id="s_price" type="number" placeholder="Giá tiền (VNĐ)" style="width:150px">
    </div>
    <div class="row">
      <input id="s_img" type="text" placeholder="Link ảnh (VD: https://...)" style="flex:1">
      <select id="s_type"><option value="day">1 Ngày</option><option value="week">1 Tuần</option><option value="month">1 Tháng</option><option value="forever">Vĩnh viễn</option></select>
      <button onclick="addShopKey()">THÊM VÀO SHOP</button>
    </div>
  </div>
</div>

<div id="tab-user" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#00ff88">Danh Sách Khách Hàng</h3>
    <button class="btn-gray" onclick="loadUsers()">Tải Danh Sách</button>
    <table id="tbl-users"><thead><tr><th>Tài khoản</th><th>Số dư</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="tab-topup" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#ffaa00">Lịch Sử Nạp Tiền</h3>
    <button class="btn-gray" onclick="loadTopups()">Tải Lịch Sử</button>
    <table id="tbl-topups"><thead><tr><th>Tài khoản</th><th>Số tiền</th><th>Thời gian</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="tab-coupon" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#ff00e5">Quản Lý Mã Giảm Giá</h3>
    <div class="row">
      <input id="c_code" type="text" placeholder="Mã (VD: GIAM20)" style="flex:1">
      <input id="c_discount" type="number" placeholder="Giảm (%)" style="width:100px">
      <input id="c_max" type="number" placeholder="Lượt dùng tối đa" style="width:150px">
      <button onclick="addCoupon()" style="background:linear-gradient(135deg, #ff00e5, #7000ff);">TẠO MÃ</button>
      <button class="btn-gray" onclick="loadCoupons()">LOAD DS</button>
    </div>
    <table id="tbl-coupons"><thead><tr><th>Mã</th><th>Giảm giá</th><th>Đã dùng</th><th>Tối đa</th><th>Trạng thái</th><th>Xóa</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<script>
function switchTab(id){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById(id).classList.add('active');
}
function getPass(){ return document.getElementById('pass').value; }

async function createKey(){
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/create',{method:'POST',headers:{'Content-Type':'application/json','x-admin-pass':getPass()},body:JSON.stringify({type:document.getElementById('type').value,count:+document.getElementById('count').value,note:document.getElementById('note').value})});
  const d = await r.json();
  alert(d.ok ? 'Tạo thành công!' : 'Lỗi: '+d.error);
  if(d.ok) loadList();
}

async function addShopKey(){
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/admin/add-shop-key',{method:'POST',headers:{'Content-Type':'application/json','x-admin-pass':getPass()},body:JSON.stringify({name:document.getElementById('s_name').value, image:document.getElementById('s_img').value, price:document.getElementById('s_price').value, type:document.getElementById('s_type').value})});
  const d = await r.json();
  alert(d.ok ? 'Đã thêm Key vào Shop!' : 'Lỗi: '+d.error);
}

async function loadList(){
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/list?pass='+getPass());
  const d = await r.json();
  const tb=document.querySelector('#tbl tbody'); tb.innerHTML='';
  if(d.ok) d.keys.forEach(k=>{
    const tr=document.createElement('tr');
    const exp = k.expires_at ? new Date(k.expires_at).toLocaleString('vi-VN') : '∞';
    const dev = k.device_id ? k.device_id.slice(0,15) : '<span style="color:#00ff88">Trống</span>';
    tr.innerHTML='<td class="key">'+k.key+'</td><td>'+exp+'</td><td>'+dev+'</td><td>'+(k.note||'—')+'</td><td><button style="background:#ff3366;padding:4px 8px;color:#fff" onclick="delKey(\\''+k.key+'\\')">X</button></td>';
    tb.appendChild(tr);
  });
}

async function delKey(key){
  await fetch('/api/delete/'+key+'?pass='+getPass(),{method:'DELETE'});
  loadList();
}

async function loadUsers(){
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/admin/users?pass='+getPass());
  const d = await r.json();
  const tb=document.querySelector('#tbl-users tbody'); tb.innerHTML='';
  if(d.ok) d.users.forEach(u=>{ tb.innerHTML += '<tr><td>'+u.username+'</td><td style="color:#00ff88">'+u.balance.toLocaleString('vi-VN')+'đ</td></tr>'; });
}

async function loadTopups(){
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/admin/topups?pass='+getPass());
  const d = await r.json();
  const tb=document.querySelector('#tbl-topups tbody'); tb.innerHTML='';
  if(d.ok) d.topups.forEach(t=>{ 
    let statusHtml = '';
    if(t.status === 'success') statusHtml = '<span class="status-success">Đã duyệt</span>';
    else if(t.status === 'cancel') statusHtml = '<span class="status-cancel">Đã hủy</span>';
    else statusHtml = '<span class="status-pending">Chờ duyệt</span>';
    
    let actionHtml = '';
    if(t.status === 'pending') {
      actionHtml = '<button style="background:#00ff88;padding:4px 8px;color:#000;margin-right:5px;" onclick="approveTopup('+t.id+', \\''+t.username+'\\', '+t.amount+')">DUYỆT</button>';
    }
    actionHtml += '<button style="background:#ffaa00;padding:4px 8px;color:#000;" onclick="openEditModal('+t.id+', \\''+t.username+'\\', '+t.amount+', \\''+t.status+'\\')">SỬA</button>';
    
    tb.innerHTML += '<tr><td>'+t.username+'</td><td style="color:#ffaa00">+'+t.amount.toLocaleString('vi-VN')+'đ</td><td>'+new Date(t.created_at).toLocaleString('vi-VN')+'</td><td>'+statusHtml+'</td><td>'+actionHtml+'</td></tr>'; 
  });
}

async function approveTopup(id, username, amount){
  if(!confirm('Xác nhận đã nhận được ' + amount.toLocaleString('vi-VN') + ' đ từ ' + username + '?')) return;
  const r = await fetch('/api/admin/approve-topup', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-admin-pass': getPass()},
    body: JSON.stringify({ id, username, amount })
  });
  const d = await r.json();
  if(d.ok) { alert('Đã duyệt thành công!'); loadTopups(); } 
  else alert('Lỗi: ' + d.error);
}

function openEditModal(id, username, amount, status) {
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-username').value = username;
  document.getElementById('edit-amount').value = amount;
  document.getElementById('edit-status').value = status;
  document.getElementById('editModal').style.display = 'flex';
}

async function saveEditTopup() {
  const id = document.getElementById('edit-id').value;
  const username = document.getElementById('edit-username').value;
  const amount = document.getElementById('edit-amount').value;
  const status = document.getElementById('edit-status').value;

  const r = await fetch('/api/admin/edit-topup', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-admin-pass': getPass()},
    body: JSON.stringify({ id, username, amount, status })
  });
  const d = await r.json();
  if(d.ok) {
    alert('Đã cập nhật đơn hàng!');
    document.getElementById('editModal').style.display = 'none';
    loadTopups();
  } else {
    alert('Lỗi: ' + d.error);
  }
}

async function addCoupon() {
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/admin/add-coupon', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-admin-pass': getPass()},
    body: JSON.stringify({ code: document.getElementById('c_code').value, discount: document.getElementById('c_discount').value, max_uses: document.getElementById('c_max').value })
  });
  const d = await r.json();
  alert(d.ok ? 'Đã tạo mã giảm giá!' : 'Lỗi: '+d.error);
  if(d.ok) loadCoupons();
}

async function loadCoupons() {
  if(!getPass()) return alert('Nhập pass!');
  const r = await fetch('/api/admin/coupons?pass='+getPass());
  const d = await r.json();
  const tb=document.querySelector('#tbl-coupons tbody'); tb.innerHTML='';
  if(d.ok) d.coupons.forEach(c=>{ 
    tb.innerHTML += '<tr><td style="color:#ff00e5;font-weight:bold">'+c.code+'</td><td>'+c.discount+'%</td><td>'+c.used_count+'</td><td>'+c.max_uses+'</td><td>'+c.status+'</td><td><button style="background:#ff3366;padding:4px 8px;color:#fff" onclick="delCoupon('+c.id+')">X</button></td></tr>'; 
  });
}

async function delCoupon(id) {
  if(!confirm('Xóa mã giảm giá này?')) return;
  await fetch('/api/admin/delete-coupon/'+id+'?pass='+getPass(),{method:'DELETE'});
  loadCoupons();
}
</script></body></html>`);
});

app.get('/', (req, res) => res.json({ ok: true, status: 'Running' }));
app.listen(PORT, () => console.log('Server chạy tại cổng ' + PORT));
