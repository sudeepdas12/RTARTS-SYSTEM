import * as XLSX from "xlsx";

export interface ModernStatementShareholder {
  name: string;
  fatherName?: string;
  boid: string;
  pan?: string;
  holderType?: string;
  bankName?: string;
  bankAccountNo?: string;
  phone?: string;
}

export interface ModernStatementTotals {
  gross: number;
  tax: number;
  net: number;
  paid: number;
  pending: number;
}

export interface ModernStatementRecord {
  fiscalYear: string;
  companyName: string;
  companyCode?: string;
  type: string;
  kitta: number;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  status: string;
  paymentDate?: string | null;
  paymentRef?: string | null;
  bankDetails?: string | null;
  remarks?: string | null;
}

export interface ModernStatementExportOptions {
  fileName: string;
  title?: string;
  subtitle?: string;
  shareholder: ModernStatementShareholder;
  summary: ModernStatementTotals;
  records: ModernStatementRecord[];
}

import { MAX_EXPORT_BROWSER_ROWS } from "./constants";

export const ExcelExporter = {
  /**
   * Exports data to a formatted Excel file with dynamic column width calculation.
   * Warns and safely caps at MAX_EXPORT_BROWSER_ROWS with an explicit truncation note if exceeded.
   */
  exportToExcel(data: any[], fileName: string, sheetName = "Data") {
    if (!data || data.length === 0) return;

    let exportRows = data;
    const isTruncated = data.length > MAX_EXPORT_BROWSER_ROWS;
    if (isTruncated) {
      console.warn(
        `[ExcelExporter] Dataset contains ${data.length} rows, exceeding browser safety threshold (${MAX_EXPORT_BROWSER_ROWS}). Capping export to prevent memory exhaustion.`,
      );
      exportRows = data.slice(0, MAX_EXPORT_BROWSER_ROWS);
    }

    const worksheet = XLSX.utils.json_to_sheet(exportRows);

    if (isTruncated) {
      // Append a clear audit notice row at the end of the sheet
      XLSX.utils.sheet_add_aoa(
        worksheet,
        [
          [],
          [
            `[NOTE: Export truncated at ${MAX_EXPORT_BROWSER_ROWS} rows out of ${data.length} total records for browser performance. Use server export for full archive.]`,
          ],
        ],
        { origin: -1 },
      );
    }

    // Auto-calculate column widths to prevent cramped/clipped cells
    const colWidths = Object.keys(data[0] || {}).map((key) => {
      let maxLen = key.length;
      for (const row of exportRows) {
        const val = String(row[key] ?? "");
        if (val.length > maxLen) maxLen = val.length;
      }
      return { wch: Math.min(Math.max(maxLen + 3, 10), 60) };
    });
    worksheet["!cols"] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
  },

  /**
   * Ultra-Modern Multi-Section Statement Excel Dump with Demographics, Financial KPIs, and Formatted Ledger.
   */
  exportModernStatement(options: ModernStatementExportOptions) {
    const {
      fileName,
      title = "SHAREHOLDER DISTRIBUTION & HISTORICAL PAYOUT STATEMENT",
      subtitle = "Unified Entitlement Ledger Across All Fiscal Years & Schemes",
      shareholder,
      summary,
      records,
    } = options;

    const aoa: any[][] = [];

    // 1. Corporate Header
    aoa.push(["RTA / RTS SYSTEM — REGISTRAR & TRANSFER AGENT OPERATIONS"]);
    aoa.push([title.toUpperCase()]);
    aoa.push([
      `Official Entitlement Statement | Generated: ${new Date().toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })} | Confidential`,
    ]);
    if (subtitle) aoa.push([subtitle]);
    aoa.push([]); // blank separator

    // 2. Shareholder Demographic Profile
    aoa.push(["--- SHAREHOLDER / BENEFICIARY PROFILE ---"]);
    aoa.push([
      "Shareholder Name:",
      shareholder.name,
      "",
      "BOID (16-Digit Demat):",
      String(shareholder.boid),
    ]);
    aoa.push([
      "Father's Name:",
      shareholder.fatherName || "—",
      "",
      "PAN / Citizenship:",
      String(shareholder.pan || "—"),
    ]);
    aoa.push([
      "Holder Category:",
      shareholder.holderType || "Natural Person - Public",
      "",
      "Bank Name:",
      shareholder.bankName || "—",
    ]);
    aoa.push([
      "Contact Phone:",
      shareholder.phone || "—",
      "",
      "Bank Account No.:",
      String(shareholder.bankAccountNo || "—"),
    ]);
    aoa.push([]); // blank separator

    // 3. Financial Summary KPIs Block
    aoa.push(["--- FINANCIAL ENTITLEMENT SUMMARY (NPR) ---"]);
    aoa.push([
      "Total Gross Entitlements",
      "Total TDS Tax Deducted",
      "Total Net Settled (Paid)",
      "Total Outstanding (Pending)",
    ]);
    aoa.push([summary.gross, summary.tax, summary.paid, summary.pending]);
    aoa.push([]); // blank separator

    // 4. Ledger Table Column Headers
    aoa.push(["--- DETAILED TRANSACTION LEDGER ---"]);
    const headers = [
      "S.N.",
      "Fiscal Year",
      "Company / Scheme Name",
      "Symbol / Code",
      "Distribution Type",
      "Holding (Kitta / Units)",
      "Gross Amount (NPR)",
      "TDS Tax (NPR)",
      "Net Payable (NPR)",
      "Payment Status",
      "Payment Date",
      "Payment Reference",
      "Bank Account",
      "Remarks / Corporate Action",
    ];
    aoa.push(headers);

    // 5. Ledger Data Rows
    // In multi-year ledgers, holding is a point-in-time stock balance.
    // We report the latest active holding rather than summing historical balances across years.
    const activeRecord = records.find((r) => Number(r.kitta) > 0);
    const latestHolding = activeRecord ? Number(activeRecord.kitta) : 0;

    records.forEach((r, idx) => {
      aoa.push([
        idx + 1,
        r.fiscalYear,
        r.companyName,
        r.companyCode || "—",
        r.type,
        Number(r.kitta || 0),
        Number(r.grossAmount || 0),
        Number(r.taxAmount || 0),
        Number(r.netAmount || 0),
        r.status,
        r.paymentDate ? String(r.paymentDate).slice(0, 10) : "—",
        r.paymentRef || "—",
        r.bankDetails || shareholder.bankAccountNo || "—",
        r.remarks || "—",
      ]);
    });

    // 6. Grand Total Row
    aoa.push([
      "GRAND TOTAL",
      "",
      "",
      "",
      "",
      latestHolding,
      summary.gross,
      summary.tax,
      summary.net,
      `${records.length} Record(s)`,
      "",
      "",
      "",
    ]);

    aoa.push([]);
    aoa.push([
      "Verification Note: This document is an electronic statement generated from the RTARTS verified ledger pursuant to Nepal Companies Act & SEBON guidelines.",
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column widths
    ws["!cols"] = [
      { wch: 6 }, // S.N.
      { wch: 14 }, // Fiscal Year
      { wch: 32 }, // Company Name
      { wch: 14 }, // Symbol / Code
      { wch: 22 }, // Distribution Type
      { wch: 22 }, // Holding (Kitta)
      { wch: 20 }, // Gross Amount
      { wch: 18 }, // TDS Tax
      { wch: 20 }, // Net Payable
      { wch: 16 }, // Status
      { wch: 16 }, // Payment Date
      { wch: 22 }, // Payment Reference
      { wch: 30 }, // Bank Account
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payout Statement");

    // Optional Sheet 2: Summary by Scheme
    const schemeMap = new Map<
      string,
      {
        company: string;
        kitta: number;
        gross: number;
        tax: number;
        net: number;
        paid: number;
        pending: number;
      }
    >();
    for (const r of records) {
      const key = r.companyName;
      if (!schemeMap.has(key)) {
        schemeMap.set(key, {
          company: key,
          kitta: 0,
          gross: 0,
          tax: 0,
          net: 0,
          paid: 0,
          pending: 0,
        });
      }
      const item = schemeMap.get(key)!;
      item.kitta += Number(r.kitta || 0);
      item.gross += Number(r.grossAmount || 0);
      item.tax += Number(r.taxAmount || 0);
      item.net += Number(r.netAmount || 0);
      if (r.status === "Paid") item.paid += Number(r.netAmount || 0);
      else item.pending += Number(r.netAmount || 0);
    }

    const schemeAoa: any[][] = [];
    schemeAoa.push(["PORTFOLIO SUMMARY BY SCHEME / COMPANY"]);
    schemeAoa.push([`Shareholder: ${shareholder.name} | BOID: ${shareholder.boid}`]);
    schemeAoa.push([]);
    schemeAoa.push([
      "S.N.",
      "Company / Scheme",
      "Total Kitta / Units",
      "Gross Entitlement (NPR)",
      "TDS Tax (NPR)",
      "Net Entitlement (NPR)",
      "Settled / Paid (NPR)",
      "Pending Due (NPR)",
    ]);

    let sIdx = 1;
    for (const s of schemeMap.values()) {
      schemeAoa.push([sIdx++, s.company, s.kitta, s.gross, s.tax, s.net, s.paid, s.pending]);
    }
    schemeAoa.push([
      "TOTAL",
      "",
      latestHolding,
      summary.gross,
      summary.tax,
      summary.net,
      summary.paid,
      summary.pending,
    ]);

    const schemeWs = XLSX.utils.aoa_to_sheet(schemeAoa);
    schemeWs["!cols"] = [
      { wch: 6 },
      { wch: 36 },
      { wch: 20 },
      { wch: 24 },
      { wch: 20 },
      { wch: 24 },
      { wch: 22 },
      { wch: 22 },
    ];
    XLSX.utils.book_append_sheet(wb, schemeWs, "Portfolio Breakdown");

    XLSX.writeFile(wb, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
  },
};
