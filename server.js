const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'innova-admin-2024';

// ✅ THÔNG TIN SUPABASE
const SUPABASE_URL = 'https://llvlcqfievwtvylsqslm.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_37lYwmdntFwHgspQ7b3vgA_Jna_S5r1'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json());

function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INNOVA-${part()}-${part()}-${part()}`;
}

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

// ================= SHOP API =================
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

app.get('/api/shop/keys', async (req, res) => {
  const { data } = await supabase.from('keys').select('*').not('price', 'is', null).gt('price', 0).is('device_id', null);
  res.json({ ok: true, keys: data || [] });
});

app.post('/api/shop/buy', async (req, res) => {
  const { username, key } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  const { data: keyData } = await supabase.from('keys').select('*').eq('key', key).single();

  if(!user || !keyData) return res.json({ ok: false, error: 'Lỗi dữ liệu' });
  if(user.balance < keyData.price) return res.json({ ok: false, error: 'Số dư không đủ' });

  // Trừ tiền
  await supabase.from('users').update({ balance: user.balance - keyData.price }).eq('username', username);
  
  // Cập nhật key: đánh dấu đã bán cho user này (dùng device_id = 'BOUGHT_' + username)
  await supabase.from('keys').update({ device_id: 'BOUGHT_' + username }).eq('key', key);
  
  res.json({ ok: true, message: 'Mua thành công!' });
});

app.post('/api/shop/topup', async (req, res) => {
  const { username, amount } = req.body;
  const { error } = await supabase.from('topups').insert([{ 
    username, 
    amount: parseInt(amount), 
    created_at: Date.now(),
    status: 'pending' 
  }]);
  if(error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đã gửi yêu cầu' });
});

app.get('/api/shop/history', async (req, res) => {
  const { username } = req.query;
  const { data } = await supabase.from('keys').select('*').eq('device_id', 'BOUGHT_' + username);
  res.json({ ok: true, history: data || [] });
});

// ================= ADMIN API =================
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

// ================= CÁC API CŨ (ĐÃ SỬA LỖI) =================
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

app.post('/api/verify', async (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ ok: false, error: 'Thiếu key hoặc deviceId' });

  const { data: found } = await supabase.from('keys').select('*').eq('key', key.toUpperCase().trim()).single();
  
  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  
  // SỬA LỖI: Nếu Key được mua từ Shop, tự động mở khóa (không chặn thiết bị)
  if (found.device_id && found.device_id.startsWith('BOUGHT_')) {
    if (found.expires_at && Date.now() > found.expires_at) return res.json({ ok: false, error: 'Key đã hết hạn' });
    return res.json({ ok: true, type: found.type, isForever: !found.expires_at, remainingMs: found.expires_at ? Math.max(0, found.expires_at - Date.now()) : null });
  }

  if (found.expires_at && Date.now() > found.expires_at) return res.json({ ok: false, error: 'Key đã hết hạn' });
  if (found.device_id && found.device_id !== deviceId) return res.json({ ok: false, error: 'Key đã dùng trên thiết bị khác' });

  if (!found.device_id) await supabase.from('keys').update({ device_id: deviceId }).eq('key', found.key);
  res.json({ ok: true, type: found.type, isForever: !found.expires_at, remainingMs: found.expires_at ? Math.max(0, found.expires_at - Date.now()) : null });
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
<html lang="vi"><head><meta charset="utf-8"><title>Admin - Innova Shop</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; font-family: system-ui, sans-serif; }
  body { background: #0a0f17; color: #cfefff; padding: 20px; max-width: 900px; margin: auto; }
  h1 { color: #00f0ff; text-align: center; text-shadow: 0 0 10px #00f0ff80; }
  .box { background: #101a24; padding: 20px; border-radius: 12px; border: 1px solid #1a2a3d; margin-bottom: 20px; }
  input,select,button { padding: 10px; border-radius: 8px; border: 1px solid #2a3a4d; background: #0a0f17; color: #cfefff; font-size: 14px; outline: none; margin-bottom: 5px;}
  button { background: linear-gradient(135deg, #00f0ff, #0099cc); color: #001a22; font-weight: 800; cursor: pointer; border: none; transition: 0.2s;}
  button:hover { transform: scale(1.02); }
  .btn-gray { background: #2a3a4d; color: #fff; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px; align-items: flex-start; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; overflow-x: auto; display: block; }
  th,td { padding: 10px; border-bottom: 1px solid #1a2a3d; text-align: left; white-space: nowrap; }
  .key { color: #00ff88; font-family: monospace; font-weight: bold; }
  #msg { color: #00ff88; margin-top: 10px; font-weight: bold; }
  .tabs { display:flex; gap:10px; margin-bottom:20px; }
  .tab { padding:10px 20px; background:#1a2a3d; border-radius:8px; cursor:pointer; font-weight:bold;}
  .tab.active { background:#00f0ff; color:#000; }
  .panel { display:none; }
  .panel.active { display:block; }
  .status-pending { color: #ffaa00; font-weight: bold; }
  .status-success { color: #00ff88; font-weight: bold; }
</style></head><body>
<h1>⚡ INNOVA ADMIN ⚡</h1>
<div class="row"><input id="pass" type="password" placeholder="Mật khẩu Admin..." style="flex:1"></div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('tab-key')">Quản Lý Key</div>
  <div class="tab" onclick="switchTab('tab-shop')">Thêm Key Shop</div>
  <div class="tab" onclick="switchTab('tab-user')">Khách Hàng</div>
  <div class="tab" onclick="switchTab('tab-topup')">Duyệt Nạp Tiền</div>
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
    <table id="tbl-users" style="margin-top:10px"><thead><tr><th>Tài khoản</th><th>Số dư</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="tab-topup" class="panel">
  <div class="box">
    <h3 style="margin-bottom:10px; color:#ffaa00">Lịch Sử Nạp Tiền</h3>
    <button class="btn-gray" onclick="loadTopups()">Tải Lịch Sử</button>
    <table id="tbl-topups" style="margin-top:10px"><thead><tr><th>Tài khoản</th><th>Số tiền</th><th>Thời gian</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody></tbody></table>
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
    let statusHtml = t.status === 'success' ? '<span class="status-success">Đã duyệt</span>' : '<span class="status-pending">Chờ duyệt</span>';
    let actionHtml = t.status === 'success' ? '' : '<button style="background:#00ff88;padding:4px 8px;color:#000" onclick="approveTopup('+t.id+', \\''+t.username+'\\', '+t.amount+')">DUYỆT</button>';
    
    tb.innerHTML += '<tr><td>'+t.username+'</td><td style="color:#ffaa00">+'+t.amount.toLocaleString('vi-VN')+'đ</td><td>'+new Date(t.created_at).toLocaleString('vi-VN')+'</td><td>'+statusHtml+'</td><td>'+actionHtml+'</td></tr>'; 
  });
}

async function approveTopup(id, username, amount){
  if(!confirm('Xác nhận đã nhận được ' + amount.toLocaleString('vi-VN') + 'đ từ ' + username + '?')) return;
  const r = await fetch('/api/admin/approve-topup', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-admin-pass': getPass()},
    body: JSON.stringify({ id, username, amount })
  });
  const d = await r.json();
  if(d.ok) {
    alert('Đã duyệt thành công!');
    loadTopups();
  } else {
    alert('Lỗi: ' + d.error);
  }
}
</script></body></html>`);
});

app.get('/', (req, res) => res.json({ ok: true, status: 'Running' }));
app.listen(PORT, () => console.log('Server chạy tại cổng ' + PORT));
