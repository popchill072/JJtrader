// JJ TRADER - Cloudflare Worker API Backend
// Handles authentication, user data persistence via D1 Database

const ALLOWED_ORIGINS = [
  'https://jj-trader.pages.dev',
  'https://production.jj-trader.pages.dev',
  'http://localhost:8787',
  'http://localhost:3000',
  'http://127.0.0.1:8787',
  'http://127.0.0.1:5500',
];

function resolveCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return 'https://jj-trader.pages.dev';
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.pages.dev') || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return origin;
    }
  } catch {}
  return 'https://jj-trader.pages.dev';
}

function corsHeaders(request) {
  const origin = resolveCorsOrigin(request);
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Crypto helpers
function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const PBKDF2_ITERATIONS = 100000;

async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex}`;
}

async function verifyPin(pin, storedHash, salt) {
  const userSalt = salt || '_jj_trader_salt';
  if (storedHash && storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    const iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(userSalt), iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const hex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2$${iterations}$${hex}` === storedHash;
  }
  // Legacy SHA-256 fallback for accounts created before PBKDF2 upgrade
  const encoded = new TextEncoder().encode(pin + userSalt);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const legacyHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return legacyHex === storedHash;
}

function genId() {
  return crypto.randomUUID();
}

// Rate limiting (in-memory)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }
  entry.count++;
  return true;
}

// Get user from Authorization header
async function getUser(request, DB) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const now = new Date().toISOString();
  const row = await DB.prepare(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?'
  ).bind(token, now).first();
  return row || null;
}

export default {
  async fetch(request, env) {
    const { DB } = env;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;

    // Handle OPTIONS Preflight
    if (method === 'OPTIONS') {
      const cors = corsHeaders(request);
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const cors = corsHeaders(request);
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const fail = (msg, status = 400) => respond({ error: msg }, status);

    try {

      // Root URL -> Render friendly status page with direct link to Web App
      if (path === '/' || path === '' || path === '/index.html') {
        return new Response(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>JJ Trader API Server - Active</title>
  <style>
    body { background: #080a0f; color: #d4af37; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: rgba(18,22,32,0.95); border: 1px solid rgba(212,175,55,0.4); padding: 40px; border-radius: 20px; box-shadow: 0 0 40px rgba(212,175,55,0.2); max-width: 450px; }
    h1 { margin-top: 0; font-size: 24px; letter-spacing: 2px; }
    p { color: #ccc; font-size: 14px; line-height: 1.6; }
    a { display: inline-block; margin-top: 16px; padding: 12px 24px; background: linear-gradient(135deg, #ffd700, #d4af37); color: #000; text-decoration: none; font-weight: bold; border-radius: 10px; box-shadow: 0 0 15px rgba(255,215,0,0.3); }
  </style>
</head>
<body>
  <div class="card">
    <h1>👑 JJ TRADER API SERVER</h1>
    <p style="color: #00e676; font-weight: bold;">● สถานะเซิร์ฟเวอร์: ออนไลน์ปกติ (Cloudflare D1 Active)</p>
    <p>นี่คือลิงก์เซิร์ฟเวอร์ API สำหรับเชื่อมต่อข้อมูล หากต้องการเปิดหน้าเว็บแอปพลิเคชันหลัก ให้กดปุ่มด้านล่างได้เลยครับ:</p>
    <a href="https://jj-trader.pages.dev">🚀 เปิดใช้งานเว็บแอป JJ TRADER</a>
  </div>
</body>
</html>`, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(request) }
        });
      }

      // ── FOREXFACTORY NEWS API ─────────────────────────
      if (path === '/api/news' && method === 'GET') {
        const period = url.searchParams.get('period') || 'thisweek';
        
        let targetUrl = 'https://nfp.forexfactory.com/fetch.php';
        if (period === 'yesterday') {
          targetUrl = 'https://nfp.forexfactory.com/fetch.php?period=yesterday';
        } else if (period === 'today') {
          targetUrl = 'https://nfp.forexfactory.com/fetch.php?period=today';
        } else if (period === 'nextweek') {
          targetUrl = 'https://nfp.forexfactory.com/fetch.php?period=nextweek';
        }

        try {
          const ffRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (ffRes.ok) {
            const data = await ffRes.json();
            return respond(data);
          }
        } catch (e) {}

        // Dynamic fallback mock data with timestamps based on requested period
        const now = new Date();
        const buildDate = (offsetDays, hours, mins) => {
          const d = new Date(now);
          d.setDate(d.getDate() + offsetDays);
          d.setHours(hours, mins, 0, 0);
          return d.toISOString();
        };

        const dayOffset = period === 'yesterday' ? -1 : (period === 'nextweek' ? 7 : (period === 'today' ? 0 : 0));
        const mockData = [
          { title: "CPI m/m (ดัชนีราคาผู้บริโภค)", country: "USD", date: buildDate(dayOffset, 19, 30), impact: "High", forecast: "0.3%", previous: "0.2%" },
          { title: "Core CPI m/m", country: "USD", date: buildDate(dayOffset, 19, 30), impact: "High", forecast: "0.2%", previous: "0.2%" },
          { title: "Unemployment Claims (สวัสดิการว่างงาน)", country: "USD", date: buildDate(dayOffset, 19, 30), impact: "Medium", forecast: "225K", previous: "222K" },
          { title: "Flash Manufacturing PMI", country: "EUR", date: buildDate(dayOffset, 15, 0), impact: "High", forecast: "45.8", previous: "45.6" },
          { title: "Retail Sales m/m (ยอดค้าปลีก)", country: "GBP", date: buildDate(dayOffset, 13, 0), impact: "Medium", forecast: "0.5%", previous: "-0.7%" },
          { title: "FOMC Member Speaks", country: "USD", date: buildDate(dayOffset, 21, 0), impact: "High", forecast: "-", previous: "-" },
          { title: "Crude Oil Inventories (สต็อกน้ำมัน)", country: "USD", date: buildDate(dayOffset, 21, 30), impact: "Medium", forecast: "-1.5M", previous: "+0.8M" }
        ];
        return new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json', 'X-Mock-Data': 'true' }
        });
      }

      // ── AUTH (Rate Limited) ──────────────────────────
      // POST /api/auth/register { username, pin, email }
      if (path === '/api/auth/register' && method === 'POST') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return fail('⚠️ มีการลงทะเบียนบ่อยเกินไป กรุณารอสักครู่ แล้วลองใหม่อีกครั้ง', 429);
        }

        const { username, pin, email } = await request.json();
        if (!username || !pin || String(pin).trim().length < 4) {
          return fail('กรุณากรอกชื่อผู้ใช้ และ PIN (อย่างน้อย 4 หลัก) ให้ครบถ้วนครับ');
        }
        if (!email || !email.includes('@')) {
          return fail('กรุณากรอก อีเมล (Email) ให้ถูกต้องครับ');
        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        const existing = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(cleanUsername).first();
        if (existing) {
          return fail('❌ ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาใช้ชื่ออื่น หรือกดสลับไปหน้าเข้าสู่ระบบ', 400);
        }

        const salt = generateSalt();
        const pinHash = await hashPin(String(pin).trim(), salt);
        const newId = genId();
        
        try {
          await DB.prepare('INSERT INTO users (id, username, pin_hash, salt, email) VALUES (?, ?, ?, ?, ?)').bind(newId, cleanUsername, pinHash, salt, cleanEmail).run();
        } catch(e) {
          // Fallback if email/salt columns not yet in users table schema
          await DB.prepare('INSERT INTO users (id, username, pin_hash) VALUES (?, ?, ?)').bind(newId, cleanUsername, pinHash).run();
        }
        
        await DB.prepare('INSERT INTO preferences (user_id) VALUES (?)').bind(newId).run();

        // Create session (30 days)
        const token = genId();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, newId, expires).run();

        return respond({ token, username: cleanUsername, message: 'สมัครสมาชิกสำเร็จ!' });
      }

      // POST /api/auth/login  { username, pin }
      if (path === '/api/auth/login' && method === 'POST') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return fail('⚠️ มีการขอเข้าใช้ระบบบ่อยเกินไป กรุณารอสักครู่ แล้วลองใหม่อีกครั้ง', 429);
        }

        const { username, pin } = await request.json();
        if (!username || !pin || String(pin).trim().length < 4) {
          return fail('กรุณากรอกชื่อผู้ใช้และ PIN (อย่างน้อย 4 หลัก) ครับ');
        }

        // Check if user exists (need salt)
        let user = await DB.prepare('SELECT id, pin_hash, salt FROM users WHERE username = ?').bind(username.trim()).first();
        if (!user) {
          return fail('❌ ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 401);
        }

        // Use per-user salt if available; fallback for legacy accounts
        const valid = await verifyPin(String(pin).trim(), user.pin_hash, user.salt);
        if (!valid) {
          return fail('❌ ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 401);
        }

        // Create session (30 days)
        const token = genId();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expires).run();

        return respond({ token, username: username.trim() });
      }

    // All routes below require auth
    const user = await getUser(request, DB);
    if (!user && path.startsWith('/api/') && path !== '/api/auth/login') {
      return fail('กรุณาล็อกอินก่อนครับ', 401);
    }

    // ── PREFERENCES ──────────────────────────────────
    // GET /api/preferences
    if (path === '/api/preferences' && method === 'GET') {
      const prefs = await DB.prepare('SELECT * FROM preferences WHERE user_id = ?').bind(user.id).first();
      return respond(prefs || {});
    }

    // POST /api/preferences  { balance, risk_pct, timeframe, symbol }
    if (path === '/api/preferences' && method === 'POST') {
      const { balance, risk_pct, timeframe, symbol } = await request.json();
      await DB.prepare(`
        INSERT INTO preferences (user_id, balance, risk_pct, timeframe, symbol, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          balance = excluded.balance,
          risk_pct = excluded.risk_pct,
          timeframe = excluded.timeframe,
          symbol = excluded.symbol,
          updated_at = excluded.updated_at
      `).bind(user.id, balance, risk_pct, timeframe, symbol).run();
      return respond({ ok: true });
    }

    // ── NOTES ─────────────────────────────────────────
    // GET /api/notes
    if (path === '/api/notes' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
      return respond(results);
    }

    // POST /api/notes  { text }
    if (path === '/api/notes' && method === 'POST') {
      const { text } = await request.json();
      if (!text) return fail('ข้อความว่างครับ');
      const id = genId();
      const date = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
      await DB.prepare('INSERT INTO notes (id, user_id, text, date) VALUES (?, ?, ?, ?)').bind(id, user.id, text, date).run();
      return respond({ ok: true, id });
    }

    // DELETE /api/notes/:id
    if (path.startsWith('/api/notes/') && method === 'DELETE') {
      const noteId = path.split('/')[3];
      await DB.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(noteId, user.id).run();
      return respond({ ok: true });
    }

    // ── ALERTS ────────────────────────────────────────
    // GET /api/alerts
    if (path === '/api/alerts' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM alerts WHERE user_id = ? AND active = 1 ORDER BY created_at ASC').bind(user.id).all();
      return respond(results);
    }

    // POST /api/alerts  { symbol, target_price, condition }
    if (path === '/api/alerts' && method === 'POST') {
      const { symbol, target_price, condition } = await request.json();
      const price = parseFloat(target_price);
      if (!price || isNaN(price)) return fail('ราคาเป้าหมายว่างครับ');
      const id = genId();
      await DB.prepare('INSERT INTO alerts (id, user_id, symbol, target_price, condition, price) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, user.id, symbol || 'XAUUSD', price, condition || 'above', price).run();
      return respond({ ok: true, id });
    }

    // DELETE /api/alerts/:id
    if (path.startsWith('/api/alerts/') && method === 'DELETE') {
      const alertId = path.split('/')[3];
      await DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').bind(alertId, user.id).run();
      return respond({ ok: true });
    }

    // ── TRADE HISTORY ──────────────────────────────────
    // GET /api/history
    if (path === '/api/history' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM trade_history WHERE user_id = ? ORDER BY date DESC LIMIT 100').bind(user.id).all();
      return respond(results);
    }

    // POST /api/history  { symbol, direction, entry, close, sl, tp, lot, result, pnl, note }
    if (path === '/api/history' && method === 'POST') {
      const body = await request.json();
      const id = genId();
      const date = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
      await DB.prepare(`
        INSERT INTO trade_history (id, user_id, symbol, direction, entry, close, sl, tp, lot, result, pnl, note, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, user.id, body.symbol || 'XAUUSD', body.direction || 'BUY', body.entry, body.close, body.sl, body.tp, body.lot, body.result, body.pnl || 0, body.note || '', date).run();
      return respond({ ok: true, id });
    }

    // DELETE /api/history/:id
    if (path.startsWith('/api/history/') && method === 'DELETE') {
      const hId = path.split('/')[3];
      await DB.prepare('DELETE FROM trade_history WHERE id = ? AND user_id = ?').bind(hId, user.id).run();
      return respond({ ok: true });
    }

    return fail('ไม่พบ API endpoint นี้ครับ', 404);
    } catch (error) {
      return respond({ error: '⚠️ เซิร์ฟเวอร์มีข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง' }, 500);
    }
  }
};
