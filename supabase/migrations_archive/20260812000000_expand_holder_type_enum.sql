-- Expand the holder_type ENUM to include Mutual_Fund and Foreign.
-- This allows the system to distinguish Mutual Funds and Foreign investors
-- from ordinary institutional (Legal Person / Company) investors in reports.

ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Mutual_Fund';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Foreign';
