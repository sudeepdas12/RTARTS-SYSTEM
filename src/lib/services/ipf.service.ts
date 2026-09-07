/**
 * SEBON & Company Registrar — Investor Protection Fund (IPF) Aging & Transfer Service
 *
 * Pursuant to Section 182 of the Nepal Companies Act, 2063 (2006):
 * - Unpaid or unclaimed cash dividends remaining unpaid for a period of 5 years (1,825 days)
 *   from the date of AGM approval must be transferred to the Investor Protection Fund (IPF).
 */

import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export interface IpfAgingBucket {
  label: string; // e.g. "< 1 Year", "1 - 3 Years", "3 - 5 Years", "> 5 Years (IPF Eligible)"
  count: number;
  totalAmount: number;
  isEligibleForIpf: boolean;
}

export interface IpfUnclaimedItem {
  id: string;
  boid: string;
  shareholderName: string;
  companyName: string;
  companyCode: string;
  fiscalYear: string;
  paymentType: "DIVIDEND" | "INTEREST" | "MUTUAL_FUND";
  declaredDate: string;
  grossAmount: number;
  taxAmount: number;
  netPayable: number;
  daysUnclaimed: number;
  yearsUnclaimed: number;
  isIpfEligible: boolean; // >= 5 years
  bankName?: string;
  bankAccountNo?: string;
  remarks?: string;
}

export interface IpfSummaryReport {
  companyName: string;
  companyCode: string;
  asOfDate: string;
  totalUnclaimedCount: number;
  totalUnclaimedAmount: number;
  ipfEligibleCount: number;
  ipfEligibleAmount: number;
  nonIpfCount: number;
  nonIpfAmount: number;
  agingBuckets: IpfAgingBucket[];
  items: IpfUnclaimedItem[];
}

export const IpfService = {
  /**
   * Evaluates unclaimed aging and identifies IPF-eligible items for a company.
   */
  async getIpfAgingReport(params: {
    companyId?: string;
    asOfDate?: Date;
  }): Promise<IpfSummaryReport> {
    const asOf = params.asOfDate || new Date();
    const asOfTime = asOf.getTime();

    // 1. Fetch Company Info if specific
    let companyName = "All Managed Companies";
    let companyCode = "ALL";
    if (params.companyId && params.companyId !== "all") {
      const { data: comp } = await (supabase as any)
        .from("companies")
        .select("company_name, company_code")
        .eq("id", params.companyId)
        .maybeSingle();
      if (comp) {
        companyName = comp.company_name;
        companyCode = comp.company_code;
      }
    }

    const items: IpfUnclaimedItem[] = [];

    // 2. Fetch Unpaid Dividends (Pending, Failed, Discrepancy)
    let divQ = (supabase as any)
      .from("dividend_payables")
      .select("*, company:companies(company_name, company_code), client:clients(id, full_name, boid, phone)")
      .in("payment_status", ["Pending", "Failed", "Discrepancy"]);

    if (params.companyId && params.companyId !== "all") {
      divQ = divQ.eq("company_id", params.companyId);
    }

    const { data: divData } = await divQ;

    for (const d of divData || []) {
      const declaredDateStr = d.payment_date || d.created_at?.split("T")[0] || "2020-01-01";
      const declaredTime = new Date(declaredDateStr).getTime();
      const diffMs = Math.max(0, asOfTime - declaredTime);
      const daysUnclaimed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const yearsUnclaimed = Math.round((daysUnclaimed / 365.25) * 10) / 10;
      const isIpfEligible = daysUnclaimed >= 1825; // 5 years

      items.push({
        id: d.id,
        boid: d.client?.boid || "N/A",
        shareholderName: d.client?.full_name || "Unknown Investor",
        companyName: d.company?.company_name || companyName,
        companyCode: d.company?.company_code || companyCode,
        fiscalYear: d.fiscal_year || "N/A",
        paymentType: "DIVIDEND",
        declaredDate: declaredDateStr,
        grossAmount: Number(d.gross_dividend || 0),
        taxAmount: Number(d.tax_amount || 0),
        netPayable: Number(d.net_payable || 0),
        daysUnclaimed,
        yearsUnclaimed,
        isIpfEligible,
        bankName: d.bank_name || undefined,
        bankAccountNo: d.bank_account_no || undefined,
        remarks: d.remarks || undefined,
      });
    }

    // 3. Build Aging Buckets
    const b1 = { label: "< 1 Year (Fresh)", count: 0, totalAmount: 0, isEligibleForIpf: false };
    const b2 = { label: "1 - 3 Years (Pending)", count: 0, totalAmount: 0, isEligibleForIpf: false };
    const b3 = { label: "3 - 5 Years (Notice Period)", count: 0, totalAmount: 0, isEligibleForIpf: false };
    const b4 = { label: "> 5 Years (IPF Statutory Transfer)", count: 0, totalAmount: 0, isEligibleForIpf: true };

    for (const item of items) {
      if (item.daysUnclaimed < 365) {
        b1.count++;
        b1.totalAmount += item.netPayable;
      } else if (item.daysUnclaimed < 1095) {
        b2.count++;
        b2.totalAmount += item.netPayable;
      } else if (item.daysUnclaimed < 1825) {
        b3.count++;
        b3.totalAmount += item.netPayable;
      } else {
        b4.count++;
        b4.totalAmount += item.netPayable;
      }
    }

    const ipfEligibleItems = items.filter((i) => i.isIpfEligible);
    const nonIpfItems = items.filter((i) => !i.isIpfEligible);

    return {
      companyName,
      companyCode,
      asOfDate: asOf.toISOString().split("T")[0],
      totalUnclaimedCount: items.length,
      totalUnclaimedAmount: Math.round(items.reduce((s, i) => s + i.netPayable, 0) * 100) / 100,
      ipfEligibleCount: ipfEligibleItems.length,
      ipfEligibleAmount: Math.round(ipfEligibleItems.reduce((s, i) => s + i.netPayable, 0) * 100) / 100,
      nonIpfCount: nonIpfItems.length,
      nonIpfAmount: Math.round(nonIpfItems.reduce((s, i) => s + i.netPayable, 0) * 100) / 100,
      agingBuckets: [
        { ...b1, totalAmount: Math.round(b1.totalAmount * 100) / 100 },
        { ...b2, totalAmount: Math.round(b2.totalAmount * 100) / 100 },
        { ...b3, totalAmount: Math.round(b3.totalAmount * 100) / 100 },
        { ...b4, totalAmount: Math.round(b4.totalAmount * 100) / 100 },
      ],
      items,
    };
  },

  /**
   * Exports the official SEBON IPF transfer schedule to Excel.
   */
  exportIpfTransferSchedule(report: IpfSummaryReport, fileName?: string): void {
    const wb = XLSX.utils.book_new();

    const header = [
      ["SEBON / OFFICE OF THE COMPANY REGISTRAR (OCR) - NEPAL"],
      ["SCHEDULE OF UNCLAIMED DIVIDENDS FOR TRANSFER TO INVESTOR PROTECTION FUND (IPF)"],
      ["Pursuant to Section 182 of the Companies Act, 2063"],
      [],
      ["Entity Name:", report.companyName],
      ["Company Code:", report.companyCode],
      ["As Of Date:", report.asOfDate],
      ["Statutory Threshold:", "5 Years (1,825 Days) from Declaration"],
      ["Total IPF Transfer Amount (NPR):", report.ipfEligibleAmount],
      ["Total Eligible Beneficiaries:", report.ipfEligibleCount],
      [],
      [
        "S.N.",
        "BOID (16 Digits)",
        "Shareholder Name",
        "Company",
        "Fiscal Year",
        "Declared Date",
        "Unclaimed Days",
        "Unclaimed Years",
        "Gross Dividend (NPR)",
        "TDS Withheld (NPR)",
        "Net Transfer Amount (NPR)",
        "Bank Details",
        "Status",
      ],
    ];

    const ipfOnly = report.items.filter((i) => i.isIpfEligible);
    const dataRows = ipfOnly.map((r, idx) => [
      idx + 1,
      r.boid,
      r.shareholderName,
      r.companyName,
      r.fiscalYear,
      r.declaredDate,
      r.daysUnclaimed,
      r.yearsUnclaimed,
      r.grossAmount,
      r.taxAmount,
      r.netPayable,
      r.bankAccountNo ? `${r.bankName || "Bank"}: ${r.bankAccountNo}` : "Unspecified",
      "IPF_ELIGIBLE",
    ]);

    const all = [...header, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(all);

    ws["!cols"] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 30 },
      { wch: 25 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
      { wch: 18 },
      { wch: 22 },
      { wch: 28 },
      { wch: 16 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "SEBON_IPF_Transfer");

    const safeName =
      (fileName || `SEBON_IPF_Transfer_${report.companyCode}_${report.asOfDate}`)
        .replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },
};
