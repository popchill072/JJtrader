// == JJ TRADER V11 PRO ENGINE ==
// Translated from Pine Script "JJ TRADER V11 PRO" to JavaScript
// Swing High/Low Lookback -> Fibonacci Zones -> EMA Trend Filter -> Status Detection

const V11_CONFIG = { lookback: 30, emaFast: 21, emaSlow: 89, slPercent: 10.0, atrLength: 14, atrMult: 1.5 };
let v11PriceHistory = [];
const V11_MAX_HISTORY = 200;

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
  for (let i = start; i < prices.length; i++) { sum += Math.abs(prices[i] - prices[i - 1]); }
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

  // Trend detection: which came first - high or low?
  let hAge = 0, lAge = 0;
  for (let i = recentPrices.length - 1; i >= 0; i--) {
    if (recentPrices[i] === dHigh && hAge === 0) hAge = recentPrices.length - 1 - i;
    if (recentPrices[i] === dLow && lAge === 0) lAge = recentPrices.length - 1 - i;
  }
  const isUp = lAge > hAge;

  // EMA Filter
  const emaFast = v11CalcEMA(hist, V11_CONFIG.emaFast);
  const emaSlow = v11CalcEMA(hist, V11_CONFIG.emaSlow);
  const emaConfirm = isUp ? (emaFast > emaSlow) : (emaFast < emaSlow);

  // ATR
  const atrVal = v11CalcATR(hist, V11_CONFIG.atrLength);

  // Fibonacci Levels
  const fib382 = isUp ? dHigh - sRange * 0.382 : dLow + sRange * 0.382;
  const fib786 = isUp ? dHigh - sRange * 0.786 : dLow + sRange * 0.786;

  // Zones (from Pine Script)
  const z1Hi = isUp ? dHigh - sRange * 0.618 : dLow + sRange * 0.700;
  const z1Lo = isUp ? dHigh - sRange * 0.700 : dLow + sRange * 0.618;
  const z2Hi = isUp ? dHigh - sRange * 0.786 : dLow + sRange * 0.850;
  const z2Lo = isUp ? dHigh - sRange * 0.850 : dLow + sRange * 0.786;
  const z3Hi = isUp ? dHigh - sRange * 0.950 : dLow + sRange * 1.000;
  const z3Lo = isUp ? dHigh - sRange * 1.000 : dLow + sRange * 0.950;

  // Entry / TP / SL
  const entryR = fib786;
  const tp1 = fib382;
  const tp3 = isUp ? dHigh : dLow;
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
}
