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
    return;
  }

  // Build close series (candles preferred, live ticks as fallback)
  const closes = hasCandles ? v11Candles.map(c => c.c) : v11PriceHistory;
  const emaFast = v11CalcEMA(closes, V11_CONFIG.emaFast);
  const emaSlow = v11CalcEMA(closes, V11_CONFIG.emaSlow);
  const atrVal = hasCandles ? v11CalcATR(v11Candles, V11_CONFIG.atrLength) : 0;

  // ── Swing detection on candle high/low (matches ta.highest/ta.lowest) ──
  let dHigh, dLow, sRange;
  if (hasCandles) {
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
  if (signalEl) {
    signalEl.textContent = sigEmoji + ' ' + signal;
    signalEl.style.color = sigColor;
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
