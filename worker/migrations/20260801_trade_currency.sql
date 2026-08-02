-- Migration: add currency column to trade_history for multi-currency P&L
ALTER TABLE trade_history ADD COLUMN currency TEXT DEFAULT 'USD';
