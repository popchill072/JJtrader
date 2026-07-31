-- Migration: add new alert columns + trade_history.close to existing DB
ALTER TABLE alerts ADD COLUMN symbol TEXT DEFAULT 'XAUUSD';
ALTER TABLE alerts ADD COLUMN target_price REAL;
ALTER TABLE alerts ADD COLUMN condition TEXT DEFAULT 'above';
UPDATE alerts SET target_price = price WHERE target_price IS NULL;
ALTER TABLE trade_history ADD COLUMN close REAL;
