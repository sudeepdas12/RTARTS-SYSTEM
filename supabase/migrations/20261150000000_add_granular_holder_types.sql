-- ============================================================================
-- Migration: 20261150000000_add_granular_holder_types.sql
-- Description:
--   Expands the holder_type enum in PostgreSQL using ADD VALUE IF NOT EXISTS
-- ============================================================================

ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Natural Person - Local';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Natural Person - Employee';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Natural Person - Minor';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Natural Person - Joint Holder';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Legal Person - Promoter';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Local';
ALTER TYPE public.holder_type ADD VALUE IF NOT EXISTS 'Employee';

CREATE OR REPLACE FUNCTION public.sync_client_payee_classification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.classification_status = 'CONFIRMED' THEN RETURN NEW; END IF;
  IF NEW.payee_classification <> 'UNCLASSIFIED' THEN
    NEW.classification_status = COALESCE(NULLIF(NEW.classification_status, 'REVIEW_REQUIRED'), 'AUTO_CLASSIFIED');
    RETURN NEW;
  END IF;
  CASE NEW.holder_type::text
    WHEN 'Natural Person - Promoter', 'Promoter' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PROMOTER';
    WHEN 'Natural Person - Local', 'Local' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'LOCAL';
    WHEN 'Natural Person - Employee', 'Employee' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Natural Person - Public', 'Natural Person - Minor', 'Natural Person - Joint Holder' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Public' THEN NEW.payee_classification := 'PUBLIC_LEGAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Legal Person', 'Legal Person - Promoter', 'Institution', 'Foreign' THEN NEW.payee_classification := 'COMPANY_INSTITUTION';
    WHEN 'Mutual Fund', 'Tax Exempt' THEN NEW.payee_classification := 'TAX_EXEMPT';
    ELSE RETURN NEW;
  END CASE;
  NEW.classification_status := 'AUTO_CLASSIFIED';
  NEW.classification_source := COALESCE(NEW.classification_source, 'holder_type');
  RETURN NEW;
END;
$$;
