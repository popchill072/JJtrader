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

let newsCache = { data: null, ts: 0 };
const NEWS_CACHE_TTL = 60 * 1000;
const NEWS_DB_TTL = 30 * 60 * 1000;
const NEWS_HTTP_CACHE_URL = 'https://jj-trader-api/_news_thisweek.json';

const TV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TV_HEADERS = {
  'User-Agent': TV_UA,
  'Accept': 'application/json',
  'Referer': 'https://www.tradingview.com/',
  'Origin': 'https://www.tradingview.com',
};

async function fetchTradingViewNews() {
  const now = new Date();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 8);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 14);
  const url = `https://economic-calendar.tradingview.com/events?from=${fmt(from)}&to=${fmt(to)}`;
  const res = await fetch(url, { headers: TV_HEADERS });
  if (!res.ok) return null;
  const body = await res.json();
  if (body.status !== 'ok' || !Array.isArray(body.result)) return null;
  return body.result.map(item => ({
    title: item.title || item.indicator || '',
    country: item.country || '',
    date: item.date || item.referenceDate || null,
    impact: item.importance >= 1 ? 'High' : (item.importance === 0 ? 'Medium' : 'Low'),
    actual: item.actual != null ? `${item.actual}${item.unit || ''}` : '',
    forecast: item.forecast != null ? `${item.forecast}${item.unit || ''}` : '',
    previous: item.previous != null ? `${item.previous}${item.unit || ''}` : '',
  })).filter(item => item.title && item.date);
}

async function fetchForexNews(DB) {
  if (newsCache.data && Date.now() - newsCache.ts < NEWS_CACHE_TTL) {
    return { data: newsCache.data, isMock: false };
  }

  let staleData = null;
  const dbRow = await DB.prepare('SELECT payload, fetched_at FROM news_cache WHERE id = ?').bind('default').first();
  if (dbRow && dbRow.payload) {
    try {
      const parsed = JSON.parse(dbRow.payload);
      if (Array.isArray(parsed) && parsed.length) {
        if (Date.now() - dbRow.fetched_at < NEWS_DB_TTL) {
          newsCache = { data: parsed, ts: Date.now() };
          return { data: parsed, isMock: false };
        }
        staleData = parsed;
      }
    } catch (e) {}
  }

  const cache = caches.default;
  const cacheKey = new Request(NEWS_HTTP_CACHE_URL, { method: 'GET' });
  try {
    const cached = await cache.match(cacheKey);
    if (cached && cached.ok) {
      const parsed = await cached.json();
      if (Array.isArray(parsed) && parsed.length) {
        newsCache = { data: parsed, ts: Date.now() };
        return { data: parsed, isMock: false };
      }
    }
  } catch (e) {}

  let tvData = null;
  try { tvData = await fetchTradingViewNews(); } catch (e) {}

  if (tvData && tvData.length) {
    newsCache = { data: tvData, ts: Date.now() };
    try {
      await DB.prepare('INSERT INTO news_cache (id, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at')
        .bind('default', JSON.stringify(tvData), Date.now()).run();
    } catch (e) {}
    const cachedRes = new Response(JSON.stringify(tvData), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
    try { await cache.put(cacheKey, cachedRes); } catch (e) {}
    return { data: tvData, isMock: false };
  }

  try {
    const ffRes = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const rawText = await ffRes.text();
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (e) {}
    const isArr = Array.isArray(parsed);
    if (ffRes.ok && isArr && parsed.length) {
      newsCache = { data: parsed, ts: Date.now() };
      try {
        await DB.prepare('INSERT INTO news_cache (id, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at')
          .bind('default', rawText, Date.now()).run();
      } catch (e) {}
      const cachedRes = new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      });
      try { await cache.put(cacheKey, cachedRes); } catch (e) {}
      return { data: parsed, isMock: false };
    }
    if (ffRes.status === 429) {
      if (newsCache.data) return { data: newsCache.data, isMock: false };
      if (staleData) {
        newsCache = { data: staleData, ts: Date.now() };
        return { data: staleData, isMock: false };
      }
      return { data: null, isMock: false };
    }
    if (!isArr || !parsed.length) {
      if (newsCache.data) return { data: newsCache.data, isMock: false };
      if (staleData) {
        newsCache = { data: staleData, ts: Date.now() };
        return { data: staleData, isMock: false };
      }
      return { data: null, isMock: false };
    }
  } catch (e) {
    if (newsCache.data) return { data: newsCache.data, isMock: false };
    if (staleData) {
      newsCache = { data: staleData, ts: Date.now() };
      return { data: staleData, isMock: false };
    }
  }
  if (staleData) {
    newsCache = { data: staleData, ts: Date.now() };
    return { data: staleData, isMock: false };
  }
  return { data: null, isMock: false };
}

function resolveCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return 'https://jj-trader.pages.dev';
  try {
    const url = new URL(origin);
    // Exact allowlist, plus any *.jj-trader.pages.dev preview/PR subdomain
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    if (url.hostname === 'jj-trader.pages.dev' || url.hostname.endsWith('.jj-trader.pages.dev')) return origin;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return origin;
  } catch {}
  return 'https://jj-trader.pages.dev';
}

function corsHeaders(request) {
  const origin = resolveCorsOrigin(request);
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
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
  // Prune stale entries to keep memory bounded
  if (rateLimitStore.size > 1000) {
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) rateLimitStore.delete(key);
    }
  }
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

// Safe JSON body parser -> returns null on malformed input
async function readJson(request) {
  try {
    const body = await request.json();
    return (body && typeof body === 'object') ? body : {};
  } catch (e) {
    return null;
  }
}

// Sanitize free-text fields against stored XSS / length abuse
function sanitizeText(value, maxLen = 300) {
  if (value === undefined || value === null) return '';
  let s = String(value).replace(/[<>]/g, '').trim();
  if (maxLen > 0 && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// Coerce a value to a number or a fallback
function toNum(value, fallback = null) {
  const n = parseFloat(value);
  return (Number.isFinite(n)) ? n : fallback;
}

// Prune expired sessions (run opportunistically on login/register)
async function pruneSessions(DB) {
  try {
    await DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()).run();
  } catch (e) {}
}

// Get user from Authorization header
async function getUser(request, DB) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const now = new Date().toISOString();
  const row = await DB.prepare(
    'SELECT u.id, u.username, u.display_name, u.avatar FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?'
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

      // ── PRICE PROXY (gold / silver / DXY / USOIL via Yahoo Finance) ──
      // Direct browser fetches to Yahoo are CORS-blocked, so proxy here.
      if (path === '/api/price' && method === 'GET') {
        const sym = (url.searchParams.get('symbol') || '').toUpperCase();
        const yahooSymbol = sym === 'DXY' ? 'DX-Y.NYB'
          : (sym === 'USOIL' || sym === 'OIL' ? 'CL=F'
          : (sym === 'XAU' || sym === 'XAUUSD' || sym === 'GOLD' ? 'GC=F'
          : (sym === 'XAG' || sym === 'XAGUSD' || sym === 'SILVER' ? 'SI=F' : null)));
        if (!yahooSymbol) return fail('symbol ไม่ถูกต้อง (ใช้ DXY, USOIL, XAU, XAG)', 400);
        try {
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`, {
            headers: { 'User-Agent': TV_UA, 'Accept': 'application/json' },
          });
          if (!res.ok) return fail('ไม่สามารถดึงราคาได้ กรุณาลองใหม่', 502);
          const body = await res.json();
          const price = body?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (!price || isNaN(price)) return fail('ไม่สามารถดึงราคาได้ กรุณาลองใหม่', 502);
          return respond({ price, symbol: sym });
        } catch (e) {
          return fail('ไม่สามารถดึงราคาได้ กรุณาลองใหม่', 502);
        }
      }

      // ── CANDLES PROXY (OHLC for the V11 engine swing detection) ──
      // Returns recent candles so swing high/low are computed on real bars,
      // not on live tick prices like the old implementation.
      if (path === '/api/candles' && method === 'GET') {
        const sym = (url.searchParams.get('symbol') || 'XAU').toUpperCase();
        const interval = url.searchParams.get('interval') || '5m';
        const range = url.searchParams.get('range') || '5d';
        const yahooSymbol = sym === 'DXY' ? 'DX-Y.NYB'
          : (sym === 'USOIL' || sym === 'OIL' ? 'CL=F'
          : (sym === 'XAU' || sym === 'XAUUSD' || sym === 'GOLD' ? 'GC=F'
          : (sym === 'XAG' || sym === 'XAGUSD' || sym === 'SILVER' ? 'SI=F'
          : (sym === 'BTC' || sym === 'BTCUSDT' ? 'BTC-USD' : null))));
        if (!yahooSymbol) return fail('symbol ไม่ถูกต้อง (ใช้ DXY, USOIL, XAU, XAG, BTC)', 400);
        try {
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`, {
            headers: { 'User-Agent': TV_UA, 'Accept': 'application/json' },
          });
          if (!res.ok) return fail('ไม่สามารถดึงข้อมูลกราฟได้ กรุณาลองใหม่', 502);
          const body = await res.json();
          const result = body?.chart?.result?.[0];
          const times = result?.timestamp || [];
          const quote = result?.indicators?.quote?.[0];
          if (!times.length || !quote) return fail('ไม่สามารถดึงข้อมูลกราฟได้ กรุณาลองใหม่', 502);

          const candles = [];
          for (let i = 0; i < times.length; i++) {
            const o = quote.open && quote.open[i];
            const h = quote.high && quote.high[i];
            const l = quote.low && quote.low[i];
            const c = quote.close && quote.close[i];
            if (o == null || h == null || l == null || c == null) continue;
            candles.push({ t: times[i], o, h, l, c });
          }
          if (!candles.length) return fail('ไม่สามารถดึงข้อมูลกราฟได้ กรุณาลองใหม่', 502);
          // Keep the last 250 candles for swing/EMA computations
          return respond({ symbol: sym, interval, candles: candles.slice(-250) });
        } catch (e) {
          return fail('ไม่สามารถดึงข้อมูลกราฟได้ กรุณาลองใหม่', 502);
        }
      }

      // ── FOREXFACTORY NEWS API ─────────────────────────
      if (path === '/api/news' && method === 'GET') {
        const period = url.searchParams.get('period') || 'thisweek';

        // Convert a Date to a YYYY-MM-DD string in Bangkok timezone (UTC+7) without locale APIs
        const dateInTh = (dt) => {
          try {
            const d = new Date(dt);
            const t = new Date(d.getTime() + 7 * 3600 * 1000);
            return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
          } catch (e) { return null; }
        };

        const { data: all } = await fetchForexNews(DB);
        if (Array.isArray(all) && all.length) {
          const now = new Date();
          const todayTh = dateInTh(now);

          const startOfWeekUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const bkkDay = (startOfWeekUtc.getTime() + 7 * 3600 * 1000);
          const dayOfWeek = (Math.floor(bkkDay / 86400000) + 4) % 7;
          startOfWeekUtc.setUTCDate(startOfWeekUtc.getUTCDate() - dayOfWeek);
          const weekStart = dateInTh(startOfWeekUtc);
          const weekEnd = new Date(startOfWeekUtc);
          weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
          const weekEndStr = dateInTh(weekEnd);
          const nextWeekStart = new Date(startOfWeekUtc);
          nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
          const nextWeekStartStr = dateInTh(nextWeekStart);
          const nextWeekEnd = new Date(nextWeekStart);
          nextWeekEnd.setUTCDate(nextWeekEnd.getUTCDate() + 6);
          const nextWeekEndStr = dateInTh(nextWeekEnd);

          let data = all;
          if (period === 'today') {
            data = all.filter(item => item.date && dateInTh(item.date) === todayTh);
          } else if (period === 'yesterday') {
            const y = new Date(now);
            y.setUTCDate(y.getUTCDate() - 1);
            const yTh = dateInTh(y);
            data = all.filter(item => item.date && dateInTh(item.date) === yTh);
          } else if (period === 'thisweek') {
            data = all.filter(item => item.date && dateInTh(item.date) >= weekStart && dateInTh(item.date) <= weekEndStr);
          } else if (period === 'nextweek') {
            data = all.filter(item => item.date && dateInTh(item.date) >= nextWeekStartStr && dateInTh(item.date) <= nextWeekEndStr);
          }
          return respond(data);
        }

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

        const body = await readJson(request);
        if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);

        const { username, pin, email } = body;
        if (!username || !pin || String(pin).trim().length < 4 || String(pin).trim().length > 6 || !/^\d+$/.test(String(pin).trim())) {
          return fail('กรุณากรอกชื่อผู้ใช้ และ PIN 4-6 หลัก (ตัวเลขเท่านั้น) ให้ครบถ้วนครับ');
        }
        if (!email || !email.includes('@')) {
          return fail('กรุณากรอก อีเมล (Email) ให้ถูกต้องครับ');
        }

        const cleanUsername = sanitizeText(username, 30);
        const cleanEmail = sanitizeText(email, 60).toLowerCase();
        if (!cleanUsername) {
          return fail('ชื่อผู้ใช้ไม่ถูกต้องครับ');
        }

        const existing = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(cleanUsername).first();
        if (existing) {
          return fail('❌ ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาใช้ชื่ออื่น หรือกดสลับไปหน้าเข้าสู่ระบบ', 400);
        }

        const existingEmail = await DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
        if (existingEmail) {
          return fail('❌ อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น', 400);
        }

        const salt = generateSalt();
        const pinHash = await hashPin(String(pin).trim(), salt);
        const newId = genId();
        
        try {
          await DB.prepare('INSERT INTO users (id, username, pin_hash, salt, email) VALUES (?, ?, ?, ?, ?)').bind(newId, cleanUsername, pinHash, salt, cleanEmail).run();
        } catch(e) {
          // Fallback if email/salt columns not yet in users table schema.
          // Re-hash with the legacy fixed salt so verifyPin() can still log the user in.
          const legacyHash = await hashPin(String(pin).trim(), '_jj_trader_salt');
          await DB.prepare('INSERT INTO users (id, username, pin_hash) VALUES (?, ?, ?)').bind(newId, cleanUsername, legacyHash).run();
        }
        
        try {
          await DB.prepare('INSERT INTO preferences (user_id) VALUES (?)').bind(newId).run();
        } catch (e) {}

        // Create session (30 days)
        const token = genId();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, newId, expires).run();
        await pruneSessions(DB);

        return respond({ token, username: cleanUsername, message: 'สมัครสมาชิกสำเร็จ!' });
      }

      // POST /api/auth/login  { username, pin }
      if (path === '/api/auth/login' && method === 'POST') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return fail('⚠️ มีการขอเข้าใช้ระบบบ่อยเกินไป กรุณารอสักครู่ แล้วลองใหม่อีกครั้ง', 429);
        }

        const body = await readJson(request);
        if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);

        const { username, pin } = body;
        if (!username || !pin || String(pin).trim().length < 4) {
          return fail('กรุณากรอกชื่อผู้ใช้และ PIN (อย่างน้อย 4 หลัก) ครับ');
        }

        // Check if user exists (need salt)
        let user = await DB.prepare('SELECT id, pin_hash, salt FROM users WHERE username = ?').bind(sanitizeText(username, 30)).first();
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
        await pruneSessions(DB);

        return respond({ token, username: username.trim() });
      }

      // POST /api/auth/logout  (revoke current token)
      if (path === '/api/auth/logout' && method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace('Bearer ', '').trim();
        if (token) {
          await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        }
        return respond({ ok: true });
      }

      // Wrong method on known public paths -> 405
      if (path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/news') {
        return fail('Method นี้ไม่รองรับครับ', 405);
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
      const body = await readJson(request);
      if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);

      const { balance, risk_pct, timeframe, symbol } = body;
      // Never bind undefined -> D1 throws; coalesce to defaults
      const cleanBalance = toNum(balance, 1000);
      const cleanRisk = toNum(risk_pct, 1);
      const cleanTimeframe = sanitizeText(timeframe, 20) || '240';
      const cleanSymbol = sanitizeText(symbol, 30) || 'OANDA:XAUUSD';
      await DB.prepare(`
        INSERT INTO preferences (user_id, balance, risk_pct, timeframe, symbol, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          balance = excluded.balance,
          risk_pct = excluded.risk_pct,
          timeframe = excluded.timeframe,
          symbol = excluded.symbol,
          updated_at = excluded.updated_at
      `).bind(user.id, cleanBalance, cleanRisk, cleanTimeframe, cleanSymbol).run();
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
      const body = await readJson(request);
      if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);
      const text = sanitizeText(body.text, 2000);
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
      const body = await readJson(request);
      if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);
      const { symbol, target_price, condition } = body;
      const price = toNum(target_price, null);
      if (price === null || isNaN(price)) return fail('ราคาเป้าหมายว่างครับ');
      const id = genId();
      const cleanSymbol = sanitizeText(symbol, 30) || 'XAUUSD';
      const cleanCondition = sanitizeText(condition, 10) === 'below' ? 'below' : 'above';
      await DB.prepare('INSERT INTO alerts (id, user_id, symbol, target_price, condition, price) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, user.id, cleanSymbol, price, cleanCondition, price).run();
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
      const { results } = await DB.prepare('SELECT * FROM trade_history WHERE user_id = ? ORDER BY date DESC LIMIT 500').bind(user.id).all();
      return respond(results);
    }

    // POST /api/history  { symbol, direction, entry, close, sl, tp, lot, result, pnl, note, currency }
    if (path === '/api/history' && method === 'POST') {
      const body = await readJson(request);
      if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);
      const id = genId();
      const date = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
      const cleanSymbol = sanitizeText(body.symbol, 30) || 'XAUUSD';
      const cleanDirection = (sanitizeText(body.direction, 10)).toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
      const cleanNote = sanitizeText(body.note, 500);
      const cleanResult = (sanitizeText(body.result, 10)).toUpperCase() === 'LOSS' ? 'LOSS' : 'WIN';
      const cleanCurrency = /^(USD|USDT|USDC|THB)$/.test(String(body.currency || '').toUpperCase()) ? String(body.currency).toUpperCase() : 'USD';
      await DB.prepare(`
        INSERT INTO trade_history (id, user_id, symbol, direction, entry, close, sl, tp, lot, result, pnl, note, date, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, user.id, cleanSymbol, cleanDirection,
        toNum(body.entry, 0), toNum(body.close, 0), toNum(body.sl, null), toNum(body.tp, null),
        toNum(body.lot, 0.01), cleanResult, toNum(body.pnl, 0), cleanNote, date, cleanCurrency
      ).run();
      return respond({ ok: true, id });
    }

    // DELETE /api/history/:id
    if (path.startsWith('/api/history/') && method === 'DELETE') {
      const hId = path.split('/')[3];
      await DB.prepare('DELETE FROM trade_history WHERE id = ? AND user_id = ?').bind(hId, user.id).run();
      return respond({ ok: true });
    }

      // ── CHAT PROFILE (display name + avatar) ─────────
      // GET /api/profile
      if (path === '/api/profile' && method === 'GET') {
        return respond({
          username: user.username,
          display_name: user.display_name || null,
          avatar: user.avatar || null,
        });
      }

      // POST /api/profile  { display_name?, avatar? }
      if (path === '/api/profile' && method === 'POST') {
        const body = await readJson(request);
        if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);

        const cleanDisplay = sanitizeText(body.display_name, 30) || null;
        if (cleanDisplay !== null && (cleanDisplay.length < 1 || cleanDisplay.length > 30)) {
          return fail('ชื่อแสดงผลต้องมีความยาว 1-30 ตัวอักษรครับ', 400);
        }

        let cleanAvatar = user.avatar || null;
        if (body.avatar !== undefined) {
          if (body.avatar === null || body.avatar === '') {
            cleanAvatar = null;
          } else {
            const av = String(body.avatar);
            const isImage = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(av);
            if (!isImage) return fail('รูปแบบภาพโปรไฟล์ไม่ถูกต้องครับ', 400);
            if (av.length > 250_000) return fail('ภาพโปรไฟล์ใหญ่เกินไป (สูงสุด ~180KB) กรุณาเลือกรูปที่เล็กลง', 400);
            cleanAvatar = av;
          }
        }

        // Update only when provided; absent fields keep their current values
        await DB.prepare('UPDATE users SET display_name = ?, avatar = ? WHERE id = ?')
          .bind(cleanDisplay, cleanAvatar, user.id).run();
        return respond({ ok: true, display_name: cleanDisplay, avatar: cleanAvatar });
      }

      // ── TEAM CHAT (polling) ─────────────────────────
      // GET /api/chat?after=<id>  -> messages newer than <id> (default last 50)
      // display_name/avatar are JOINed live so profile changes apply to history
      if (path === '/api/chat' && method === 'GET') {
        const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
        const { results } = await DB.prepare(
          `SELECT m.id, m.username, COALESCE(u.display_name, m.username) AS display_name, u.avatar AS avatar,
                  m.message, m.image, m.created_at
           FROM chat_messages m
           LEFT JOIN users u ON u.id = m.user_id
           WHERE m.id > ? ORDER BY m.id ASC LIMIT 100`
        ).bind(after).all();
        return respond(results || []);
      }

      // POST /api/chat  { message?, image? }
      if (path === '/api/chat' && method === 'POST') {
        const body = await readJson(request);
        if (!body) return fail('ข้อมูล JSON ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 400);
        const message = sanitizeText(body.message, 500);
        // Validate optional image: must be a data URL of a supported image type
        let image = null;
        if (body.image) {
          const img = String(body.image);
          const isImage = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(img);
          if (!isImage) return fail('รูปแบบรูปภาพไม่ถูกต้องครับ', 400);
          if (img.length > 1_500_000) return fail('รูปภาพใหญ่เกินไป (สูงสุดประมาณ 1MB) กรุณาเลือกรูปที่เล็กลง', 400);
          image = img;
        }
        if (!message && !image) return fail('กรุณาพิมพ์ข้อความหรือแนบรูปภาพครับ');
        const created = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
        const { meta } = await DB.prepare(
          'INSERT INTO chat_messages (user_id, username, message, image, created_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(user.id, user.username, message, image, created).run();
        return respond({ ok: true, id: meta.last_row_id, username: user.username, created_at: created });
      }

      // Wrong method on known protected paths -> 405
      if (path === '/api/chat' || path === '/api/preferences' || path === '/api/notes' ||
          path === '/api/alerts' || path === '/api/history') {
        return fail('Method นี้ไม่รองรับครับ', 405);
      }

      return fail('ไม่พบ API endpoint นี้ครับ', 404);
    } catch (error) {
      return respond({ error: '⚠️ เซิร์ฟเวอร์มีข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง' }, 500);
    }
  }
};
