import { supabase, throwIfError } from "./database";
import { Database } from "@/integrations/supabase/types";

type Company = Database["public"]["Tables"]["companies"]["Row"];
type CompanyInsert = Database["public"]["Tables"]["companies"]["Insert"];
type CompanyUpdate = Database["public"]["Tables"]["companies"]["Update"];

export interface AutoRegisterCompanyParams {
  name: string;
  fileType?: string;
  isin?: string | null;
  rate?: number | null;
  fiscalYear?: string | null;
  userId?: string | null;
}

const KNOWN_CODES: Record<string, string> = {
  "GLOBAL IME": "GBIME",
  "NIC ASIA": "NICA",
  RBB: "RBB",
  NABIL: "NABIL",
  SANIMA: "SANIMA",
  KUMARI: "KBL",
  PRABHU: "PRVU",
  EVEREST: "EBL",
  "NEPAL LIFE": "NLIC",
  NLG: "NLG",
};

export function generateCompanyCode(name: string, fileType?: string, rate?: number): string {
  if (!name || !name.trim()) return "COMP";

  // Strip true file extensions only (e.g. .xlsx, .xls, .csv)
  const clean = name
    .replace(/\.(xlsx|xls|csv|tsv|xlsm)$/i, "")
    .replace(/[,\-_()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Extract rate if present in name (e.g. "8.5%", "10.25%")
  let detectedRate = rate;
  if (detectedRate === undefined || detectedRate === null) {
    const rateMatch = clean.match(/(\d+(?:\.\d+)?)\s*%/);
    if (rateMatch) {
      detectedRate = parseFloat(rateMatch[1]);
    }
  }

  const isDebenture =
    (fileType && fileType.toLowerCase().includes("debenture")) ||
    /debenture|bond|rinpatra/i.test(clean);

  const isMutualFund =
    (fileType &&
      (fileType.toLowerCase().includes("mutual") || fileType.toLowerCase().includes("fund"))) ||
    /mutual\s*fund|balanced\s*fund|equity\s*fund|growth\s*fund|rmf/i.test(clean);

  const cleanUpper = clean.toUpperCase();

  // If debenture, extract issuer symbol & rate or year
  if (isDebenture) {
    let issuer = "";
    for (const [key, sym] of Object.entries(KNOWN_CODES)) {
      if (cleanUpper.includes(key)) {
        issuer = sym;
        break;
      }
    }

    if (!issuer) {
      const cleanNoRate = clean
        .replace(/\d+(?:\.\d+)?\s*%/g, "")
        .replace(/debentures?|bonds?|rinpatra/gi, "");
      const words = cleanNoRate
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0 && !/^(the|of|and|\d{4})$/i.test(w));
      const found = words.find((w) => /^[A-Z]{2,8}$/.test(w)) || words[0] || "COMP";
      issuer = found.toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    let rateSuffix = "";
    if (detectedRate !== undefined && detectedRate !== null && !isNaN(detectedRate)) {
      rateSuffix = `D${detectedRate}`;
    } else {
      const yrMatch = clean.match(/\b(20[789]\d)\b/);
      rateSuffix = yrMatch ? `D${yrMatch[1].slice(-2)}` : "D";
    }
    return `${issuer}${rateSuffix}`.slice(0, 16);
  }

  // If Mutual Fund
  if (isMutualFund) {
    const fundWords = clean
      .replace(/mutual\s*fund|fund/gi, "Fund")
      .split(/\s+/)
      .filter((w) => w.length > 0 && !/^(the|of|and)$/i.test(w));
    if (fundWords.length >= 2) {
      const acronym = fundWords.map((w) => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join("");
      return acronym.slice(0, 12);
    }
  }

  // Check known codes first
  for (const [key, sym] of Object.entries(KNOWN_CODES)) {
    if (cleanUpper.includes(key)) {
      return sym;
    }
  }

  // Standard Equities / Banks / Hydro / Insurance
  const stopWords = new Set([
    "LIMITED",
    "LTD",
    "COMPANY",
    "CO",
    "BANK",
    "VIKAS",
    "BIKAS",
    "DEVELOPMENT",
    "FINANCE",
    "HOLDINGS",
    "CORP",
    "CORPORATION",
    "THE",
    "OF",
    "AND",
    "FOR",
  ]);

  const rawWords = clean.split(/\s+/).filter(Boolean);
  const significant = rawWords.filter(
    (w) => !stopWords.has(w.toUpperCase().replace(/[^A-Z]/g, "")),
  );

  // If there's an existing recognizable 2-7 letter acronym (e.g. NABIL, NICA, NLG, GBIME, RBB)
  const acronymWord = significant.find((w) => /^[A-Z]{2,7}$/.test(w));
  if (acronymWord) {
    return acronymWord.toUpperCase();
  }

  // Multi-word name: take initials (e.g. Nepal Life Insurance -> NLIC)
  if (significant.length >= 2) {
    const initials = significant.map((w) => w[0].toUpperCase()).join("");
    if (initials.length >= 2 && initials.length <= 8) {
      return initials;
    }
  }

  // Single word or fallback
  const firstWord = (significant[0] || rawWords[0] || "COMP")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return firstWord.slice(0, 8) || "COMP";
}

export const CompanyService = {
  generateCompanyCode,

  async getCompanies(): Promise<Company[]> {
    const { data, error } = await supabase.from("companies").select("*").order("company_name");
    throwIfError(error, "Failed to fetch companies");
    return data || [];
  },

  async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
    if (error && error.code !== "PGRST116") {
      throwIfError(error, "Failed to fetch company");
    }
    return data;
  },

  async findMatchingCompany(name: string, isin?: string | null): Promise<Company | null> {
    const cleanName = (name || "").replace(/\.[^/.]+$/, "").trim();

    // 1. ISIN match
    if (isin) {
      const { data: isinMatch } = await supabase
        .from("companies")
        .select("*")
        .eq("isin", isin.trim())
        .limit(1);
      if (isinMatch && isinMatch.length > 0) return isinMatch[0];
    }

    if (!cleanName) return null;

    // 2. Query all companies to check exact, substring, or token overlap
    const { data: allComps } = await supabase.from("companies").select("*").limit(300);

    if (!allComps || allComps.length === 0) return null;

    const lowerTarget = cleanName.toLowerCase();

    // 2a. Exact match
    const exact = allComps.find((c) => c.company_name.toLowerCase().trim() === lowerTarget);
    if (exact) return exact;

    // 2b. Substring match
    const sub = allComps.find((c) => {
      const cLower = c.company_name.toLowerCase().trim();
      return cLower.includes(lowerTarget) || lowerTarget.includes(cLower);
    });
    if (sub) return sub;

    // 2c. Token overlap match
    const targetTokens = lowerTarget
      .replace(/[^\w\s.%]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !/^\d{4}$/.test(t));

    if (targetTokens.length >= 2) {
      let bestMatch: Company | null = null;
      let maxOverlap = 0;

      for (const c of allComps) {
        const cTokens = c.company_name
          .toLowerCase()
          .replace(/[^\w\s.%]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 1);

        const overlap = targetTokens.filter((t) =>
          cTokens.some((ct) => ct === t || ct.includes(t) || t.includes(ct)),
        ).length;

        if (overlap > maxOverlap && overlap >= 2) {
          maxOverlap = overlap;
          bestMatch = c;
        }
      }
      if (bestMatch) return bestMatch;
    }

    // 2d. Code match
    const codeMatch = allComps.find((c) => {
      const code = (c.company_code || "").toLowerCase().trim();
      return code && (lowerTarget.includes(code) || code.includes(lowerTarget));
    });
    if (codeMatch) return codeMatch;

    return null;
  },

  async autoRegisterCompany(params: AutoRegisterCompanyParams): Promise<Company> {
    const cleanName = (params.name || "Unknown Company").replace(/\.[^/.]+$/, "").trim();

    // Check if matching company already exists
    const existing = await this.findMatchingCompany(cleanName, params.isin);
    if (existing) {
      // Enrich with missing metadata if available
      const updates: CompanyUpdate = {};
      if (!existing.isin && params.isin) updates.isin = params.isin;
      const isDeb =
        (params.fileType && params.fileType.toLowerCase().includes("debenture")) ||
        /debenture|bond|rinpatra/i.test(cleanName);
      if (!existing.debenture_rate && isDeb && params.rate) {
        updates.debenture_rate = params.rate;
        updates.coupon_rate = params.rate;
      }
      if (!existing.dividend_rate && !isDeb && params.rate) {
        updates.dividend_rate = params.rate;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from("companies").update(updates).eq("id", existing.id);
      }
      return existing;
    }

    // Determine type and sector
    const isDebenture =
      (params.fileType && params.fileType.toLowerCase().includes("debenture")) ||
      /debenture|bond|rinpatra/i.test(cleanName);
    const isMutualFund =
      (params.fileType &&
        (params.fileType.toLowerCase().includes("mutual") ||
          params.fileType.toLowerCase().includes("fund"))) ||
      /mutual\s*fund|balanced\s*fund|equity\s*fund|growth\s*fund|rmf/i.test(cleanName);

    const companyType = isDebenture ? "Debenture" : isMutualFund ? "Mutual Fund" : "Public Limited";
    const sectorType: "Institution" | "Public" =
      isDebenture || isMutualFund ? "Institution" : "Public";

    // Generate unique company code
    const baseCode = generateCompanyCode(cleanName, params.fileType, params.rate || undefined);
    let candidateCode = baseCode;

    const { data: codeCheck } = await supabase
      .from("companies")
      .select("company_code")
      .ilike("company_code", `${baseCode}%`);

    const existingCodes = new Set(
      (codeCheck || []).map((c) => (c.company_code || "").toUpperCase()),
    );
    if (existingCodes.has(candidateCode.toUpperCase())) {
      let counter = 1;
      while (existingCodes.has(`${baseCode}-${counter}`.toUpperCase())) {
        counter++;
      }
      candidateCode = `${baseCode}-${counter}`;
    }

    const insertData: CompanyInsert = {
      company_name: cleanName,
      company_code: candidateCode,
      company_type: companyType,
      sector_type: sectorType,
      isin: params.isin || null,
      fiscal_year: params.fiscalYear || null,
      debenture_rate: isDebenture && params.rate ? params.rate : null,
      coupon_rate: isDebenture && params.rate ? params.rate : null,
      dividend_rate: !isDebenture && params.rate ? params.rate : null,
      status: "Active",
      created_by: params.userId || null,
    };

    const { data: created, error: insertError } = await supabase
      .from("companies")
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      // In case of race condition / concurrent chunk insert, fetch again
      const { data: fallback } = await supabase
        .from("companies")
        .select("*")
        .ilike("company_name", cleanName)
        .maybeSingle();
      if (fallback) return fallback;
      throw new Error(`Failed to auto-register company "${cleanName}": ${insertError.message}`);
    }

    return created!;
  },

  async createCompany(company: CompanyInsert): Promise<Company> {
    const { data, error } = await supabase.from("companies").insert(company).select().single();
    throwIfError(error, "Failed to create company");
    return data!;
  },

  async updateCompany(id: string, updates: CompanyUpdate): Promise<Company> {
    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    throwIfError(error, "Failed to update company");
    return data!;
  },

  async deleteCompany(id: string): Promise<void> {
    const { DataManagementService } = await import("./data-management.service");
    const results = await DataManagementService.customBulkDelete({
      companyId: id,
      deleteDividends: true,
      deleteMutualFunds: true,
      deleteInterests: true,
      deleteClients: true,
      deleteCompany: true,
      deleteOrphans: true,
    });
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      throw new Error(errors.map((e) => `${e.table}: ${e.error}`).join(", "));
    }
  },
};
