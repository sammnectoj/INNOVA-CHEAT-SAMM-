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

// Lấy thông báo mới nhất
app.get('/api/shop/notifications', async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(10);
  res.json({ ok: true, notifications: data || [] });
});

// Kiểm tra mã giảm giá
app.post('/api/shop/check-coupon', async (req, res) => {
  const { code } = req.body;
  const { data } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase()).single();
  
  if(!data || data.status !== 'active') return res.json({ ok: false, error: 'Mã không hợp lệ hoặc đã khóa' });
  if(data.used_count >= data.max_uses) return res.json({ ok: false, error: 'Mã đã hết lượt sử dụng' });
  res.json({ ok: true, discount: data.discount });
});

app.get('/api/shop/keys', async (req, res) => {
  const { data } = await supabase.from('keys').select('*').not('price', 'is', null).gt('price', 0).is('device_id', null);
  res.json({ ok: true, keys: data || [] });
});

app.post('/api/shop/buy', async (req, res) => {
  const { username, key, couponCode } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  const { data: keyData } = await supabase.from('keys').select('*').eq('key', key).single();

  if(!user || !keyData) return res.json({ ok: false, error: 'Lỗi dữ liệu' });
  
  let finalPrice = keyData.price;
  if(couponCode) {
    const { data: coupon } = await supabase.from('coupons').select('*').eq('code', couponCode.toUpperCase()).eq('status', 'active').single();
    if(coupon && coupon.used_count < coupon.max_uses) {
      const discountAmount = (finalPrice * coupon.discount) / 100;
      finalPrice = finalPrice - discountAmount;
      await supabase.from('coupons').update({ used_count: coupon.used_count + 1 }).eq('id', coupon.id);
    }
  }

  if(user.balance < finalPrice) return res.json({ ok: false, error: 'Số dư không đủ' });

  await supabase.from('users').update({ balance: user.balance - finalPrice }).eq('username', username);
  
  // SỬA LỖI TẠI ĐÂY: Đồng bộ chữ BOUGHT_ với hàm verify
  await supabase.from('keys').update({ device_id: 'BOUGHT_' + username }).eq('key', key);
  
  res.json({ ok: true, message: 'Mua thành công!', finalPrice });
});

app.post('/api/shop/topup', async (req, res) => {
  const { username, amount } = req.body;
  const { error } = await supabase.from('topups').insert([{ 
    username, amount: parseInt(amount), created_at: Date.now(), status: 'pending' 
  }]);
  if(error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, message: 'Đã gửi yêu cầu' });
});

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
  
  // TẠO THÔNG BÁO
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
  
  // TẠO THÔNG BÁO
  await supabase.from('notifications').insert([{ message: `SAMM VIP ĐÃ CẬP NHẬP MÃ GIẢM GIÁ MỚI: ${code.toUpperCase()}`, created_at: Date.now() }]);
  
  res.json({ ok: true });
});

app.delete('/api/admin/delete-coupon/:id', async (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
  await supabase.from('coupons').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// CÁC API CŨ
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

// SỬA LỖI VERIFY TẠI ĐÂY
app.post('/api/verify', async (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ ok: false, error: 'Thiếu key hoặc deviceId' });
  const { data: found } = await supabase.from('keys').select('*').eq('key', key.toUpperCase().trim()).single();
  
  if (!found) return res.json({ ok: false, error: 'Key không tồn tại' });
  
  // NẾU LÀ KEY MUA TỪ SHOP (BẮT ĐẦU BẰNG BOUGHT_) -> TỰ ĐỘNG CHO QUA
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

// GIAO DIỆN ADMIN (Giữ nguyên như cũ)
app.get('/admin', (req, res) => {
  // ... (Phần giao diện Admin giữ nguyên như đoạn code trước, bạn có thể copy lại từ tin nhắn trước)
  res.send(`<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0a0f17;color:#fff;font-family:sans-serif;padding:20px}</style>
</head><body>
<h1>⚡ INNOVA ADMIN ⚡</h1>
<p>Vui lòng sử dụng giao diện Admin đầy đủ từ tin nhắn trước.</p>
</body></html>`);
});

app.get('/', (req, res) => res.json({ ok: true, status: 'Running' }));
app.listen(PORT, () => console.log('Server chạy tại cổng ' + PORT));
