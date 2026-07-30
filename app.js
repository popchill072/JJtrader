// JJ TRADER - Cloud-Connected Trading Platform
const API_BASE = 'https://jj-trader-api.popchill072.workers.dev';

let currentSymbol = 'OANDA:XAUUSD';
let currentInterval = '240';
let widgetInstance = null;
let priceAlerts = [];
let sessionToken = localStorage.getItem('jj_session_token') || null;
let currentUsername = localStorage.getItem('jj_username') || null;

// ── API HELPER ─────────────────────────────────────────
async function api(method, path, body = null) {
  if (path !== '/api/auth/login' && (sessionToken === 'guest_mode' || !sessionToken)) {
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
  
  try {
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401 && path !== '/api/auth/login') {
      sessionToken = null;
      currentUsername = null;
      localStorage.removeItem('jj_session_token');
      localStorage.removeItem('jj_username');
      showLoginOverlay();
      return { error: 'Unauthorized' };
    }
    return await res.json();
  } catch (err) {
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

// ── AUTH & STARTUP SYSTEM ───────────────────────────────
function checkAuthOnStartup() {
  if (sessionToken && currentUsername) {
    hideLoginOverlay();
    initApp();
  } else {
    showLoginOverlay();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAuthOnStartup);
} else {
  checkAuthOnStartup();
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

async function handleRegisterSubmit() {
  const usernameInput = document.getElementById('reg-username');
  const emailInput = document.getElementById('reg-email');
  const pinInput = document.getElementById('reg-pin');
  const errEl = document.getElementById('reg-error-msg');
  const btn = document.getElementById('register-btn');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const pin = pinInput ? pinInput.value.trim() : '';

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
  hideLoginOverlay();
  initApp();
  showToast('👤 เข้าใช้งานในโหมด Guest เรียบร้อยแล้วครับ');
}

function handleLogout() {
  if (!confirm('ต้องการออกจากระบบใช่ไหมครับ?')) return;
  sessionToken = null;
  currentUsername = null;
  localStorage.removeItem('jj_session_token');
  localStorage.removeItem('jj_username');
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
  try { renderMainChart(); } catch (e) { console.error(e); }
  try { renderTechnicalGauge(); } catch (e) { console.error(e); }
  try { loadPreferences(); } catch (e) { console.error(e); }
  try { calculateThaiGold(); } catch (e) { console.error(e); }
  try { calculatePivot(); } catch (e) { console.error(e); }
  try { loadNotes(); } catch (e) { console.error(e); }
  try { loadPriceAlerts(); } catch (e) { console.error(e); }
  try { startLivePriceTicker(); } catch (e) { console.error(e); }

  try {
    updateTradingSessionsClock();
    setInterval(updateTradingSessionsClock, 1000);
  } catch (e) { console.error(e); }
  try { loadTradeLogs(); } catch (e) { console.error(e); }
  try {
    const initPrice = lastKnownLivePrice || parseFloat(document.getElementById('gold-spot-input')?.value) || 0;
    calculateV11ProEngine(initPrice);
  } catch (e) { console.error(e); }
}

// ── TRADINGVIEW CHART ──────────────────────────────────
let customIndicatorId = localStorage.getItem('jj_custom_indicator_id') || '';

function renderMainChart() {
  const container = document.getElementById('tv_chart_container');
  if (!container) return;
  container.innerHTML = '';

  const widgetConfig = {
    "autosize": true,
    "symbol": currentSymbol,
    "interval": currentInterval,
    "timezone": "Asia/Bangkok",
    "theme": "dark",
    "style": "1",
    "locale": "th",
    "toolbar_bg": "#080a0f",
    "enable_publishing": false,
    "allow_symbol_change": true,
    "hide_side_toolbar": false,
    "withdateranges": true,
    "save_image": true,
    "auto_save_change": true,
    "client_id": "jjtrader_platform",
    "user_id": currentUsername || "default_trader",
    "container_id": "tv_chart_container"
  };

  if (customIndicatorId) {
    widgetConfig.studies = [customIndicatorId];
  }

  if (typeof TradingView !== 'undefined' && TradingView.widget) {
    widgetInstance = new TradingView.widget(widgetConfig);
  }
}

function setCustomIndicator(indicatorId) {
  customIndicatorId = indicatorId ? indicatorId.trim() : '';
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

function renderTechnicalGauge() {
  const container = document.getElementById('technical_gauge_container');
  if (!container) return;
  container.innerHTML = '';
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
  script.async = true;
  script.innerHTML = JSON.stringify({
    "interval": "1h", "width": "100%", "isTransparent": true, "height": "100%",
    "symbol": currentSymbol, "showIntervalTabs": true,
    "displayMode": "single", "locale": "th", "colorTheme": "dark"
  });
  container.appendChild(script);
}

function changeSymbol(symbol, title, btnElement) {
  currentSymbol = symbol;
  document.querySelectorAll('.quick-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  const titleEl = document.getElementById('current-asset-title');
  if (titleEl) titleEl.innerHTML = `<span>📊</span><span>${title} - Realtime TradingView</span>`;
  savePreferences();
  renderMainChart();
  renderTechnicalGauge();
}

function changeTimeframe(tf, btnElement) {
  currentInterval = tf;
  document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  savePreferences();
  renderMainChart();
}

// ── PREFERENCES (Cloud) ────────────────────────────────
async function loadPreferences() {
  try {
    const data = await api('GET', '/api/preferences');
    if (data.balance && document.getElementById('acc-balance')) document.getElementById('acc-balance').value = data.balance;
    if (data.risk_pct && document.getElementById('risk-percent')) document.getElementById('risk-percent').value = data.risk_pct;
    if (data.symbol) currentSymbol = data.symbol;
    if (data.timeframe) currentInterval = data.timeframe;
    calculateRiskLot();
    calculatePivot();
  } catch (e) { /* offline fallback */ }
}

async function savePreferences() {
  const balanceEl = document.getElementById('acc-balance');
  const riskEl = document.getElementById('risk-percent');
  const balance = parseFloat(balanceEl ? balanceEl.value : 1000) || 1000;
  const risk_pct = parseFloat(riskEl ? riskEl.value : 1) || 1;
  try {
    await api('POST', '/api/preferences', { balance, risk_pct, symbol: currentSymbol, timeframe: currentInterval });
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
  const getHour = (tz) => parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).formatToParts(now).find(p => p.type === 'hour').value, 10);

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

// ── NOTES (Cloud) ──────────────────────────────────────
async function loadNotes() {
  const notesContainer = document.getElementById('notes-list');
  if (!notesContainer) return;
  try {
    const notes = await api('GET', '/api/notes');
    notesContainer.innerHTML = '';
    if (!Array.isArray(notes) || !notes.length) {
      notesContainer.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:10px;">ยังไม่มีแผนบันทึก...</div>';
      return;
    }
    notes.forEach(note => {
      const item = document.createElement('div');
      item.className = 'note-item';
      item.innerHTML = `
        <div><div>${escapeHtml(note.text)}</div><div class="note-date">${note.date}</div></div>
        <button class="delete-note-btn" onclick="deleteNote('${note.id}')">✕</button>
      `;
      notesContainer.appendChild(item);
    });
  } catch (e) {
    notesContainer.innerHTML = '<div style="color:var(--accent-red);font-size:11px;text-align:center;padding:8px;">⚠️ ไม่สามารถโหลดข้อมูลได้</div>';
  }
}

async function addNote() {
  const input = document.getElementById('journal-text');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  const res = await api('POST', '/api/notes', { text });
  if (res.ok) {
    if (input) input.value = '';
    showToast('✅ บันทึกแผนเทรดแล้วครับ');
    loadNotes();
  }
}

async function deleteNote(id) {
  await api('DELETE', `/api/notes/${id}`);
  loadNotes();
}

// ── FOREXFACTORY NEWS CALENDAR & COUNTDOWN ──────────────────
let newsCountdownInterval = null;
let currentNewsData = [];
let currentNewsPeriod = 'thisweek';
let currentNewsImpactFilter = 'all';

async function loadForexNews(forceRefresh = false) {
  const container = document.getElementById('news-list-container');
  if (!container) return;

  if (forceRefresh || !currentNewsData.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:15px;">⏳ กำลังอัปเดตข้อมูลข่าวจาก ForexFactory...</div>';
    try {
      const res = await fetch(`https://jj-trader-api.popchill072.workers.dev/api/news?period=${currentNewsPeriod}`);
      if (res.ok) {
        currentNewsData = await res.json();
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

  if (newsCountdownInterval) clearInterval(newsCountdownInterval);
  newsCountdownInterval = setInterval(updateNewsCountdowns, 1000);
}

function changeNewsPeriod(period, btnElement) {
  currentNewsPeriod = period;
  document.querySelectorAll('.news-period-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  currentNewsData = [];
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

  const filtered = getFilteredNewsData();

  if (!filtered.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:15px;">ไม่มีข่าวสารตามเงื่อนไขที่เลือก...</div>';
    return;
  }

  filtered.slice(0, 30).forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'note-item';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.gap = '4px';

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
    const timeStr = dateObj ? dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) : (item.time || 'ไม่ระบุเวลา');
    const dateStr = dateObj ? dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;color:var(--gold-light);font-size:11px;">
          <span style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;margin-right:4px;">${escapeHtml(item.country || 'USD')}</span> 
          ${escapeHtml(item.title)}
        </div>
        <div>${impactBadge}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;color:var(--text-muted);font-size:10px;">
        <span>📅 ${dateStr} | ⏰ <strong>${timeStr} น.</strong></span>
        <span id="news-cd-${index}" style="font-weight:700;color:var(--accent-cyan);">⏳ กำลังคำนวณ...</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;color:var(--text-muted);font-size:10px;border-top:1px solid rgba(255,255,255,0.05);padding-top:3px;">
        <span>คาดการณ์: <strong style="color:#fff;">${item.forecast || '-'}</strong> | ครั้งก่อน: <strong>${item.previous || '-'}</strong></span>
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
    if (!cdEl || !item.date) return;

    const newsTime = new Date(item.date).getTime();
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
let triggeredAlertIds = new Set();

function startLivePriceTicker() {
  fetchLiveAssetPrice();
  setInterval(fetchLiveAssetPrice, 2500);
}

async function fetchLiveAssetPrice() {
  try {
    let livePrice = 0;

    if (currentSymbol.includes('XAU') || currentSymbol.includes('GOLD')) {
      try {
        const res = await fetch('https://api.gold-api.com/price/XAU');
        if (res.ok) {
          const data = await res.json();
          if (data.price) livePrice = parseFloat(data.price);
        }
      } catch (e) {}

      if (!livePrice) {
        try {
          const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
          if (res.ok) {
            const data = await res.json();
            if (data.price) livePrice = parseFloat(data.price);
          }
        } catch (e) {}
      }
    } else if (currentSymbol.includes('BTC')) {
      const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const data = await res.json();
      if (data.price) livePrice = parseFloat(data.price);
    }

    if (livePrice && !isNaN(livePrice)) {
      previousLivePrice = lastKnownLivePrice || livePrice;
      lastKnownLivePrice = livePrice;
      
      const spotInput = document.getElementById('gold-spot-input');
      if (spotInput && document.activeElement !== spotInput) {
        spotInput.value = livePrice.toFixed(2);
        calculateThaiGold();
        calculatePivot();
      }

      checkPriceAlerts(livePrice);

      // Update V11 PRO Engine on every tick
      try { updateV11ProDashboard(livePrice); } catch(e) {}
    }
  } catch (e) {}
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
    item.innerHTML = `
      <div>🔔 ${alert.symbol || 'XAUUSD'} ${condText} <strong>$${parseFloat(alert.target_price).toFixed(2)}</strong></div>
      <button class="delete-note-btn" onclick="deletePriceAlert('${alert.id}')">✕</button>
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
  priceAlerts.push(newAlert);
  renderPriceAlerts();
  if (targetEl) targetEl.value = '';
  showToast(`🔔 เพิ่มการตั้งเตือนราคา $${target_price.toFixed(2)} เรียบร้อยแล้ว`);

  if (sessionToken && sessionToken !== 'guest_mode') {
    await api('POST', '/api/alerts', newAlert);
  }
}

async function deletePriceAlert(id) {
  priceAlerts = priceAlerts.filter(a => a.id !== id);
  renderPriceAlerts();
  if (sessionToken && sessionToken !== 'guest_mode') {
    await api('DELETE', `/api/alerts/${id}`);
  }
}

function checkPriceAlerts(currentPrice) {
  priceAlerts.forEach(alert => {
    if (triggeredAlertIds.has(alert.id)) return;
    const target = parseFloat(alert.target_price);
    let triggered = false;

    if (alert.condition === 'above' && currentPrice >= target) triggered = true;
    if (alert.condition === 'below' && currentPrice <= target) triggered = true;

    if (triggered) {
      triggeredAlertIds.add(alert.id);
      playAlertAudio();
      showToast(`🚨 ALERT! ${alert.symbol || 'XAUUSD'} แตะเป้าหมาย $${target.toFixed(2)} แล้ว (ราคาปัจจุบัน $${currentPrice.toFixed(2)})`);
    }
  });
}

function playAlertAudio() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {}
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── TRADE JOURNAL & PERFORMANCE ANALYTICS ──────────────────
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
  const lotEl = document.getElementById('log-input-lot');
  const entryEl = document.getElementById('log-input-entry');
  const closeEl = document.getElementById('log-input-close');
  const noteEl = document.getElementById('log-input-note');

  const direction = dirEl ? dirEl.value : 'BUY';
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

  showToast(pnl >= 0 ? `✅ บันทึกออเดอร์: กำไร +$${pnl.toFixed(2)}` : `📉 บันทึกออเดอร์: ขาดทุน -$${Math.abs(pnl).toFixed(2)}`);
  loadTradeLogs();
}

function deleteTradeLogRecord(id) {
  let logs = getLocalTradeLogs();
  logs = logs.filter(item => item.id !== id);
  saveLocalTradeLogs(logs);
  loadTradeLogs();
}

function loadTradeLogs() {
  const container = document.getElementById('trade-log-list-container');
  const countEl = document.getElementById('log-stat-count');
  const winRateEl = document.getElementById('log-stat-winrate');
  const pnlEl = document.getElementById('log-stat-pnl');

  const logs = getLocalTradeLogs();

  // Update Summary Dashboard
  if (countEl) countEl.textContent = logs.length;
  if (logs.length > 0) {
    const wins = logs.filter(l => l.result === 'WIN').length;
    const winRate = ((wins / logs.length) * 100).toFixed(0);
    const totalPnl = logs.reduce((sum, l) => sum + parseFloat(l.pnl), 0);

    if (winRateEl) {
      winRateEl.textContent = `${winRate}%`;
      winRateEl.style.color = parseInt(winRate) >= 50 ? 'var(--accent-green)' : 'var(--accent-red)';
    }
    if (pnlEl) {
      pnlEl.textContent = `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`;
      pnlEl.style.color = totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
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
  logs.slice(0, 30).forEach(l => {
    const item = document.createElement('div');
    item.className = 'note-item';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '8px 10px';

    const isWin = l.result === 'WIN';
    const dirBadge = l.direction === 'BUY'
      ? '<span style="color:var(--accent-green);font-weight:800;">🟢 BUY</span>'
      : '<span style="color:var(--accent-red);font-weight:800;">🔴 SELL</span>';

    const resultBadge = isWin
      ? '<span style="background:rgba(0,230,118,0.15);border:1px solid var(--accent-green);color:var(--accent-green);padding:1px 5px;border-radius:4px;font-size:9px;font-weight:800;">WIN</span>'
      : '<span style="background:rgba(255,82,82,0.15);border:1px solid var(--accent-red);color:var(--accent-red);padding:1px 5px;border-radius:4px;font-size:9px;font-weight:800;">LOSS</span>';

    const pnlColor = isWin ? 'color:var(--accent-green)' : 'color:var(--accent-red)';
    const pnlText = `${parseFloat(l.pnl) >= 0 ? '+' : ''}$${l.pnl}`;

    item.innerHTML = `
      <div style="flex:1;">
        <div style="display:flex; align-items:center; gap:6px; font-size:11px;">
          ${dirBadge}
          <strong style="color:var(--gold-light);">${l.symbol}</strong>
          <span style="color:var(--text-muted);">${l.lot} Lot</span>
          ${resultBadge}
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">
          $${l.entry} ➔ $${l.close} | P&L: <strong style="${pnlColor};">${pnlText}</strong>
        </div>
        ${l.note !== '-' ? `<div style="font-size:9px; color:var(--gold-light); opacity:0.8; margin-top:2px;">💡 ${escapeHtml(l.note)}</div>` : ''}
      </div>
      <button class="delete-note-btn" onclick="deleteTradeLogRecord('${l.id}')" title="ลบ">✕</button>
    `;
    container.appendChild(item);
  });
}

