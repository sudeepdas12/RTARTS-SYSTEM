/**
 * Inland Revenue Department (IRD) Nepal — e-TDS Annex-10 & Withholding Certificate Service
 *
 * Implements standard IRD e-TDS reporting formats pursuant to Nepal Income Tax Act 2058:
 * - Section 87/88 (Dividend & Interest TDS)
 * - Segregated tax rates: 5% (Natural/Legal Person Dividends), 6% (Natural Person Debenture Interest),
 *   15% (Legal Person Debenture Interest), 0% (Mutual Funds / Tax-Exempt Entities).
 */

import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface IrdAnnex10Row {
  sn: number;
  withholdeePan: string;
  withholdeeName: string;
  boid: string;
  paymentType: "DIVIDEND" | "INTEREST" | "MUTUAL_FUND";
  paymentDate: string;
  grossAmount: number;
  tdsRate: number;
  tdsAmount: number;
  netPayable: number;
  voucherRef?: string;
}

export interface IrdAnnex10Summary {
  companyName: string;
  companyPan: string;
  fiscalYear: string;
  payableType: string;
  totalWithholdees: number;
  panWithholdees: number;
  unregisteredWithholdees: number;
  totalGrossAmount: number;
  totalTdsAmount: number;
  totalNetAmount: number;
  rows: IrdAnnex10Row[];
}

export interface TdsCertificateData {
  certificateNo: string;
  companyName: string;
  companyAddress: string;
  companyPan: string;
  fiscalYear: string;
  shareholderName: string;
  boid: string;
  panNo: string;
  citizenshipNo: string;
  address: string;
  paymentType: string;
  grossAmount: number;
  tdsRate: number;
  tdsAmount: number;
  netAmount: number;
  issueDate: string;
  authorizedPerson: string;
}

export const IrdEtdsService = {
  /**
   * Fetches and builds standard IRD Annex-10 report data for a company and fiscal year.
   */
  async getAnnex10Report(params: {
    companyId: string;
    fiscalYear?: string;
    payableType?: "dividend" | "interest" | "mutual_fund" | "all";
  }): Promise<IrdAnnex10Summary> {
    const { companyId, fiscalYear, payableType = "all" } = params;

    // 1. Fetch Company Info
    const { data: comp } = await (supabase as any)
      .from("companies")
      .select("company_name, company_code, pan_no, address")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = comp?.company_name || "Company";
    const companyPan = comp?.pan_no || "N/A";

    const rows: IrdAnnex10Row[] = [];
    let sn = 1;

    // 2. Fetch Dividend Payables if requested
    if (payableType === "all" || payableType === "dividend") {
      let q = (supabase as any)
        .from("dividend_payables")
        .select("*, client:clients(id, full_name, boid, pan_no, pan_or_citizenship, citizenship_no)")
        .eq("company_id", companyId);

      if (fiscalYear && fiscalYear !== "all") {
        q = q.eq("fiscal_year", fiscalYear);
      }

      const { data: divRows } = await q;
      for (const d of divRows || []) {
        const client = d.client || {};
        const pan = client.pan_no || client.pan_or_citizenship || "";
        const cleanPan = /^[0-9]{9}$/.test(pan.trim()) ? pan.trim() : "UNREGISTERED";
        const gross = Number(d.gross_dividend || 0);
        const tax = Number(d.tax_amount || 0);
        const net = Number(d.net_payable || gross - tax);
        const rate = Number(d.tds_rate != null ? Number(d.tds_rate) * 100 : gross > 0 ? (tax / gross) * 100 : 5);

        rows.push({
          sn: sn++,
          withholdeePan: cleanPan,
          withholdeeName: client.full_name || "Unknown Investor",
          boid: client.boid || "N/A",
          paymentType: "DIVIDEND",
          paymentDate: d.payment_date || d.created_at?.split("T")[0] || "",
          grossAmount: Math.round(gross * 100) / 100,
          tdsRate: Math.round(rate * 100) / 100,
          tdsAmount: Math.round(tax * 100) / 100,
          netPayable: Math.round(net * 100) / 100,
          voucherRef: d.payment_reference || undefined,
        });
      }
    }

    // 3. Fetch Interest Payables if requested
    if (payableType === "all" || payableType === "interest") {
      let q = (supabase as any)
        .from("interest_payables")
        .select("*, client:clients(id, full_name, boid, pan_no, pan_or_citizenship, citizenship_no)")
        .eq("company_id", companyId);

      if (fiscalYear && fiscalYear !== "all") {
        q = q.eq("fiscal_year", fiscalYear);
      }

      const { data: intRows } = await q;
      for (const d of intRows || []) {
        const client = d.client || {};
        const pan = client.pan_no || client.pan_or_citizenship || "";
        const cleanPan = /^[0-9]{9}$/.test(pan.trim()) ? pan.trim() : "UNREGISTERED";
        const gross = Number(d.gross_interest || 0);
        const tax = Number(d.tax_amount || 0);
        const net = Number(d.net_payable || gross - tax);
        const rate = Number(d.tds_rate != null ? Number(d.tds_rate) * 100 : gross > 0 ? (tax / gross) * 100 : 6);

        rows.push({
          sn: sn++,
          withholdeePan: cleanPan,
          withholdeeName: client.full_name || "Unknown Investor",
          boid: client.boid || "N/A",
          paymentType: "INTEREST",
          paymentDate: d.payment_date || d.due_date || d.created_at?.split("T")[0] || "",
          grossAmount: Math.round(gross * 100) / 100,
          tdsRate: Math.round(rate * 100) / 100,
          tdsAmount: Math.round(tax * 100) / 100,
          netPayable: Math.round(net * 100) / 100,
          voucherRef: d.payment_reference || undefined,
        });
      }
    }

    // 4. Fetch Mutual Fund Payables if requested
    if (payableType === "all" || payableType === "mutual_fund") {
      let q = (supabase as any)
        .from("mutual_fund_payables")
        .select("*, client:clients(id, full_name, boid, pan_no, pan_or_citizenship, citizenship_no)")
        .eq("company_id", companyId);

      if (fiscalYear && fiscalYear !== "all") {
        q = q.eq("fiscal_year", fiscalYear);
      }

      const { data: mfRows } = await q;
      for (const d of mfRows || []) {
        const client = d.client || {};
        const pan = client.pan_no || client.pan_or_citizenship || "";
        const cleanPan = /^[0-9]{9}$/.test(pan.trim()) ? pan.trim() : "UNREGISTERED";
        const gross = Number(d.gross_dividend || 0);
        const tax = Number(d.tax_amount || 0);
        const net = Number(d.net_payable || gross - tax);
        const rate = Number(d.tds_rate != null ? Number(d.tds_rate) * 100 : 0);

        rows.push({
          sn: sn++,
          withholdeePan: cleanPan,
          withholdeeName: client.full_name || "Unknown Investor",
          boid: client.boid || "N/A",
          paymentType: "MUTUAL_FUND",
          paymentDate: d.payment_date || d.created_at?.split("T")[0] || "",
          grossAmount: Math.round(gross * 100) / 100,
          tdsRate: Math.round(rate * 100) / 100,
          tdsAmount: Math.round(tax * 100) / 100,
          netPayable: Math.round(net * 100) / 100,
          voucherRef: d.payment_reference || undefined,
        });
      }
    }

    const totalGrossAmount = rows.reduce((s, r) => s + r.grossAmount, 0);
    const totalTdsAmount = rows.reduce((s, r) => s + r.tdsAmount, 0);
    const totalNetAmount = rows.reduce((s, r) => s + r.netPayable, 0);
    const panWithholdees = rows.filter((r) => r.withholdeePan !== "UNREGISTERED").length;
    const unregisteredWithholdees = rows.length - panWithholdees;

    return {
      companyName,
      companyPan,
      fiscalYear: fiscalYear || "All Fiscal Years",
      payableType: payableType.toUpperCase(),
      totalWithholdees: rows.length,
      panWithholdees,
      unregisteredWithholdees,
      totalGrossAmount: Math.round(totalGrossAmount * 100) / 100,
      totalTdsAmount: Math.round(totalTdsAmount * 100) / 100,
      totalNetAmount: Math.round(totalNetAmount * 100) / 100,
      rows,
    };
  },

  /**
   * Generates formatted Excel file for IRD Annex-10 e-TDS return upload.
   */
  exportAnnex10Excel(summary: IrdAnnex10Summary, fileName?: string): void {
    const wb = XLSX.utils.book_new();

    // Sheet 1: IRD Annex-10 e-TDS Return
    const headerRows = [
      ["GOVERNMENT OF NEPAL - MINISTRY OF FINANCE"],
      ["INLAND REVENUE DEPARTMENT (IRD)"],
      ["ANNEX-10: STATEMENT OF TAX DEDUCTION AT SOURCE (e-TDS RETURN)"],
      ["Pursuant to Section 87 & 88 of the Income Tax Act, 2058"],
      [],
      ["Withholding Entity Name:", summary.companyName],
      ["Withholding Entity PAN:", summary.companyPan],
      ["Fiscal Year:", summary.fiscalYear],
      ["Income Head / Type:", summary.payableType],
      ["Total Payees / Withholdees:", summary.totalWithholdees],
      ["Total Gross Payment (NPR):", summary.totalGrossAmount],
      ["Total TDS Withheld (NPR):", summary.totalTdsAmount],
      ["Total Net Payment (NPR):", summary.totalNetAmount],
      [],
      [
        "S.N.",
        "Withholdee PAN",
        "Shareholder / Payee Name",
        "BOID",
        "Payment Head",
        "Payment Date",
        "Gross Payment (NPR)",
        "TDS Rate (%)",
        "TDS Amount (NPR)",
        "Net Payment (NPR)",
        "Voucher / Reference",
      ],
    ];

    const dataRows = summary.rows.map((r) => [
      r.sn,
      r.withholdeePan,
      r.withholdeeName,
      r.boid,
      r.paymentType,
      r.paymentDate,
      r.grossAmount,
      r.tdsRate,
      r.tdsAmount,
      r.netPayable,
      r.voucherRef || "",
    ]);

    const allRows = [...headerRows, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    ws["!cols"] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 32 },
      { wch: 20 },
      { wch: 15 },
      { wch: 14 },
      { wch: 20 },
      { wch: 14 },
      { wch: 18 },
      { wch: 20 },
      { wch: 22 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "IRD_Annex_10_eTDS");

    const safeName =
      (fileName || `IRD_Annex10_${summary.companyName}_${summary.fiscalYear}`)
        .replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },

  /**
   * Generates a formal printable TDS Withholding Certificate PDF for an investor.
   */
  generateTdsCertificatePdf(data: TdsCertificateData): void {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const primaryColor = [22, 101, 52]; // Dark Green
    const textColor = [30, 41, 59];

    // Border Frame
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, 190, 277);
    doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setLineWidth(1);
    doc.rect(12, 12, 186, 273);

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text("RBB MERCHANT BANKING LIMITED", 105, 24, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text("Registrar to Shares (RTS) Department | Central Office, Kathmandu, Nepal", 105, 30, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("TAX DEDUCTION AT SOURCE (TDS) WITHHOLDING CERTIFICATE", 105, 40, { align: "center" });

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Pursuant to Section 87, 88 & 90 of the Nepal Income Tax Act, 2058", 105, 46, { align: "center" });

    // Meta Info Block
    doc.setDrawColor(220, 220, 220);
    doc.line(20, 52, 190, 52);

    doc.setFontSize(9);
    doc.text(`Certificate No: ${data.certificateNo}`, 20, 58);
    doc.text(`Issue Date: ${data.issueDate}`, 150, 58);

    doc.setFont("helvetica", "bold");
    doc.text("1. WITHHOLDING ENTITY (COMPANY DETAILS):", 20, 68);
    doc.setFont("helvetica", "normal");
    doc.text(`Company Name : ${data.companyName}`, 25, 74);
    doc.text(`PAN Number   : ${data.companyPan}`, 25, 80);
    doc.text(`Fiscal Year  : ${data.fiscalYear}`, 130, 80);

    doc.setFont("helvetica", "bold");
    doc.text("2. BENEFICIARY / SHAREHOLDER DETAILS:", 20, 92);
    doc.setFont("helvetica", "normal");
    doc.text(`Shareholder Name : ${data.shareholderName}`, 25, 98);
    doc.text(`BOID (16 Digits) : ${data.boid}`, 25, 104);
    doc.text(`Permanent PAN    : ${data.panNo || "N/A"}`, 130, 98);
    doc.text(`Citizenship No.  : ${data.citizenshipNo || "N/A"}`, 130, 104);
    doc.text(`Address          : ${data.address || "Nepal"}`, 25, 110);

    // TDS Details Table
    doc.setFont("helvetica", "bold");
    doc.text("3. INCOME DISTRIBUTION & TAX DEDUCTION BREAKDOWN:", 20, 122);

    autoTable(doc, {
      startY: 126,
      margin: { left: 20, right: 20 },
      head: [["Particulars / Income Head", "Gross Amount (NPR)", "TDS Rate (%)", "TDS Withheld (NPR)", "Net Amount Paid (NPR)"]],
      body: [
        [
          data.paymentType,
          data.grossAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          `${data.tdsRate.toFixed(2)}%`,
          data.tdsAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          data.netAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
        ],
        [
          "TOTAL",
          data.grossAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          "-",
          data.tdsAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          data.netAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
        ],
      ],
      headStyles: {
        fillColor: [22, 101, 52],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 9,
      },
      bodyStyles: {
        fontSize: 9,
        textColor: [30, 41, 59],
      },
      footStyles: {
        fontStyle: "bold",
      },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;

    // Statutory Declaration
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "italic");
    doc.text(
      "Declaration: This is to certify that the tax deducted as stated above has been credited/deposited to the Government Revenue Account through the Inland Revenue Department (IRD) electronic filing system (e-TDS).",
      20,
      finalY,
      { maxWidth: 170 },
    );

    // Signatures
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.line(25, finalY + 45, 75, finalY + 45);
    doc.text("Prepared By (Operator)", 25, finalY + 50);

    doc.line(135, finalY + 45, 185, finalY + 45);
    doc.text("Authorized Signatory & Seal", 135, finalY + 50);
    doc.text(data.companyName, 135, finalY + 55);

    // Security Verification Hash
    const verifHash = `RBB-TDS-${data.boid.slice(-6)}-${data.fiscalYear.replace("/", "")}-${Math.round(data.tdsAmount)}`;
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(`Digital Verification Code: ${verifHash} | Generated by RTARTS System`, 105, 280, { align: "center" });

    doc.save(`TDS_Certificate_${data.shareholderName}_${data.fiscalYear.replace("/", "_")}.pdf`);
  },
};
