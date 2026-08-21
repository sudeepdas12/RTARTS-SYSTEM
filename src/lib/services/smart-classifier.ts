/**
 * Smart Shareholder & Investor Classification Engine
 *
 * Deterministic, multi-tier classification hierarchy designed for Nepal RTA/RTS operations.
 * Enforces strict precedence:
 *  0. Pre-existing Confirmed Database Classification.
 *  1. Explicit Upload / Form Metadata (Holder Type, Investor Type, Sheet Category).
 *  2. Hard Proof of Individual Human (Family Lineage, Guardians, Citizenship, DOB, Demographics, Lineage S/O D/O, Titles).
 *  3. Corporate Registration Guard (PVT. LTD. / PRIVATE LIMITED / LTD) -> Guaranteed COMPANY_INSTITUTION.
 *  4. Tax Exempt Funds (SEBON Registered Mutual Funds & Statutory Retirement Funds).
 *  5. Institutional Business Entities (Banks, Insurance, Hydropower, Cooperatives, Government, Organizations).
 *  6. Nepali Surname & Joint Account Matching -> Natural Person.
 *  7. Fallback -> UNCLASSIFIED / UNKNOWN (or Public).
 */

export type PayeeClassification = 'NATURAL_PERSON' | 'PUBLIC_LEGAL_PERSON' | 'COMPANY_INSTITUTION' | 'TAX_EXEMPT' | 'UNCLASSIFIED';
export type PayeeCategory = 'PUBLIC' | 'PROMOTER' | 'INSTITUTION' | 'MUTUAL_FUND' | 'TAX_EXEMPT' | 'LOCAL' | 'FOREIGN' | 'UNKNOWN';
export type PayeeSegment = 'PROMOTER' | 'LOCAL' | 'PUBLIC' | null;

export interface ClassificationInput {
  full_name?: string | null;
  fullName?: string | null;
  name?: string | null;
  NAME?: string | null;
  client_name?: string | null;
  clientName?: string | null;
  company_name?: string | null;
  companyName?: string | null;

  boid?: string | null;
  BOID?: string | null;
  client_code?: string | null;

  // Family Lineage (Only humans have parents/spouses)
  father_name?: string | null;
  fatherName?: string | null;
  FATHER_NAME?: string | null;
  "FATHER'S NAME"?: string | null;
  FATHER_NAME_MOTHER_NAME?: string | null;

  grandfather_name?: string | null;
  grandfatherName?: string | null;
  GRANDFATHER_NAME?: string | null;
  "GRANDFATHER'S NAME"?: string | null;
  GRANDFATHER_NAME_SPOUSE_NAME?: string | null;

  mother_name?: string | null;
  spouse_name?: string | null;

  // Guardians (Only human minors have guardians)
  guardian_name?: string | null;
  guardianName?: string | null;
  GUARDIAN_NAME?: string | null;
  GUARDIAN?: string | null;
  guardian_relation?: string | null;
  guardianRelation?: string | null;
  guardian_citizenship?: string | null;
  guardian_father_name?: string | null;

  // Personal Credentials & Demographics
  citizenship?: string | null;
  CITIZENSHIP?: string | null;
  citizenship_no?: string | null;
  CITIZENSHIP_NO?: string | null;
  passport_no?: string | null;
  voter_id?: string | null;

  pan?: string | null;
  pan_or_citizenship?: string | null;
  date_of_birth?: string | null;
  dob?: string | null;
  gender?: string | null;
  sex?: string | null;
  marital_status?: string | null;
  maritalStatus?: string | null;
  occupation?: string | null;
  profession?: string | null;

  // Metadata / Sheet columns
  holder_type?: string | null;
  holderType?: string | null;
  payee_classification?: string | null;
  payee_segment?: string | null;
  investor_type?: string | null;
  investorType?: string | null;
  category?: string | null;
  CATEGORY?: string | null;
  type?: string | null;
  TYPE?: string | null;
  shareholder_type?: string | null;
  shareholderType?: string | null;

  lot_name?: string | null;
  sheetType?: string | null;
  instrument_ref?: string | null;
}

export interface ClassificationResult {
  payee_classification: PayeeClassification;
  payee_category: PayeeCategory;
  payee_segment: PayeeSegment;
  holder_type: string;
  tds_rate_dividend: number; // 0.05 (5%) or 0 (0%)
  tds_rate_debenture: number; // 0.06 (6%), 0.15 (15%), or 0 (0%)
  rule_matched: string;
}

// 1. Known Statutory Tax-Exempt Funds in Nepal (Exact or strict compound matches)
const STATUTORY_FUNDS_REGEX = /(NAGARIK\s*LAGANI\s*KOSH|CITIZEN\s*INVESTMENT\s*TRUST|\bCIT\b|CIT\s*-\s*CITIZEN|KARMACHARI\s*SANCHAYA\s*KOSH|EMPLOYEES\s*PROVIDENT\s*FUND|\bEPF\b|SAMAJIK\s*SURAKSHA\s*KOSH|SOCIAL\s*SECURITY\s*FUND|\bSSF\b|AWAKASH\s*KOSH\s*(TRUST|BYAWASTHAPAN\s*TRUST)|PENSION\s*FUND\s*TRUST|KALYAN\s*KOSH\s*TRUST)/i;

// 2. SEBON Mutual Fund Schemes Regex (All open/closed-ended schemes in Nepal)
const MUTUAL_FUND_SCHEMES_REGEX = /(MUTUAL\s*FUND|\bMF\b|FOCUS\s*(40|30|25)|SELECT\s*(30|40)|SUPER\s*(30|40)|SAMRIDDHI\s*FUND|SAMUNNAT\s*SCHEME|PRAGATI\s*FUND|SAHABHAGITA\s*FUND|DHANABRIDDHI\s*YOJANA|SABAL\s*FUND|UNNATI\s*FUND|SARAL\s*FUND|SHUBHA\s*LAXMI\s*KOSH|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP\s*(FUND|SCHEME)|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|DIVIDEND\s*YIELD\s*FUND|MONEY\s*MARKET\s*FUND|INDEX\s*FUND|CWEDA\s*EQUITY\s*FUND|STABLE\s*FUND|RESOURCE\s*FUND|HYBRID\s*FUND|SMART\s*FUND|\bYOJANA\b)/i;

// 3. Corporate Suffixes Regex (Guaranteed Institution / Company)
const CORPORATE_SUFFIX_REGEX = /(PVT\.?\s*LTD|PRIVATE\s*LIMITED|P\.?\s*LTD|\bLIMITED\b|\bLTD\.?\b|\bCOMPANY\b|\bCORP\b|CORPORATION|\bINC\.?\b|\bLLC\b|\bPLC\b)/i;

// 4. Institutional Business Patterns in Nepal
const INSTITUTIONAL_BUSINESS_REGEX = /(\bBANK\b|BIKAS\s*BANK|DEVELOPMENT\s*BANK|FINANCE|MICROFINANCE|LAGHUBITTA|BITTIYA|BITTIYA\s*SANSTHA|BIMA|BEEMA|INSURANCE|REINSURANCE|NIRJIBAN\s*BIMA|JIBAN\s*BIMA|HYDROPOWER|HYDRO\s*POWER|HYDRO|JALABIDHYUT|URJA|ENERGY|POWER|CEMENT|STEEL|MINES|PETROLEUM|CONSTRUCTION|DEVELOPERS|REAL\s*ESTATE|HOUSING|HOTEL|RESORT|HOSPITAL|NURSING\s*HOME|POLYCLINIC|DIAGNOSTIC|PHARMA|PHARMACEUTICALS|LABORATORIES|COLLEGE|SCHOOL|CAMPUS|UNIVERSITY|ACADEMY|VIDHYALAYA|INSTITUTE|FOUNDATION|PRATISTHAN|\bTRUST\b|SOCIETY|SANSTHA|SAMITI|MANDAL|PARISHAD|KENDRA|SANGH|MAHASANGH|FEDERATION|ASSOCIATION|\bCLUB\b|COOPERATIVE|CO-OPERATIVE|SAHAKARI|ENTERPRISES|TRADING|TRADERS|SUPPLIERS|DISTRIBUTORS|INDUSTRIES|VENTURES|CAPITAL|SECURITIES|BROKER|MERCHANT\s*BANKING|INVESTMENT|HOLDINGS|\bGROUP\b|SOLUTIONS|SERVICES|CONSULTING|SYSTEMS|AGRO|TECH|TECHNOLOGIES|GOVERNMENT|SARKAR|MINISTRY|DEPARTMENT|PRADHIKARAN|SANSTHAN|NIGAM|MUNICIPALITY|NAGARPALIKA|GAUNPALIKA|EMBASSY|GUTHI)/i;

// 5. Distinct Human Honorifics & Personal Titles (Prefixes)
const HUMAN_TITLES_REGEX = /(^|\s)(MR|MRS|MS|MISS|DR|ER|PROF|CA|ADV|HON|LT|CAPT|MAJ|COL|BRIG|GEN|SWAMI|PANDIT|SMT)\.?\s+/i;

// 6. Distinct Human Relationship Phrases in Name
const HUMAN_RELATIONSHIPS_REGEX = /\b(S\/O|D\/O|W\/O|H\/O|C\/O|S\/D\/W\s*OF|SON\s*OF|DAUGHTER\s*OF|WIFE\s*OF|CARE\s*OF|JT\.?\s*HOLDER|JOINT\s*HOLDER|\(MINOR\)|MINOR)\b/i;

// 7. Common Nepali Surnames (High-Confidence Human Names)
const NEPALI_SURNAMES_REGEX = /\b(SHRESTHA|SHARMA|THAPA|GIRI|SUBEDI|ONTA|POKHAREL|ADHIKARI|KARKI|BHATTARAI|GURUNG|MAGAR|TAMANG|RAI|LIMBU|SHAKYA|BAJRACHARYA|JOSHI|PRADHAN|PANDEY|KHATRI|DAHAL|GAUTAM|BASNET|BISTA|REGMI|NEUPANE|RIJAL|SIGDEL|ACHARYA|GHIMIRE|POUDEL|KHADKA|TIWARI|BARAL|ARYAL|TRIPATHI|JHA|YADAV|MAHATO|CHAUDHARY|SHAH|SINGH|RANA|MALLA|KSHETRI|PANT|UPADHYAYA|BHATTA|PANTHI|DHAKAL|LAMICHHANE|KANDEL|GYAWALI|CHAPAGAIN|DEVCOTA|DHUNGANA|BHANDARI|ALE|PUN|GHALE|ROKAYA|BOHARA|RAWAT|BANIYA|SILWAL|MAHARJAN|DANGOL|MANANDHAR|KASAJU|SUWAL|DONGOL|PRACHAND|CHAUDHARY)\b/i;

/**
 * Authoritative Smart Classifier
 */
export function smartClassify(input: ClassificationInput): ClassificationResult {
  const rawName = String(
    input.full_name || input.fullName || input.name || input.NAME ||
    input.client_name || input.clientName || input.company_name || input.companyName || ''
  ).trim();

  const nameUpper = rawName.toUpperCase();

  // Family Lineage
  const father = String(input.father_name || input.fatherName || input.FATHER_NAME || input["FATHER'S NAME"] || input.FATHER_NAME_MOTHER_NAME || '').trim();
  const gfather = String(input.grandfather_name || input.grandfatherName || input.GRANDFATHER_NAME || input["GRANDFATHER'S NAME"] || input.GRANDFATHER_NAME_SPOUSE_NAME || '').trim();
  const mother = String(input.mother_name || '').trim();
  const spouse = String(input.spouse_name || '').trim();

  // Guardian Details (Minors)
  const guardian = String(
    input.guardian_name || input.guardianName || input.GUARDIAN_NAME || input.GUARDIAN ||
    input.guardian_relation || input.guardianRelation || input.guardian_citizenship || input.guardian_father_name || ''
  ).trim();

  // Personal Credentials & Demographics
  const citizenship = String(input.citizenship || input.CITIZENSHIP || input.citizenship_no || input.CITIZENSHIP_NO || '').trim();
  const passport = String(input.passport_no || input.voter_id || '').trim();
  const dob = String(input.date_of_birth || input.dob || '').trim();
  const gender = String(input.gender || input.sex || '').trim().toUpperCase();
  const maritalStatus = String(input.marital_status || input.maritalStatus || '').trim().toUpperCase();
  const occupation = String(input.occupation || input.profession || '').trim().toUpperCase();

  // Explicit Type / Category / Segment Metadata
  const explicitType = String(
    input.holder_type || input.holderType || input.investor_type || input.investorType ||
    input.category || input.CATEGORY || input.type || input.TYPE ||
    input.shareholder_type || input.shareholderType || ''
  ).trim().toUpperCase();

  const lotName = String(input.lot_name || input.sheetType || input.instrument_ref || '').toUpperCase();
  const dbClassification = String(input.payee_classification || '').trim().toUpperCase();
  const dbSegment = String(input.payee_segment || '').trim().toUpperCase();

  const isPromoterSegment = explicitType.includes('PROMOT') || lotName.includes('PROMOT') || dbSegment === 'PROMOTER';
  const isLocalSegment = explicitType.includes('LOCAL') || lotName.includes('LOCAL') || dbSegment === 'LOCAL';

  // =========================================================================
  // TIER 0: Pre-existing Database Confirmed Classification
  // =========================================================================
  if (dbClassification && dbClassification !== 'UNCLASSIFIED') {
    if (dbClassification === 'COMPANY_INSTITUTION') {
      return {
        payee_classification: 'COMPANY_INSTITUTION',
        payee_category: isPromoterSegment ? 'PROMOTER' : 'INSTITUTION',
        payee_segment: isPromoterSegment ? 'PROMOTER' : null,
        holder_type: isPromoterSegment ? 'Legal Person - Promoter' : 'Legal Person',
        tds_rate_dividend: 0.05,
        tds_rate_debenture: 0.15,
        rule_matched: 'Database Confirmed Classification (Legal Person)',
      };
    }
    if (dbClassification === 'TAX_EXEMPT') {
      const isMf = MUTUAL_FUND_SCHEMES_REGEX.test(nameUpper) || explicitType.includes('MUTUAL');
      return {
        payee_classification: 'TAX_EXEMPT',
        payee_category: isMf ? 'MUTUAL_FUND' : 'TAX_EXEMPT',
        payee_segment: null,
        holder_type: isMf ? 'Mutual Fund' : 'Tax Exempt',
        tds_rate_dividend: 0.0,
        tds_rate_debenture: 0.0,
        rule_matched: 'Database Confirmed Classification (Tax Exempt)',
      };
    }
    if (dbClassification === 'NATURAL_PERSON' || dbClassification === 'PUBLIC_LEGAL_PERSON') {
      const segment: PayeeSegment = isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC';
      const category: PayeeCategory = isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC';
      return {
        payee_classification: 'NATURAL_PERSON',
        payee_category: category,
        payee_segment: segment,
        holder_type: isPromoterSegment
          ? 'Natural Person - Promoter'
          : isLocalSegment
          ? 'Natural Person - Local'
          : 'Natural Person - Public',
        tds_rate_dividend: 0.05,
        tds_rate_debenture: 0.06,
        rule_matched: 'Database Confirmed Classification (Natural Person)',
      };
    }
  }

  // =========================================================================
  // TIER 1: Explicit Metadata Check (Holder Type / Type / Category)
  // =========================================================================
  if (explicitType) {
    if (/MUTUAL|MF\b/i.test(explicitType)) {
      return {
        payee_classification: 'TAX_EXEMPT',
        payee_category: 'MUTUAL_FUND',
        payee_segment: null,
        holder_type: 'Mutual Fund',
        tds_rate_dividend: 0.0,
        tds_rate_debenture: 0.0,
        rule_matched: 'Explicit Metadata (Mutual Fund)',
      };
    }
    if (/TAX.?EXEMPT|EXEMPT/i.test(explicitType)) {
      return {
        payee_classification: 'TAX_EXEMPT',
        payee_category: 'TAX_EXEMPT',
        payee_segment: null,
        holder_type: 'Tax Exempt',
        tds_rate_dividend: 0.0,
        tds_rate_debenture: 0.0,
        rule_matched: 'Explicit Metadata (Tax Exempt)',
      };
    }
    if (/LEGAL|INSTIT|COMPANY|CORPORAT|PRIVATE/i.test(explicitType)) {
      return {
        payee_classification: 'COMPANY_INSTITUTION',
        payee_category: isPromoterSegment ? 'PROMOTER' : 'INSTITUTION',
        payee_segment: isPromoterSegment ? 'PROMOTER' : null,
        holder_type: isPromoterSegment ? 'Legal Person - Promoter' : 'Legal Person',
        tds_rate_dividend: 0.05,
        tds_rate_debenture: 0.15,
        rule_matched: 'Explicit Metadata (Institution / Corporate)',
      };
    }
    if (/PROMOT/i.test(explicitType)) {
      return {
        payee_classification: 'NATURAL_PERSON',
        payee_category: 'PROMOTER',
        payee_segment: 'PROMOTER',
        holder_type: 'Natural Person - Promoter',
        tds_rate_dividend: 0.05,
        tds_rate_debenture: 0.06,
        rule_matched: 'Explicit Metadata (Promoter)',
      };
    }
    if (/LOCAL/i.test(explicitType)) {
      return {
        payee_classification: 'NATURAL_PERSON',
        payee_category: 'LOCAL',
        payee_segment: 'LOCAL',
        holder_type: 'Natural Person - Local',
        tds_rate_dividend: 0.05,
        tds_rate_debenture: 0.06,
        rule_matched: 'Explicit Metadata (Local)',
      };
    }
    if (/PUBLIC|INDIVIDUAL|GENERAL/i.test(explicitType)) {
      return {
        payee_classification: 'NATURAL_PERSON',
        payee_category: 'PUBLIC',
        payee_segment: 'PUBLIC',
        holder_type: 'Natural Person - Public',
        tds_rate_dividend: 0.05,
        tds_rate_debenture: 0.06,
        rule_matched: 'Explicit Metadata (Natural Person - Public)',
      };
    }
  }

  // =========================================================================
  // TIER 2: Hard Proof of Individual Human
  // Real humans have:
  //  - Family Lineage (Father, Grandfather, Mother, Spouse)
  //  - Guardians (Minor accounts)
  //  - Personal Credentials (Citizenship, Passport, Voter ID)
  //  - Personal Demographics (Date of Birth, Gender, Marital Status, Occupation)
  //  - Lineage phrases in name (s/o, d/o, w/o, minor, joint holder)
  //  - Distinct Human Titles (Dr, Er, Prof, CA, Adv, Mr, Mrs, Ms)
  // =========================================================================
  const hasFamilyLineage = Boolean(father || gfather || mother || spouse);
  const hasGuardian = Boolean(guardian);
  const hasCitizenship = Boolean(citizenship && /[-a-zA-Z0-9]/.test(citizenship));
  const hasPassport = Boolean(passport && passport.length >= 5);
  const hasDob = Boolean(dob && dob.length >= 4);
  const hasGender = Boolean(gender === 'MALE' || gender === 'FEMALE' || gender === 'M' || gender === 'F');
  const hasMaritalStatus = Boolean(maritalStatus && (maritalStatus.includes('MARRIED') || maritalStatus.includes('SINGLE')));
  const hasPersonalOccupation = Boolean(
    occupation && /(STUDENT|HOUSEWIFE|SERVICE|TEACHER|DOCTOR|ENGINEER|AGRICULTURE|RETIRED|LAWYER|NURSE|PROFESSOR)/i.test(occupation)
  );

  const hasHumanTitle = HUMAN_TITLES_REGEX.test(nameUpper);
  const hasHumanRelationship = HUMAN_RELATIONSHIPS_REGEX.test(nameUpper);

  if (
    hasFamilyLineage ||
    hasGuardian ||
    hasCitizenship ||
    hasPassport ||
    hasDob ||
    hasGender ||
    hasMaritalStatus ||
    hasPersonalOccupation ||
    hasHumanTitle ||
    hasHumanRelationship
  ) {
    const segment: PayeeSegment = isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC';
    const category: PayeeCategory = isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC';
    const holderType = isPromoterSegment
      ? 'Natural Person - Promoter'
      : isLocalSegment
      ? 'Natural Person - Local'
      : hasGuardian || nameUpper.includes('MINOR')
      ? 'Natural Person - Minor'
      : 'Natural Person - Public';

    return {
      payee_classification: 'NATURAL_PERSON',
      payee_category: category,
      payee_segment: segment,
      holder_type: holderType,
      tds_rate_dividend: 0.05,
      tds_rate_debenture: 0.06,
      rule_matched: hasGuardian
        ? 'Natural Person (Minor with Guardian Verified)'
        : hasFamilyLineage
        ? 'Natural Person (Family Lineage Verified)'
        : hasCitizenship
        ? 'Natural Person (Citizenship Certificate Verified)'
        : hasDob
        ? 'Natural Person (Date of Birth Verified)'
        : hasHumanTitle || hasHumanRelationship
        ? 'Natural Person (Personal Title / Lineage Format)'
        : 'Natural Person (Demographics Verified)',
    };
  }

  // =========================================================================
  // TIER 3: Private Limited Company Guard (PVT. LTD. / PRIVATE LIMITED / LTD)
  // Any corporate company (e.g. Khimadevi Lagani Kosh Pvt. Ltd.) is an
  // incorporated Legal Person, NOT a tax-exempt entity.
  // =========================================================================
  const isCorporateSuffix = CORPORATE_SUFFIX_REGEX.test(nameUpper);
  const isMutualFundScheme = MUTUAL_FUND_SCHEMES_REGEX.test(nameUpper);

  if (isCorporateSuffix && !isMutualFundScheme) {
    const segment: PayeeSegment = isPromoterSegment ? 'PROMOTER' : null;
    return {
      payee_classification: 'COMPANY_INSTITUTION',
      payee_category: isPromoterSegment ? 'PROMOTER' : 'INSTITUTION',
      payee_segment: segment,
      holder_type: isPromoterSegment ? 'Legal Person - Promoter' : 'Legal Person',
      tds_rate_dividend: 0.05,
      tds_rate_debenture: 0.15,
      rule_matched: 'Legal Person (Corporate Registration Suffix)',
    };
  }

  // =========================================================================
  // TIER 4: Tax Exempt Entities (SEBON Mutual Funds & Statutory Retirement Funds)
  // =========================================================================
  const isStatutoryFund = STATUTORY_FUNDS_REGEX.test(nameUpper);

  if (isStatutoryFund || isMutualFundScheme) {
    return {
      payee_classification: 'TAX_EXEMPT',
      payee_category: isMutualFundScheme ? 'MUTUAL_FUND' : 'TAX_EXEMPT',
      payee_segment: null,
      holder_type: isMutualFundScheme ? 'Mutual Fund' : 'Tax Exempt',
      tds_rate_dividend: 0.0,
      tds_rate_debenture: 0.0,
      rule_matched: isStatutoryFund
        ? 'Tax Exempted (Statutory Retirement / Pension Fund)'
        : 'Tax Exempted (SEBON Approved Mutual Fund Scheme)',
    };
  }

  // =========================================================================
  // TIER 5: Institutional & Corporate Business Entities in Nepal
  // =========================================================================
  const isInstitutionalBusiness = INSTITUTIONAL_BUSINESS_REGEX.test(nameUpper);
  if (isInstitutionalBusiness) {
    const segment: PayeeSegment = isPromoterSegment ? 'PROMOTER' : null;
    return {
      payee_classification: 'COMPANY_INSTITUTION',
      payee_category: isPromoterSegment ? 'PROMOTER' : 'INSTITUTION',
      payee_segment: segment,
      holder_type: isPromoterSegment ? 'Legal Person - Promoter' : 'Legal Person',
      tds_rate_dividend: 0.05,
      tds_rate_debenture: 0.15,
      rule_matched: 'Legal Person (Institutional Organization Keyword)',
    };
  }

  // =========================================================================
  // TIER 6: Joint human accounts & Nepali Human Surname Detection
  // =========================================================================
  const isJointHumanHolder = /\s+(\/|&|\+)\s+/.test(nameUpper) && !isCorporateSuffix && !isInstitutionalBusiness;

  if (isJointHumanHolder || (NEPALI_SURNAMES_REGEX.test(nameUpper) && !isCorporateSuffix && !isInstitutionalBusiness)) {
    const segment: PayeeSegment = isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC';
    const category: PayeeCategory = isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC';
    return {
      payee_classification: 'NATURAL_PERSON',
      payee_category: category,
      payee_segment: segment,
      holder_type: isJointHumanHolder
        ? 'Natural Person - Joint Holder'
        : isPromoterSegment
        ? 'Natural Person - Promoter'
        : isLocalSegment
        ? 'Natural Person - Local'
        : 'Natural Person - Public',
      tds_rate_dividend: 0.05,
      tds_rate_debenture: 0.06,
      rule_matched: isJointHumanHolder ? 'Natural Person (Joint Human Account)' : 'Natural Person (Nepali Name Structure)',
    };
  }

  // =========================================================================
  // TIER 7: Default / Unclassified Fallback
  // If row has an unidentifiable text string with zero signals:
  // =========================================================================
  if (dbClassification === 'UNCLASSIFIED' || !rawName || rawName === 'Ram Shyam') {
    return {
      payee_classification: 'UNCLASSIFIED',
      payee_category: 'UNKNOWN',
      payee_segment: isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : null,
      holder_type: 'Public',
      tds_rate_dividend: 0.05,
      tds_rate_debenture: 0.06,
      rule_matched: 'Unclassified (Pending Review)',
    };
  }

  return {
    payee_classification: 'NATURAL_PERSON',
    payee_category: isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC',
    payee_segment: isPromoterSegment ? 'PROMOTER' : isLocalSegment ? 'LOCAL' : 'PUBLIC',
    holder_type: isPromoterSegment
      ? 'Natural Person - Promoter'
      : isLocalSegment
      ? 'Natural Person - Local'
      : 'Natural Person - Public',
    tds_rate_dividend: 0.05,
    tds_rate_debenture: 0.06,
    rule_matched: 'Default Fallback (Natural Person - Public)',
  };
}
