import type { ColumnMapping, ParsedExcelData, ParsedSheetData } from "@/lib/excel-parser";
import type { PayeeClassification, PayeeSegment } from "@/lib/classification-review.functions";
import { resolveMappedSheetColumns } from "@/lib/pre-import-triage";
import type { ReconciliationExceptionItem, ReconciliationMatch } from "@/lib/reconciliation-engine";

export interface ClassificationTriageInput {
  id: string;
  full_name: string;
  boid?: string | null;
  holder_type?: string | null;
  payee_classification?: string | null;
  payee_segment?: string | null;
  classification_status?: string | null;
  classification_source?: string | null;
  pan_or_citizenship?: string | null;
}

export interface ClassificationTriageProposal {
  clientId: string;
  shareholderName: string;
  redactedBoid: string;
  currentClassification: string;
  suggestedClassification: PayeeClassification;
  suggestedSegment: PayeeSegment;
  confidence: number;
  tdsImplication: string;
  rationale: string;
  matchedSignals: string[];
  requiresHumanJudgment: boolean;
}

export interface ClassificationTriageSummary {
  totalAnalyzed: number;
  highConfidenceCount: number;
  needsHumanJudgmentCount: number;
  bySuggestedClass: Record<PayeeClassification, number>;
  proposals: ClassificationTriageProposal[];
}

export interface MappingRepairSuggestion {
  sheetName: string;
  excelHeader: string;
  suggestedField: keyof ColumnMapping;
  confidence: number;
  rationale: string;
}

export interface WorkbookMappingTriageReport {
  sheetCount: number;
  coverageScorePct: number;
  missingCoreFields: Array<{ sheetName: string; field: keyof ColumnMapping; label: string }>;
  suggestions: MappingRepairSuggestion[];
  summaryNote: string;
}

export type ExceptionClusterCategory =
  | "NCHL_REJECTED_OR_INVALID_ACCOUNT"
  | "BANK_FEE_OR_PAISA_DRIFT"
  | "UNMATCHED_SWEEP_OR_PRIOR_FY"
  | "REFERENCE_OR_AMOUNT_VARIANCE";

export interface ReconciliationExceptionCluster {
  category: ExceptionClusterCategory;
  title: string;
  severity: "critical" | "warning" | "info";
  itemCount: number;
  totalExposureNpr: number;
  exceptionIds: string[];
  rootCauseSummary: string;
  recommendedHitlAction: string;
  supportsRemediation: boolean;
  supportsToleranceAcknowledge: boolean;
}

const SENSITIVE_EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_LONG_NUMBER_REGEX = /\b\d[\d\s-]{5,}\d\b/g;

/**
 * Redact PAN, citizenship IDs, phone numbers, emails, and raw 16-digit BOIDs
 * before generating summaries or invoking any external advisory endpoint.
 */
export function redactSensitiveText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(SENSITIVE_EMAIL_REGEX, "[REDACTED_EMAIL]")
    .replace(SENSITIVE_LONG_NUMBER_REGEX, (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length === 16) {
        return `${digits.slice(0, 4)}********${digits.slice(-4)}`;
      }
      if (digits.length >= 7) {
        return `[REDACTED_NUM_*${digits.slice(-3)}]`;
      }
      return match;
    })
    .trim();
}

export function maskIdentifier(id: string | null | undefined): string {
  if (!id) return "—";
  const cleaned = id.replace(/\s+/g, "");
  if (cleaned.length <= 4) return "****";
  if (cleaned.length >= 16) {
    return `${cleaned.slice(0, 4)}********${cleaned.slice(-4)}`;
  }
  return `${cleaned.slice(0, 2)}****${cleaned.slice(-2)}`;
}

const TAX_EXEMPT_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bmutual\s*fund\b/i, label: "Mutual Fund" },
  { pattern: /\byojana\b/i, label: "Scheme / Yojana" },
  {
    pattern: /\b(samriddhi|sajhedari|nibl\s+sahabhagita|balanced\s+fund|equity\s+fund)\b/i,
    label: "Pooled Fund Scheme",
  },
  {
    pattern:
      /\b(sanchaya\s*kosh|provident\s*fund|retirement\s*fund|social\s*security\s*fund|citizen\s*investment\s*trust|nagarik\s*lagani)\b/i,
    label: "Statutory Retirement Fund",
  },
];

const PUBLIC_LEGAL_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /\b(nepal\s+rastra\s+bank|government\s+of\s+nepal|ministry\s+of|municipality|nagarpalika|gaupalika)\b/i,
    label: "Government / Sovereign Body",
  },
  {
    pattern:
      /\b(sansthan|authority|commission|parishad|academy|university|tribhuvan|guthi|welfare\s+fund|sainik\s+kalyankari|police\s+welfare)\b/i,
    label: "Public Legal / Statutory Body",
  },
  {
    pattern:
      /\b(rastriya\s+banijya|nepal\s+bank|krishi\s+bikas|agricultural\s+development\s+bank|hidcl|nepal\s+reinsurance)\b/i,
    label: "Public Sector Institution",
  },
];

const INSTITUTIONAL_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(pvt\.?\s*ltd\.?|private\s+limited|p\.?\s*ltd\.?)\b/i, label: "Private Limited" },
  { pattern: /\b(ltd\.?|limited|inc\.?|corp\.?|corporation|llc)\b/i, label: "Limited Corporation" },
  {
    pattern:
      /\b(bank|finance|insurance|microfinance|laghubitta|hydropower|hydro|energy|capital|securities|ventures|holdings|investment|enterprises|traders|associates|company|sanstha|sahakari|co-?operative|udhyog|mills|hospital|hotel|resort|college|school)\b/i,
    label: "Corporate / Financial Entity",
  },
];

const AMBIGUOUS_CUES =
  /\b(c\/o|care\s+of|proprietor|proprietorship|firm|traders|trading|concern|suppliers?|stores?|group|pasal|studio|workshop|bhandar|hardware|agency)\b/i;

function classifySingleClient(client: ClassificationTriageInput): ClassificationTriageProposal {
  const rawName = (client.full_name || "").trim();
  const holderHint = (client.holder_type || "").toUpperCase();
  const currentSeg = (client.payee_segment || "").toUpperCase();
  const suggestedSegment: PayeeSegment =
    currentSeg === "PROMOTER" || holderHint.includes("PROMOTER")
      ? "PROMOTER"
      : currentSeg === "LOCAL" || holderHint.includes("LOCAL")
        ? "LOCAL"
        : currentSeg === "PUBLIC"
          ? "PUBLIC"
          : null;

  const matchedSignals: string[] = [];

  for (const rule of TAX_EXEMPT_KEYWORDS) {
    if (rule.pattern.test(rawName)) {
      matchedSignals.push(rule.label);
    }
  }
  if (holderHint.includes("MUTUAL")) matchedSignals.push("HolderType=MUTUAL_FUND");

  if (
    matchedSignals.length > 0 &&
    /fund|yojana|kosh|cit|investment\s*trust/i.test(rawName + " " + holderHint)
  ) {
    const isStatutoryFund =
      /sanchaya|nagarik|citizen\s+investment|social\s+security|provident/i.test(rawName);
    const suggestedClassification: PayeeClassification = isStatutoryFund
      ? "PUBLIC_LEGAL_PERSON"
      : "TAX_EXEMPT";
    return {
      clientId: client.id,
      shareholderName: rawName || "Unnamed Account",
      redactedBoid: maskIdentifier(client.boid),
      currentClassification: client.payee_classification || "UNCLASSIFIED",
      suggestedClassification,
      suggestedSegment,
      confidence: suggestedClassification === "TAX_EXEMPT" ? 0.94 : 0.9,
      tdsImplication:
        suggestedClassification === "TAX_EXEMPT"
          ? "0% TDS (Exempt Fund Scheme — subject to Tax Certificate)"
          : "15% Institutional / Statutory TDS (Verify Exemption Circular)",
      rationale: `Detected ${matchedSignals.join(", ")} in holder designation.`,
      matchedSignals,
      requiresHumanJudgment: isStatutoryFund,
    };
  }

  const publicMatches = PUBLIC_LEGAL_KEYWORDS.filter((k) => k.pattern.test(rawName)).map(
    (k) => k.label,
  );
  if (publicMatches.length > 0) {
    return {
      clientId: client.id,
      shareholderName: rawName || "Unnamed Account",
      redactedBoid: maskIdentifier(client.boid),
      currentClassification: client.payee_classification || "UNCLASSIFIED",
      suggestedClassification: "PUBLIC_LEGAL_PERSON",
      suggestedSegment,
      confidence: 0.89,
      tdsImplication: "Public Legal Body — confirm statutory tax exemption or 15% corporate rate",
      rationale: `Matched statutory/sovereign markers: ${publicMatches.join(", ")}.`,
      matchedSignals: publicMatches,
      requiresHumanJudgment: false,
    };
  }

  const isAmbiguousFirm =
    AMBIGUOUS_CUES.test(rawName) &&
    !/\b(pvt|ltd|limited|inc|corp|bank|finance|insurance|hydropower|co-?operative|sahakari|company|securities|capital)\b/i.test(
      rawName,
    );
  if (isAmbiguousFirm) {
    return {
      clientId: client.id,
      shareholderName: rawName || "Unnamed Account",
      redactedBoid: maskIdentifier(client.boid),
      currentClassification: client.payee_classification || "UNCLASSIFIED",
      suggestedClassification: "NATURAL_PERSON",
      suggestedSegment,
      confidence: 0.62,
      tdsImplication:
        "Ambiguous Trade / Concern — verify individual proprietorship PAN (5%) vs corporate entity (15%)",
      rationale:
        "Commercial trade/concern cue detected without explicit Pvt/Ltd incorporation suffix; Checker confirmation required.",
      matchedSignals: ["Proprietorship / Trading Concern cue"],
      requiresHumanJudgment: true,
    };
  }

  const instMatches = INSTITUTIONAL_KEYWORDS.filter((k) => k.pattern.test(rawName)).map(
    (k) => k.label,
  );
  if (
    instMatches.length > 0 ||
    holderHint.includes("INSTITUTION") ||
    holderHint.includes("COMPANY")
  ) {
    if (holderHint.includes("INSTITUTION")) instMatches.push("HolderType=INSTITUTION");
    return {
      clientId: client.id,
      shareholderName: rawName || "Unnamed Account",
      redactedBoid: maskIdentifier(client.boid),
      currentClassification: client.payee_classification || "UNCLASSIFIED",
      suggestedClassification: "COMPANY_INSTITUTION",
      suggestedSegment,
      confidence: 0.91,
      tdsImplication: "15% Resident Corporate / Entity TDS (Confirm PAN registration)",
      rationale: `Corporate entity markers detected: ${instMatches.join(", ")}.`,
      matchedSignals: instMatches,
      requiresHumanJudgment: false,
    };
  }

  const tokens = rawName.split(/\s+/).filter(Boolean);
  const looksLikeHumanName =
    tokens.length >= 2 && tokens.length <= 5 && !/[0-9/&@#]/.test(rawName) && !isAmbiguousFirm;

  if (looksLikeHumanName) {
    const signals = ["Standard multi-token person name"];
    if (client.pan_or_citizenship) signals.push("Citizenship/PAN present");
    return {
      clientId: client.id,
      shareholderName: rawName,
      redactedBoid: maskIdentifier(client.boid),
      currentClassification: client.payee_classification || "UNCLASSIFIED",
      suggestedClassification: "NATURAL_PERSON",
      suggestedSegment,
      confidence: 0.84,
      tdsImplication: "5% Resident Natural Person Cash / Bonus / Interest TDS",
      rationale:
        "No corporate, fund, or statutory institution suffixes detected; conforms to individual natural person naming.",
      matchedSignals: signals,
      requiresHumanJudgment: false,
    };
  }

  return {
    clientId: client.id,
    shareholderName: rawName || "Unnamed Account",
    redactedBoid: maskIdentifier(client.boid),
    currentClassification: client.payee_classification || "UNCLASSIFIED",
    suggestedClassification: "NATURAL_PERSON",
    suggestedSegment,
    confidence: 0.52,
    tdsImplication: "Unconfirmed — requires Operator/Checker KYC verification before TDS posting",
    rationale:
      "Short, numeric, or ambiguous designation could represent an institutional abbreviation or individual.",
    matchedSignals: ["Ambiguous naming structure"],
    requiresHumanJudgment: true,
  };
}

/**
 * Analyze REVIEW_REQUIRED / UNCLASSIFIED client queue and produce HITL classification proposals.
 * Never mutates DB state directly.
 */
export function triageClassificationQueue(
  clients: ClassificationTriageInput[],
): ClassificationTriageSummary {
  const proposals = clients.map(classifySingleClient);
  const bySuggestedClass: Record<PayeeClassification, number> = {
    NATURAL_PERSON: 0,
    PUBLIC_LEGAL_PERSON: 0,
    COMPANY_INSTITUTION: 0,
    TAX_EXEMPT: 0,
  };

  let highConfidenceCount = 0;
  let needsHumanJudgmentCount = 0;

  for (const prop of proposals) {
    bySuggestedClass[prop.suggestedClassification] += 1;
    if (prop.confidence >= 0.85 && !prop.requiresHumanJudgment) {
      highConfidenceCount += 1;
    }
    if (prop.requiresHumanJudgment || prop.confidence < 0.75) {
      needsHumanJudgmentCount += 1;
    }
  }

  return {
    totalAnalyzed: proposals.length,
    highConfidenceCount,
    needsHumanJudgmentCount,
    bySuggestedClass,
    proposals,
  };
}

const SAFE_HEADER_SUGGESTIONS: Array<{
  field: keyof ColumnMapping;
  label: string;
  include: RegExp;
  exclude?: RegExp;
  confidence: number;
  rationale: string;
}> = [
  {
    field: "boid",
    label: "BOID / Demat / Folio",
    include: /(boid|demat|beneficiar|folio|account.?id|client.?id)/i,
    exclude: /(bank|date|father|approve)/i,
    confidence: 0.94,
    rationale: "Header matches beneficiary ID / demat account nomenclature.",
  },
  {
    field: "full_name",
    label: "Shareholder Name",
    include: /(shareholder|holder|investor|unit.?holder|applicant|member|owner).*(name)|^name$/i,
    exclude: /(father|grand|mother|spouse|nominee|guardian|bank|company|branch)/i,
    confidence: 0.93,
    rationale: "Identifies primary shareholder name while avoiding father/bank name collisions.",
  },
  {
    field: "shares_held",
    label: "Shares Held (Kitta)",
    include: /(kitta|share|unit|holding|allot|qty|quantity)/i,
    exclude: /(after|bonus|right|total.?after|amount|value|rate)/i,
    confidence: 0.88,
    rationale:
      "Matches share unit count (kitta) without colliding with principal currency columns.",
  },
  {
    field: "cash_dividend",
    label: "Gross Dividend / Interest",
    include: /(gross|int_amt|interest.?amt|cash.?div|div.?amt|dividend.?amount|gross.?pay)/i,
    exclude: /(net|tax|tds|rate|@|principal|face|after)/i,
    confidence: 0.9,
    rationale: "Matches pre-tax gross disbursement column.",
  },
  {
    field: "div_tax",
    label: "Withheld TDS Tax",
    include: /(div.?tax|tds|tax.?amt|withheld|^tax$)/i,
    exclude: /(bon|bonus|rate|after|exempt|gross|net)/i,
    confidence: 0.91,
    rationale: "Matches statutory cash/interest TDS deduction column.",
  },
  {
    field: "net_payable",
    label: "Net Payable Amount",
    include: /(net.?pay|net.?int|net.?div|round.?up|net.?amt|payable.?amt)/i,
    exclude: /(gross|tax|rate|unit)/i,
    confidence: 0.92,
    rationale: "Matches post-TDS net disbursement figure.",
  },
  {
    field: "bank_account_no",
    label: "Bank Account Number",
    include: /(bank.?ac|a\/c.?no|account.?no|acc.?no)/i,
    exclude: /(boid|demat|name|bank.?code)/i,
    confidence: 0.89,
    rationale: "Matches destination bank account identifier.",
  },
];

/**
 * Inspect target upload sheets for unmapped core fields and propose reversible header repair mappings.
 */
export function triageWorkbookMappings(
  parsedData: ParsedExcelData | null,
  selectedSheetIndex: number,
): WorkbookMappingTriageReport {
  if (!parsedData?.sheets?.length) {
    return {
      sheetCount: 0,
      coverageScorePct: 100,
      missingCoreFields: [],
      suggestions: [],
      summaryNote: "No sheets loaded for mapping review.",
    };
  }

  const targetSheets: ParsedSheetData[] =
    selectedSheetIndex === -1
      ? parsedData.sheets.filter((s) => s.sheetType !== "SUMMARY")
      : [parsedData.sheets[selectedSheetIndex]].filter(Boolean);

  const missingCoreFields: Array<{ sheetName: string; field: keyof ColumnMapping; label: string }> =
    [];
  const suggestions: MappingRepairSuggestion[] = [];
  let totalCoreChecks = 0;
  let totalCoreMapped = 0;

  for (const sheet of targetSheets) {
    const resolved = resolveMappedSheetColumns(sheet);
    const mappedValues = new Set(Object.values(sheet.mapping || {}).map(String));
    const corePresence: Array<{ field: keyof ColumnMapping; label: string; present: boolean }> = [
      {
        field: "boid",
        label: "BOID / Folio",
        present: Boolean(resolved.boidCol || mappedValues.has("boid")),
      },
      {
        field: "full_name",
        label: "Shareholder Name",
        present: Boolean(resolved.nameCol || mappedValues.has("full_name")),
      },
      {
        field: "net_payable",
        label: "Net Payable / Gross",
        present: Boolean(
          resolved.netCol ||
          resolved.grossCol ||
          mappedValues.has("net_payable") ||
          mappedValues.has("cash_dividend"),
        ),
      },
      {
        field: "div_tax",
        label: "TDS Tax Column",
        present: Boolean(
          resolved.cashTaxCol || mappedValues.has("div_tax") || sheet.isRawInputFile,
        ),
      },
    ];

    for (const check of corePresence) {
      totalCoreChecks += 1;
      if (check.present) {
        totalCoreMapped += 1;
      } else {
        missingCoreFields.push({
          sheetName: sheet.sheetName,
          field: check.field,
          label: check.label,
        });
      }
    }

    const mappedHeaders = new Set(Object.keys(sheet.mapping || {}));
    for (const candidateRule of SAFE_HEADER_SUGGESTIONS) {
      if (mappedValues.has(candidateRule.field)) continue;
      const matchingHeader = (sheet.headers || []).find(
        (header) =>
          !mappedHeaders.has(header) &&
          candidateRule.include.test(header) &&
          (!candidateRule.exclude || !candidateRule.exclude.test(header)),
      );
      if (matchingHeader) {
        suggestions.push({
          sheetName: sheet.sheetName,
          excelHeader: matchingHeader,
          suggestedField: candidateRule.field,
          confidence: candidateRule.confidence,
          rationale: candidateRule.rationale,
        });
      }
    }
  }

  const coverageScorePct =
    totalCoreChecks === 0 ? 100 : Math.round((totalCoreMapped / totalCoreChecks) * 100);

  const summaryNote =
    suggestions.length > 0
      ? `Pre-Import HITL Copilot found ${suggestions.length} unmapped header repair suggestion(s) across ${targetSheets.length} sheet(s) (${coverageScorePct}% core field coverage).`
      : missingCoreFields.length > 0
        ? `Core coverage ${coverageScorePct}% — verify ${missingCoreFields.map((m) => `${m.sheetName}:${m.label}`).join(", ")} in column mapper.`
        : `All core financial and identity fields verified (${coverageScorePct}% coverage across ${targetSheets.length} sheet(s)).`;

  return {
    sheetCount: targetSheets.length,
    coverageScorePct,
    missingCoreFields,
    suggestions,
    summaryNote,
  };
}

/**
 * Cluster reconciliation exceptions into operational root causes without bypassing posting approvals.
 */
export function clusterReconciliationExceptions(
  exceptions: ReconciliationExceptionItem[],
  matches: ReconciliationMatch[] = [],
): ReconciliationExceptionCluster[] {
  if (!exceptions.length) return [];

  const matchById = new Map<string, ReconciliationMatch>();
  for (const m of matches) {
    if (m.id) matchById.set(m.id, m);
  }

  const buckets: Record<
    ExceptionClusterCategory,
    {
      title: string;
      severity: "critical" | "warning" | "info";
      items: ReconciliationExceptionItem[];
      rootCauseSummary: string;
      recommendedHitlAction: string;
      supportsRemediation: boolean;
      supportsToleranceAcknowledge: boolean;
    }
  > = {
    NCHL_REJECTED_OR_INVALID_ACCOUNT: {
      title: "NCHL / Destination Bank Rejections (Account Remediation)",
      severity: "critical",
      items: [],
      rootCauseSummary:
        "Transactions rejected by receiving bank / ConnectIPS (RJCT, AC01/AC04 invalid or closed account, or beneficiary name mismatch).",
      recommendedHitlAction:
        "Open Account Remediation workflow, contact shareholder via KYC notice, and re-queue for retry.",
      supportsRemediation: true,
      supportsToleranceAcknowledge: false,
    },
    BANK_FEE_OR_PAISA_DRIFT: {
      title: "Sub-NPR 5 Rounding / Bank Charge Variances",
      severity: "info",
      items: [],
      rootCauseSummary:
        "Settled vs ledger amounts differ by ≤ NPR 5.00, typical of ConnectIPS transfer charges or paisa rounding truncation.",
      recommendedHitlAction:
        "Verify bank charge schedule, then acknowledge cluster variance before posting settlement lot.",
      supportsRemediation: false,
      supportsToleranceAcknowledge: true,
    },
    UNMATCHED_SWEEP_OR_PRIOR_FY: {
      title: "Unmatched Bank Credits / Batch Sweeps / Prior FY Entries",
      severity: "warning",
      items: [],
      rootCauseSummary:
        "Statement entries without matching pending payables (e.g. consolidated IPS DR pool funding, NRB circular sweeps, or unimported prior FY payouts).",
      recommendedHitlAction:
        "Upload itemized ConnectIPS LOT settlement file or verify target company & fiscal year scope.",
      supportsRemediation: false,
      supportsToleranceAcknowledge: true,
    },
    REFERENCE_OR_AMOUNT_VARIANCE: {
      title: "Large Amount Variances & Unlinked References (> NPR 5.00)",
      severity: "critical",
      items: [],
      rootCauseSummary:
        "Material discrepancy between bank/Excel figure and system payable or missing ConnectIPS instruction ID.",
      recommendedHitlAction:
        "Inspect individual transaction candidates and verify TDS / partial installment status with Checker sign-off.",
      supportsRemediation: false,
      supportsToleranceAcknowledge: false,
    },
  };

  for (const exc of exceptions) {
    const desc = `${exc.description || ""} ${exc.status || ""}`.toUpperCase();
    const matchedRow = matchById.get(exc.id);
    const isRejected =
      exc.status === "Rejected" ||
      matchedRow?.status === "Rejected" ||
      /\b(RJCT|AC01|AC04|AM04|BE01|BOUNCED|REJECTED|CLOSED|INVALID\s+ACCOUNT|MISMATCH)\b/.test(
        desc,
      );

    if (isRejected) {
      buckets.NCHL_REJECTED_OR_INVALID_ACCOUNT.items.push(exc);
    } else if (
      ((exc.type === "LARGE_VARIANCE" || exc.type === "UNDER_OVER_PAID") &&
        Math.abs(exc.varianceAmount || 0) <= 5) ||
      (exc.type === "UNMATCHED_BANK_DEBIT" && /fee|charge|commission/i.test(desc))
    ) {
      buckets.BANK_FEE_OR_PAISA_DRIFT.items.push(exc);
    } else if (exc.type === "UNMATCHED_BANK_CREDIT" || exc.type === "UNMATCHED_BANK_DEBIT") {
      buckets.UNMATCHED_SWEEP_OR_PRIOR_FY.items.push(exc);
    } else {
      buckets.REFERENCE_OR_AMOUNT_VARIANCE.items.push(exc);
    }
  }

  return (
    Object.entries(buckets) as Array<
      [ExceptionClusterCategory, (typeof buckets)[ExceptionClusterCategory]]
    >
  )
    .filter(([, b]) => b.items.length > 0)
    .map(([category, b]) => ({
      category,
      title: b.title,
      severity: b.severity,
      itemCount: b.items.length,
      totalExposureNpr:
        Math.round(
          b.items.reduce(
            (sum, item) => sum + Math.abs(item.varianceAmount || item.amount || 0),
            0,
          ) * 100,
        ) / 100,
      exceptionIds: b.items.map((item) => item.id),
      rootCauseSummary: b.rootCauseSummary,
      recommendedHitlAction: b.recommendedHitlAction,
      supportsRemediation: b.supportsRemediation,
      supportsToleranceAcknowledge: b.supportsToleranceAcknowledge,
    }));
}
