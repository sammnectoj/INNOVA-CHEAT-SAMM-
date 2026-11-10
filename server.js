const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'innova-admin-2024';

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
    case 'hour5': return now + 5 * HOUR;
    case 'hour10': return now + 10 * HOUR;
    case 'day':   return now + DAY;
    case 'week':  return now + 7 * DAY;
    case 'month': return now + 30 * DAY;
    case 'forever': return null;
    default: return null;
  }
}

// ================= API KHÁCH HÀNG =================
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

app.get('/api/shop/notifications', async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5);
  res.json({ ok: true, notifications: data || [] });
});

app.post('/api/bot/buy-multiple', async (req, res) => {
  const { username, type, count, discount } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if(!user) return res.json({ ok: false, error: 'Bạn chưa đăng nhập.' });

  let basePrice = 0;
  if(type === 'day') basePrice = 20000;
  else if(type === 'week') basePrice = 50000;
  else if(type === 'month') basePrice = 80000;
  else if(type === 'forever') basePrice = 200000;
  
  let finalPricePerKey = basePrice;
  if (discount && discount > 0) finalPricePerKey = basePrice - (basePrice * discount / 100);
  const totalPrice = finalPricePerKey * count;

  if(user.balance < totalPrice) return res.json({ ok: false, error: `Số dư không đủ.` });

  const { data: keyDatas } = await supabase.from('keys').select('*').eq('type', type).is('device_id', null).limit(count);
  if(!keyDatas || keyDatas.length < count) return res.json({ ok: false, error: `Kho chỉ còn ${keyDatas ? keyDatas.length : 0} Key.` });

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
  let type = 'hour';
  let name = '1 Giờ';
  if(rand > 99.5) { type = 'day'; name = '24 Giờ (Cực hiếm)'; }
  else if(rand > 90) { type = 'hour10'; name = '10 Giờ'; }
  else if(rand > 70) { type = 'hour5'; name = '5 Giờ'; }

  const newKey = generateKey();
  const item = { key: newKey, type: type, created_at: Date.now(), expires_at: calcExpiry(type), note: 'Lì xì', device_id: null };
  await supabase.from('keys').insert([item]);
  res.json({ ok: true, key: newKey, name: name });
});

app.get('/api/bot/my-keys', async (req, res) => {
  const { username } = req.query;
  const { data } = await supabase.from('keys').select('*').eq('device_id', 'BOUGHT_' + username).order('created_at', { ascending: false });
  res.json({ ok: true, keys: data || [] });
});

app.post('/api/shop/topup', async (req, res) => {
  const { username, amount } = req.body;
  const { error } = await supabase.from('topups').insert([{ username, amount: parseInt(amount), created_at: Date.now(), status: 'pending' }]);
  if(error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đã gửi yêu cầu' });
});

app.post('/api/shop/check-coupon', async (req, res) => {
  const { code } = req.body;
  const { data } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase()).single();
  if(!data || data.status !== 'active') return res.json({ ok: false, error: 'Mã không hợp lệ' });
  if(data.used_count >= data.max_uses) return res.json({ ok: false, error: 'Mã đã hết lượt' });
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
app.post('/api/admin/add-shop-key', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
  const { type, count } = req.body;
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 100);
  const created = [];
  let price = 0, name = '';
  if(type === 'day') { price = 20000; name = 'Key 1 Ngày'; }
  else if(type === 'week') { price = 50000; name = 'Key 1 Tuần'; }
  else if(type === 'month') { price = 80000; name = 'Key 1 Tháng'; }
  else if(type === 'forever') { price = 200000; name = 'Key Vĩnh Viễn'; }

  for (let i = 0; i < n; i++) {
    const item = { key: generateKey(), type, created_at: Date.now(), expires_at: calcExpiry(type), note: 'Shop Item', device_id: null, name: name, image: '', price: price };
    const { error } = await supabase.from('keys').insert([item]);
    if(!error) created.push(item);
  }
  res.json({ ok: true, count: created.length });
});

app.get('/api/admin/users', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
  const { data } = await supabase.from('users').select('*');
  res.json({ ok: true, users: data || [] });
});

app.get('/api/admin/topups', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
  const { data } = await supabase.from('topups').select('*').order('created_at', { ascending: false });
  res.json({ ok: true, topups: data || [] });
});

app.post('/api/admin/approve-topup', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
  const { id, username, amount } = req.body;
  await supabase.from('topups').update({ status: 'success' }).eq('id', id);
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if(user) await supabase.from('users').update({ balance: user.balance + amount }).eq('username', username);
  res.json({ ok: true });
});

app.post('/api/create', async (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
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

app.get('/api/list', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
  const { data } = await supabase.from('keys').select('*').order('created_at', { ascending: false });
  res.json({ ok: true, keys: data || [] });
});

app.delete('/api/delete/:key', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai pass' });
  await supabase.from('keys').delete().eq('key', req.params.key.toUpperCase());
  res.json({ ok: true });
});

// ================= GIAO DIỆN ADMIN MÀU XANH NEON =================
const adminHtml = '<!DOCTYPE html>' +
'<html lang="vi"><head><meta charset="utf-8"><title>Admin - Headlock</title>' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<style>' +
'  * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }' +
'  body { background: #050a05; color: #d0ffd0; padding: 20px; max-width: 1000px; margin: auto; }' +
'  h1 { color: #00ff88; text-align: center; text-shadow: 0 0 15px #00ff8880; letter-spacing: 2px; }' +
'  .box { background: rgba(10, 30, 15, 0.8); padding: 20px; border-radius: 16px; border: 1px solid rgba(0, 255, 136, 0.2); margin-bottom: 20px; box-shadow: 0 0 20px rgba(0,255,136,0.1); }' +
'  input,select,button { padding: 12px; border-radius: 8px; border: 1px solid rgba(0, 255, 136, 0.3); background: rgba(0,0,0,0.5); color: #fff; font-size: 14px; outline: none; margin-bottom: 5px; transition: 0.3s; }' +
'  input:focus, select:focus { border-color: #00ff88; box-shadow: 0 0 10px rgba(0,255,136,0.3); }' +
'  button { background: linear-gradient(135deg, #00ff88, #009944); color: #000; font-weight: 800; cursor: pointer; border: none; transition: 0.2s; text-transform: uppercase; letter-spacing: 1px;}' +
'  button:hover { transform: scale(1.02); box-shadow: 0 0 15px rgba(0,255,136,0.6); }' +
'  button:disabled { opacity: 0.5; cursor: not-allowed; }' +
'  .btn-gray { background: rgba(255,255,255,0.1); color: #d0ffd0; border: 1px solid #555; }' +
'  .btn-gray:hover { background: #fff; color: #000; }' +
'  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px; align-items: flex-start; }' +
'  table { width: 100%; border-collapse: collapse; font-size: 13px; overflow-x: auto; display: block; margin-top: 10px;}' +
'  th,td { padding: 12px 10px; border-bottom: 1px solid rgba(0, 255, 136, 0.1); text-align: left; white-space: nowrap; }' +
'  th { color: #00ff88; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }' +
'  .key { color: #00ff88; font-family: monospace; font-weight: bold; text-shadow: 0 0 5px rgba(0,255,136,0.5); }' +
'  .tabs { display:flex; flex-wrap: wrap; gap:10px; margin-bottom:20px; padding-bottom: 5px;}' +
'  .tab { padding:12px 20px; background:rgba(0,0,0,0.5); border: 1px solid rgba(0,255,136,0.2); border-radius:12px; cursor:pointer; font-weight:bold; white-space: nowrap; font-size: 13px; transition: 0.3s;}' +
'  .tab:hover { background: rgba(0,255,136,0.1); }' +
'  .tab.active { background:#00ff88; color:#000; box-shadow: 0 0 15px rgba(0,255,136,0.5); border-color: transparent; }' +
'  .panel { display:none; }' +
'  .panel.active { display:block; animation: fadeIn 0.3s ease; }' +
'  @keyframes fadeIn { from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:translateY(0)} }' +
'  .status-pending { color: #ffaa00; font-weight: bold; text-shadow: 0 0 5px rgba(255,170,0,0.5); }' +
'  .status-success { color: #00ff88; font-weight: bold; text-shadow: 0 0 5px rgba(0,255,136,0.5); }' +
'  .toast-msg { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; font-weight: bold; z-index: 1000; box-shadow: 0 0 20px rgba(0,0,0,0.5); display: none; text-align: center; }' +
'  .toast-msg.success { background: #00ff88; color: #000; display: block; }' +
'  .toast-msg.error { background: #ff3366; color: #fff; display: block; }' +
'</style></head><body>' +
'<div class="toast-msg" id="toastMsg"></div>' +
'<h1>⚡ HEADLOCK ADMIN ⚡</h1>' +
'<div class="row"><input id="pass" type="password" placeholder="Mật khẩu Admin..." style="flex:1"></div>' +
'<div class="tabs">' +
'  <div class="tab active" onclick="switchTab(this, \'tab-key\')">Quản Lý Key</div>' +
'  <div class="tab" onclick="switchTab(this, \'tab-shop\')">Thêm Key Shop</div>' +
'  <div class="tab" onclick="switchTab(this, \'tab-user\')">Khách Hàng</div>' +
'  <div class="tab" onclick="switchTab(this, \'tab-topup\')">Duyệt Nạp Tiền</div>' +
'</div>' +
'<div id="tab-key" class="panel active">' +
'  <div class="box">' +
'    <div class="row">' +
'      <select id="type"><option value="hour">1 Giờ</option><option value="day" selected>1 Ngày</option><option value="week">1 Tuần</option><option value="month">1 Tháng</option><option value="forever">Vĩnh viễn</option></select>' +
'      <input id="count" type="number" value="1" min="1" max="100" style="width:80px">' +
'      <input id="note" type="text" placeholder="Ghi chú" style="flex:1">' +
'      <button onclick="createKey(this)">TẠO KEY</button>' +
'      <button class="btn-gray" onclick="loadList()">LOAD DS</button>' +
'    </div>' +
'    <table id="tbl"><thead><tr><th>Key</th><th>Hạn</th><th>Thiết bị</th><th>Ghi chú</th><th>Xóa</th></tr></thead><tbody></tbody></table>' +
'  </div>' +
'</div>' +
'<div id="tab-shop" class="panel">' +
'  <div class="box">' +
'    <h3 style="margin-bottom:10px; color:#00ff88">Thêm Key Bán Trong Shop</h3>' +
'    <div class="row">' +
'      <select id="s_type" style="flex:1">' +
'        <option value="day">Key 1 Ngày (20.000đ)</option>' +
'        <option value="week">Key 1 Tuần (50.000đ)</option>' +
'        <option value="month">Key 1 Tháng (80.000đ)</option>' +
'        <option value="forever">Key Vĩnh Viễn (200.000đ)</option>' +
'      </select>' +
'      <input id="s_count" type="number" value="1" min="1" max="100" style="width:100px" placeholder="Số lượng">' +
'      <button onclick="addShopKey(this)">THÊM VÀO SHOP</button>' +
'    </div>' +
'  </div>' +
'</div>' +
'<div id="tab-user" class="panel">' +
'  <div class="box">' +
'    <h3 style="margin-bottom:10px; color:#00ff88">Danh Sách Khách Hàng</h3>' +
'    <button class="btn-gray" onclick="loadUsers()">Tải Danh Sách</button>' +
'    <table id="tbl-users" style="margin-top:10px"><thead><tr><th>Tài khoản</th><th>Số dư</th></tr></thead><tbody></tbody></table>' +
'  </div>' +
'</div>' +
'<div id="tab-topup" class="panel">' +
'  <div class="box">' +
'    <h3 style="margin-bottom:10px; color:#ffaa00">Lịch Sử Nạp Tiền</h3>' +
'    <button class="btn-gray" onclick="loadTopups()">Tải Lịch Sử</button>' +
'    <table id="tbl-topups" style="margin-top:10px"><thead><tr><th>Tài khoản</th><th>Số tiền</th><th>Thời gian</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody></tbody></table>' +
'  </div>' +
'</div>' +
'<script>' +
'function showMsg(text, isError) {' +
'  const el = document.getElementById("toastMsg");' +
'  el.textContent = text;' +
'  el.className = "toast-msg " + (isError ? "error" : "success");' +
'  setTimeout(() => { el.className = "toast-msg"; }, 3000);' +
'}' +
'function switchTab(element, id){' +
'  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));' +
'  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));' +
'  element.classList.add("active");' +
'  document.getElementById(id).classList.add("active");' +
'}' +
'function getPass(){ return document.getElementById("pass").value; }' +
'async function createKey(btn){' +
'  if(!getPass()) return showMsg("Vui lòng nhập mật khẩu Admin!", true);' +
'  btn.disabled = true; btn.innerText = "ĐANG TẠO...";' +
'  try {' +
'    const r = await fetch("/api/create",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pass":getPass()},body:JSON.stringify({type:document.getElementById("type").value,count:+document.getElementById("count").value,note:document.getElementById("note").value})});' +
'    const d = await r.json();' +
'    if(d.ok) { showMsg("Đã tạo "+d.created.length+" Key!", false); loadList(); }' +
'    else showMsg("Lỗi: "+d.error, true);' +
'  } catch(e) { showMsg("Lỗi kết nối Server!", true); }' +
'  btn.disabled = false; btn.innerText = "TẠO KEY";' +
'}' +
'async function addShopKey(btn){' +
'  if(!getPass()) return showMsg("Vui lòng nhập mật khẩu Admin!", true);' +
'  btn.disabled = true; btn.innerText = "ĐANG THÊM...";' +
'  try {' +
'    const r = await fetch("/api/admin/add-shop-key",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pass":getPass()},body:JSON.stringify({' +
'      type: document.getElementById("s_type").value,' +
'      count: document.getElementById("s_count").value' +
'    })});' +
'    const d = await r.json();' +
'    if(d.ok) showMsg("Đã thêm "+d.count+" Key vào Shop!", false);' +
'    else showMsg("Lỗi: "+d.error, true);' +
'  } catch(e) { showMsg("Lỗi kết nối Server!", true); }' +
'  btn.disabled = false; btn.innerText = "THÊM VÀO SHOP";' +
'}' +
'async function loadList(){' +
'  if(!getPass()) return;' +
'  const r = await fetch("/api/list?pass="+getPass());' +
'  const d = await r.json();' +
'  const tb=document.querySelector("#tbl tbody"); tb.innerHTML="";' +
'  if(d.ok) d.keys.forEach(k=>{' +
'    const tr=document.createElement("tr");' +
'    const exp = k.expires_at ? new Date(k.expires_at).toLocaleString("vi-VN") : "∞";' +
'    const dev = k.device_id ? k.device_id.slice(0,10) : "<span style=\'color:#00ff88\'>Trống</span>";' +
'    tr.innerHTML="<td class=\'key\'>"+k.key+"</td><td>"+exp+"</td><td>"+dev+"</td><td>"+(k.note||"—")+"</td><td><button style=\'background:#ff3366;padding:4px 8px;color:#fff\' onclick=\'delKey(\""+k.key+"\")\'>X</button></td>";' +
'    tb.appendChild(tr);' +
'  });' +
'}' +
'async function delKey(key){' +
'  await fetch("/api/delete/"+key+"?pass="+getPass(),{method:"DELETE"});' +
'  loadList();' +
'}' +
'async function loadUsers(){' +
'  if(!getPass()) return;' +
'  const r = await fetch("/api/admin/users?pass="+getPass());' +
'  const d = await r.json();' +
'  const tb=document.querySelector("#tbl-users tbody"); tb.innerHTML="";' +
'  if(d.ok) d.users.forEach(u=>{ tb.innerHTML += "<tr><td>"+u.username+"</td><td style=\'color:#00ff88\'>"+u.balance.toLocaleString("vi-VN")+"đ</td></tr>"; });' +
'}' +
'async function loadTopups(){' +
'  if(!getPass()) return;' +
'  const r = await fetch("/api/admin/topups?pass="+getPass());' +
'  const d = await r.json();' +
'  const tb=document.querySelector("#tbl-topups tbody"); tb.innerHTML="";' +
'  if(d.ok) d.topups.forEach(t=>{ ' +
'    let statusHtml = t.status === "success" ? "<span class=\'status-success\'>Đã duyệt</span>" : "<span class=\'status-pending\'>Chờ duyệt</span>";' +
'    let actionHtml = t.status === "success" ? "" : "<button style=\'background:#00ff88;padding:4px 8px;color:#000\' onclick=\'approveTopup("+t.id+", \""+t.username+"\", "+t.amount+")\'>DUYỆT</button>";' +
'    tb.innerHTML += "<tr><td>"+t.username+"</td><td style=\'color:#ffaa00\'>+"+t.amount.toLocaleString("vi-VN")+"đ</td><td>"+new Date(t.created_at).toLocaleString("vi-VN")+"</td><td>"+statusHtml+"</td><td>"+actionHtml+"</td></tr>"; ' +
'  });' +
'}' +
'async function approveTopup(id, username, amount){' +
'  const r = await fetch("/api/admin/approve-topup", {' +
'    method: "POST", headers: {"Content-Type": "application/json", "x-admin-pass": getPass()},' +
'    body: JSON.stringify({ id, username, amount })' +
'  });' +
'  const d = await r.json();' +
'  if(d.ok) { showMsg("Đã duyệt thành công!", false); loadTopups(); } ' +
'  else showMsg("Lỗi: " + d.error, true);' +
'}' +
'</script></body></html>';

app.get('/admin', (req, res) => { res.send(adminHtml); });
app.get('/', (req, res) => { res.json({ ok: true, status: 'Running' }); });
app.listen(PORT, () => console.log('Server chạy tại cổng ' + PORT));
