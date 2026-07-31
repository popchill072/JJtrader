-- Add news_cache table for persisting ForexFactory calendar data
CREATE TABLE IF NOT EXISTS news_cache (
  id TEXT PRIMARY KEY DEFAULT 'default',
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
