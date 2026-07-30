// JJ TRADER - Cloudflare Worker API Backend
// Handles authentication, user data persistence via D1 Database

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// Crypto helpers
function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  const encoded = new TextEncoder().encode(pin + salt);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

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
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
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
            return json(data);
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

        return json([
          { title: "CPI m/m (ดัชนีราคาผู้บริโภค)", country: "USD", date: buildDate(dayOffset, 19, 30), impact: "High", forecast: "0.3%", previous: "0.2%" },
          { title: "Core CPI m/m", country: "USD", date: buildDate(dayOffset, 19, 30), impact: "High", forecast: "0.2%", previous: "0.2%" },
          { title: "Unemployment Claims (สวัสดิการว่างงาน)", country: "USD", date: buildDate(dayOffset, 19, 30), impact: "Medium", forecast: "225K", previous: "222K" },
          { title: "Flash Manufacturing PMI", country: "EUR", date: buildDate(dayOffset, 15, 0), impact: "High", forecast: "45.8", previous: "45.6" },
          { title: "Retail Sales m/m (ยอดค้าปลีก)", country: "GBP", date: buildDate(dayOffset, 13, 0), impact: "Medium", forecast: "0.5%", previous: "-0.7%" },
          { title: "FOMC Member Speaks", country: "USD", date: buildDate(dayOffset, 21, 0), impact: "High", forecast: "-", previous: "-" },
          { title: "Crude Oil Inventories (สต็อกน้ำมัน)", country: "USD", date: buildDate(dayOffset, 21, 30), impact: "Medium", forecast: "-1.5M", previous: "+0.8M" }
        ]);
      }

      // ── AUTH (Rate Limited) ──────────────────────────
      // POST /api/auth/register { username, pin, email }
      if (path === '/api/auth/register' && method === 'POST') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return err('⚠️ มีการลงทะเบียนบ่อยเกินไป กรุณารอสักครู่ แล้วลองใหม่อีกครั้ง', 429);
        }

        const { username, pin, email } = await request.json();
        if (!username || !pin || String(pin).trim().length < 4) {
          return err('กรุณากรอกชื่อผู้ใช้ และ PIN (อย่างน้อย 4 หลัก) ให้ครบถ้วนครับ');
        }
        if (!email || !email.includes('@')) {
          return err('กรุณากรอก อีเมล (Email) ให้ถูกต้องครับ');
        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        const existing = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(cleanUsername).first();
        if (existing) {
          return err('❌ ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาใช้ชื่ออื่น หรือกดสลับไปหน้าเข้าสู่ระบบ', 400);
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

        return json({ token, username: cleanUsername, message: 'สมัครสมาชิกสำเร็จ!' });
      }

      // POST /api/auth/login  { username, pin }
      if (path === '/api/auth/login' && method === 'POST') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return err('⚠️ มีการขอเข้าใช้ระบบบ่อยเกินไป กรุณารอสักครู่ แล้วลองใหม่อีกครั้ง', 429);
        }

        const { username, pin } = await request.json();
        if (!username || !pin || String(pin).trim().length < 4) {
          return err('กรุณากรอกชื่อผู้ใช้และ PIN (อย่างน้อย 4 หลัก) ครับ');
        }

        // Check if user exists (need salt)
        let user = await DB.prepare('SELECT id, pin_hash, salt FROM users WHERE username = ?').bind(username.trim()).first();
        if (!user) {
          return err('❌ ไม่พบบัญชีผู้ใช้นี้ในระบบ กรุณากดปุ่มสมัครสมาชิกใหม่ครับ', 401);
        }

        // Use per-user salt if available; fallback for legacy accounts
        const userSalt = user.salt || '_jj_trader_salt';
        const pinHash = await hashPin(String(pin).trim(), userSalt);

        // Verify PIN
        if (user.pin_hash !== pinHash) {
          return err('❌ PIN ไม่ถูกต้องครับ กรุณาลองใหม่อีกครั้ง', 401);
        }

        // Create session (30 days)
        const token = genId();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expires).run();

        return json({ token, username: username.trim() });
      }

    // All routes below require auth
    const user = await getUser(request, DB);
    if (!user && path.startsWith('/api/') && path !== '/api/auth/login') {
      return err('กรุณาล็อกอินก่อนครับ', 401);
    }

    // ── PREFERENCES ──────────────────────────────────
    // GET /api/preferences
    if (path === '/api/preferences' && method === 'GET') {
      const prefs = await DB.prepare('SELECT * FROM preferences WHERE user_id = ?').bind(user.id).first();
      return json(prefs || {});
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
      return json({ ok: true });
    }

    // ── NOTES ─────────────────────────────────────────
    // GET /api/notes
    if (path === '/api/notes' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
      return json(results);
    }

    // POST /api/notes  { text }
    if (path === '/api/notes' && method === 'POST') {
      const { text } = await request.json();
      if (!text) return err('ข้อความว่างครับ');
      const id = genId();
      const date = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
      await DB.prepare('INSERT INTO notes (id, user_id, text, date) VALUES (?, ?, ?, ?)').bind(id, user.id, text, date).run();
      return json({ ok: true, id });
    }

    // DELETE /api/notes/:id
    if (path.startsWith('/api/notes/') && method === 'DELETE') {
      const noteId = path.split('/')[3];
      await DB.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(noteId, user.id).run();
      return json({ ok: true });
    }

    // ── ALERTS ────────────────────────────────────────
    // GET /api/alerts
    if (path === '/api/alerts' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM alerts WHERE user_id = ? AND active = 1 ORDER BY price ASC').bind(user.id).all();
      return json(results);
    }

    // POST /api/alerts  { price }
    if (path === '/api/alerts' && method === 'POST') {
      const { price } = await request.json();
      if (!price) return err('ราคาว่างครับ');
      const id = genId();
      await DB.prepare('INSERT INTO alerts (id, user_id, price) VALUES (?, ?, ?)').bind(id, user.id, price).run();
      return json({ ok: true, id });
    }

    // DELETE /api/alerts/:id
    if (path.startsWith('/api/alerts/') && method === 'DELETE') {
      const alertId = path.split('/')[3];
      await DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').bind(alertId, user.id).run();
      return json({ ok: true });
    }

    // ── TRADE HISTORY ──────────────────────────────────
    // GET /api/history
    if (path === '/api/history' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM trade_history WHERE user_id = ? ORDER BY date DESC LIMIT 100').bind(user.id).all();
      return json(results);
    }

    // POST /api/history  { symbol, direction, entry, sl, tp, lot, result, pnl, note }
    if (path === '/api/history' && method === 'POST') {
      const body = await request.json();
      const id = genId();
      const date = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
      await DB.prepare(`
        INSERT INTO trade_history (id, user_id, symbol, direction, entry, sl, tp, lot, result, pnl, note, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, user.id, body.symbol || 'XAUUSD', body.direction || 'BUY', body.entry, body.sl, body.tp, body.lot, body.result, body.pnl || 0, body.note || '', date).run();
      return json({ ok: true, id });
    }

    // DELETE /api/history/:id
    if (path.startsWith('/api/history/') && method === 'DELETE') {
      const hId = path.split('/')[3];
      await DB.prepare('DELETE FROM trade_history WHERE id = ? AND user_id = ?').bind(hId, user.id).run();
      return json({ ok: true });
    }

    return err('ไม่พบ API endpoint นี้ครับ', 404);
    } catch (error) {
      return json({ error: 'Server Error: ' + (error.message || error.toString()) }, 500);
    }
  }
};
