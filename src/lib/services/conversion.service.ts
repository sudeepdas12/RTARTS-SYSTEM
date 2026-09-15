/**
 * Corporate Action & Share Conversion Engine
 *
 * Implements 5 standard conversion & restructuring techniques in Nepal Capital Markets:
 * 1. Promoter to Public Conversion (PO -> Ordinary / Lock-in 01 -> 00)
 * 2. Convertible Debenture / Preference Share to Equity Conversion
 * 3. M&A / Merger Swap Ratio Conversion
 * 4. Stock Split / Consolidation (Sub-division / Reverse Split)
 * 5. Physical-to-DEMAT Dematerialization (DRN)
 *
 * Full Two-Way Database Persistence:
 * - Updates clients balances & holder_types
 * - Inserts fractional cash payables to dividend_payables
 * - Generates ConnectIPS disbursement batches
 * - Creates audit trail records in audit_logs
 */

import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { getPayeeTaxRate } from "./payable-summary";

export type ConversionType =
  | "PROMOTER_TO_PUBLIC"
  | "DEBENTURE_TO_EQUITY"
  | "MERGER_SWAP"
  | "STOCK_SPLIT"
  | "PHYSICAL_TO_DEMAT";

export interface ConversionRow {
  sn: number;
  clientId: string;
  boid: string;
  shareholderName: string;
  panNo?: string;
  oldHolderType: string;
  newHolderType: string;
  oldLockInCode: string;
  newLockInCode: string;

  // Balance Adjustments
  initialBalance: number; // original kitta or debenture amount
  convertedKitta: number; // newly issued / converted whole shares
  finalBalance: number; // final post-conversion holding

  // Fractional Remainder & Cash Payout
  fractionalKitta: number;
  fractionalGrossCash: number;
  fractionalTaxAmount: number; // 5% TDS
  fractionalNetPayable: number;

  bankName?: string;
  bankAccountNo?: string;
  remarks: string;
}

export interface ConversionResultSummary {
  conversionType: ConversionType;
  companyId: string;
  companyName: string;
  companyCode: string;
  isin: string;
  fiscalYear: string;

  // Parameter metadata
  conversionRatio: number; // e.g. 19% for PO->Ord, or 100:85 swap ratio, or 10:1 split
  conversionPrice?: number; // for debenture conversion
  oldFaceValue?: number;
  newFaceValue?: number;

  totalEligibleShareholders: number;
  totalInitialBalance: number;
  totalConvertedKitta: number;
  totalFinalBalance: number;
  totalFractionalKitta: number;
  totalFractionalGrossCash: number;
  totalFractionalTaxAmount: number;
  totalFractionalNetPayable: number;
  rows: ConversionRow[];
}

export const ConversionService = {
  /**
   * 1. Promoter to Public Conversion (e.g. 70:30 to 51:49)
   */
  async simulatePromoterToPublic(params: {
    companyId: string;
    fiscalYear: string;
    conversionPct: number; // e.g. 27.14% of promoter holding to achieve 51:49 ratio
  }): Promise<ConversionResultSummary> {
    const { companyId, fiscalYear, conversionPct } = params;

    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("id, company_name, company_code, isin")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Company";
    const companyCode = comp?.company_code || "COMP";
    const isin = comp?.isin || "NP0000000000";

    const { data: clients } = await (supabase as any)
      .from("clients")
      .select("id, full_name, boid, pan_no, kitta, holder_type, bank_name, bank_account_no")
      .eq("company_id", companyId);

    const rows: ConversionRow[] = [];
    let sn = 1;
    const ratioDecimal = conversionPct / 100;

    for (const c of clients || []) {
      const isPromoter = (c.holder_type || "").toUpperCase().includes("PROMOTER");
      if (!isPromoter) continue;

      const initialKitta = Number(c.kitta || 0);
      if (initialKitta <= 0) continue;

      const convertedFloat = initialKitta * ratioDecimal;
      const convertedKitta = Math.floor(convertedFloat);
      const remainingPromoterKitta = initialKitta - convertedKitta;

      rows.push({
        sn: sn++,
        clientId: c.id,
        boid: c.boid || "",
        shareholderName: c.full_name || "Promoter Shareholder",
        panNo: c.pan_no || undefined,
        oldHolderType: "PROMOTER",
        newHolderType: remainingPromoterKitta > 0 ? "PROMOTER / PUBLIC" : "PUBLIC",
        oldLockInCode: "01",
        newLockInCode: "00",
        initialBalance: initialKitta,
        convertedKitta, // converted to public ordinary shares (Code 00)
        finalBalance: initialKitta, // total shares remains same, classification changes
        fractionalKitta: 0,
        fractionalGrossCash: 0,
        fractionalTaxAmount: 0,
        fractionalNetPayable: 0,
        bankName: c.bank_name || undefined,
        bankAccountNo: c.bank_account_no || undefined,
        remarks: `Converted ${convertedKitta.toLocaleString()} shares (${conversionPct}%) from Promoter (01) to Public (00)`,
      });
    }

    const totalInitial = rows.reduce((s, r) => s + r.initialBalance, 0);
    const totalConverted = rows.reduce((s, r) => s + r.convertedKitta, 0);

    return {
      conversionType: "PROMOTER_TO_PUBLIC",
      companyId,
      companyName,
      companyCode,
      isin,
      fiscalYear,
      conversionRatio: conversionPct,
      totalEligibleShareholders: rows.length,
      totalInitialBalance: totalInitial,
      totalConvertedKitta: totalConverted,
      totalFinalBalance: totalInitial,
      totalFractionalKitta: 0,
      totalFractionalGrossCash: 0,
      totalFractionalTaxAmount: 0,
      totalFractionalNetPayable: 0,
      rows,
    };
  },

  /**
   * 2. Convertible Debenture / Preference Share to Equity Conversion
   */
  async simulateDebentureToEquity(params: {
    companyId: string;
    fiscalYear: string;
    conversionPrice: number; // e.g. NPR 150 per equity share
    equityFaceValue?: number; // NPR 100
  }): Promise<ConversionResultSummary> {
    const { companyId, fiscalYear, conversionPrice, equityFaceValue = 100 } = params;

    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("id, company_name, company_code, isin")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Company";
    const companyCode = comp?.company_code || "COMP";
    const isin = comp?.isin || "NP0000000000";

    const { data: debentures } = await (supabase as any)
      .from("interest_payables")
      .select(
        "client_id, kitta, gross_interest, client:clients(id, full_name, boid, pan_no, holder_type, bank_name, bank_account_no)",
      )
      .eq("company_id", companyId);

    const rows: ConversionRow[] = [];
    let sn = 1;

    for (const d of debentures || []) {
      if (!d.client) continue;
      const debentureFaceTotal = Number(d.kitta || 10) * 1000; // 1 debenture bond = NPR 1000
      if (debentureFaceTotal <= 0) continue;

      const rawEquityFloat = debentureFaceTotal / conversionPrice;
      const convertedKitta = Math.floor(rawEquityFloat);
      const fractionalKitta =
        Math.round((rawEquityFloat - convertedKitta + Number.EPSILON) * 10000) / 10000;

      // Remaining unutilized bond principal = fractionalKitta * conversionPrice.
      // Under Nepal Income Tax Act §88 / §2(ज), principal refunds are Return of Capital and carry 0% TDS.
      const fractionalGrossCash =
        Math.round((fractionalKitta * conversionPrice + Number.EPSILON) * 100) / 100;
      const fractionalTaxAmount = 0;
      const fractionalNetPayable = fractionalGrossCash;

      rows.push({
        sn: sn++,
        clientId: d.client.id,
        boid: d.client.boid || "",
        shareholderName: d.client.full_name || "Debenture Holder",
        panNo: d.client.pan_no || undefined,
        oldHolderType: "DEBENTURE_HOLDER",
        newHolderType: "PUBLIC",
        oldLockInCode: "00",
        newLockInCode: "00",
        initialBalance: debentureFaceTotal, // in NPR
        convertedKitta,
        finalBalance: convertedKitta,
        fractionalKitta,
        fractionalGrossCash,
        fractionalTaxAmount,
        fractionalNetPayable,
        bankName: d.client.bank_name || undefined,
        bankAccountNo: d.client.bank_account_no || undefined,
        remarks: `Debentures (NPR ${debentureFaceTotal.toLocaleString()}) converted @ NPR ${conversionPrice}/equity share`,
      });
    }

    const totalInitial = rows.reduce((s, r) => s + r.initialBalance, 0);
    const totalConverted = rows.reduce((s, r) => s + r.convertedKitta, 0);
    const totalFractionalKitta = rows.reduce((s, r) => s + r.fractionalKitta, 0);
    const totalFractionalGross = rows.reduce((s, r) => s + r.fractionalGrossCash, 0);
    const totalFractionalTax = rows.reduce((s, r) => s + r.fractionalTaxAmount, 0);
    const totalFractionalNet = rows.reduce((s, r) => s + r.fractionalNetPayable, 0);

    return {
      conversionType: "DEBENTURE_TO_EQUITY",
      companyId,
      companyName,
      companyCode,
      isin,
      fiscalYear,
      conversionRatio: conversionPrice,
      conversionPrice,
      totalEligibleShareholders: rows.length,
      totalInitialBalance: totalInitial,
      totalConvertedKitta: totalConverted,
      totalFinalBalance: totalConverted,
      totalFractionalKitta: Math.round(totalFractionalKitta * 100) / 100,
      totalFractionalGrossCash: Math.round(totalFractionalGross * 100) / 100,
      totalFractionalTaxAmount: Math.round(totalFractionalTax * 100) / 100,
      totalFractionalNetPayable: Math.round(totalFractionalNet * 100) / 100,
      rows,
    };
  },

  /**
   * 3. M&A / Merger Swap Ratio Conversion (Target Company -> Acquiring Company)
   */
  async simulateMergerSwap(params: {
    targetCompanyId: string;
    acquiringCompanyId: string;
    fiscalYear: string;
    swapRatio: number; // e.g. 85 for 100:85 swap ratio (0.85 multiplier)
    faceValue?: number;
  }): Promise<ConversionResultSummary> {
    const { targetCompanyId, fiscalYear, swapRatio, faceValue = 100 } = params;

    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("id, company_name, company_code, isin")
      .eq("id", targetCompanyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Target Company";
    const companyCode = comp?.company_code || "TGT";
    const isin = comp?.isin || "NP0000000000";

    const { data: clients } = await (supabase as any)
      .from("clients")
      .select("id, full_name, boid, pan_no, kitta, holder_type, bank_name, bank_account_no")
      .eq("company_id", targetCompanyId);

    const rows: ConversionRow[] = [];
    let sn = 1;
    const ratioMultiplier = swapRatio / 100;

    for (const c of clients || []) {
      const initialKitta = Number(c.kitta || 0);
      if (initialKitta <= 0) continue;

      const rawSwapFloat = initialKitta * ratioMultiplier;
      const convertedKitta = Math.floor(rawSwapFloat);
      const fractionalKitta =
        Math.round((rawSwapFloat - convertedKitta + Number.EPSILON) * 10000) / 10000;

      const fractionalGrossCash =
        Math.round((fractionalKitta * faceValue + Number.EPSILON) * 100) / 100;
      const tdsRate = getPayeeTaxRate(c.holder_type || "PUBLIC", false);
      const fractionalTaxAmount =
        Math.round((fractionalGrossCash * tdsRate + Number.EPSILON) * 100) / 100;
      const fractionalNetPayable =
        Math.round((fractionalGrossCash - fractionalTaxAmount + Number.EPSILON) * 100) / 100;

      rows.push({
        sn: sn++,
        clientId: c.id,
        boid: c.boid || "",
        shareholderName: c.full_name || "Shareholder",
        panNo: c.pan_no || undefined,
        oldHolderType: c.holder_type || "PUBLIC",
        newHolderType: c.holder_type || "PUBLIC",
        oldLockInCode: "00",
        newLockInCode: "00",
        initialBalance: initialKitta,
        convertedKitta,
        finalBalance: convertedKitta,
        fractionalKitta,
        fractionalGrossCash,
        fractionalTaxAmount,
        fractionalNetPayable,
        bankName: c.bank_name || undefined,
        bankAccountNo: c.bank_account_no || undefined,
        remarks: `Merger Swap 100:${swapRatio} (${initialKitta} target shares -> ${convertedKitta} merged shares)`,
      });
    }

    const totalInitial = rows.reduce((s, r) => s + r.initialBalance, 0);
    const totalConverted = rows.reduce((s, r) => s + r.convertedKitta, 0);
    const totalFractionalKitta = rows.reduce((s, r) => s + r.fractionalKitta, 0);
    const totalFractionalGross = rows.reduce((s, r) => s + r.fractionalGrossCash, 0);
    const totalFractionalTax = rows.reduce((s, r) => s + r.fractionalTaxAmount, 0);
    const totalFractionalNet = rows.reduce((s, r) => s + r.fractionalNetPayable, 0);

    return {
      conversionType: "MERGER_SWAP",
      companyId: targetCompanyId,
      companyName,
      companyCode,
      isin,
      fiscalYear,
      conversionRatio: swapRatio,
      totalEligibleShareholders: rows.length,
      totalInitialBalance: totalInitial,
      totalConvertedKitta: totalConverted,
      totalFinalBalance: totalConverted,
      totalFractionalKitta: Math.round(totalFractionalKitta * 100) / 100,
      totalFractionalGrossCash: Math.round(totalFractionalGross * 100) / 100,
      totalFractionalTaxAmount: Math.round(totalFractionalTax * 100) / 100,
      totalFractionalNetPayable: Math.round(totalFractionalNet * 100) / 100,
      rows,
    };
  },

  /**
   * 4. Stock Split / Consolidation (Sub-division e.g. NPR 100 -> NPR 10)
   */
  async simulateStockSplit(params: {
    companyId: string;
    fiscalYear: string;
    oldFaceValue: number; // e.g. 100
    newFaceValue: number; // e.g. 10
  }): Promise<ConversionResultSummary> {
    const { companyId, fiscalYear, oldFaceValue, newFaceValue } = params;

    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("id, company_name, company_code, isin")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Company";
    const companyCode = comp?.company_code || "COMP";
    const isin = comp?.isin || "NP0000000000";

    const { data: clients } = await (supabase as any)
      .from("clients")
      .select("id, full_name, boid, pan_no, kitta, holder_type, bank_name, bank_account_no")
      .eq("company_id", companyId);

    const multiplier = oldFaceValue / newFaceValue;
    const rows: ConversionRow[] = [];
    let sn = 1;

    for (const c of clients || []) {
      const initialKitta = Number(c.kitta || 0);
      if (initialKitta <= 0) continue;

      const finalKitta = Math.round(initialKitta * multiplier);

      rows.push({
        sn: sn++,
        clientId: c.id,
        boid: c.boid || "",
        shareholderName: c.full_name || "Shareholder",
        panNo: c.pan_no || undefined,
        oldHolderType: c.holder_type || "PUBLIC",
        newHolderType: c.holder_type || "PUBLIC",
        oldLockInCode: "00",
        newLockInCode: "00",
        initialBalance: initialKitta,
        convertedKitta: finalKitta - initialKitta,
        finalBalance: finalKitta,
        fractionalKitta: 0,
        fractionalGrossCash: 0,
        fractionalTaxAmount: 0,
        fractionalNetPayable: 0,
        bankName: c.bank_name || undefined,
        bankAccountNo: c.bank_account_no || undefined,
        remarks: `Stock split ${oldFaceValue}:${newFaceValue} (1 share -> ${multiplier} shares)`,
      });
    }

    const totalInitial = rows.reduce((s, r) => s + r.initialBalance, 0);
    const totalFinal = rows.reduce((s, r) => s + r.finalBalance, 0);
    const totalConverted = totalFinal - totalInitial;

    return {
      conversionType: "STOCK_SPLIT",
      companyId,
      companyName,
      companyCode,
      isin,
      fiscalYear,
      conversionRatio: multiplier,
      oldFaceValue,
      newFaceValue,
      totalEligibleShareholders: rows.length,
      totalInitialBalance: totalInitial,
      totalConvertedKitta: totalConverted,
      totalFinalBalance: totalFinal,
      totalFractionalKitta: 0,
      totalFractionalGrossCash: 0,
      totalFractionalTaxAmount: 0,
      totalFractionalNetPayable: 0,
      rows,
    };
  },

  /**
   * 5. Physical-to-DEMAT Conversion (DRN)
   */
  async simulatePhysicalToDemat(params: {
    companyId: string;
    fiscalYear: string;
    records?: Array<{
      clientId?: string;
      boid?: string;
      shareholderName?: string;
      kitta: number;
      certificateNo?: string;
      folioNo?: string;
    }>;
  }): Promise<ConversionResultSummary> {
    const { companyId, fiscalYear, records } = params;

    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("id, company_name, company_code, isin")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Company";
    const companyCode = comp?.company_code || "COMP";
    const isin = comp?.isin || "NP0000000000";

    let rows: ConversionRow[] = [];

    if (records && records.length > 0) {
      rows = records.map((r, idx) => ({
        sn: idx + 1,
        clientId: r.clientId || `PHYS-${idx + 1}`,
        boid: r.boid || "",
        shareholderName: r.shareholderName || `Shareholder ${idx + 1}`,
        oldHolderType: "PHYSICAL_FOLIO",
        newHolderType: "PUBLIC",
        oldLockInCode: "00",
        newLockInCode: "00",
        initialBalance: Number(r.kitta || 0),
        convertedKitta: Number(r.kitta || 0),
        finalBalance: Number(r.kitta || 0),
        fractionalKitta: 0,
        fractionalGrossCash: 0,
        fractionalTaxAmount: 0,
        fractionalNetPayable: 0,
        remarks: `DRN Dematerialization: Cert #${r.certificateNo || "N/A"}, Folio #${r.folioNo || "N/A"}`,
      }));
    } else {
      // Query physical or non-dematted clients from database
      const { data: physicalClients } = await (supabase as any)
        .from("clients")
        .select("id, full_name, boid, pan_no, kitta, holder_type, bank_name, bank_account_no")
        .eq("company_id", companyId);

      let sn = 1;
      for (const c of physicalClients || []) {
        const isPhysical =
          !c.boid ||
          c.boid.trim().length < 16 ||
          (c.holder_type || "").toUpperCase().includes("PHYSICAL");

        if (!isPhysical) continue;

        const kitta = Number(c.kitta || 0);
        if (kitta <= 0) continue;

        rows.push({
          sn: sn++,
          clientId: c.id,
          boid: c.boid || "",
          shareholderName: c.full_name || "Physical Shareholder",
          panNo: c.pan_no || undefined,
          oldHolderType: c.holder_type || "PHYSICAL",
          newHolderType: "PUBLIC",
          oldLockInCode: "00",
          newLockInCode: "00",
          initialBalance: kitta,
          convertedKitta: kitta,
          finalBalance: kitta,
          fractionalKitta: 0,
          fractionalGrossCash: 0,
          fractionalTaxAmount: 0,
          fractionalNetPayable: 0,
          bankName: c.bank_name || undefined,
          bankAccountNo: c.bank_account_no || undefined,
          remarks: `Physical Folio converted to DEMAT Ordinary Public Share`,
        });
      }
    }

    const totalKitta = rows.reduce((s, r) => s + r.convertedKitta, 0);

    return {
      conversionType: "PHYSICAL_TO_DEMAT",
      companyId,
      companyName,
      companyCode,
      isin,
      fiscalYear,
      conversionRatio: 1,
      totalEligibleShareholders: rows.length,
      totalInitialBalance: totalKitta,
      totalConvertedKitta: totalKitta,
      totalFinalBalance: totalKitta,
      totalFractionalKitta: 0,
      totalFractionalGrossCash: 0,
      totalFractionalTaxAmount: 0,
      totalFractionalNetPayable: 0,
      rows,
    };
  },

  /**
   * ATOMIC DATABASE COMMIT: Commits conversion results directly into RTARTS database using apply_share_conversion_atomic.
   */
  async commitConversionToDatabase(summary: ConversionResultSummary): Promise<{
    updatedClientsCount: number;
    syncedFractionalPayablesCount: number;
    totalFractionalAmount: number;
  }> {
    const fractionRows = summary.rows.filter((r) => r.fractionalNetPayable > 0);
    const totalFractionalAmount = fractionRows.reduce((s, r) => s + r.fractionalNetPayable, 0);

    const clientUpdates = summary.rows
      .filter((r) => r.clientId && !r.clientId.startsWith("PHYS-"))
      .map((r) => {
        let updatedHolderType = r.newHolderType;
        if (updatedHolderType.includes("PROMOTER")) {
          updatedHolderType = "PROMOTER";
        } else if (updatedHolderType === "DEBENTURE_HOLDER" || updatedHolderType === "PHYSICAL") {
          updatedHolderType = "PUBLIC";
        } else if (!updatedHolderType) {
          updatedHolderType = r.oldHolderType || "PUBLIC";
        }
        return {
          client_id: r.clientId,
          kitta: r.finalBalance,
          holder_type: updatedHolderType,
          boid: r.boid || null,
        };
      });

    const fractionalPayables = fractionRows.map((r) => ({
      client_id: r.clientId,
      dividend_type: `${summary.conversionType} Fraction Cash`,
      shares_held: r.initialBalance,
      dividend_rate: summary.conversionRatio,
      gross_dividend: r.fractionalGrossCash,
      tax_amount: r.fractionalTaxAmount,
      net_payable: r.fractionalNetPayable,
      bank_name: r.bankName || null,
      bank_account_no: r.bankAccountNo || null,
      remarks: r.remarks,
    }));

    // Invoke atomic RPC
    const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc(
      "apply_share_conversion_atomic",
      {
        p_company_id: summary.companyId,
        p_conversion_type: summary.conversionType,
        p_fiscal_year: summary.fiscalYear,
        p_ratio: Number(summary.conversionRatio || 1),
        p_client_updates: clientUpdates,
        p_fractional_payables: fractionalPayables,
      },
    );

    if (rpcErr) {
      throw new Error(`Atomic share conversion failed: ${rpcErr.message}`);
    }

    return {
      updatedClientsCount: Number(rpcRes?.clients_updated ?? clientUpdates.length),
      syncedFractionalPayablesCount: Number(
        rpcRes?.fractional_payables_inserted ?? fractionalPayables.length,
      ),
      totalFractionalAmount,
    };
  },

  /**
   * Exports CDSC Corporate Actions System (CAS) Conversion batch file in Excel (.xlsx).
   */
  exportCdscConversionBatch(summary: ConversionResultSummary, fileName?: string): void {
    const wb = XLSX.utils.book_new();

    const headers = [
      "S.N.",
      "BOID (16 Digits)",
      "Shareholder Name",
      "PAN Number",
      "ISIN",
      "Company Code",
      "Old Lock-in Code",
      "New Lock-in Code",
      "Initial Balance",
      "Converted Kitta",
      "Final Balance",
      "Fractional Share",
      "Fractional Net Cash (NPR)",
      "Bank Account",
      "Conversion Remarks",
    ];

    const rows = summary.rows.map((r) => [
      r.sn,
      r.boid,
      r.shareholderName,
      r.panNo || "",
      summary.isin,
      summary.companyCode,
      r.oldLockInCode,
      r.newLockInCode,
      r.initialBalance,
      r.convertedKitta,
      r.finalBalance,
      r.fractionalKitta,
      r.fractionalNetPayable,
      r.bankAccountNo ? `${r.bankName || "Bank"}: ${r.bankAccountNo}` : "",
      r.remarks,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 30 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 28 },
      { wch: 45 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "CDSC_CAS_Conversion");

    const safeName =
      (
        fileName ||
        `CDSC_Conversion_${summary.conversionType}_${summary.companyCode}_${summary.fiscalYear.replace("/", "_")}`
      ).replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },

  /**
   * Exports ConnectIPS Batch File for fractional cash payouts resulting from conversion.
   */
  exportConversionConnectIpsBatch(summary: ConversionResultSummary, fileName?: string): void {
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
      `INST-CONV-${idx + 1}`,
      `E2E-${summary.companyCode}-${r.sn}`,
      "109000000001",
      "01",
      r.bankName || "Commercial Bank",
      r.bankAccountNo || "0000000000000",
      r.shareholderName,
      r.fractionalNetPayable,
      r.boid,
      `${summary.conversionType} Fraction Payout ${summary.companyCode} FY ${summary.fiscalYear}`,
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

    XLSX.utils.book_append_sheet(wb, ws, "ConnectIPS_Conversion_Cash");

    const safeName =
      (
        fileName ||
        `ConnectIPS_Conversion_Fraction_${summary.companyCode}_${summary.fiscalYear.replace("/", "_")}`
      ).replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },
};
