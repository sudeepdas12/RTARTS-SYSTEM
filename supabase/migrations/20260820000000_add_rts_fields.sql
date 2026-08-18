-- Migration to add RTS tracking columns to dividend_payables
ALTER TABLE dividend_payables
  ADD COLUMN rts_submitted BOOLEAN DEFAULT FALSE,
  ADD COLUMN rts_attempts INTEGER DEFAULT 0,
  ADD COLUMN rts_error TEXT;
