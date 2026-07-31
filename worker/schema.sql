-- JJ TRADER Database Schema for Cloudflare D1

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  salt TEXT DEFAULT NULL,
  email TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Trade Journal Notes
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Price Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT DEFAULT 'XAUUSD',
  target_price REAL NOT NULL,
  condition TEXT DEFAULT 'above',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Trade History
CREATE TABLE IF NOT EXISTS trade_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry REAL,
  close REAL,
  sl REAL,
  tp REAL,
  lot REAL,
  result TEXT,
  pnl REAL DEFAULT 0,
  note TEXT,
  date TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Preferences (Risk, Timeframe, Indicators)
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  balance REAL DEFAULT 1000,
  risk_pct REAL DEFAULT 1,
  timeframe TEXT DEFAULT '240',
  symbol TEXT DEFAULT 'OANDA:XAUUSD',
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- News cache (persists ForexFactory calendar across deployments)
CREATE TABLE IF NOT EXISTS news_cache (
  id TEXT PRIMARY KEY DEFAULT 'default',
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
