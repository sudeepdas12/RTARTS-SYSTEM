/**
 * CDSC Corporate Action System (CAS) DEMAT Bonus Share Credit & Fractional Cash Calculation Engine
 *
 * Institutional capabilities for Nepal Capital Markets (Pursuant to Income Tax Act 2058 & CDSC Regulations):
 * - 3 Nepal Tax Settlement Modes:
 *     1. COMPANY_PAID: Company bears 5% bonus share tax from reserve/surplus.
 *     2. INVESTOR_PAID: Shareholder must deposit 5% bonus tax before DEMAT credit.
 *     3. CASH_ADJUSTED: Bonus tax offset against simultaneous cash dividend.
 * - Lock-In Code Preservation (00=Free, 01=Promoter, 02=Staff, 09=Local Affected).
 * - Tax Exemption for Mutual Funds / Entities (0% TDS).
 * - Fixed-width CDSC Standard CAS File (.cas / .txt with 42-byte header & 124-byte record lines).
 * - ConnectIPS Fractional Cash Disbursement File.
 * - EPSILON-safe Paisa calculations.
 */

import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export type BonusTaxMode =
  | "COMPANY_PAID" // Company pays 5% bonus tax
  | "INVESTOR_PAID" // Shareholder must deposit 5% tax
  | "CASH_ADJUSTED"; // Adjusted against cash dividend

export interface BonusShareRow {
  sn: number;
  clientId: string;
  boid: string;
  shareholderName: string;
  panNo?: string;
  holderType: string;
  lockInCode: string;
  lockInReason: string;
  lockInExpiryDate: string; // DDMMYYYY or 00000000
  existingKitta: number;
  bonusRatio: number;
  cashDividendRatio: number;

  // Bonus Shares Breakdown
  grossBonusShares: number; // floating point (4 decimals)
  creditedBonusKitta: number; // whole shares
  fractionalKitta: number; // 0..0.9999

  // Tax & Valuation
  faceValue: number;
  bonusTaxRate: number; // 0.05 or 0.00
  bonusShareTaxPayable: number; // 5% of whole bonus face value

  // Fractional Cash
  fractionalGrossCash: number; // fraction * faceValue
  fractionalTaxAmount: number; // 5% TDS
  fractionalNetPayable: number; // Gross - TDS

  // Cash Dividend (if adjusted)
  grossCashDividend: number;
  cashDividendTds: number;
  netCashPayableCombined: number;
  taxPayableByInvestor: number; // Tax voucher amount due from investor

  bankName?: string;
  bankAccountNo?: string;
  validationStatus: "VALID" | "INVALID_BOID" | "MISSING_BANK";
}

export interface BonusAllocationSummary {
  companyId: string;
  companyName: string;
  companyCode: string;
  isin: string;
  fiscalYear: string;
  bonusRatio: number;
  cashDividendRatio: number;
  faceValue: number;
  taxMode: BonusTaxMode;
  totalEligibleShareholders: number;
  totalExistingKitta: number;
  totalGrossBonusShares: number;
  totalCreditedBonusKitta: number;
  totalFreeBonusKitta: number;
  totalLockedBonusKitta: number;
  totalFractionalKitta: number;
  totalBonusShareTax: number;
  totalFractionalGrossCash: number;
  totalFractionalTaxAmount: number;
  totalFractionalNetPayable: number;
  totalInvestorTaxPayable: number;
  validBoidCount: number;
  invalidBoidCount: number;
  rows: BonusShareRow[];
}

export const CdscBonusService = {
  /**
   * Resolves CDSC Lock-In Code from holder_type
   */
  resolveLockIn(holderType?: string | null): { code: string; reason: string; expiry: string } {
    const ht = (holderType || "").toUpperCase();
    if (ht.includes("PROMOTER")) {
      return { code: "01", reason: "PROMOTER SHARE LOCK-IN", expiry: "20281231" };
    }
    if (ht.includes("LOCAL")) {
      return { code: "09", reason: "LOCAL AFFECTED RESIDENTS", expiry: "20271231" };
    }
    if (ht.includes("STAFF") || ht.includes("EMPLOYEE")) {
      return { code: "02", reason: "EMPLOYEE QUOTA LOCK-IN", expiry: "20271231" };
    }
    if (ht.includes("MUTUAL")) {
      return { code: "03", reason: "MUTUAL FUND LOCK-IN", expiry: "00000000" };
    }
    return { code: "00", reason: "FREE FLOATING / PUBLIC", expiry: "00000000" };
  },

  /**
   * Computes bonus share entitlement, lock-in classifications, bonus tax, and fractional cash.
   */
  async calculateBonusAllocation(params: {
    companyId: string;
    fiscalYear: string;
    bonusRatio: number; // percentage, e.g. 10 for 10%
    cashDividendRatio?: number; // e.g. 0.526% for cash tax adjustment
    faceValue?: number; // default NPR 100
    taxMode?: BonusTaxMode; // default COMPANY_PAID
  }): Promise<BonusAllocationSummary> {
    const {
      companyId,
      fiscalYear,
      bonusRatio,
      cashDividendRatio = 0,
      faceValue = 100,
      taxMode = "COMPANY_PAID",
    } = params;

    // 1. Fetch Company Info
    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("id, company_name, company_code, isin")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Company";
    const companyCode = comp?.company_code || "COMP";
    const isin = comp?.isin || "NP0000000000";

    // 2. Fetch Shareholders with their holdings (Check clients table and fallback to dividend_payables)
    const { data: clientRows } = await (supabase as any)
      .from("clients")
      .select(
        "id, full_name, boid, pan_no, kitta, holder_type, payee_classification, bank_name, bank_account_no",
      )
      .eq("company_id", companyId);

    // Fallback: if clients table does not have kitta, query latest dividend_payables
    let effectiveClients: any[] = clientRows || [];
    if (!effectiveClients.some((c) => Number(c.kitta || 0) > 0)) {
      const { data: payables } = await (supabase as any)
        .from("dividend_payables")
        .select(
          "client_id, shares_held, bank_name, bank_account_no, client:clients(id, full_name, boid, pan_no, holder_type, payee_classification)",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (payables && payables.length > 0) {
        const seen = new Set();
        effectiveClients = [];
        for (const p of payables) {
          if (!p.client || seen.has(p.client_id)) continue;
          seen.add(p.client_id);
          effectiveClients.push({
            id: p.client.id,
            full_name: p.client.full_name,
            boid: p.client.boid,
            pan_no: p.client.pan_no,
            kitta: p.shares_held,
            holder_type: p.client.holder_type,
            payee_classification: p.client.payee_classification,
            bank_name: p.bank_name,
            bank_account_no: p.bank_account_no,
          });
        }
      }
    }

    const rows: BonusShareRow[] = [];
    let sn = 1;
    const bonusRatioDecimal = bonusRatio / 100;
    const cashRatioDecimal = cashDividendRatio / 100;

    let validBoidCount = 0;
    let invalidBoidCount = 0;

    for (const c of effectiveClients) {
      const existingKitta = Number(c.kitta || 0);
      if (existingKitta <= 0) continue;

      const rawBoid = (c.boid || "").replace(/[^0-9]/g, "");
      const isBoidValid = rawBoid.length === 16;
      if (isBoidValid) validBoidCount++;
      else invalidBoidCount++;

      const isTaxExempt =
        c.payee_classification === "TAX_EXEMPT" ||
        (c.holder_type || "").toUpperCase().includes("MUTUAL") ||
        (c.holder_type || "").toUpperCase().includes("TAX EXEMPT") ||
        (c.holder_type || "").toUpperCase().includes("TAX_EXEMPT") ||
        (c.holder_type || "").toUpperCase().includes("EXEMPT");
      const bonusTaxRate = isTaxExempt ? 0.0 : 0.05;

      const lockIn = this.resolveLockIn(c.holder_type);
      const rawGrossBonus = existingKitta * bonusRatioDecimal;
      const creditedBonusKitta = Math.floor(rawGrossBonus);
      const fractionalKitta =
        Math.round((rawGrossBonus - creditedBonusKitta + Number.EPSILON) * 10000) / 10000;

      // 5% Tax on whole credited bonus shares (Face Value * Kitta * 5%)
      const bonusShareTaxPayable =
        Math.round((creditedBonusKitta * faceValue * bonusTaxRate + Number.EPSILON) * 100) / 100;

      // Fractional Cash Handling
      const fractionalGrossCash =
        Math.round((fractionalKitta * faceValue + Number.EPSILON) * 100) / 100;
      const fractionalTaxAmount =
        Math.round((fractionalGrossCash * bonusTaxRate + Number.EPSILON) * 100) / 100;
      const fractionalNetPayable =
        Math.round((fractionalGrossCash - fractionalTaxAmount + Number.EPSILON) * 100) / 100;

      // Cash Dividend (if combined/adjusted)
      const grossCashDividend =
        Math.round((existingKitta * faceValue * cashRatioDecimal + Number.EPSILON) * 100) / 100;
      const cashDividendTds =
        Math.round((grossCashDividend * bonusTaxRate + Number.EPSILON) * 100) / 100;

      let taxPayableByInvestor = 0;
      let netCashPayableCombined = fractionalNetPayable;

      if (taxMode === "INVESTOR_PAID") {
        taxPayableByInvestor = bonusShareTaxPayable;
      } else if (taxMode === "CASH_ADJUSTED") {
        const netCashFromDiv = grossCashDividend - cashDividendTds;
        if (netCashFromDiv >= bonusShareTaxPayable) {
          netCashPayableCombined =
            Math.round(
              (netCashFromDiv - bonusShareTaxPayable + fractionalNetPayable + Number.EPSILON) * 100,
            ) / 100;
          taxPayableByInvestor = 0;
        } else {
          taxPayableByInvestor =
            Math.round((bonusShareTaxPayable - netCashFromDiv + Number.EPSILON) * 100) / 100;
          netCashPayableCombined = fractionalNetPayable;
        }
      }

      let validationStatus: "VALID" | "INVALID_BOID" | "MISSING_BANK" = "VALID";
      if (!isBoidValid) validationStatus = "INVALID_BOID";
      else if (fractionalGrossCash > 0 && !c.bank_account_no) validationStatus = "MISSING_BANK";

      rows.push({
        sn: sn++,
        clientId: c.id,
        boid: rawBoid || c.boid || "",
        shareholderName: c.full_name || "Shareholder",
        panNo: c.pan_no || undefined,
        holderType: c.holder_type || "PUBLIC",
        lockInCode: lockIn.code,
        lockInReason: lockIn.reason,
        lockInExpiryDate: lockIn.expiry,
        existingKitta,
        bonusRatio,
        cashDividendRatio,
        grossBonusShares: Math.round((rawGrossBonus + Number.EPSILON) * 10000) / 10000,
        creditedBonusKitta,
        fractionalKitta,
        faceValue,
        bonusTaxRate,
        bonusShareTaxPayable,
        fractionalGrossCash,
        fractionalTaxAmount,
        fractionalNetPayable,
        grossCashDividend,
        cashDividendTds,
        netCashPayableCombined,
        taxPayableByInvestor,
        bankName: c.bank_name || undefined,
        bankAccountNo: c.bank_account_no || undefined,
        validationStatus,
      });
    }

    const totalExistingKitta = rows.reduce((s, r) => s + r.existingKitta, 0);
    const totalGrossBonusShares = rows.reduce((s, r) => s + r.grossBonusShares, 0);
    const totalCreditedBonusKitta = rows.reduce((s, r) => s + r.creditedBonusKitta, 0);
    const totalFreeBonusKitta = rows
      .filter((r) => r.lockInCode === "00")
      .reduce((s, r) => s + r.creditedBonusKitta, 0);
    const totalLockedBonusKitta = totalCreditedBonusKitta - totalFreeBonusKitta;
    const totalFractionalKitta = rows.reduce((s, r) => s + r.fractionalKitta, 0);
    const totalBonusShareTax = rows.reduce((s, r) => s + r.bonusShareTaxPayable, 0);
    const totalFractionalGrossCash = rows.reduce((s, r) => s + r.fractionalGrossCash, 0);
    const totalFractionalTaxAmount = rows.reduce((s, r) => s + r.fractionalTaxAmount, 0);
    const totalFractionalNetPayable = rows.reduce((s, r) => s + r.fractionalNetPayable, 0);
    const totalInvestorTaxPayable = rows.reduce((s, r) => s + r.taxPayableByInvestor, 0);

    return {
      companyId,
      companyName,
      companyCode,
      isin,
      fiscalYear,
      bonusRatio,
      cashDividendRatio,
      faceValue,
      taxMode,
      totalEligibleShareholders: rows.length,
      totalExistingKitta,
      totalGrossBonusShares: Math.round(totalGrossBonusShares * 100) / 100,
      totalCreditedBonusKitta,
      totalFreeBonusKitta,
      totalLockedBonusKitta,
      totalFractionalKitta: Math.round(totalFractionalKitta * 100) / 100,
      totalBonusShareTax: Math.round(totalBonusShareTax * 100) / 100,
      totalFractionalGrossCash: Math.round(totalFractionalGrossCash * 100) / 100,
      totalFractionalTaxAmount: Math.round(totalFractionalTaxAmount * 100) / 100,
      totalFractionalNetPayable: Math.round(totalFractionalNetPayable * 100) / 100,
      totalInvestorTaxPayable: Math.round(totalInvestorTaxPayable * 100) / 100,
      validBoidCount,
      invalidBoidCount,
      rows,
    };
  },

  /**
   * Exports the standard CDSC Corporate Action System (CAS) DEMAT credit batch file in Excel (.xlsx).
   */
  exportCdscDematCreditBatch(summary: BonusAllocationSummary, fileName?: string): void {
    const wb = XLSX.utils.book_new();

    const headers = [
      "S.N.",
      "BOID (16 Digits)",
      "Shareholder Name",
      "PAN Number",
      "ISIN",
      "Company Code",
      "Lock-in Code",
      "Lock-in Reason",
      "Existing Kitta",
      "Bonus %",
      "Credited Bonus Kitta (DEMAT)",
      "Bonus Tax 5% (NPR)",
      "Fractional Share Balance",
      "Fractional Cash Gross (NPR)",
      "Fractional TDS 5% (NPR)",
      "Fractional Net Cash (NPR)",
      "Investor Tax Payable (NPR)",
      "Bank Account",
      "Validation Status",
    ];

    const rows = summary.rows.map((r) => [
      r.sn,
      r.boid,
      r.shareholderName,
      r.panNo || "",
      summary.isin,
      summary.companyCode,
      r.lockInCode,
      r.lockInReason,
      r.existingKitta,
      `${r.bonusRatio}%`,
      r.creditedBonusKitta,
      r.bonusShareTaxPayable,
      r.fractionalKitta,
      r.fractionalGrossCash,
      r.fractionalTaxAmount,
      r.fractionalNetPayable,
      r.taxPayableByInvestor,
      r.bankAccountNo ? `${r.bankName || "Bank"}: ${r.bankAccountNo}` : "",
      r.validationStatus,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 30 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 20 },
      { wch: 16 },
      { wch: 10 },
      { wch: 28 },
      { wch: 20 },
      { wch: 22 },
      { wch: 24 },
      { wch: 20 },
      { wch: 22 },
      { wch: 24 },
      { wch: 28 },
      { wch: 18 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "CDSC_CAS_Bonus_Credit");

    const safeName =
      (
        fileName ||
        `CDSC_Bonus_Credit_${summary.companyCode}_${summary.fiscalYear.replace("/", "_")}`
      ).replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },

  /**
   * Generates CDSC Standard CAS Batch Text File (.cas / .txt) with standard 42-character header and 124-character detail records.
   */
  generateCdscCasFixedTextFile(summary: BonusAllocationSummary): string {
    const validRows = summary.rows.filter((r) => r.creditedBonusKitta > 0 && r.boid.length === 16);

    // 1. Control Header (42 chars): [01-10] Count, [11-26] Free Kitta, [27-42] Locked Kitta
    const countStr = String(validRows.length).padStart(10, "0");
    const freeStr = `${summary.totalFreeBonusKitta}.000`.padStart(16, "0");
    const lockedStr = `${summary.totalLockedBonusKitta}.000`.padStart(16, "0");
    const headerLine = `${countStr}${freeStr}${lockedStr}`;

    // 2. Detail Lines (124 chars each)
    const detailLines = validRows.map((r) => {
      const boid = r.boid.padEnd(16, " ");
      const freeQty =
        r.lockInCode === "00"
          ? `${r.creditedBonusKitta}.000`.padStart(16, "0")
          : "000000000000.000";
      const lockQty =
        r.lockInCode !== "00"
          ? `${r.creditedBonusKitta}.000`.padStart(16, "0")
          : "000000000000.000";
      const lockCode = r.lockInCode.padStart(2, "0");
      const lockReason = (r.lockInReason || "").padEnd(50, " ").slice(0, 50);
      const lockExpiry = (r.lockInExpiryDate || "00000000").padEnd(8, "0").slice(0, 8);
      const rtaRef = `BONUS_${summary.fiscalYear}`.padEnd(16, " ").slice(0, 16);

      return `${boid}${freeQty}${lockQty}${lockCode}${lockReason}${lockExpiry}${rtaRef}`;
    });

    return [headerLine, ...detailLines].join("\r\n") + "\r\n";
  },

  /**
   * Exports standard NCHL ConnectIPS CorporatePay batch file for fractional cash distribution.
   */
  exportFractionalConnectIpsBatch(summary: BonusAllocationSummary, fileName?: string): void {
    const fractionRows = summary.rows.filter((r) => r.fractionalNetPayable > 0);
    const wb = XLSX.utils.book_new();

    const headers = [
      "Instruction ID",
      "End to End ID",
      "Debit Account",
      "Credit Bank Code",
      "Credit Bank Name",
      "Credit Account No",
      "Beneficiary Name",
      "Amount (NPR)",
      "BOID (16 Digits)",
      "Remarks",
    ];

    const rows = fractionRows.map((r, idx) => [
      `INST-FRAC-${idx + 1}`,
      `E2E-${summary.companyCode}-${r.sn}`,
      "109000000001",
      "01",
      r.bankName || "Commercial Bank",
      r.bankAccountNo || "0000000000000",
      r.shareholderName,
      r.fractionalNetPayable,
      r.boid,
      `Bonus Fraction Cash Payout ${summary.companyCode} FY ${summary.fiscalYear}`,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [
      { wch: 18 },
      { wch: 22 },
      { wch: 16 },
      { wch: 18 },
      { wch: 24 },
      { wch: 22 },
      { wch: 30 },
      { wch: 16 },
      { wch: 20 },
      { wch: 45 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ConnectIPS_Fractional_Cash");

    const safeName =
      (
        fileName ||
        `ConnectIPS_Fractional_Cash_${summary.companyCode}_${summary.fiscalYear.replace("/", "_")}`
      ).replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },

  /**
   * Syncs fractional cash balances directly into dividend_payables table.
   */
  async syncFractionalCashToDividendPayables(summary: BonusAllocationSummary): Promise<{
    syncedCount: number;
    totalCashAmount: number;
  }> {
    const fractionRows = summary.rows.filter((r) => r.fractionalGrossCash > 0);
    if (fractionRows.length === 0) {
      return { syncedCount: 0, totalCashAmount: 0 };
    }

    const payload = fractionRows.map((r) => ({
      company_id: summary.companyId,
      client_id: r.clientId,
      fiscal_year: summary.fiscalYear,
      dividend_type: "Bonus Fraction Cash",
      shares_held: r.existingKitta,
      dividend_rate: summary.bonusRatio,
      gross_dividend: r.fractionalGrossCash,
      tax_amount: r.fractionalTaxAmount,
      net_payable: r.fractionalNetPayable,
      payment_status: "Pending",
      bank_name: r.bankName || null,
      bank_account_no: r.bankAccountNo || null,
      bonus_actual: r.grossBonusShares,
      bonus_issued: r.creditedBonusKitta,
      bonus_fraction: r.fractionalKitta,
      remarks: `Bonus fraction cash distribution (${r.fractionalKitta} kitta @ NPR ${summary.faceValue})`,
    }));

    const { error } = await (supabase as any).from("dividend_payables").insert(payload);

    if (error) {
      console.error("Error syncing fractional cash payables:", error);
      throw error;
    }

    const totalCashAmount = fractionRows.reduce((s, r) => s + r.fractionalNetPayable, 0);
    return {
      syncedCount: fractionRows.length,
      totalCashAmount: Math.round(totalCashAmount * 100) / 100,
    };
  },
};
