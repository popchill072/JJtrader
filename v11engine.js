// == JJ TRADER V11 PRO ENGINE ==
// Translated from Pine Script "JJ TRADER V11 PRO" to JavaScript
// Swing High/Low Lookback -> Fibonacci Zones -> EMA Trend Filter -> Status Detection

const V11_CONFIG = {
  lookback: 30, emaFast: 21, emaSlow: 89, slPercent: 10.0, atrLength: 14, atrMult: 1.5,
  fibLevels: [0, 23.6, 38.2, 50, 61.8, 78.6, 100],
  fibEntry: 78.6, fibTp1: 38.2, fibTp3: 100,
};
let v11PriceHistory = [];
const V11_MAX_HISTORY = 200;

// Latest swing reference exposed for the TradingView overlay
let v11Swing = null;

function v11AddPriceTick(price) {
  v11PriceHistory.push(price);
  if (v11PriceHistory.length > V11_MAX_HISTORY) v11PriceHistory.shift();
}

function v11CalcEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) { ema = prices[i] * k + ema * (1 - k); }
  return ema;
}

function v11CalcATR(prices, period) {
  if (prices.length < period + 1) return Math.abs(prices[prices.length - 1] - prices[0]) / (prices.length || 1);
  let sum = 0;
  const start = prices.length - period;
  for (let i = start; i < prices.length; i++) {
    const prev = prices[i - 1];
    const diff = prev !== undefined ? Math.abs(prices[i] - prev) : 0;
    sum += diff;
  }
  return sum / period;
}

function calculateV11ProEngine(price) {
  if (price > 0) {
    updateV11ProDashboard(price);
  }
}

function updateV11ProDashboard(livePrice) {
  if (!livePrice || isNaN(livePrice)) return;
  v11AddPriceTick(livePrice);
  const hist = v11PriceHistory;
  const lb = Math.min(V11_CONFIG.lookback, hist.length);
  if (lb < 5) return;

  const recentPrices = hist.slice(-lb);
  const dHigh = Math.max(...recentPrices);
  const dLow = Math.min(...recentPrices);
  const sRange = dHigh - dLow;
  if (sRange <= 0) return;
  v11Swing = { dHigh, dLow, sRange, isUp: null };

  // Trend detection: which came first - high or low?
  let hAge = 0, lAge = 0;
  for (let i = recentPrices.length - 1; i >= 0; i--) {
    if (recentPrices[i] === dHigh && hAge === 0) hAge = recentPrices.length - 1 - i;
    if (recentPrices[i] === dLow && lAge === 0) lAge = recentPrices.length - 1 - i;
  }
  const isUp = lAge > hAge;
  if (v11Swing) v11Swing.isUp = isUp;

  // EMA Filter
  const emaFast = v11CalcEMA(hist, V11_CONFIG.emaFast);
  const emaSlow = v11CalcEMA(hist, V11_CONFIG.emaSlow);
  const emaConfirm = isUp ? (emaFast > emaSlow) : (emaFast < emaSlow);

  // ATR
  const atrVal = v11CalcATR(hist, V11_CONFIG.atrLength);

  // Fibonacci Levels (from configurable levels list, retracement from the swing)
  const fibOf = (pct) => isUp ? dHigh - sRange * (pct / 100) : dLow + sRange * (pct / 100);
  const fibLevelPrices = {};
  V11_CONFIG.fibLevels.forEach(pct => { fibLevelPrices[pct] = fibOf(pct); });

  // Zones (from Pine Script)
  const z1Hi = isUp ? dHigh - sRange * 0.618 : dLow + sRange * 0.700;
  const z1Lo = isUp ? dHigh - sRange * 0.700 : dLow + sRange * 0.618;
  const z2Hi = isUp ? dHigh - sRange * 0.786 : dLow + sRange * 0.850;
  const z2Lo = isUp ? dHigh - sRange * 0.850 : dLow + sRange * 0.786;
  const z3Hi = isUp ? dHigh - sRange * 0.950 : dLow + sRange * 1.000;
  const z3Lo = isUp ? dHigh - sRange * 1.000 : dLow + sRange * 0.950;

  // Entry / TP / SL (entry & TP levels user-configurable)
  const entryR = fibOf(V11_CONFIG.fibEntry);
  const tp1 = fibOf(V11_CONFIG.fibTp1);
  const tp3 = fibOf(V11_CONFIG.fibTp3);
  const slP = isUp
    ? dLow - sRange * (V11_CONFIG.slPercent / 100)
    : dHigh + sRange * (V11_CONFIG.slPercent / 100);

  // Risk : Reward
  const risk = Math.abs(entryR - slP);
  const rr1 = risk > 0 ? Math.abs(tp1 - entryR) / risk : 0;
  const rr3 = risk > 0 ? Math.abs(tp3 - entryR) / risk : 0;

  // Status Detection
  const inZ2 = isUp ? (livePrice <= z2Hi && livePrice >= z2Lo) : (livePrice >= z2Lo && livePrice <= z2Hi);
  const inZ1 = isUp ? (livePrice <= z1Hi && livePrice >= z1Lo) : (livePrice >= z1Lo && livePrice <= z1Hi);
  const inZ3 = isUp ? (livePrice <= z3Lo) : (livePrice >= z3Hi);
  const nearZ1 = isUp ? (livePrice <= z1Hi + atrVal) : (livePrice >= z1Lo - atrVal);

  let status = 'SCANNING', statusColor = 'var(--accent-cyan)', statusEmoji = '🔍';
  if (inZ2) { status = 'ENTRY ZONE'; statusColor = '#2962FF'; statusEmoji = '🟢'; }
  else if (inZ1) { status = 'WATCH ZONE'; statusColor = '#FF6D00'; statusEmoji = '🟡'; }
  else if (inZ3) { status = 'DANGER ZONE'; statusColor = '#FF1744'; statusEmoji = '🔴'; }
  else if (nearZ1) { status = 'APPROACHING'; statusColor = '#FFD600'; statusEmoji = '⏳'; }

  // Update HTML elements
  const statusEl = document.getElementById('v11-status-badge');
  const trendEl = document.getElementById('v11-trend-badge');
  const entryEl = document.getElementById('v11-val-entry');
  const tp1El = document.getElementById('v11-val-tp1');
  const tp3El = document.getElementById('v11-val-tp3');
  const slEl = document.getElementById('v11-val-sl');
  const rrEl = document.getElementById('v11-val-rr');

  if (statusEl) {
    statusEl.textContent = statusEmoji + ' ' + status;
    statusEl.style.color = statusColor;
  }
  if (trendEl) {
    const trendLabel = isUp ? '📈 BULLISH' : '📉 BEARISH';
    const emaLabel = emaConfirm ? ' ✓ EMA' : ' ✗ EMA';
    trendEl.textContent = trendLabel + emaLabel;
    trendEl.style.color = isUp ? 'var(--accent-green)' : 'var(--accent-red)';
  }
  if (entryEl) entryEl.textContent = '$' + entryR.toFixed(2);
  if (tp1El) tp1El.textContent = '$' + tp1.toFixed(2);
  if (tp3El) tp3El.textContent = '$' + tp3.toFixed(2);
  if (slEl) slEl.textContent = '$' + slP.toFixed(2);
  if (rrEl) {
    rrEl.textContent = '1:' + rr1.toFixed(2) + ' (TP1) | 1:' + rr3.toFixed(2) + ' (TP3)';
    rrEl.style.color = rr1 >= 1.5 ? 'var(--accent-green)' : rr1 >= 1.0 ? 'var(--gold-primary)' : 'var(--accent-red)';
  }

  // Fib level table (full set 0%-100%, user-configurable)
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
  // Ensure 0% and 100% are present (needed for the retracement frame)
  if (!list.includes(0)) list.unshift(0);
  if (!list.includes(100)) list.push(100);
  V11_CONFIG.fibLevels = [...new Set(list)].sort((a, b) => a - b);
  V11_CONFIG.fibEntry = norm(entryPct, V11_CONFIG.fibEntry);
  V11_CONFIG.fibTp1 = norm(tp1Pct, V11_CONFIG.fibTp1);
  V11_CONFIG.fibTp3 = norm(tp3Pct, V11_CONFIG.fibTp3);
  return V11_CONFIG.fibLevels;
}
