// == JJ TRADER V11 PRO ENGINE ==
// Faithful port of Pine Script "JJ TRADER V11 PRO" to JavaScript
// Swing High/Low (candle-based) -> Fibonacci Zones -> EMA Trend Filter -> Status/Signal

const V11_CONFIG = {
  lookback: 30, emaFast: 21, emaSlow: 89, slPercent: 10.0, atrLength: 14, atrMult: 1.5,
  slMode: 'Percent', // 'Percent' | 'ATR'
  fibLevels: [0, 23.6, 38.2, 50, 61.8, 78.6, 100],
  fibEntry: 78.6, fibTp1: 38.2, fibTp3: 100,
};

let v11Candles = [];      // OHLC array: { t, o, h, l, c }
let v11PriceHistory = []; // fallback live ticks when no candles yet
const V11_MAX_HISTORY = 300;

// Latest computed reference exposed for the TradingView overlay
let v11Swing = null;

// Active V11 position + last result (for SL/TP hit tracking & auto rescan)
let v11Position = null;   // { dir, entry, sl, tp1, tp2, tp3, openedAt }
let v11LastResult = null; // { level, price, dir, at }
let v11ExitedSwingKey = ''; // swing key of last closed position (no re-entry on same swing)
let v11LastExitAt = 0;      // timestamp of last SL/TP exit (cooldown before re-entry)

const V11_REENTRY_COOLDOWN_MS = 45000;

function v11SwingKey(s) {
  return s ? `${s.dHigh.toFixed(4)}|${s.dLow.toFixed(4)}|${s.isUp}` : '';
}

function v11ResetPosition() {
  v11Position = null;
}

function v11OpenPosition(dir, entry, sl, tp1, tp2, tp3) {
  v11Position = { dir, entry, sl, tp1, tp2, tp3, openedAt: Date.now() };
}

function v11CheckPositionHits(livePrice) {
  if (!v11Position || !livePrice) return null;
  const p = v11Position;
  let hit = null;
  if (p.dir === 'BUY') {
    if (livePrice <= p.sl) hit = 'SL';
    else if (livePrice >= p.tp3) hit = 'TP3';
    else if (livePrice >= p.tp2) hit = 'TP2';
    else if (livePrice >= p.tp1) hit = 'TP1';
  } else {
    if (livePrice >= p.sl) hit = 'SL';
    else if (livePrice <= p.tp3) hit = 'TP3';
    else if (livePrice <= p.tp2) hit = 'TP2';
    else if (livePrice <= p.tp1) hit = 'TP1';
  }
  if (hit) {
    v11LastResult = { level: hit, price: livePrice, dir: p.dir, at: Date.now() };
    v11Position = null;
    return hit;
  }
  return null;
}

function v11SetCandles(candles) {
  if (!Array.isArray(candles) || !candles.length) return;
  v11Candles = candles.slice(-V11_MAX_HISTORY);
}

function v11AddPriceTick(price) {
  v11PriceHistory.push(price);
  if (v11PriceHistory.length > V11_MAX_HISTORY) v11PriceHistory.shift();
}

// Standard EMA (same seeding as ta.ema)
function v11CalcEMA(prices, period) {
  if (!prices.length) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) { ema = prices[i] * k + ema * (1 - k); }
  return ema;
}

// Wilder ATR using candle high/low/close (matches ta.atr)
function v11CalcATR(candles, period) {
  if (!candles || candles.length < period + 1) return 0;
  let prevClose = candles[0].c;
  let rma = 0;
  const start = candles.length - period;
  for (let i = 1; i <= start; i++) {
    const c = candles[i];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
    rma += tr;
    prevClose = c.c;
  }
  // First TR as seed, then Wilder smoothing over the remaining bars
  let atr = rma / (period + 1);
  for (let i = start + 1; i < candles.length; i++) {
    const c = candles[i];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
    atr = (atr * (period - 1) + tr) / period;
    prevClose = c.c;
  }
  return atr;
}

function calculateV11ProEngine(price) {
  if (price > 0) updateV11ProDashboard(price);
}

function updateV11ProDashboard(livePrice) {
  if (!livePrice || isNaN(livePrice)) return;

  const hasCandles = v11Candles.length >= 10;
  const lb = Math.min(V11_CONFIG.lookback, hasCandles ? v11Candles.length : v11PriceHistory.length);
  if (lb < 5) {
    v11AddPriceTick(livePrice);
    // Show skeleton placeholders while waiting for enough data
    ['v11-status-badge', 'v11-trend-badge', 'v11-signal-badge', 'v11-val-entry', 'v11-val-tp1', 'v11-val-tp2', 'v11-val-tp3', 'v11-val-sl', 'v11-val-ext161', 'v11-val-atr', 'v11-val-range', 'v11-val-live', 'v11-val-position', 'v11-val-result'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('skeleton')) el.classList.add('skeleton');
    });
    return;
  }
  ['v11-status-badge', 'v11-trend-badge', 'v11-signal-badge', 'v11-val-entry', 'v11-val-tp1', 'v11-val-tp2', 'v11-val-tp3', 'v11-val-sl', 'v11-val-ext161', 'v11-val-atr', 'v11-val-range', 'v11-val-live', 'v11-val-position', 'v11-val-result'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.classList.contains('skeleton')) el.classList.remove('skeleton');
  });

  // Build close series (candles preferred, live ticks as fallback)
  const closes = hasCandles ? v11Candles.map(c => c.c) : v11PriceHistory;
  const emaFast = v11CalcEMA(closes, V11_CONFIG.emaFast);
  const emaSlow = v11CalcEMA(closes, V11_CONFIG.emaSlow);
  const atrVal = hasCandles ? v11CalcATR(v11Candles, V11_CONFIG.atrLength) : 0;

  // ── Swing detection on candle high/low (matches ta.highest/ta.lowest) ──
  let dHigh, dLow, sRange;
  if (hasCandles) {
    // Fold the live tick into the forming candle so swing/status are real-time
    const lastC = v11Candles[v11Candles.length - 1];
    if (lastC) {
      if (livePrice > lastC.h) lastC.h = livePrice;
      if (livePrice < lastC.l) lastC.l = livePrice;
      lastC.c = livePrice;
    }
    const recent = v11Candles.slice(-lb);
    dHigh = Math.max(...recent.map(c => c.h));
    dLow = Math.min(...recent.map(c => c.l));
    sRange = dHigh - dLow;
    if (sRange <= 0) return;

    // Ages: oldest bar (largest i) that equals the swing extreme — Pine:
    //   for i = 0 to i_lookback
    //       if high[i] == d_high:  h_age := i
    //       if low[i]  == d_low:   l_age := i
    let hAge = -1, lAge = -1;
    for (let i = 0; i < lb; i++) {
      if (recent[i].h === dHigh) hAge = i;
      if (recent[i].l === dLow) lAge = i;
    }
    v11Swing = { dHigh, dLow, sRange, isUp: lAge > hAge };
  } else {
    // Fallback to tick high/low (no candles yet)
    const recent = v11PriceHistory.slice(-lb);
    dHigh = Math.max(...recent);
    dLow = Math.min(...recent);
    sRange = dHigh - dLow;
    if (sRange <= 0) return;
    let hAge = -1, lAge = -1;
    for (let i = 0; i < recent.length; i++) {
      if (recent[i] === dHigh) hAge = i;
      if (recent[i] === dLow) lAge = i;
    }
    v11Swing = { dHigh, dLow, sRange, isUp: lAge > hAge };
  }
  const isUp = v11Swing.isUp;
  const emaOk = (isUp && emaFast > emaSlow) || (!isUp && emaFast < emaSlow);

  // ── Fibonacci levels (retracement from the swing) ──
  const fibOf = (pct) => isUp ? dHigh - sRange * (pct / 100) : dLow + sRange * (pct / 100);
  const fib236 = fibOf(23.6);
  const fib382 = fibOf(38.2);
  const fib500 = fibOf(50.0);
  const fib786 = fibOf(78.6);
  const fibLevelPrices = {};
  V11_CONFIG.fibLevels.forEach(pct => { fibLevelPrices[pct] = fibOf(pct); });

  // Zones (Pine)
  const z1Hi = isUp ? dHigh - sRange * 0.618 : dLow + sRange * 0.700;
  const z1Lo = isUp ? dHigh - sRange * 0.700 : dLow + sRange * 0.618;
  const z2Hi = isUp ? dHigh - sRange * 0.786 : dLow + sRange * 0.850;
  const z2Lo = isUp ? dHigh - sRange * 0.850 : dLow + sRange * 0.786;
  const z3Hi = isUp ? dHigh - sRange * 0.950 : dLow + sRange * 1.000;
  const z3Lo = isUp ? dHigh - sRange * 1.000 : dLow + sRange * 0.950;

  // Entry / TPs / SL (Pine)
  const entryR = fibOf(V11_CONFIG.fibEntry);
  const tp1 = fibOf(V11_CONFIG.fibTp1);
  const tp2 = fib236;
  const tp3 = isUp ? dHigh : dLow;
  const slP = V11_CONFIG.slMode === 'ATR'
    ? (isUp ? dLow - atrVal * V11_CONFIG.atrMult : dHigh + atrVal * V11_CONFIG.atrMult)
    : (isUp ? dLow - sRange * (V11_CONFIG.slPercent / 100) : dHigh + sRange * (V11_CONFIG.slPercent / 100));

  // Extensions (Pine)
  const ex127 = isUp ? dLow + sRange * 1.272 : dHigh - sRange * 1.272;
  const ex161 = isUp ? dLow + sRange * 1.618 : dHigh - sRange * 1.618;
  const ex200 = isUp ? dLow + sRange * 2.000 : dHigh - sRange * 2.000;

  // Risk : Reward (Pine)
  const risk = Math.abs(entryR - slP);
  const rr1 = risk > 0 ? Math.abs(tp1 - entryR) / risk : 0;
  const rr3 = risk > 0 ? Math.abs(tp3 - entryR) / risk : 0;

  // ── Status detection using last bar low/high (matches Pine in_z*) ──
  let barLow, barHigh, barClose;
  if (hasCandles) {
    const last = v11Candles[v11Candles.length - 1];
    barLow = last.l;
    barHigh = last.h;
    barClose = livePrice || last.c;
  } else {
    barLow = barHigh = barClose = livePrice;
  }

  const inZ2 = isUp ? (barLow <= z2Hi && barLow >= z2Lo) : (barHigh >= z2Lo && barHigh <= z2Hi);
  const inZ1 = isUp ? (barLow <= z1Hi && barLow >= z1Lo) : (barHigh >= z1Lo && barHigh <= z1Hi);
  const inZ3 = isUp ? (barLow <= z3Lo) : (barHigh >= z3Hi);
  const nearZ1 = isUp ? (barClose <= z1Hi + atrVal) : (barClose >= z1Lo - atrVal);

  let status = 'SCANNING', statusColor = 'var(--accent-cyan)', statusEmoji = '🔍';
  if (inZ2) { status = 'ENTRY ZONE'; statusColor = '#2962FF'; statusEmoji = '🟢'; }
  else if (inZ1) { status = 'WATCH ZONE'; statusColor = '#FF6D00'; statusEmoji = '🟡'; }
  else if (inZ3) { status = 'DANGER ZONE'; statusColor = '#FF1744'; statusEmoji = '🔴'; }
  else if (nearZ1) { status = 'APPROACHING'; statusColor = '#FFD600'; statusEmoji = '⏳'; }

  // ── BUY / SELL signal (direction + zone + EMA confirmation) ──
  const inEntryZone = inZ2 || inZ1 || nearZ1;
  let signal = 'WAIT', sigColor = 'var(--text-muted)', sigEmoji = '⏸️';
  if (emaOk && inEntryZone) {
    if (isUp) { signal = 'BUY'; sigColor = 'var(--accent-green)'; sigEmoji = '🟢'; }
    else { signal = 'SELL'; sigColor = 'var(--accent-red)'; sigEmoji = '🔴'; }
  } else if (isUp) {
    signal = 'BIAS UP'; sigColor = 'var(--accent-green)'; sigEmoji = '↗️';
  } else {
    signal = 'BIAS DOWN'; sigColor = 'var(--accent-red)'; sigEmoji = '↘️';
  }

  // ── Position tracking + SL/TP auto-rescan ──
  if ((signal === 'BUY' || signal === 'SELL') && !v11Position) {
    // Cooldown after an exit + no re-entry on the same swing that just closed
    const curKey = v11SwingKey(v11Swing);
    const inCooldown = (Date.now() - v11LastExitAt) < V11_REENTRY_COOLDOWN_MS;
    if (!inCooldown && (!v11ExitedSwingKey || curKey !== v11ExitedSwingKey)) {
      v11OpenPosition(signal, entryR, slP, tp1, tp2, tp3);
      if (typeof window.onV11Signal === 'function') {
        window.onV11Signal(signal, entryR, slP, tp1, livePrice);
      }
    }
  }
  const hitLevel = v11CheckPositionHits(livePrice);
  if (hitLevel) {
    const closedSwingKey = v11SwingKey(v11Swing);
    v11ExitedSwingKey = closedSwingKey;
    v11LastExitAt = Date.now();
    if (typeof window.onV11PositionExit === 'function') {
      window.onV11PositionExit(hitLevel, livePrice, v11LastResult);
    }
  }

  // ── Update HTML elements ──
  const statusEl = document.getElementById('v11-status-badge');
  const trendEl = document.getElementById('v11-trend-badge');
  const signalEl = document.getElementById('v11-signal-badge');
  const entryEl = document.getElementById('v11-val-entry');
  const tp1El = document.getElementById('v11-val-tp1');
  const tp2El = document.getElementById('v11-val-tp2');
  const tp3El = document.getElementById('v11-val-tp3');
  const slEl = document.getElementById('v11-val-sl');
  const rrEl = document.getElementById('v11-val-rr');
  const extEl = document.getElementById('v11-val-ext161');
  const atrEl = document.getElementById('v11-val-atr');
  const rangeEl = document.getElementById('v11-val-range');
  const liveEl = document.getElementById('v11-val-live');

  if (statusEl) {
    statusEl.textContent = statusEmoji + ' ' + status;
    statusEl.style.color = statusColor;
  }
  if (trendEl) {
    const trendLabel = isUp ? '📈 BULLISH' : '📉 BEARISH';
    trendEl.textContent = trendLabel + (emaOk ? ' ✓ EMA' : ' ✗ EMA');
    trendEl.style.color = isUp ? 'var(--accent-green)' : 'var(--accent-red)';
  }
  if (entryEl) entryEl.textContent = '$' + entryR.toFixed(2);
  if (tp1El) tp1El.textContent = '$' + tp1.toFixed(2);
  if (tp2El) tp2El.textContent = '$' + tp2.toFixed(2);
  if (tp3El) tp3El.textContent = '$' + tp3.toFixed(2);
  if (slEl) slEl.textContent = '$' + slP.toFixed(2);
  if (extEl) extEl.textContent = '$' + ex161.toFixed(2);
  if (atrEl) atrEl.textContent = '$' + (atrVal || 0).toFixed(2);
  if (rangeEl) rangeEl.textContent = '$' + sRange.toFixed(2);
  if (liveEl) liveEl.textContent = '$' + livePrice.toFixed(2);
  if (rrEl) {
    rrEl.textContent = '1:' + rr1.toFixed(2) + ' (TP1) | 1:' + rr3.toFixed(2) + ' (TP3)';
    rrEl.style.color = rr1 >= 1.5 ? 'var(--accent-green)' : rr1 >= 1.0 ? 'var(--gold-primary)' : 'var(--accent-red)';
  }

  // Position / result status
  const posEl = document.getElementById('v11-val-position');
  if (posEl) {
    if (v11Position) {
      const p = v11Position;
      posEl.textContent = `${p.dir} @ ${p.entry.toFixed(2)} | SL ${p.sl.toFixed(2)} | TP1 ${p.tp1.toFixed(2)}`;
      posEl.style.color = p.dir === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)';
    } else {
      posEl.textContent = '—';
      posEl.style.color = 'var(--text-muted)';
    }
  }
  const resEl = document.getElementById('v11-val-result');
  if (resEl) {
    if (v11LastResult) {
      const r = v11LastResult;
      const d = new Date(r.at);
      const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      resEl.textContent = `${r.level} @ ${r.price.toFixed(2)} (${time})`;
      resEl.style.color = r.level === 'SL' ? 'var(--accent-red)' : 'var(--accent-green)';
    } else {
      resEl.textContent = '—';
      resEl.style.color = 'var(--text-muted)';
    }
  }
  // Reflect active position in the signal badge
  if (signalEl) {
    signalEl.textContent = sigEmoji + ' ' + signal + (v11Position ? ' ▶' : '');
    signalEl.style.color = sigColor;
  }

  // Fib level table (full set, user-configurable)
  const fibGrid = document.getElementById('v11-fib-grid');
  if (fibGrid) {
    fibGrid.innerHTML = V11_CONFIG.fibLevels.map(pct => {
      const price = fibLevelPrices[pct];
      const isEntry = Math.abs(pct - V11_CONFIG.fibEntry) < 0.05;
      const isTp = Math.abs(pct - V11_CONFIG.fibTp1) < 0.05;
      const color = isEntry ? 'var(--accent-cyan)' : isTp ? 'var(--gold-light)' : 'var(--text-muted)';
      const tag = isEntry ? ' 🟢' : isTp ? ' 🎯' : '';
      return `<div class="v11-fib-cell" style="color:${color}">
        <span class="v11-fib-pct">${pct}%${tag}</span>
        <span class="v11-fib-price">$${price.toFixed(2)}</span>
      </div>`;
    }).join('');
  }
}

// Apply user-customized Fibonacci levels (list of percentages 0-100)
function v11SetFibLevels(pcts, entryPct, tp1Pct, tp3Pct) {
  const norm = (v, fb) => {
    const n = parseFloat(v);
    return (Number.isFinite(n) && n >= 0 && n <= 100) ? n : fb;
  };
  let list = Array.isArray(pcts) ? pcts.map(p => norm(p, null)).filter(v => v !== null) : null;
  if (!list || !list.length) list = [0, 23.6, 38.2, 50, 61.8, 78.6, 100];
  if (!list.includes(0)) list.unshift(0);
  if (!list.includes(100)) list.push(100);
  V11_CONFIG.fibLevels = [...new Set(list)].sort((a, b) => a - b);
  V11_CONFIG.fibEntry = norm(entryPct, V11_CONFIG.fibEntry);
  V11_CONFIG.fibTp1 = norm(tp1Pct, V11_CONFIG.fibTp1);
  V11_CONFIG.fibTp3 = norm(tp3Pct, V11_CONFIG.fibTp3);
  return V11_CONFIG.fibLevels;
}

// ── V11 BACKTEST (walk-forward, no lookahead bias) ─────
// Simulates the V11 engine over historical candles:
// swing from the last `lookback` bars BEFORE the signal candle,
// entry on candle close, then SL/TP scanned on subsequent candles.
function runV11Backtest(candles, opts) {
  const o = opts || {};
  const lb = o.lookback || V11_CONFIG.lookback;
  const emaFast = o.emaFast || V11_CONFIG.emaFast;
  const emaSlow = o.emaSlow || V11_CONFIG.emaSlow;
  const fibEntry = o.fibEntry ?? V11_CONFIG.fibEntry;
  const fibTp1 = o.fibTp1 ?? V11_CONFIG.fibTp1;
  const fibTp3 = o.fibTp3 ?? V11_CONFIG.fibTp3;
  const slPercent = o.slPercent ?? V11_CONFIG.slPercent;
  const list = Array.isArray(candles) ? candles : [];

  const trades = [];
  let pos = null; // { dir, entry, sl, tp1, tp2, tp3 }

  for (let i = lb; i < list.length; i++) {
    const history = list.slice(i - lb, i + 1); // includes current candle for swing
    const closes = history.map(c => c.c);
    const fast = v11CalcEMA(closes, emaFast);
    const slow = v11CalcEMA(closes, emaSlow);
    const atrVal = v11CalcATR(history, V11_CONFIG.atrLength);

    const dHigh = Math.max(...history.map(c => c.h));
    const dLow = Math.min(...history.map(c => c.l));
    const sRange = dHigh - dLow;
    if (sRange <= 0) continue;

    let hAge = -1, lAge = -1;
    for (let j = 0; j < history.length; j++) {
      if (history[j].h === dHigh) hAge = j;
      if (history[j].l === dLow) lAge = j;
    }
    const isUp = lAge > hAge;
    const emaOk = (isUp && fast > slow) || (!isUp && fast < slow);

    const fibOf = (pct) => isUp ? dHigh - sRange * (pct / 100) : dLow + sRange * (pct / 100);
    const z1Hi = isUp ? dHigh - sRange * 0.618 : dLow + sRange * 0.700;
    const z1Lo = isUp ? dHigh - sRange * 0.700 : dLow + sRange * 0.618;
    const z2Hi = isUp ? dHigh - sRange * 0.786 : dLow + sRange * 0.850;
    const z2Lo = isUp ? dHigh - sRange * 0.850 : dLow + sRange * 0.786;
    const entryR = fibOf(fibEntry);
    const tp1 = fibOf(fibTp1);
    const tp2 = fibOf(23.6);
    const tp3 = isUp ? dHigh : dLow;
    const slP = isUp ? dLow - sRange * (slPercent / 100) : dHigh + sRange * (slPercent / 100);

    const bar = list[i];
    const barLow = bar.l, barHigh = bar.h, barClose = bar.c;
    const inZ2 = isUp ? (barLow <= z2Hi && barLow >= z2Lo) : (barHigh >= z2Lo && barHigh <= z2Hi);
    const inZ1 = isUp ? (barLow <= z1Hi && barLow >= z1Lo) : (barHigh >= z1Lo && barHigh <= z1Hi);
    const nearZ1 = isUp ? (barClose <= z1Hi + atrVal) : (barClose >= z1Lo - atrVal);
    const inEntryZone = inZ2 || inZ1 || nearZ1;
    const signal = (emaOk && inEntryZone) ? (isUp ? 'BUY' : 'SELL') : null;

    // If no open position and signal fires -> open at current close
    if (!pos && signal) {
      pos = { dir: signal, entry: barClose, sl: slP, tp1, tp2, tp3, openAt: i };
      continue;
    }
    // Scan for SL/TP on subsequent candles
    if (pos) {
      const p = pos;
      let done = false;
      for (let k = i; k < list.length && !done; k++) {
        const kb = list[k];
        let hit = null;
        if (p.dir === 'BUY') {
          if (kb.l <= p.sl) hit = 'SL';
          else if (kb.h >= p.tp3) hit = 'TP3';
          else if (kb.h >= p.tp2) hit = 'TP2';
          else if (kb.h >= p.tp1) hit = 'TP1';
        } else {
          if (kb.h >= p.sl) hit = 'SL';
          else if (kb.l <= p.tp3) hit = 'TP3';
          else if (kb.l <= p.tp2) hit = 'TP2';
          else if (kb.l <= p.tp1) hit = 'TP1';
        }
        if (hit) {
          const risk = Math.abs(p.entry - p.sl);
          let rMulti = 0;
          if (risk > 0) {
            if (hit === 'SL') rMulti = -1;
            else if (hit === 'TP1') rMulti = Math.abs(p.tp1 - p.entry) / risk;
            else if (hit === 'TP2') rMulti = Math.abs(p.tp2 - p.entry) / risk;
            else if (hit === 'TP3') rMulti = Math.abs(p.tp3 - p.entry) / risk;
          }
          trades.push({ dir: p.dir, entry: p.entry, exitPrice: hit === 'SL' ? p.sl : (hit === 'TP1' ? p.tp1 : hit === 'TP2' ? p.tp2 : p.tp3), hit, rMulti, barsHeld: k - p.openAt, openAt: p.openAt, closeAt: k });
          pos = null;
          done = true;
          i = k; // continue scanning after the exit candle
        }
      }
      if (pos && !done) { pos = null; } // position never resolved before data end
    }
  }

  // Summary stats
  const wins = trades.filter(t => t.hit !== 'SL');
  const losses = trades.filter(t => t.hit === 'SL');
  const totalR = trades.reduce((a, t) => a + t.rMulti, 0);
  const grossWin = wins.reduce((a, t) => a + t.rMulti, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.rMulti, 0));
  const equity = [];
  let bal = 1; // start with 1R baseline so drawdown % stays meaningful
  trades.forEach(t => { bal += t.rMulti; equity.push(bal); });

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length * 100) : 0,
    totalR,
    avgR: trades.length ? totalR / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDrawdown: maxDrawdownR(equity),
    bestTrade: trades.length ? Math.max(...trades.map(t => t.rMulti)) : 0,
    worstTrade: trades.length ? Math.min(...trades.map(t => t.rMulti)) : 0,
    avgBarsHeld: trades.length ? trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length : 0,
    trades,
  };
}

function maxDrawdownR(equity) {
  // Drawdown in R units: distance from the running peak to the deepest trough.
  if (!equity.length) return 0;
  let peak = equity[0], maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}
