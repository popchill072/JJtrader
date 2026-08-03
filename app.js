// JJ TRADER - Cloud-Connected Trading Platform
const API_BASE = 'https://jj-trader-api.popchill072.workers.dev';

let currentSymbol = 'OANDA:XAUUSD';
let widgetInstances = [];

const CHART_TFS = [
  { id: 'tv_chart_0', interval: '3', label: '3 นาที' },
  { id: 'tv_chart_1', interval: '30', label: '30 นาที' },
  { id: 'tv_chart_2', interval: '60', label: '1 ชั่วโมง' },
  { id: 'tv_chart_3', interval: '240', label: '4 ชั่วโมง' },
];
let priceAlerts = [];
let sessionToken = localStorage.getItem('jj_session_token') || null;
let currentUsername = localStorage.getItem('jj_username') || null;
let intervalIds = [];

// ── API HELPER ─────────────────────────────────────────
async function api(method, path, body = null) {
  if (path !== '/api/auth/login' && sessionToken === 'guest_mode') {
    return { error: 'Guest Mode', isGuest: true };
  }
  if (path !== '/api/auth/login' && !sessionToken) {
    return { error: 'Guest Mode', isGuest: true };
  }

  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`
    }
  };
  if (body) opts.body = JSON.stringify(body);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  opts.signal = controller.signal;

  try {
    const res = await fetch(API_BASE + path, opts);
    clearTimeout(timeoutId);
    if (res.status === 401 && path !== '/api/auth/login') {
      clearAllIntervals();
      sessionToken = null;
      currentUsername = null;
      localStorage.removeItem('jj_session_token');
      localStorage.removeItem('jj_username');
      showLoginOverlay();
      return { error: 'Unauthorized' };
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('API Error:', err);
    return { error: 'Network error' };
  }
}

// ── TOAST NOTIFICATION ─────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function sendPushNotification(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: 'logo.jpg', tag: 'jj-trader-alert' });
      setTimeout(() => n.close(), 8000);
    }
  } catch (e) {}
}

function requestNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}
}

function clearAllIntervals() {
  intervalIds.forEach(id => clearInterval(id));
  intervalIds = [];
  if (newsCountdownInterval) { clearInterval(newsCountdownInterval); newsCountdownInterval = null; }
  if (newsRefreshInterval) { clearInterval(newsRefreshInterval); newsRefreshInterval = null; }
  stopChatPolling();
}

// ── AUTH & STARTUP SYSTEM ───────────────────────────────
function checkAuthOnStartup() {
  // Restore a previous guest session so a refresh doesn't log the guest out
  const guestFlag = localStorage.getItem('jj_guest_mode');
  if (!sessionToken && guestFlag === '1') {
    sessionToken = 'guest_mode';
    currentUsername = 'Guest Trader';
    hideLoginOverlay();
    initApp();
    return;
  }
  if (sessionToken && currentUsername) {
    hideLoginOverlay();
    initApp();
  } else {
    showLoginOverlay();
  }
}

// ── THEME (Light/Dark) ─────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('jj_theme', theme);
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem('jj_theme') || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(cur === 'light' ? 'dark' : 'light');
  showToast(cur === 'light' ? '🌙 เปลี่ยนเป็นโหมดมืดแล้ว' : '☀️ เปลี่ยนเป็นโหมดสว่างแล้ว');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAuthOnStartup);
} else {
  checkAuthOnStartup();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { updateChatSoundToggleUI(); updateChatSoundTypeUI(); });
} else {
  updateChatSoundToggleUI();
  updateChatSoundTypeUI();
}

function switchAuthTab(tab) {
  const formLogin = document.getElementById('form-login');
  const formReg = document.getElementById('form-register');
  const btnLogin = document.getElementById('tab-btn-login');
  const btnReg = document.getElementById('tab-btn-register');

  if (tab === 'login') {
    if (formLogin) formLogin.style.display = 'flex';
    if (formReg) formReg.style.display = 'none';
    if (btnLogin) btnLogin.classList.add('active');
    if (btnReg) btnReg.classList.remove('active');
  } else {
    if (formLogin) formLogin.style.display = 'none';
    if (formReg) formReg.style.display = 'flex';
    if (btnLogin) btnLogin.classList.remove('active');
    if (btnReg) btnReg.classList.add('active');
  }
}

async function handleLoginSubmit() {
  const usernameInput = document.getElementById('login-username');
  const pinInput = document.getElementById('login-pin');
  const errEl = document.getElementById('login-error-msg');
  const btn = document.getElementById('login-btn');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const pin = pinInput ? pinInput.value.trim() : '';

  if (errEl) errEl.classList.remove('show');

  if (!username) {
    if (errEl) { errEl.textContent = '❌ กรุณากรอกชื่อผู้ใช้งาน'; errEl.classList.add('show'); }
    return;
  }

  if (!pin || pin.length < 4) {
    if (errEl) { errEl.textContent = '❌ กรุณากรอก PIN อย่างน้อย 4 หลัก'; errEl.classList.add('show'); }
    return;
  }

  if (btn) { btn.textContent = '⏳ เข้าสู่ระบบ...'; btn.disabled = true; }

  try {
    const data = await api('POST', '/api/auth/login', { username, pin });

    if (data.error) {
      if (errEl) { errEl.textContent = data.error; errEl.classList.add('show'); }
      if (btn) { btn.textContent = '🔐 เข้าสู่ระบบ'; btn.disabled = false; }
      return;
    }

    sessionToken = data.token;
    currentUsername = data.username;
    localStorage.setItem('jj_session_token', sessionToken);
    localStorage.setItem('jj_username', currentUsername);

    hideLoginOverlay();
    initApp();
    showToast(`✅ ยินดีต้อนรับ ${currentUsername} เข้าสู่ JJ Trader!`);
  } catch (err) {
    if (errEl) { errEl.textContent = '❌ เชื่อมต่อ Server ไม่ได้ครับ ลองใหม่อีกครั้ง'; errEl.classList.add('show'); }
    if (btn) { btn.textContent = '🔐 เข้าสู่ระบบ'; btn.disabled = false; }
  }
}

function togglePinVisible(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (btnEl) btnEl.textContent = isHidden ? '🙈' : '👁️';
  input.focus();
}

async function handleRegisterSubmit() {
  const usernameInput = document.getElementById('reg-username');
  const emailInput = document.getElementById('reg-email');
  const pinInput = document.getElementById('reg-pin');
  const pinConfirmInput = document.getElementById('reg-pin-confirm');
  const errEl = document.getElementById('reg-error-msg');
  const btn = document.getElementById('register-btn');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const pin = pinInput ? pinInput.value.trim() : '';
  const pinConfirm = pinConfirmInput ? pinConfirmInput.value.trim() : '';

  if (errEl) errEl.classList.remove('show');

  if (!username) {
    if (errEl) { errEl.textContent = '❌ กรุณากรอกชื่อผู้ใช้ที่ต้องการสมัคร'; errEl.classList.add('show'); }
    return;
  }

  if (!email || !email.includes('@')) {
    if (errEl) { errEl.textContent = '❌ กรุณากรอกอีเมล (Email) ให้ถูกต้อง'; errEl.classList.add('show'); }
    return;
  }

  if (!pin || pin.length < 4) {
    if (errEl) { errEl.textContent = '❌ กรุณากำหนด PIN อย่างน้อย 4 หลัก (เช่น 1234)'; errEl.classList.add('show'); }
    return;
  }

  if (pin.length > 6 || !/^\d+$/.test(pin)) {
    if (errEl) { errEl.textContent = '❌ PIN ต้องเป็นตัวเลข 4-6 หลักเท่านั้น (เช่น 123456)'; errEl.classList.add('show'); }
    return;
  }

  if (!pinConfirm) {
    if (errEl) { errEl.textContent = '❌ กรุณายืนยัน PIN อีกครั้งในช่อง "ยืนยัน PIN"'; errEl.classList.add('show'); }
    return;
  }

  if (pin !== pinConfirm) {
    if (errEl) { errEl.textContent = '❌ PIN ทั้งสองช่องไม่ตรงกัน กรุณากรอกให้ตรงกัน'; errEl.classList.add('show'); }
    return;
  }

  if (btn) { btn.textContent = '⏳ กำลังสมัครสมาชิก...'; btn.disabled = true; }

  try {
    const res = await fetch(API_BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, pin })
    });
    const data = await res.json();

    if (data.error) {
      if (errEl) { errEl.textContent = data.error; errEl.classList.add('show'); }
      if (btn) { btn.textContent = '✨ ยืนยันสมัครสมาชิก'; btn.disabled = false; }
      return;
    }

    sessionToken = data.token;
    currentUsername = data.username;
    localStorage.setItem('jj_session_token', sessionToken);
    localStorage.setItem('jj_username', currentUsername);

    hideLoginOverlay();
    initApp();
    showToast(`🎉 สมัครสมาชิกสำเร็จ! ยินดีต้อนรับคุณ ${currentUsername} เข้าสู่ระบบ!`);
  } catch (err) {
    if (errEl) { errEl.textContent = '❌ เชื่อมต่อ Server ไม่ได้ กรุณาลองใหม่อีกครั้ง'; errEl.classList.add('show'); }
    if (btn) { btn.textContent = '✨ ยืนยันสมัครสมาชิก'; btn.disabled = false; }
  }
}

function skipLoginGuest() {
  sessionToken = 'guest_mode';
  currentUsername = 'Guest Trader';
  localStorage.setItem('jj_guest_mode', '1');
  localStorage.removeItem('jj_session_token');
  localStorage.removeItem('jj_username');
  hideLoginOverlay();
  initApp();
  showToast('👤 เข้าใช้งานในโหมด Guest เรียบร้อยแล้วครับ');
}

function handleLogout() {
  if (!confirm('ต้องการออกจากระบบใช่ไหมครับ?')) return;
  clearAllIntervals();
  if (sessionToken && sessionToken !== 'guest_mode') {
    fetch(API_BASE + '/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    }).catch(() => {});
  }
  sessionToken = null;
  currentUsername = null;
  localStorage.removeItem('jj_session_token');
  localStorage.removeItem('jj_username');
  localStorage.removeItem('jj_guest_mode');
  location.reload();
}

function showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'flex';
  const btn = document.getElementById('login-btn');
  if (btn) { btn.textContent = '🔐 เข้าสู่ระบบ / สมัครสมาชิก'; btn.disabled = false; }
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'none';
  const headerUser = document.getElementById('header-username');
  if (headerUser && currentUsername) headerUser.textContent = currentUsername;
}

// ── INIT APP AFTER LOGIN ───────────────────────────────
function initApp() {
  try { autoAdaptChartLayout(); } catch (e) { console.error(e); }
  try { renderMainChart(); } catch (e) { console.error(e); }
  try { renderTechnicalGauge(); } catch (e) { console.error(e); }
  try { loadPreferences(); } catch (e) { console.error(e); }
  try { calculateThaiGold(); } catch (e) { console.error(e); }
  try { calculatePivot(); } catch (e) { console.error(e); }
  try { loadNotes(); } catch (e) { console.error(e); }
  try { loadPriceAlerts(); } catch (e) { console.error(e); }
  try { v11LoadFibSettings(); updateV11TfBadge(); refreshV11Candles(); renderV11FibOverlay(); } catch (e) { console.error(e); }
  try { startLivePriceTicker(); } catch (e) { console.error(e); }
  try { loadForexNews(); } catch (e) { console.error(e); }
  try { requestNotificationPermission(); } catch (e) {}

  try {
    updateTradingSessionsClock();
    const clockId = setInterval(updateTradingSessionsClock, 1000);
    intervalIds.push(clockId);
  } catch (e) { console.error(e); }
  try { loadTradeLogs().then(() => renderTradeDashboard()).catch(e => console.error(e)); } catch (e) { console.error(e); }
  try { startChatPolling(); } catch (e) { console.error(e); }
  try { loadChatProfile(); } catch (e) { console.error(e); }
  try {
    const initPrice = lastKnownLivePrice || parseFloat(document.getElementById('gold-spot-input')?.value) || 0;
    calculateV11ProEngine(initPrice);
  } catch (e) { console.error(e); }
}

window.addEventListener('resize', () => {
  clearTimeout(window.__layoutResizeTimer);
  window.__layoutResizeTimer = setTimeout(() => {
    try { autoAdaptChartLayout(); } catch (e) { console.error(e); }
  }, 250);
});

// ── TRADINGVIEW CHART ──────────────────────────────────
let customIndicatorId = localStorage.getItem('jj_custom_indicator_id') || '';

function renderMainChart() {
  widgetInstances.forEach(w => { try { w.remove(); } catch(e) {} });
  widgetInstances = [];

  const tvUserId = String(currentUsername || 'default_trader').replace(/[^a-zA-Z0-9-_. ]/g, '').slice(0, 32) || 'default_trader';

  CHART_TFS.forEach((cfg, idx) => {
    const container = document.getElementById(cfg.id);
    if (!container) return;
    container.innerHTML = '';

    const studies = customIndicatorId ? [customIndicatorId] : [];
    const widget = new TradingView.widget({
      autosize: true,
      symbol: currentSymbol,
      interval: cfg.interval,
      timezone: "Asia/Bangkok",
      theme: "dark",
      style: "1",
      locale: "th",
      toolbar_bg: "#080a0f",
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      save_image: true,
      auto_save_change: false,
      client_id: "jjtrader_platform",
      user_id: tvUserId,
      container_id: cfg.id,
      studies
    });
    widgetInstances[idx] = widget;
  });
}

function setCustomIndicator(indicatorId) {
  // Only allow safe study identifiers: alphanumeric, dots, dashes, underscores (TradingView script IDs)
  const cleaned = indicatorId ? indicatorId.trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) : '';
  customIndicatorId = cleaned;
  localStorage.setItem('jj_custom_indicator_id', customIndicatorId);
  renderMainChart();
  showToast(customIndicatorId ? `✅ ตั้งค่าอินดิเคเตอร์เริ่มต้นเป็น: ${customIndicatorId}` : '🧹 ลบอินดิเคเตอร์พรีเซ็ตทั้งหมดเรียบร้อยแล้ว (กราฟสะอาด)');
}

function promptCustomIndicator() {
  const current = localStorage.getItem('jj_custom_indicator_id') || '';
  const input = prompt('กรุณากรอกชื่อหรือ Script ID ของ Indicator ประจำตัวของคุณ:', current);
  if (input !== null) {
    setCustomIndicator(input);
  }
}

// ── V11 FIBONACCI SETTINGS ─────────────────────────────
const V11_FIB_STORAGE_KEY = 'jj_v11_fib_config';
let v11FibOverlayEnabled = localStorage.getItem('jj_v11_fib_overlay') === '1';

function v11LoadFibSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(V11_FIB_STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.levels)) {
      v11SetFibLevels(saved.levels, saved.entry, saved.tp1, saved.tp3);
    }
  } catch (e) {}
}

function toggleV11FibSettings() {
  const panel = document.getElementById('v11-fib-settings');
  const btn = document.getElementById('v11-fib-settings-btn');
  if (!panel) return;
  const willOpen = panel.style.display !== 'block';
  panel.style.display = willOpen ? 'block' : 'none';
  if (willOpen) {
    const lvl = document.getElementById('v11-fib-levels-input');
    const entry = document.getElementById('v11-fib-entry-input');
    const tp1 = document.getElementById('v11-fib-tp1-input');
    const tp3 = document.getElementById('v11-fib-tp3-input');
    const tfSel = document.getElementById('v11-timeframe-select');
    if (lvl) lvl.value = V11_CONFIG.fibLevels.join(',');
    if (entry) entry.value = V11_CONFIG.fibEntry;
    if (tp1) tp1.value = V11_CONFIG.fibTp1;
    if (tp3) tp3.value = V11_CONFIG.fibTp3;
    if (tfSel) tfSel.value = v11Timeframe;
  }
}

function saveV11FibSettings() {
  const lvl = document.getElementById('v11-fib-levels-input');
  const entry = document.getElementById('v11-fib-entry-input');
  const tp1 = document.getElementById('v11-fib-tp1-input');
  const tp3 = document.getElementById('v11-fib-tp3-input');
  const raw = (lvl ? lvl.value : '').split(',').map(s => parseFloat(s)).filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
  const e = parseFloat(entry ? entry.value : 78.6);
  const t1 = parseFloat(tp1 ? tp1.value : 38.2);
  const t3 = parseFloat(tp3 ? tp3.value : 100);
  if (!raw.length) {
    showToast('❌ กรุณากรอกรายการระดับ Fib ให้ถูกต้อง (ตัวเลขคั่นด้วย ,)');
    return;
  }
  const levels = v11SetFibLevels(raw, e, t1, t3);
  localStorage.setItem(V11_FIB_STORAGE_KEY, JSON.stringify({ levels, entry: V11_CONFIG.fibEntry, tp1: V11_CONFIG.fibTp1, tp3: V11_CONFIG.fibTp3 }));
  renderV11FibOverlay();
  const last = lastKnownLivePrice || parseFloat(document.getElementById('gold-spot-input')?.value) || 0;
  updateV11ProDashboard(last);
  const panel = document.getElementById('v11-fib-settings');
  if (panel) panel.style.display = 'none';
  showToast(`✅ ตั้งค่า Fibonacci เรียบร้อย: ${levels.join(', ')}%`);
}

function resetV11FibSettings() {
  localStorage.removeItem(V11_FIB_STORAGE_KEY);
  v11SetFibLevels([0, 23.6, 38.2, 50, 61.8, 78.6, 100], 78.6, 38.2, 100);
  const panel = document.getElementById('v11-fib-settings');
  if (panel) panel.style.display = 'none';
  renderV11FibOverlay();
  const last = lastKnownLivePrice || parseFloat(document.getElementById('gold-spot-input')?.value) || 0;
  updateV11ProDashboard(last);
  showToast('↩️ คืนค่า Fibonacci กลับเป็นค่าเริ่มต้นแล้วครับ');
}

// ── FIB OVERLAY ON TRADINGVIEW CHART ───────────────────
// Draw a retracement frame (0%-100%) over the main chart container.
// Uses a transparent overlay div positioned by swing high/low range.
function toggleV11FibOverlay() {
  v11FibOverlayEnabled = !v11FibOverlayEnabled;
  localStorage.setItem('jj_v11_fib_overlay', v11FibOverlayEnabled ? '1' : '0');
  renderV11FibOverlay();
  const btn = document.getElementById('v11-fib-overlay-btn');
  if (btn) {
    btn.textContent = v11FibOverlayEnabled ? '📐 Fib: เปิด' : '📐 Fib: ปิด';
    btn.classList.toggle('active', v11FibOverlayEnabled);
  }
  showToast(v11FibOverlayEnabled ? '📐 แสดงเส้น Fibonacci บนกราฟแล้ว' : '📐 ปิดเส้น Fibonacci บนกราฟแล้ว');
}

function renderV11FibOverlay() {
  document.querySelectorAll('.v11-fib-overlay').forEach(el => el.remove());
  if (!v11FibOverlayEnabled) return;
  if (!v11Swing || v11Swing.sRange <= 0) return;
  const container = document.getElementById('tv_chart_0');
  if (!container) return;

  const { dHigh, dLow, sRange, isUp } = v11Swing;
  const overlay = document.createElement('div');
  overlay.className = 'v11-fib-overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '5';

  // Horizontal lines at each fib level (y = level retracement from high->low)
  const levels = V11_CONFIG.fibLevels.slice();
  levels.forEach(pct => {
    const price = isUp === false ? dLow + sRange * (pct / 100) : dHigh - sRange * (pct / 100);
    const y = ((dHigh - price) / sRange) * 100;
    const isEntry = Math.abs(pct - V11_CONFIG.fibEntry) < 0.05;
    const line = document.createElement('div');
    line.className = 'v11-fib-line';
    line.style.position = 'absolute';
    line.style.left = '0';
    line.style.right = '0';
    line.style.top = y + '%';
    line.style.height = '1px';
    line.style.background = isEntry ? 'rgba(41,98,255,0.9)' : 'rgba(255,215,0,0.45)';
    line.style.borderTop = isEntry ? '1px dashed #2962FF' : '1px dashed rgba(255,215,0,0.5)';
    const lbl = document.createElement('span');
    lbl.textContent = pct + '%';
    lbl.style.cssText = 'position:absolute;right:4px;top:-7px;font-size:9px;font-weight:700;color:' + (isEntry ? '#2962FF' : '#ffd700') + ';background:rgba(8,10,15,0.8);padding:0 3px;border-radius:3px';
    line.appendChild(lbl);
    overlay.appendChild(line);
  });

  container.style.position = 'relative';
  container.appendChild(overlay);
}

function renderTechnicalGauge() {
  const container = document.getElementById('technical_gauge_container');
  if (!container) return;
  container.innerHTML = '';

  // Standard TradingView embed structure: container > __widget > script
  const widgetDiv = document.createElement('div');
  widgetDiv.className = 'tradingview-widget-container';
  const widgetInner = document.createElement('div');
  widgetInner.className = 'tradingview-widget-container__widget';
  widgetDiv.appendChild(widgetInner);

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
  script.async = true;
  script.innerHTML = JSON.stringify({
    "interval": "1h", "width": "100%", "isTransparent": true, "height": "100%",
    "symbol": currentSymbol, "showIntervalTabs": true,
    "displayMode": "single", "locale": "th", "colorTheme": "dark"
  });

  widgetDiv.appendChild(script);
  container.appendChild(widgetDiv);
}

function changeSymbol(symbol, title, btnElement) {
  currentSymbol = symbol;
  document.querySelectorAll('.btn-asset').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  applySymbolToCharts();

  savePreferences();
  renderMainChart();
  renderTechnicalGauge();

  // Reload V11 candles for the new asset so swing/EMA are computed on fresh bars
  v11CandleSymbol = '';
  refreshV11Candles();
}

const CHART_PRESETS = {
  intraday: {
    label: '3นาที · 30นาที · 1ชม. · 4ชม.',
    intervals: ['3', '30', '60', '240'],
    tfLabels: ['3 นาที', '30 นาที', '1 ชั่วโมง', '4 ชั่วโมง'],
  },
  scalping: {
    label: '1นาที · 5นาที · 15นาที · 1ชม.',
    intervals: ['1', '5', '15', '60'],
    tfLabels: ['1 นาที', '5 นาที', '15 นาที', '1 ชั่วโมง'],
  },
  swing: {
    label: '1ชม. · 4ชม. · 1วัน · 1สัปดาห์',
    intervals: ['60', '240', '1D', '1W'],
    tfLabels: ['1 ชั่วโมง', '4 ชั่วโมง', '1 วัน', '1 สัปดาห์'],
  },
};

let currentTimeframePref = localStorage.getItem('jj_timeframe_pref') || '';

function applyChartPreset(name, btnElement) {
  const preset = CHART_PRESETS[name];
  if (!preset) return;
  currentTimeframePref = name;
  localStorage.setItem('jj_timeframe_pref', name);
  document.querySelectorAll('.tf-preset-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  CHART_TFS.forEach((cfg, idx) => {
    cfg.interval = preset.intervals[idx];
    cfg.label = preset.tfLabels[idx];
  });

  const meta = SYMBOL_META[currentSymbol];
  const shortTitle = meta ? meta.short : (currentSymbol.split(':').pop() || currentSymbol);
  CHART_TFS.forEach((cfg, idx) => {
    const labelEl = document.getElementById(`chart-label-${idx}`);
    if (labelEl) labelEl.textContent = `${shortTitle} - ${cfg.label}`;
  });

  renderMainChart();
  showToast(`✅ เปลี่ยนชุด Timeframe เป็น: ${preset.label}`);
}

// ── CHART LAYOUT (grid / vertical / horizontal) ────────
let currentChartLayout = 'grid';

function setChartLayout(layout, btnElement, save = true) {
  currentChartLayout = layout;
  const grid = document.getElementById('chart-grid');
  if (grid) {
    grid.classList.remove('layout-grid', 'layout-vertical', 'layout-horizontal', 'layout-focus', 'layout-feature');
    grid.classList.add(`layout-${layout}`);
  }
  document.querySelectorAll('.layout-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  else {
    document.querySelectorAll('.layout-btn').forEach(btn => {
      if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${layout}'`)) btn.classList.add('active');
    });
  }
  if (save) {
    localStorage.setItem('jj_chart_layout', layout);
  }
  // Ask each TradingView widget to re-measure after the grid reshapes
  // (TradingView's widget.resize() is safe and does not re-trigger window resize)
  clearTimeout(window.__chartWidgetResizeTimer);
  window.__chartWidgetResizeTimer = setTimeout(() => {
    widgetInstances.forEach(w => { try { w && typeof w.resize === 'function' && w.resize(); } catch (e) {} });
  }, 120);
}

function autoAdaptChartLayout() {
  const isMobile = window.innerWidth <= 900;
  const saved = localStorage.getItem('jj_chart_layout') || 'grid';
  let layout = saved;
  if (isMobile && ['horizontal', 'focus', 'feature'].includes(layout)) layout = 'vertical';
  setChartLayout(layout, null, false);
}

// ── PREFERENCES (Cloud) ────────────────────────────────
const SYMBOL_META = {
  'OANDA:XAUUSD': { label: '👑 XAU/USD (Gold)', short: 'XAU/USD (Gold)' },
  'OANDA:XAGUSD': { label: '🥈 XAG/USD (Silver)', short: 'XAG/USD (Silver)' },
  'CAPITALCOM:DXY': { label: '💵 DXY', short: 'DXY' },
  'TVC:USOIL': { label: '🛢️ US Oil', short: 'US Oil' },
  'BINANCE:BTCUSDT': { label: '₿ BTC/USD', short: 'BTC/USD' },
};

function applySymbolToCharts() {
  const meta = SYMBOL_META[currentSymbol];
  const shortTitle = meta ? meta.short : (currentSymbol.split(':').pop() || currentSymbol);
  CHART_TFS.forEach((cfg, idx) => {
    const labelEl = document.getElementById(`chart-label-${idx}`);
    if (labelEl) labelEl.textContent = `${shortTitle} - ${cfg.label}`;
  });
  document.querySelectorAll('.btn-asset').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.btn-asset').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    if (onclick.includes(currentSymbol)) btn.classList.add('active');
  });
}

// ── V11 CANDLE DATA ────────────────────────────────────
// Swing high/low for the V11 engine must come from real OHLC candles
// (matching the Pine script), not from live tick prices.
let v11CandleSymbol = '';
let v11RefreshId = null;

// Timeframe options for the V11 engine (candle interval + Yahoo range)
const V11_TF_OPTIONS = {
  '1m': { label: '1 นาที', interval: '1m', range: '1d', refreshMs: 30000 },
  '5m': { label: '5 นาที', interval: '5m', range: '5d', refreshMs: 60000 },
  '15m': { label: '15 นาที', interval: '15m', range: '1mo', refreshMs: 90000 },
  '30m': { label: '30 นาที', interval: '30m', range: '1mo', refreshMs: 120000 },
  '1h': { label: '1 ชั่วโมง', interval: '60m', range: '3mo', refreshMs: 180000 },
  '4h': { label: '4 ชั่วโมง', interval: '4h', range: '3mo', refreshMs: 300000 },
};
let v11Timeframe = localStorage.getItem('jj_v11_timeframe') || '5m';
if (!V11_TF_OPTIONS[v11Timeframe]) v11Timeframe = '5m';

function setV11Timeframe(tf) {
  if (!V11_TF_OPTIONS[tf]) return;
  v11Timeframe = tf;
  localStorage.setItem('jj_v11_timeframe', tf);
  const sel = document.getElementById('v11-timeframe-select');
  if (sel) sel.value = tf;
  updateV11TfBadge();
  // Force reload candles for the new interval
  v11CandleSymbol = '';
  fetchV11Candles();
  showToast(`⏱️ เปลี่ยน timeframe ของ V11 เป็น ${V11_TF_OPTIONS[tf].label} แล้วครับ`);
}

function updateV11TfBadge() {
  const badge = document.getElementById('v11-tf-badge');
  const tf = V11_TF_OPTIONS[v11Timeframe] || V11_TF_OPTIONS['5m'];
  if (badge) {
    badge.textContent = '⚡ ' + tf.label.replace(' นาที', 'นาที').replace(' ชั่วโมง', 'ชม.');
  }
}

// Binance spot klines are close to real spot price (PAXG tracks XAU spot within ~$1-3),
// unlike Yahoo GC=F futures which run ~$50-60 above spot.
const V11_BINANCE_PAIRS = {
  'XAU': { pair: 'PAXGUSDT', limit: 250 },
  'BTC': { pair: 'BTCUSDT', limit: 250 },
};

async function fetchV11Candles() {
  const symKey = (SYMBOL_META[currentSymbol] ? currentSymbol.split(':').pop() : 'XAUUSD').toUpperCase();
  const sym = symKey.includes('XAG') ? 'XAG' : symKey.includes('DXY') ? 'DXY' : symKey.includes('USOIL') || symKey.includes('OIL') ? 'USOIL' : symKey.includes('BTC') ? 'BTC' : 'XAU';
  if (v11CandleSymbol === sym) return;
  v11CandleSymbol = sym;
  const tf = V11_TF_OPTIONS[v11Timeframe] || V11_TF_OPTIONS['5m'];
  try {
    let candles = null;
    const binance = V11_BINANCE_PAIRS[sym];
    if (binance) {
      // Binance klines: [[openTime, open, high, low, close, ...], ...]
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binance.pair}&interval=${tf.interval}&limit=${binance.limit}`);
      if (res.ok) {
        const k = await res.json();
        if (Array.isArray(k) && k.length) {
          candles = k.map(row => ({ t: Math.floor(row[0] / 1000), o: parseFloat(row[1]), h: parseFloat(row[2]), l: parseFloat(row[3]), c: parseFloat(row[4]) }));
        }
      }
    }
    if (!candles) {
      const res = await fetch(`${API_BASE}/api/candles?symbol=${sym}&interval=${tf.interval}&range=${tf.range}`);
      if (!res.ok) return;
      const data = await res.json();
      candles = Array.isArray(data.candles) ? data.candles : null;
    }
    if (candles && candles.length) {
      v11SetCandles(candles);
      const last = lastKnownLivePrice || parseFloat(document.getElementById('gold-spot-input')?.value) || 0;
      if (last) updateV11ProDashboard(last);
      renderV11FibOverlay();
    }
  } catch (e) {}
}

function refreshV11Candles() {
  fetchV11Candles();
  // Refresh cadence follows the selected timeframe
  if (v11RefreshId) { clearInterval(v11RefreshId); intervalIds = intervalIds.filter(id => id !== v11RefreshId); }
  const tf = V11_TF_OPTIONS[v11Timeframe] || V11_TF_OPTIONS['5m'];
  v11RefreshId = setInterval(fetchV11Candles, tf.refreshMs);
  intervalIds.push(v11RefreshId);
}

async function loadPreferences() {
  // Guests: restore locally-saved balance/risk/timeframe/symbol
  if (!sessionToken || sessionToken === 'guest_mode') {
    try {
      const p = JSON.parse(localStorage.getItem('jj_guest_prefs') || '{}');
      if (p.balance && document.getElementById('acc-balance')) document.getElementById('acc-balance').value = p.balance;
      if (p.risk_pct && document.getElementById('risk-percent')) document.getElementById('risk-percent').value = p.risk_pct;
      if (p.symbol) {
        currentSymbol = p.symbol;
        applySymbolToCharts();
        renderMainChart();
        renderTechnicalGauge();
      }
      if (p.timeframe && CHART_PRESETS[p.timeframe]) {
        currentTimeframePref = p.timeframe;
        applyChartPreset(p.timeframe, document.querySelector(`.tf-preset-btn[onclick*="${p.timeframe}"]`));
      }
    } catch (e) {}
    calculateRiskLot();
    calculatePivot();
    return;
  }

  try {
    const data = await api('GET', '/api/preferences');
    if (data.balance && document.getElementById('acc-balance')) document.getElementById('acc-balance').value = data.balance;
    if (data.risk_pct && document.getElementById('risk-percent')) document.getElementById('risk-percent').value = data.risk_pct;
    if (data.symbol) {
      currentSymbol = data.symbol;
      applySymbolToCharts();
      renderMainChart();
      renderTechnicalGauge();
    }
    if (data.timeframe && CHART_PRESETS[data.timeframe]) {
      currentTimeframePref = data.timeframe;
      applyChartPreset(data.timeframe, document.querySelector(`.tf-preset-btn[onclick*="${data.timeframe}"]`));
    }
    calculateRiskLot();
    calculatePivot();
  } catch (e) { /* offline fallback */ }
}

async function savePreferences() {
  const balanceEl = document.getElementById('acc-balance');
  const riskEl = document.getElementById('risk-percent');
  const balance = parseFloat(balanceEl ? balanceEl.value : 1000) || 1000;
  const risk_pct = parseFloat(riskEl ? riskEl.value : 1) || 1;

  // Guest users: persist to localStorage so settings survive a refresh
  if (!sessionToken || sessionToken === 'guest_mode') {
    try {
      localStorage.setItem('jj_guest_prefs', JSON.stringify({ balance, risk_pct, symbol: currentSymbol, timeframe: currentTimeframePref || '' }));
    } catch (e) {}
    return;
  }

  try {
    await api('POST', '/api/preferences', { balance, risk_pct, symbol: currentSymbol, timeframe: currentTimeframePref || '' });
  } catch (e) { /* silent */ }
}

// ── CALCULATORS ────────────────────────────────────────
function calculateThaiGold() {
  const spotEl = document.getElementById('gold-spot-input');
  const rateEl = document.getElementById('usd-thb-input');
  const resultEl = document.getElementById('thai-gold-result');
  if (!spotEl || !rateEl || !resultEl) return;

  const spotInput = parseFloat(spotEl.value) || 0;
  const rateInput = parseFloat(rateEl.value) || 0;
  const thaiBahtPrice = (spotInput * 15.244 * rateInput * 0.965) / 31.1035;
  resultEl.textContent = new Intl.NumberFormat('th-TH', {
    style: 'currency', currency: 'THB', maximumFractionDigits: 0
  }).format(thaiBahtPrice);
}

function calculateRiskLot() {
  const balanceEl = document.getElementById('acc-balance');
  const riskEl = document.getElementById('risk-percent');
  const entryEl = document.getElementById('entry-price');
  const slEl = document.getElementById('sl-price');
  const tpEl = document.getElementById('tp-price');
  const riskUsdEl = document.getElementById('risk-amount-usd');
  const recLotEl = document.getElementById('recommended-lot');
  const rrrEl = document.getElementById('rrr-ratio-val');
  const tpPipEl = document.getElementById('tp-pip-result');
  if (!balanceEl || !riskEl || !riskUsdEl || !recLotEl) return;

  const balance = parseFloat(balanceEl.value) || 0;
  const riskPct = parseFloat(riskEl.value) || 0;
  const entry = parseFloat(entryEl ? entryEl.value : 0) || 0;
  const sl = parseFloat(slEl ? slEl.value : 0) || 0;
  const tp = parseFloat(tpEl ? tpEl.value : 0) || 0;

  const riskUsd = balance * (riskPct / 100);
  const slDistance = Math.abs(entry - sl);
  const tpDistance = Math.abs(tp - entry);

  let lotSize = slDistance > 0 ? riskUsd / (slDistance * 100) : 0.01;
  riskUsdEl.textContent = `$${riskUsd.toFixed(2)}`;
  recLotEl.textContent = `${Math.max(0.01, lotSize).toFixed(2)} Lot`;

  if (slDistance > 0 && tpDistance > 0) {
    const rrr = (tpDistance / slDistance).toFixed(1);
    if (rrrEl) rrrEl.textContent = `1 : ${rrr}`;
    const pips = Math.round(tpDistance * 10);
    if (tpPipEl) tpPipEl.value = `${pips} pips ($${tpDistance.toFixed(1)})`;
  } else {
    if (rrrEl) rrrEl.textContent = '1 : -';
    if (tpPipEl) tpPipEl.value = '0 pips';
  }
}

function calculatePivot() {
  const spotEl = document.getElementById('gold-spot-input');
  const rangeEl = document.getElementById('gold-range-input');
  const algoEl = document.getElementById('pivot-algo');
  const tbody = document.getElementById('pivot-table-body');
  if (!spotEl || !tbody) return;

  const spot = parseFloat(spotEl.value) || 2420.00;
  const range = parseFloat(rangeEl ? rangeEl.value : 30.00) || 30.00;
  const algo = algoEl ? algoEl.value : 'fibonacci';
  let r3, r2, r1, pivot = spot, s1, s2, s3;
  if (algo === 'fibonacci') {
    r3 = pivot + (range * 1.000); r2 = pivot + (range * 0.618); r1 = pivot + (range * 0.382);
    s1 = pivot - (range * 0.382); s2 = pivot - (range * 0.618); s3 = pivot - (range * 1.000);
  } else if (algo === 'camarilla') {
    r3 = pivot + (range * 1.1 / 4); r2 = pivot + (range * 1.1 / 6); r1 = pivot + (range * 1.1 / 12);
    s1 = pivot - (range * 1.1 / 12); s2 = pivot - (range * 1.1 / 6); s3 = pivot - (range * 1.1 / 4);
  } else {
    r3 = pivot + (range * 0.66); r2 = pivot + (range * 0.50); r1 = pivot + (range * 0.25);
    s1 = pivot - (range * 0.25); s2 = pivot - (range * 0.50); s3 = pivot - (range * 0.66);
  }
  tbody.innerHTML = `
    <tr><td class="pivot-r">R3</td><td>แนวต้านแข็งแกร่ง</td><td class="pivot-r">$${r3.toFixed(2)}</td></tr>
    <tr><td class="pivot-r">R2</td><td>แนวต้านเป้าหมาย 2</td><td class="pivot-r">$${r2.toFixed(2)}</td></tr>
    <tr><td class="pivot-r">R1</td><td>แนวต้านเป้าหมาย 1</td><td class="pivot-r">$${r1.toFixed(2)}</td></tr>
    <tr style="background:rgba(212,175,55,0.12)"><td class="pivot-p">PIVOT</td><td>จุดสมดุล (Live)</td><td class="pivot-p">$${pivot.toFixed(2)}</td></tr>
    <tr><td class="pivot-s">S1</td><td>แนวรับเป้าหมาย 1</td><td class="pivot-s">$${s1.toFixed(2)}</td></tr>
    <tr><td class="pivot-s">S2</td><td>แนวรับเป้าหมาย 2</td><td class="pivot-s">$${s2.toFixed(2)}</td></tr>
    <tr><td class="pivot-s">S3</td><td>แนวรับแข็งแกร่ง</td><td class="pivot-s">$${s3.toFixed(2)}</td></tr>
  `;
}

// ── TOOL TABS ──────────────────────────────────────────
function switchToolTab(tabId, btnElement) {
  document.querySelectorAll('.tool-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
}

// ── SESSIONS CLOCK ─────────────────────────────────────
function updateTradingSessionsClock() {
  const now = new Date();
  const getTime = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  const getHour = (tz) => parseInt((new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).formatToParts(now).find(p => p.type === 'hour')?.value) || '0', 10);

  if (document.getElementById('time-sydney')) document.getElementById('time-sydney').textContent = getTime('Australia/Sydney');
  if (document.getElementById('time-tokyo')) document.getElementById('time-tokyo').textContent = getTime('Asia/Tokyo');
  if (document.getElementById('time-london')) document.getElementById('time-london').textContent = getTime('Europe/London');
  if (document.getElementById('time-newyork')) document.getElementById('time-newyork').textContent = getTime('America/New_York');

  const londonHour = getHour('Europe/London');
  const nyHour = getHour('America/New_York');
  const isLondon = londonHour >= 8 && londonHour < 17;
  const isNy = nyHour >= 8 && nyHour < 17;
  const isSydney = getHour('Australia/Sydney') >= 7 && getHour('Australia/Sydney') < 16;
  const isTokyo = getHour('Asia/Tokyo') >= 9 && getHour('Asia/Tokyo') < 18;

  toggleChipActive('session-sydney', isSydney);
  toggleChipActive('session-tokyo', isTokyo);
  toggleChipActive('session-london', isLondon);
  toggleChipActive('session-newyork', isNy);

  const overlapEl = document.getElementById('session-overlap');
  if (overlapEl) overlapEl.style.display = (isLondon && isNy) ? 'flex' : 'none';
}

function toggleChipActive(id, isActive) {
  document.getElementById(id)?.classList.toggle('active', isActive);
}

// ── NOTES (Cloud + Guest local fallback) ─────────────
function getLocalNotes() {
  try { return JSON.parse(localStorage.getItem('jj_local_notes') || '[]'); } catch (e) { return []; }
}
function saveLocalNotes(notes) { localStorage.setItem('jj_local_notes', JSON.stringify(notes)); }

async function loadNotes() {
  const notesContainer = document.getElementById('notes-list');
  if (!notesContainer) return;

  let notes = [];
  if (sessionToken && sessionToken !== 'guest_mode') {
    try {
      const data = await api('GET', '/api/notes');
      if (Array.isArray(data)) notes = data;
    } catch (e) {}
  } else {
    notes = getLocalNotes();
  }

  notesContainer.innerHTML = '';
  if (!notes.length) {
    notesContainer.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:10px;">ยังไม่มีแผนบันทึก...</div>';
    return;
  }
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'note-item';
    item.innerHTML = `
        <div style="flex:1"><div>${escapeHtml(note.text)}</div><div class="note-date">${note.date}</div></div>
        <button class="btn-icon" onclick="deleteNote('${note.id}')">✕</button>
      `;
    notesContainer.appendChild(item);
  });
}

async function addNote() {
  const input = document.getElementById('journal-text');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  if (sessionToken && sessionToken !== 'guest_mode') {
    const res = await api('POST', '/api/notes', { text });
    if (res.ok) {
      if (input) input.value = '';
      showToast('✅ บันทึกแผนเทรดแล้วครับ');
      loadNotes();
    }
  } else {
    const notes = getLocalNotes();
    notes.unshift({ id: Date.now().toString(), text, date: new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) });
    saveLocalNotes(notes);
    if (input) input.value = '';
    showToast('✅ บันทึกแผนเทรดแล้วครับ (บันทึกในเครื่อง)');
    loadNotes();
  }
}

async function deleteNote(id) {
  if (sessionToken && sessionToken !== 'guest_mode') {
    await api('DELETE', `/api/notes/${id}`);
  } else {
    const notes = getLocalNotes().filter(n => n.id !== id);
    saveLocalNotes(notes);
  }
  loadNotes();
}

// ── FOREXFACTORY NEWS CALENDAR & COUNTDOWN ──────────────────
let newsCountdownInterval = null;
let newsRefreshInterval = null;
let currentNewsData = [];
let currentNewsPeriod = 'thisweek';
let currentNewsImpactFilter = 'all';
let currentNewsIsMock = false;

async function loadForexNews(forceRefresh = false) {
  const container = document.getElementById('news-list-container');
  if (!container) return;

  if (forceRefresh || !currentNewsData.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:15px;">⏳ กำลังอัปเดตข้อมูลข่าวจาก ForexFactory...</div>';
    try {
      const res = await fetch(`${API_BASE}/api/news?period=${currentNewsPeriod}`);
      if (res.ok) {
        currentNewsData = await res.json();
        currentNewsIsMock = res.headers.get('X-Mock-Data') === 'true';
      }
    } catch (err) {
      container.innerHTML = '<div style="color:var(--accent-red);font-size:11px;text-align:center;padding:10px;">⚠️ ไม่สามารถโหลดข้อมูลข่าวสารได้</div>';
      return;
    }
  }

  if (!Array.isArray(currentNewsData) || !currentNewsData.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:15px;">ไม่มีข่าวสารในหมวดหมู่นี้...</div>';
    return;
  }

  renderNewsListWithCountdown();

  if (newsCountdownInterval) {
    clearInterval(newsCountdownInterval);
    intervalIds = intervalIds.filter(id => id !== newsCountdownInterval);
  }
  newsCountdownInterval = setInterval(updateNewsCountdowns, 1000);
  intervalIds.push(newsCountdownInterval);

  if (!newsRefreshInterval) {
    newsRefreshInterval = setInterval(() => loadForexNews(true), 5 * 60 * 1000);
    intervalIds.push(newsRefreshInterval);
  }
}

function changeNewsPeriod(period, btnElement) {
  currentNewsPeriod = period;
  document.querySelectorAll('.news-period-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  currentNewsData = [];
  currentNewsIsMock = false;
  loadForexNews(true);
}

function filterNewsImpact(impact, btnElement) {
  currentNewsImpactFilter = impact;
  document.querySelectorAll('.news-impact-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  renderNewsListWithCountdown();
}

function getFilteredNewsData() {
  if (currentNewsImpactFilter === 'all') return currentNewsData;
  return currentNewsData.filter(item => {
    const imp = (item.impact || '').toLowerCase();
    if (currentNewsImpactFilter === 'high') return imp.includes('high') || imp.includes('red');
    if (currentNewsImpactFilter === 'medium') return imp.includes('med') || imp.includes('orange');
    return true;
  });
}

function renderNewsListWithCountdown() {
  const container = document.getElementById('news-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (currentNewsIsMock) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(255,160,0,0.12);border:1px solid #ffa000;color:#ffa000;font-size:10px;text-align:center;padding:6px 8px;border-radius:6px;margin-bottom:8px;';
    banner.textContent = '⚠️ แหล่งข่าวหลักไม่ตอบสนอง กำลังแสดงข้อมูลตัวอย่าง (Mock) เพื่อให้เห็นรูปแบบการแจ้งเตือน';
    container.appendChild(banner);
  }

  const filtered = getFilteredNewsData();

  if (!filtered.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:15px;">ไม่มีข่าวสารตามเงื่อนไขที่เลือก...</div>';
    return;
  }

  filtered.slice(0, 30).forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'news-item';

    let impactBadge = '';
    const impactUpper = (item.impact || 'low').toLowerCase();
    if (impactUpper.includes('high') || impactUpper.includes('red')) {
      impactBadge = '<span style="background:rgba(255,82,82,0.2);border:1px solid var(--accent-red);color:var(--accent-red);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;">🔴 HIGH (ข่าวแรง)</span>';
    } else if (impactUpper.includes('med') || impactUpper.includes('orange')) {
      impactBadge = '<span style="background:rgba(255,160,0,0.2);border:1px solid #ffa000;color:#ffa000;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;">🟠 MEDIUM</span>';
    } else {
      impactBadge = '<span style="background:rgba(255,215,0,0.15);border:1px solid var(--gold-primary);color:var(--gold-light);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;">🟡 LOW</span>';
    }

    const dateObj = item.date ? new Date(item.date) : null;
    const thOpts = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
    const timeStr = dateObj ? dateObj.toLocaleTimeString('th-TH', thOpts) : (item.time || 'ไม่ระบุเวลา');
    const dateStr = dateObj ? dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }) : '';

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;color:var(--gold-light);font-size:11px;">
          <span style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;margin-right:4px;">${escapeHtml(item.country || 'USD')}</span> 
          ${escapeHtml(item.title)}
        </div>
        <div>${impactBadge}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;color:var(--text-muted);font-size:10px;">
        <span>📅 ${dateStr} | ⏰ <strong>${escapeHtml(timeStr)} น.</strong></span>
        <span id="news-cd-${index}" style="font-weight:700;color:var(--accent-cyan);">⏳ กำลังคำนวณ...</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;color:var(--text-muted);font-size:10px;border-top:1px solid rgba(255,255,255,0.05);padding-top:3px;">
        <span>คาดการณ์: <strong style="color:#fff;">${escapeHtml(item.forecast || '-')}</strong> | ครั้งก่อน: <strong style="color:#fff;">${escapeHtml(item.previous || '-')}</strong></span>
        <span>ประกาศ: <strong style="color:var(--accent-green);">${escapeHtml(item.actual || '-')}</strong></span>
      </div>
    `;
    container.appendChild(el);
  });

  updateNewsCountdowns();
}

let newsAudioAlertPlayed = new Set();

function updateNewsCountdowns() {
  const now = new Date().getTime();
  const filtered = getFilteredNewsData();

  filtered.slice(0, 30).forEach((item, index) => {
    const cdEl = document.getElementById(`news-cd-${index}`);
    if (!cdEl) return;
    if (!item.date) {
      cdEl.textContent = 'ไม่ระบุเวลา';
      cdEl.style.color = 'var(--text-muted)';
      return;
    }

    const newsTime = new Date(item.date).getTime();
    if (isNaN(newsTime)) {
      cdEl.textContent = 'ไม่ระบุเวลา';
      cdEl.style.color = 'var(--text-muted)';
      return;
    }
    const diff = newsTime - now;

    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      
      let timerText = '⏳ อีก ';
      if (hours > 0) timerText += `${hours}ชม. `;
      timerText += `${mins}นาที ${secs}วิ`;

      cdEl.textContent = timerText;
      cdEl.style.color = (diff <= 15 * 60 * 1000) ? 'var(--accent-red)' : 'var(--accent-cyan)';

      // Trigger Audio Alert when news is <= 5 minutes away
      if (diff <= 5 * 60 * 1000 && !newsAudioAlertPlayed.has(item.title + item.date)) {
        newsAudioAlertPlayed.add(item.title + item.date);
        playAlertAudio();
        showToast(`🚨 เตือนด่วน! ข่าว ${item.title} (${item.country || 'USD'}) กำลังจะออกในอีก 5 นาที!`);
        sendPushNotification('📰 JJ TRADER ข่าวด่วน!', `${item.title} (${item.country || 'USD'}) กำลังจะออกในอีก 5 นาที!`);
      }

    } else if (diff >= -30 * 60 * 1000) {
      cdEl.textContent = '⚡ ประกาศผลแล้ว / กำลังออกข่าว!';
      cdEl.style.color = 'var(--accent-green)';
    } else {
      cdEl.textContent = '✅ ผ่านไปแล้ว';
      cdEl.style.color = 'var(--text-muted)';
    }
  });
}

// ── REAL-TIME PRICE TICKER & ALERT ENGINE ──────────────────
let previousLivePrice = 0;
let lastKnownLivePrice = 0;
let triggeredAlertIds = new Map();
let assetPrices = {};

async function fetchPriceForSymbol(symbol) {
  let livePrice = 0;
  try {
    if (symbol.includes('XAU') || symbol.includes('GOLD')) {
      // Spot price first (matches the OANDA:XAUUSD chart & real-world gold price).
      // GC=F futures can be ~$50-60 higher than spot, so only fall back to it.
      try {
        const res = await fetch('https://api.gold-api.com/price/XAU');
        if (res.ok) {
          const data = await res.json();
          if (data.price) livePrice = parseFloat(data.price);
        }
      } catch (e) {}

      if (!livePrice) {
        try {
          const res = await fetch(API_BASE + '/api/price?symbol=XAU');
          if (res.ok) {
            const data = await res.json();
            if (data.price) livePrice = parseFloat(data.price);
          }
        } catch (e) {}
      }

      if (!livePrice) {
        try {
          const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
          if (res.ok) {
            const data = await res.json();
            if (data.price) livePrice = parseFloat(data.price);
          }
        } catch (e) {}
      }
    } else if (symbol.includes('XAG') || symbol.includes('SILVER')) {
      // Spot first (matches OANDA:XAGUSD chart); SI=F futures as fallback.
      try {
        const res = await fetch('https://api.gold-api.com/price/XAG');
        if (res.ok) {
          const data = await res.json();
          if (data.price) livePrice = parseFloat(data.price);
        }
      } catch (e) {}

      if (!livePrice) {
        try {
          const res = await fetch(API_BASE + '/api/price?symbol=XAG');
          if (res.ok) {
            const data = await res.json();
            if (data.price) livePrice = parseFloat(data.price);
          }
        } catch (e) {}
      }
    } else if (symbol.includes('BTC')) {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        if (res.ok) {
          const data = await res.json();
          if (data.price) livePrice = parseFloat(data.price);
        }
      } catch (e) {}
    } else if (symbol.includes('USOIL') || symbol.includes('OIL')) {
      // No free direct source allows browser CORS for oil; use our worker proxy
      try {
        const res = await fetch(API_BASE + '/api/price?symbol=USOIL');
        if (res.ok) {
          const data = await res.json();
          if (data.price) livePrice = parseFloat(data.price);
        }
      } catch (e) {}
    } else if (symbol.includes('DXY') || symbol.includes('DOLLAR')) {
      try {
        const res = await fetch(API_BASE + '/api/price?symbol=DXY');
        if (res.ok) {
          const data = await res.json();
          if (data.price) livePrice = parseFloat(data.price);
        }
      } catch (e) {}
    }
  } catch (e) {}
  return livePrice;
}

function startLivePriceTicker() {
  fetchLiveAssetPrice();
  const id = setInterval(fetchLiveAssetPrice, 2500);
  intervalIds.push(id);
}

async function fetchLiveAssetPrice() {
  try {
    const livePrice = await fetchPriceForSymbol(currentSymbol);
    if (livePrice && !isNaN(livePrice)) {
      assetPrices[currentSymbol] = livePrice;
      previousLivePrice = lastKnownLivePrice || livePrice;
      lastKnownLivePrice = livePrice;

      // Update the live price badge next to the asset selector
      const badge = document.getElementById('asset-price-badge');
      if (badge) {
        const meta = SYMBOL_META[currentSymbol];
        const shortTitle = meta ? meta.short : (currentSymbol.split(':').pop() || currentSymbol);
        badge.textContent = `${shortTitle}: $${livePrice.toFixed(2)}`;
      }

      // Only write into the "Gold Spot" calculator input when the active asset IS gold,
      // so the Thai gold / pivot calc is never fed a Bitcoin or DXY price.
      if (currentSymbol.includes('XAU') || currentSymbol.includes('GOLD')) {
        const spotInput = document.getElementById('gold-spot-input');
        if (spotInput && document.activeElement !== spotInput) {
          spotInput.value = livePrice.toFixed(2);
          calculateThaiGold();
          calculatePivot();
        }
      }

      checkPriceAlerts(livePrice);

      // Update V11 PRO Engine on every tick
      try { updateV11ProDashboard(livePrice); } catch(e) {}
      // Keep fib overlay frame in sync with the latest swing high/low
      try { renderV11FibOverlay(); } catch(e) {}
    }
  } catch (e) {}
  // Also evaluate alerts for other assets (each fetches its own live price)
  checkOtherAssetAlerts();
}

async function loadPriceAlerts() {
  const alertsContainer = document.getElementById('alerts-list');
  if (!alertsContainer) return;
  try {
    const data = await api('GET', '/api/alerts');
    priceAlerts = Array.isArray(data) ? data : [];
    renderPriceAlerts();
  } catch (e) {
    priceAlerts = [];
    renderPriceAlerts();
  }
}

function renderPriceAlerts() {
  const container = document.getElementById('alerts-list');
  if (!container) return;
  container.innerHTML = '';
  if (!priceAlerts.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:10px;">ยังไม่มีรายการตั้งเตือน...</div>';
    return;
  }
  priceAlerts.forEach(alert => {
    const item = document.createElement('div');
    item.className = 'alert-item';
    const condText = alert.condition === 'above' ? '≥ (สูงกว่า)' : '≤ (ต่ำกว่า)';
    const targetVal = parseFloat(alert.target_price || alert.price || 0);
    item.innerHTML = `
        <div style="flex:1">🔔 ${escapeHtml(alert.symbol || 'XAUUSD')} ${condText} <strong>$${targetVal.toFixed(2)}</strong></div>
        <button class="btn-icon" onclick="deletePriceAlert('${alert.id}')">✕</button>
      `;
    container.appendChild(item);
  });
}

async function addPriceAlert() {
  const targetEl = document.getElementById('alert-target-price');
  const condEl = document.getElementById('alert-condition');
  const target_price = parseFloat(targetEl ? targetEl.value : 0);
  const condition = condEl ? condEl.value : 'above';

  if (!target_price || isNaN(target_price)) {
    showToast('❌ กรุณากรอกราคาเป้าหมายให้ถูกต้องครับ');
    return;
  }

  const newAlert = { id: Date.now().toString(), symbol: currentSymbol, target_price, condition };

  if (sessionToken && sessionToken !== 'guest_mode') {
    const res = await api('POST', '/api/alerts', newAlert);
    if (res && res.id) newAlert.id = res.id;
  }

  priceAlerts.push(newAlert);
  renderPriceAlerts();
  if (targetEl) targetEl.value = '';
  showToast(`🔔 เพิ่มการตั้งเตือนราคา $${target_price.toFixed(2)} เรียบร้อยแล้ว`);
}

async function deletePriceAlert(id) {
  priceAlerts = priceAlerts.filter(a => a.id !== id);
  renderPriceAlerts();
  if (sessionToken && sessionToken !== 'guest_mode') {
    await api('DELETE', `/api/alerts/${id}`);
  }
}

function normalizeSymbol(sym) {
  return String(sym || '').split(':').pop().toUpperCase();
}

function checkPriceAlerts(currentPrice) {
  const currentSym = normalizeSymbol(currentSymbol);
  priceAlerts.forEach(alert => {
    const alertSym = normalizeSymbol(alert.symbol);
    // Only evaluate alerts for the currently active asset with the passed-in price
    if (alertSym && alertSym !== currentSym) return;
    evaluateAlert(alert, currentPrice);
  });
}

async function checkOtherAssetAlerts() {
  try {
    const currentSym = normalizeSymbol(currentSymbol);
    for (const alert of priceAlerts) {
      const alertSym = normalizeSymbol(alert.symbol);
      if (!alertSym || alertSym === currentSym) continue;
      const price = await fetchPriceForSymbol(alert.symbol || alertSym);
      if (price && !isNaN(price) && price > 0) {
        assetPrices[alertSym] = price;
        evaluateAlert(alert, price);
      }
    }
  } catch (e) {}
}

function evaluateAlert(alert, currentPrice) {
  const target = parseFloat(alert.target_price || alert.price);
  if (isNaN(target) || !currentPrice || isNaN(currentPrice)) return;

  // Hysteresis: only re-arm after price moves a small margin away from target
  const buffer = target * 0.0005;
  let triggered = false;
  if (alert.condition === 'above' && currentPrice >= target) triggered = true;
  if (alert.condition === 'below' && currentPrice <= target) triggered = true;

  const lastState = triggeredAlertIds.get(alert.id);
  if (triggered) {
    if (lastState === 'fired') return; // already fired
    triggeredAlertIds.set(alert.id, 'fired');
    playAlertAudio();
    const symLabel = alert.symbol || 'XAUUSD';
    showToast(`🚨 ALERT! ${symLabel} แตะเป้าหมาย $${target.toFixed(2)} แล้ว (ราคาปัจจุบัน $${currentPrice.toFixed(2)})`);
    sendPushNotification('🚨 JJ TRADER ALERT!', `${symLabel} แตะเป้าหมาย $${target.toFixed(2)} (ราคาปัจจุบัน $${currentPrice.toFixed(2)})`);
  } else {
    // Re-arm when price clearly moved away from the target
    const away = alert.condition === 'above' ? currentPrice <= (target - buffer) : currentPrice >= (target + buffer);
    if (away) triggeredAlertIds.set(alert.id, 'armed');
  }
}

function playAlertAudio() {
  try {
    tone(880, 0.8, 'sine', 0.3); // A5 note
  } catch (e) {}
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJs(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`');
}

// ── TEAM CHAT (polling, floating window) ───────────────
let chatPollingInterval = null;
let chatLastId = 0;
let chatMessageCache = [];
let chatInitialSyncDone = false;
let chatPendingImage = null;
let chatWindowOpen = false;
let chatUnreadCount = 0;
let chatSoundEnabled = (localStorage.getItem('jj_chat_sound') || 'on') === 'on';
let chatSoundType = localStorage.getItem('jj_chat_sound_type') || 'ding';
let chatDisplayName = null;
let chatAvatar = null;
let chatUserId = null;
let chatOnlineUsers = [];
const BASE_PAGE_TITLE = document.title;

const CHAT_SOUNDS = {
  ding:   { name: 'ติ๊ง', play: () => tone(880, 0.12, 'sine', 0.16) },
  pop:    { name: 'ป๊อป', play: () => sweep(220, 660, 0.18, 'triangle', 0.14) },
  chime:  { name: 'กระดิ่ง', play: () => { tone(1046, 0.18, 'sine', 0.14); setTimeout(() => tone(1568, 0.28, 'sine', 0.1), 130); } },
  beep:   { name: 'บี๊บ', play: () => { tone(784, 0.1, 'square', 0.1); setTimeout(() => tone(988, 0.14, 'square', 0.1), 120); } },
  marimba:{ name: 'มาริมบา', play: () => { tone(987, 0.12, 'sine', 0.16); setTimeout(() => tone(784, 0.16, 'sine', 0.16), 110); } },
};

let _sharedAudioCtx = null;

function getAudioContext() {
  try {
    if (!_sharedAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      _sharedAudioCtx = new AC();
    }
    // Resume to satisfy browser autoplay policy (Chrome/Edge block suspended contexts)
    if (_sharedAudioCtx.state === 'suspended') {
      _sharedAudioCtx.resume().catch(() => {});
    }
    return _sharedAudioCtx;
  } catch (e) { return null; }
}

// Unlock audio on the first user gesture so later sounds play without extra clicks
function unlockChatAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch (e) {}
}
document.addEventListener('click', unlockChatAudio, { once: false });
document.addEventListener('touchstart', unlockChatAudio, { once: false });
document.addEventListener('keydown', unlockChatAudio, { once: false });

function tone(freq, dur, type = 'sine', vol = 0.12) {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.05);
  } catch (e) {}
}

function sweep(from, to, dur, type = 'sine', vol = 0.12) {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.05);
  } catch (e) {}
}

function updateChatSoundToggleUI() {
  const btn = document.getElementById('chat-sound-toggle');
  if (!btn) return;
  btn.textContent = chatSoundEnabled ? '🔔' : '🔕';
  btn.classList.toggle('off', !chatSoundEnabled);
  btn.title = chatSoundEnabled ? 'เสียงแจ้งเตือนเปิดอยู่ (แตะเพื่อปิด)' : 'เสียงแจ้งเตือนปิดอยู่ (แตะเพื่อเปิด)';
}

function updateChatSoundTypeUI() {
  const sndBtn = document.getElementById('chat-sound-type-toggle');
  if (!sndBtn) return;
  const snd = CHAT_SOUNDS[chatSoundType] || CHAT_SOUNDS.ding;
  sndBtn.textContent = snd.name;
  sndBtn.title = `เสียงปัจจุบัน: ${snd.name} (แตะเพื่อเปลี่ยนเสียง)`;
}

// ── CHAT PROFILE (display name + avatar) ───────────────
function chatIdentityName() {
  return chatDisplayName || currentUsername || 'Guest Trader';
}

function chatIdentityAvatar() {
  return chatAvatar || null;
}

function initialsFor(name) {
  const s = String(name || '?').trim();
  return (s.charAt(0) || '?').toUpperCase();
}

function avatarHtml(userName, avatarSrc, sizeClass = '') {
  const name = String(userName || '?');
  if (avatarSrc) {
    return `<span class="chat-avatar ${sizeClass}" title="${escapeHtml(name)}"><img src="${escapeHtml(avatarSrc)}" alt=""></span>`;
  }
  const hue = Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  return `<span class="chat-avatar chat-avatar-initials ${sizeClass}" style="--avatar-hue:${hue}" title="${escapeHtml(name)}">${escapeHtml(initialsFor(name))}</span>`;
}

async function loadChatProfile() {
  if (sessionToken && sessionToken !== 'guest_mode') {
    try {
      const data = await api('GET', '/api/profile');
      if (data && !data.isGuest && !data.error) {
        chatDisplayName = data.display_name || null;
        chatAvatar = data.avatar || null;
        chatUserId = data.user_id || null;
      }
    } catch (e) {}
  } else {
    chatDisplayName = localStorage.getItem('jj_chat_display_name') || null;
    chatAvatar = localStorage.getItem('jj_chat_avatar') || null;
  }
  updateChatProfileUI();
}

function updateChatProfileUI() {
  const headerAvatar = document.getElementById('chat-my-avatar');
  if (headerAvatar) headerAvatar.innerHTML = avatarHtml(chatIdentityName(), chatIdentityAvatar(), 'chat-avatar-lg');
  const headerName = document.getElementById('chat-my-name');
  if (headerName) headerName.textContent = chatIdentityName();
}

function openChatProfileSettings() {
  const modal = document.getElementById('chat-profile-modal');
  if (!modal) return;
  delete window.__chatAvatarPending;
  delete window.__chatAvatarRemove;
  const nameInput = document.getElementById('chat-profile-name');
  const preview = document.getElementById('chat-profile-preview');
  if (nameInput) nameInput.value = chatDisplayName || '';
  if (preview) preview.innerHTML = avatarHtml(chatIdentityName(), chatIdentityAvatar(), 'chat-avatar-xl');
  modal.classList.add('open');
}

function closeChatProfileSettings() {
  const modal = document.getElementById('chat-profile-modal');
  if (modal) modal.classList.remove('open');
}

function handleChatProfileAvatarSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('❌ กรุณาเลือกไฟล์รูปภาพเท่านั้นครับ');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('❌ รูปใหญ่เกินไป (สูงสุด 5MB) กรุณาเลือกไฟล์ที่เล็กลง');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 200;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const preview = document.getElementById('chat-profile-preview');
        if (preview) preview.innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.85)}" alt="ภาพโปรไฟล์">`;
        window.__chatAvatarPending = canvas.toDataURL('image/jpeg', 0.85);
      } catch (e) {
        showToast('❌ ไม่สามารถประมวลผลรูปภาพได้');
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveChatProfile() {
  const nameInput = document.getElementById('chat-profile-name');
  const newName = nameInput ? nameInput.value.trim() : '';
  const hasNewAvatar = !!window.__chatAvatarPending;
  const wantsRemove = !!window.__chatAvatarRemove;

  if (sessionToken && sessionToken !== 'guest_mode') {
    if (!newName) {
      showToast('❌ กรุณากรอกชื่อแสดงผล (อย่างน้อย 1 ตัวอักษร)');
      return;
    }
    const payload = { display_name: newName };
    if (hasNewAvatar) payload.avatar = window.__chatAvatarPending;
    if (wantsRemove) payload.avatar = null;
    const res = await api('POST', '/api/profile', payload);
    if (res && res.error && !res.isGuest) {
      showToast('❌ ' + res.error);
      return;
    }
  } else {
    localStorage.setItem('jj_chat_display_name', newName);
    if (hasNewAvatar) localStorage.setItem('jj_chat_avatar', window.__chatAvatarPending);
    if (wantsRemove) localStorage.removeItem('jj_chat_avatar');
  }

  chatDisplayName = newName;
  if (hasNewAvatar) chatAvatar = window.__chatAvatarPending;
  if (wantsRemove) chatAvatar = null;
  delete window.__chatAvatarPending;
  delete window.__chatAvatarRemove;
  closeChatProfileSettings();
  updateChatProfileUI();
  renderChatMessages();
  showToast('✅ บันทึกโปรไฟล์แชทแล้ว');
}

function removeChatAvatar() {
  delete window.__chatAvatarPending;
  window.__chatAvatarRemove = true;
  const preview = document.getElementById('chat-profile-preview');
  if (preview) preview.innerHTML = avatarHtml(chatIdentityName(), null, 'chat-avatar-xl');
}

function cycleChatSoundType() {
  const types = Object.keys(CHAT_SOUNDS);
  const idx = types.indexOf(chatSoundType);
  chatSoundType = types[(idx + 1) % types.length];
  localStorage.setItem('jj_chat_sound_type', chatSoundType);
  const sndBtn = document.getElementById('chat-sound-type-toggle');
  if (sndBtn) {
    sndBtn.textContent = CHAT_SOUNDS[chatSoundType].name;
    sndBtn.title = `เสียงปัจจุบัน: ${CHAT_SOUNDS[chatSoundType].name} (แตะเพื่อเปลี่ยนเสียง)`;
  }
  playChatNewMessageSound();
  showToast(`🎵 เปลี่ยนเสียงแจ้งเตือนเป็น: ${CHAT_SOUNDS[chatSoundType].name}`);
}

function toggleChatSound() {
  chatSoundEnabled = !chatSoundEnabled;
  localStorage.setItem('jj_chat_sound', chatSoundEnabled ? 'on' : 'off');
  updateChatSoundToggleUI();
  if (chatSoundEnabled) {
    requestChatNotificationPermission();
    playChatNewMessageSound();
    showToast('🔔 เปิดเสียงแจ้งเตือนแล้ว');
  } else {
    showToast('🔕 ปิดเสียงแจ้งเตือนแล้ว');
  }
}

function requestChatNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}
}

function notifyChatUnread(username, message) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('💬 แชททีม', {
        body: (username || 'สมาชิก') + ': ' + (message || 'ส่งรูปภาพ'),
        tag: 'jj-team-chat',
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text y="46" font-size="44">💬</text></svg>'
      });
      n.onclick = () => {
        window.focus();
        toggleChatWindow(true);
        n.close();
      };
    }
  } catch (e) {}
}

function toggleChatWindow(forceOpen) {
  const win = document.getElementById('chat-window');
  const fab = document.getElementById('chat-fab');
  if (!win) return;
  chatWindowOpen = (typeof forceOpen === 'boolean') ? forceOpen : !chatWindowOpen;
  if (chatWindowOpen) {
    win.classList.add('open');
    chatUnreadCount = 0;
    updateChatUnreadBadge();
    renderChatMessages();
    const input = document.getElementById('chat-input');
    if (input) input.focus();
    startChatPolling();
  } else {
    win.classList.remove('open');
  }
}

function updateChatUnreadBadge() {
  const badge = document.getElementById('chat-unread-badge');
  if (badge) {
    badge.textContent = chatUnreadCount > 99 ? '99+' : chatUnreadCount;
    badge.classList.toggle('show', chatUnreadCount > 0 && !chatWindowOpen);
  }
  // Mirror unread count onto the browser tab title like typical chat apps
  if (chatUnreadCount > 0) {
    document.title = `(${chatUnreadCount > 99 ? '99+' : chatUnreadCount}) ${BASE_PAGE_TITLE}`;
  } else {
    document.title = BASE_PAGE_TITLE;
  }
}

function startChatPolling() {
  if (chatPollingInterval) return;
  fetchChatMessages();
  chatPollingInterval = setInterval(fetchChatMessages, 3000);
  intervalIds.push(chatPollingInterval);
}

function stopChatPolling() {
  if (chatPollingInterval) {
    clearInterval(chatPollingInterval);
    chatPollingInterval = null;
  }
}

async function fetchChatMessages() {
  if (sessionToken && sessionToken !== 'guest_mode') {
    try {
      const data = await api('GET', `/api/chat?after=${chatLastId}`);
      if (data && !data.isGuest && !data.error) {
        // New API shape: { messages: [], online: [] }; fall back to plain array
        const messages = Array.isArray(data) ? data : (data.messages || []);
        if (Array.isArray(data.online)) {
          chatOnlineUsers = data.online;
          updateChatOnlineUI();
        }
        if (messages.length) {
          chatMessageCache = chatMessageCache.concat(messages).slice(-200);
          chatLastId = messages[messages.length - 1].id;
          // First sync after page load: only fast-forward the last-read id so
          // historical messages are NOT counted as unread.
          if (!chatInitialSyncDone) {
            chatInitialSyncDone = true;
            if (chatWindowOpen) renderChatMessages();
            return;
          }
          if (chatWindowOpen) {
            renderChatMessages();
          } else {
            const latest = messages[messages.length - 1];
            // Count as unread + play sound whenever the chat window is closed
            // (tab hidden or not), like a real chat app
            chatUnreadCount += messages.length;
            updateChatUnreadBadge();
            if (chatSoundEnabled) playChatNewMessageSound();
            if (document.hidden || document.visibilityState !== 'visible') {
              notifyChatUnread(latest.display_name || latest.username, latest.message);
            }
          }
        }
      }
    } catch (e) {}
  }
}

// Clear unread badge when the user comes back to the tab and the chat is open
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && chatWindowOpen) {
    chatUnreadCount = 0;
    updateChatUnreadBadge();
  }
});

function updateChatOnlineUI() {
  const el = document.getElementById('chat-online-count');
  if (el) el.textContent = chatOnlineUsers.length;
}

function onChatInputChange() {
  const input = document.getElementById('chat-input');
  const dd = document.getElementById('chat-mention-dropdown');
  if (!input || !dd) return;
  const text = input.value;
  const match = text.match(/@([\u0E00-\u0E7FA-Za-z0-9_]*)$/);
  if (!match || !chatOnlineUsers.length) { dd.classList.remove('open'); return; }
  const q = match[1].toLowerCase();
  const list = chatOnlineUsers.filter(u => (u.display_name || u.username).toLowerCase().includes(q));
  if (!list.length) { dd.classList.remove('open'); return; }
  dd.innerHTML = list.slice(0, 6).map(u => {
    const name = u.display_name || u.username;
    return `<button type="button" class="chat-mention-item" onclick="insertChatMention('${escapeJs(name)}')">${avatarHtml(name, null, '')}${escapeHtml(name)}</button>`;
  }).join('');
  dd.classList.add('open');
}

function insertChatMention(name) {
  const input = document.getElementById('chat-input');
  const dd = document.getElementById('chat-mention-dropdown');
  if (!input) return;
  const text = input.value.replace(/@[\u0E00-\u0E7FA-Za-z0-9_]*$/, '@' + name + ' ');
  input.value = text;
  input.focus();
  if (dd) dd.classList.remove('open');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMentions(htmlText) {
  return htmlText.replace(/@([\u0E00-\u0E7FA-Za-z0-9_]+)/g, '<span class="chat-mention">@$1</span>');
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  if (!chatMessageCache.length) {
    container.innerHTML = '<div class="empty-state">ยังไม่มีข้อความ... เป็นคนแรกที่พิมพ์ครับ</div>';
    return;
  }
  const shouldScroll = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;
  container.innerHTML = '';
  chatMessageCache.forEach(msg => {
    const item = document.createElement('div');
    const isMine = msg.user_id
      ? (chatUserId && msg.user_id === chatUserId)
      : (msg.username === currentUsername);
    item.className = 'chat-msg' + (isMine ? ' mine' : '');
    const showName = msg.display_name || msg.username || '?';
    let body = '';
    if (msg.message) body += `<div class="chat-msg-text">${highlightMentions(escapeHtml(msg.message))}</div>`;
    if (msg.image) {
      body += `<img class="chat-msg-img" src="${escapeHtml(msg.image)}" alt="ภาพจากแชท" onclick="openChatLightbox('${escapeJs(msg.image)}')">`;
    }
    item.innerHTML = `
      ${avatarHtml(showName, msg.avatar || null)}
      <div class="chat-msg-content">
        <div class="chat-msg-head">
          <span class="chat-msg-user">${escapeHtml(showName)}</span>
          <span class="chat-msg-time">${escapeHtml(msg.created_at || '')}</span>
        </div>
        ${body}
      </div>
    `;
    container.appendChild(item);
  });
  if (shouldScroll || chatWindowOpen) container.scrollTop = container.scrollHeight;
}

function shareV11Signal() {
  if (!sessionToken || sessionToken === 'guest_mode') {
    showToast('❌ ต้องล็อกอินเป็นสมาชิกก่อนแชร์สัญญาณครับ');
    return;
  }
  const $ = id => document.getElementById(id);
  const entry = ($('v11-val-entry')?.textContent || '').trim();
  if (!entry || entry === '--') {
    showToast('❌ ยังไม่มีสัญญาณ V11 ให้แชร์ — รอข้อมูลสวิงก่อนครับ');
    return;
  }
  const sig = ($('v11-signal-badge')?.textContent || '').trim();
  const dir = /SELL/i.test(sig) ? '🔴 SELL' : (/BUY/i.test(sig) ? '🟢 BUY' : '⏸️ WAIT');
  const trend = ($('v11-trend-badge')?.textContent || '').trim();
  const tf = ($('v11-tf-badge')?.textContent || '⚡ 5นาที').trim();
  const tp1 = ($('v11-val-tp1')?.textContent || '-').trim();
  const tp2 = ($('v11-val-tp2')?.textContent || '-').trim();
  const tp3 = ($('v11-val-tp3')?.textContent || '-').trim();
  const sl = ($('v11-val-sl')?.textContent || '-').trim();
  const live = ($('v11-val-live')?.textContent || '-').trim();
  const msg = [
    `⚡ V11 SIGNAL XAU/USD • ${tf}`,
    `${dir} ${trend}`,
    `💰 Entry: ${entry}`,
    `🎯 TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}`,
    `🛑 SL: ${sl}`,
    `📡 Live: ${live}`,
  ].join('\n');
  api('POST', '/api/chat', { message: msg }).then(res => {
    if (res && res.ok) {
      chatMessageCache.push({
        id: res.id, user_id: chatUserId, username: currentUsername,
        display_name: chatIdentityName(), avatar: chatAvatar,
        message: msg, image: null,
        created_at: res.created_at || new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
      });
      chatLastId = res.id;
      toggleChatWindow(true);
      renderChatMessages();
      showToast('📤 แชร์สัญญาณ V11 ไปที่แชททีมแล้ว');
    } else {
      showToast('❌ แชร์สัญญาณไม่สำเร็จ กรุณาลองใหม่ครับ');
    }
  }).catch(() => showToast('❌ แชร์สัญญาณไม่สำเร็จ กรุณาลองใหม่ครับ'));
}

function playChatNewMessageSound() {
  try {
    const snd = CHAT_SOUNDS[chatSoundType] || CHAT_SOUNDS.ding;
    snd.play();
  } catch (e) {}
}

function handleChatImageSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('❌ กรุณาเลือกไฟล์รูปภาพเท่านั้นครับ');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('❌ รูปใหญ่เกินไป (สูงสุด 5MB) กรุณาเลือกไฟล์ที่เล็กลง');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    compressChatImage(e.target.result, (compressed) => {
      chatPendingImage = compressed;
      const preview = document.getElementById('chat-image-preview');
      const previewImg = document.getElementById('chat-image-preview-img');
      if (preview && previewImg) {
        preview.style.display = 'block';
        previewImg.src = compressed;
      }
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function compressChatImage(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const MAX_W = 1000;
    const MAX_H = 1000;
    let { width, height } = img;
    if (width > MAX_W || height > MAX_H) {
      const ratio = Math.min(MAX_W / width, MAX_H / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    // JPEG quality 0.75; PNG stays PNG (needed for transparency)
    const mime = img.src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    callback(canvas.toDataURL(mime, 0.75));
  };
  img.onerror = () => { showToast('❌ ไม่สามารถอ่านไฟล์รูปได้'); };
  img.src = dataUrl;
}

function clearChatImage() {
  chatPendingImage = null;
  const preview = document.getElementById('chat-image-preview');
  const input = document.getElementById('chat-image-input');
  if (preview) preview.style.display = 'none';
  if (input) input.value = '';
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input ? input.value.trim() : '';
  if (!text && !chatPendingImage) return;
  if (!sessionToken || sessionToken === 'guest_mode') {
    showToast('❌ ต้องล็อกอินเป็นสมาชิกก่อนถึงจะพิมพ์แชทได้ครับ');
    return;
  }
  try {
    const payload = { message: text };
    if (chatPendingImage) payload.image = chatPendingImage;
    const res = await api('POST', '/api/chat', payload);
    if (res && res.ok) {
      const sentImage = chatPendingImage;
      if (input) input.value = '';
      clearChatImage();
      // Immediately include own message in the cache for snappy UX
      if (res.id > chatLastId) {
        chatMessageCache.push({
          id: res.id,
          user_id: chatUserId || null,
          username: currentUsername,
          display_name: chatIdentityName(),
          avatar: chatAvatar,
          message: text,
          image: sentImage || null,
          created_at: res.created_at || new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
        });
        chatLastId = res.id;
        renderChatMessages();
      }
    } else {
      showToast('❌ ไม่สามารถส่งข้อความได้ กรุณาลองใหม่ครับ');
    }
  } catch (e) {
    showToast('❌ ไม่สามารถส่งข้อความได้ กรุณาลองใหม่ครับ');
  }
}

function openChatLightbox(src) {
  const overlay = document.getElementById('chat-lightbox');
  const img = document.getElementById('chat-lightbox-img');
  if (!overlay || !img) return;
  img.src = src;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeChatLightbox() {
  const overlay = document.getElementById('chat-lightbox');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ESC closes lightbox / profile modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeChatLightbox();
    closeChatProfileSettings();
  }
});

// Enter key sends chat
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'chat-input') {
    e.preventDefault();
    sendChatMessage();
  }
});

// ── TRADE JOURNAL & PERFORMANCE ANALYTICS ──────────────────
const CURRENCY_SYMBOLS = { USD: '$', USDT: '₮', USDC: '$', THB: '฿' };

function currencySymbolOf(currency) {
  return CURRENCY_SYMBOLS[currency] || '$';
}

function getLocalTradeLogs() {
  try {
    return JSON.parse(localStorage.getItem('jj_trade_logs') || '[]');
  } catch (e) { return []; }
}

function saveLocalTradeLogs(logs) {
  localStorage.setItem('jj_trade_logs', JSON.stringify(logs));
}

function addTradeLogRecord() {
  const dirEl = document.getElementById('log-input-dir');
  const currencyEl = document.getElementById('log-input-currency');
  const lotEl = document.getElementById('log-input-lot');
  const entryEl = document.getElementById('log-input-entry');
  const closeEl = document.getElementById('log-input-close');
  const noteEl = document.getElementById('log-input-note');

  const direction = dirEl ? dirEl.value : 'BUY';
  const currency = currencyEl ? currencyEl.value : 'USD';
  const currencySymbol = CURRENCY_SYMBOLS[currency] || '$';
  const lot = parseFloat(lotEl ? lotEl.value : 0.01) || 0.01;
  const entry = parseFloat(entryEl ? entryEl.value : 0);
  const close = parseFloat(closeEl ? closeEl.value : 0);
  const note = noteEl ? noteEl.value.trim() : '';

  if (!entry || !close || isNaN(entry) || isNaN(close)) {
    showToast('❌ กรุณากรอกราคาเข้า (Entry) และราคาปิด (Close) ให้ครบถ้วนครับ');
    return;
  }

  // Calculate P&L for 100 multiplier (Gold/Forex standard)
  let pnl = 0;
  if (direction === 'BUY') {
    pnl = (close - entry) * lot * 100;
  } else {
    pnl = (entry - close) * lot * 100;
  }

  const record = {
    id: Date.now().toString(),
    date: new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
    symbol: currentSymbol ? currentSymbol.replace(/.*:/, '') : 'XAUUSD',
    direction,
    currency,
    lot,
    entry: entry.toFixed(2),
    close: close.toFixed(2),
    pnl: pnl.toFixed(2),
    result: pnl >= 0 ? 'WIN' : 'LOSS',
    note: note || '-'
  };

  const logs = getLocalTradeLogs();
  logs.unshift(record);
  saveLocalTradeLogs(logs);

  if (entryEl) entryEl.value = '';
  if (closeEl) closeEl.value = '';
  if (noteEl) noteEl.value = '';

  showToast(pnl >= 0 ? `✅ บันทึกออเดอร์: กำไร +${currencySymbol}${pnl.toFixed(2)}` : `📉 บันทึกออเดอร์: ขาดทุน -${currencySymbol}${Math.abs(pnl).toFixed(2)}`);
  loadTradeLogs().then(() => renderTradeDashboard());

  // Sync to cloud if logged in
  if (sessionToken && sessionToken !== 'guest_mode') {
    api('POST', '/api/history', {
      symbol: record.symbol, direction, entry: parseFloat(entry), close: parseFloat(close), sl: 0, tp: 0,
      lot, result: record.result, pnl: parseFloat(pnl), note, currency
    }).then(res => {
      // Adopt the server-generated UUID so a later delete hits the right row
      if (res && res.id) {
        const logs = getLocalTradeLogs();
        const idx = logs.findIndex(r => r.id === record.id);
        if (idx !== -1) {
          logs[idx].id = res.id;
          saveLocalTradeLogs(logs);
        }
      }
    }).catch(() => {});
  }
}

function deleteTradeLogRecord(id) {
  let logs = getLocalTradeLogs();
  logs = logs.filter(item => item.id !== id);
  saveLocalTradeLogs(logs);
  loadTradeLogs().then(() => renderTradeDashboard());

  // Sync delete to cloud if logged in
  if (sessionToken && sessionToken !== 'guest_mode') {
    api('DELETE', `/api/history/${id}`).catch(() => {});
  }
}

async function loadTradeLogs() {
  const container = document.getElementById('trade-log-list-container');
  const countEl = document.getElementById('log-stat-count');
  const winRateEl = document.getElementById('log-stat-winrate');
  const pnlEl = document.getElementById('log-stat-pnl');

  if (container) container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:12px;">⏳ กำลังโหลดประวัติเทรด...</div>';

  // Try loading from cloud first when logged in
  if (sessionToken && sessionToken !== 'guest_mode') {
    try {
      const remote = await api('GET', '/api/history');
      if (Array.isArray(remote) && remote.length) {
        // Merge: keep newer local records that haven't synced yet (no server id)
        const local = getLocalTradeLogs();
        const merged = remote.slice();
        const remoteIds = new Set(remote.map(r => r.id));
        local.forEach(l => { if (!remoteIds.has(l.id)) merged.push(l); });
        saveLocalTradeLogs(merged);
      }
    } catch (e) {}
  }

  const logs = getLocalTradeLogs();

  // Update Summary Dashboard
  if (countEl) countEl.textContent = logs.length;
  if (logs.length > 0) {
    const wins = logs.filter(l => l.result === 'WIN').length;
    const winRate = ((wins / logs.length) * 100).toFixed(0);

    // Dominant currency for the summary total
    const freq = {};
    logs.forEach(l => { const c = l.currency || 'USD'; freq[c] = (freq[c] || 0) + 1; });
    const mainCur = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || 'USD';
    const sym = currencySymbolOf(mainCur);
    const mainLogs = logs.filter(l => (l.currency || 'USD') === mainCur);
    const totalPnl = mainLogs.reduce((sum, l) => sum + parseFloat(l.pnl), 0);

    if (winRateEl) {
      winRateEl.textContent = `${winRate}%`;
      winRateEl.style.color = parseInt(winRate) >= 50 ? 'var(--accent-green)' : 'var(--accent-red)';
    }
    if (pnlEl) {
      pnlEl.textContent = `${totalPnl >= 0 ? '+' : ''}${sym}${totalPnl.toFixed(2)}`;
      pnlEl.style.color = totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      pnlEl.title = `P&L รวมเฉพาะสกุล ${mainCur} (${mainLogs.length} รายการ)`;
    }
  } else {
    if (winRateEl) { winRateEl.textContent = '0%'; winRateEl.style.color = 'var(--accent-green)'; }
    if (pnlEl) { pnlEl.textContent = '$0.00'; pnlEl.style.color = 'var(--text-main)'; }
  }

  if (!container) return;
  if (!logs.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:12px;">ยังไม่มีประวัติการเทรด...</div>';
    return;
  }

  container.innerHTML = '';
  logs.forEach(l => {
    const item = document.createElement('div');
    item.className = 'trade-item';

    const isWin = l.result === 'WIN';
    const dirBadge = l.direction === 'BUY'
      ? '<span class="badge-dir buy">🟢 BUY</span>'
      : '<span class="badge-dir sell">🔴 SELL</span>';

    const resultBadge = isWin
      ? '<span class="badge-result win">WIN</span>'
      : '<span class="badge-result loss">LOSS</span>';

    const sym = currencySymbolOf(l.currency || 'USD');
    const pnlClass = parseFloat(l.pnl) >= 0 ? 'pnl-positive' : 'pnl-negative';
    const pnlText = `${parseFloat(l.pnl) >= 0 ? '+' : ''}${sym}${l.pnl}`;
    const safeSym = escapeHtml(l.symbol || '');
    const safeEntry = escapeHtml(l.entry);
    const safeClose = (l.close !== undefined && l.close !== null) ? sym + escapeHtml(l.close) : '-';
    const safeCur = escapeHtml(l.currency || 'USD');

    item.innerHTML = `
      <div class="trade-info">
        <div class="trade-row">
          ${dirBadge}
          <strong class="text-gold">${safeSym}</strong>
          <span style="color:var(--text-muted)">${escapeHtml(l.lot)} Lot</span>
          <span class="badge-cur">${safeCur}</span>
          ${resultBadge}
        </div>
        <div class="trade-row-secondary">
          ${sym}${safeEntry} ➔ ${safeClose} | P&L: <strong class="${pnlClass}">${pnlText}</strong>
        </div>
        ${l.note !== '-' ? `<div class="trade-note">💡 ${escapeHtml(l.note)}</div>` : ''}
      </div>
      <button class="btn-icon" onclick="deleteTradeLogRecord('${l.id}')" title="ลบ">✕</button>
    `;
    container.appendChild(item);
  });
}

// ── PERFORMANCE DASHBOARD ─────────────────────────────
function formatPnlShort(v) {
  return (v >= 0 ? '+' : '') + '$' + v.toFixed(1);
}

function renderTradeDashboard() {
  const logs = getLocalTradeLogs();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  const wins = logs.filter(l => l.result === 'WIN').length;
  const losses = logs.length - wins;
  const totalPnl = logs.reduce((s, l) => s + parseFloat(l.pnl || 0), 0);
  const avgPnl = logs.length ? totalPnl / logs.length : 0;
  const best = logs.length ? Math.max(...logs.map(l => parseFloat(l.pnl || 0))) : 0;
  const worst = logs.length ? Math.min(...logs.map(l => parseFloat(l.pnl || 0))) : 0;
  const winRate = logs.length ? (wins / logs.length) * 100 : 0;

  set('dash-count', logs.length);
  set('dash-wins', wins);
  set('dash-losses', losses);
  set('dash-best', best >= 0 ? '+' + best.toFixed(0) : best.toFixed(0));
  set('dash-worst', worst.toFixed(0));

  const wrEl = document.getElementById('dash-winrate');
  if (wrEl) {
    wrEl.textContent = winRate.toFixed(0) + '%';
    wrEl.style.color = winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)';
  }
  const pnlEl = document.getElementById('dash-pnl');
  if (pnlEl) {
    pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
    pnlEl.style.color = totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  }
  const avgEl = document.getElementById('dash-avg');
  if (avgEl) {
    avgEl.textContent = (avgPnl >= 0 ? '+' : '') + '$' + avgPnl.toFixed(2);
    avgEl.style.color = avgPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  }

  const emptyEl = document.getElementById('dash-equity-empty');
  if (emptyEl) emptyEl.style.display = logs.length ? 'none' : 'flex';

  const canvas = document.getElementById('dash-equity-canvas');
  if (canvas && logs.length) drawEquityCurve(canvas, logs);
}

function drawEquityCurve(canvas, logs) {
  const wrap = canvas.parentElement;
  const width = wrap ? wrap.clientWidth : 600;
  if (width < 60) return; // panel hidden — will redraw when tab opens
  const height = Math.max(150, Math.round(width * 0.36));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padL = 10, padR = 10, padT = 18, padB = 14;
  const cw = width - padL - padR;
  const ch = height - padT - padB;

  ctx.strokeStyle = 'rgba(128,140,160,0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (ch / 4) * i;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const series = logs.slice().reverse().map(l => ({ pnl: parseFloat(l.pnl || 0), win: l.result === 'WIN' }));
  const points = [];
  let cum = 0;
  series.forEach(s => { cum += s.pnl; points.push(cum); });

  const maxV = Math.max(...points, 0);
  const minV = Math.min(...points, 0);
  const range = (maxV - minV) || 1;
  const padV = range * 0.08;
  const x = i => padL + (i / Math.max(points.length - 1, 1)) * cw;
  const y = v => padT + ch - ((v - (minV - padV)) / (range + 2 * padV)) * ch;

  if (minV < 0 && maxV > 0) {
    ctx.strokeStyle = 'rgba(128,140,160,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y(0));
    ctx.lineTo(width - padR, y(0));
    ctx.stroke();
  }

  ctx.strokeStyle = '#00e676';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((v, i) => { const X = x(i), Y = y(v); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
  ctx.stroke();

  points.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(v), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = series[i].win ? '#f5c518' : '#ff5252';
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(160,170,185,0.95)';
  ctx.font = '11px Inter, sans-serif';
  ctx.fillText(formatPnlShort(points[points.length - 1]), padL + 4, padT - 4);
}

