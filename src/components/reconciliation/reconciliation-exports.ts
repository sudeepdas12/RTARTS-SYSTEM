import * as XLSX from "xlsx";
import { toast } from "sonner";
import type {
  ComprehensiveReconciliationReport,
  ReconciliationMatch,
} from "@/lib/reconciliation-engine";
import type { ReconciliationGroupedLot } from "@/lib/services/reconciliation.service";

const isUUID = (str: unknown): str is string =>
  typeof str === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

export function buildReconciliationResultsPayload(
  report: ComprehensiveReconciliationReport | null,
  targetMatches?: ReconciliationMatch[],
) {
  const matchesToConvert = targetMatches || report?.matches || [];
  if (!matchesToConvert.length) return [];
  const today = new Date().toISOString().slice(0, 10);

  return matchesToConvert.map((match) => {
    const isBankStatement = report?.sourceType === "bank_statement";
    const clientId = isUUID(match.clientId) ? match.clientId : null;
    const companyId = isUUID(match.companyId) ? match.companyId : null;
    const payableId = isUUID(match.payableId) ? match.payableId : null;
    const paymentId = isUUID(match.paymentId) ? match.paymentId : null;
    const batchId = isUUID(match.batchId) ? match.batchId : null;
    const isBatch = Boolean(batchId) || match.matchSources?.includes("payment_batch");
    const sourceBId = isBankStatement ? paymentId || batchId || payableId : payableId;
    const sourceBType = isBankStatement
      ? paymentId
        ? "payment"
        : isBatch
          ? "batch"
          : "payable"
      : "payable";

    const fileNamePrefix = report?.fileName ? `File: ${report.fileName}` : "";
    const lotPrefix = match.lotName ? `Lot: ${match.lotName}` : "";
    const holderPrefix = match.shareholderName
      ? `Holder: ${match.shareholderName}${match.boid ? ` | BOID: ${match.boid}` : ""}`
      : "";
    const contextPrefix = [fileNamePrefix, lotPrefix, holderPrefix].filter(Boolean).join(" | ");

    return {
      reconciliation_date: today,
      source_a_type: isBankStatement ? "bank_statement" : "excel",
      source_a_id: null,
      source_b_type: sourceBType,
      source_b_id: sourceBId,
      client_id: clientId,
      company_id: companyId,
      fiscal_year: match.fiscalYear || null,
      payable_type:
        match.payableType ||
        (report?.fileName?.toLowerCase().includes("debenture") ||
        report?.fileName?.toLowerCase().includes("interest")
          ? "interest"
          : isBankStatement
            ? "interest"
            : "dividend"),
      payable_id: payableId,
      payment_id: paymentId,
      batch_id: batchId,
      expected_amount: match.systemAmount,
      actual_amount: match.excelAmount,
      difference: match.difference,
      result: match.status,
      notes:
        `${contextPrefix ? `[${contextPrefix}] ` : ""}Category: ${match.category}${isBankStatement ? ` / Bank Transaction ${match.transactionDate ?? ""}` : ""}${match.matchSources ? ` / Sources: ${match.matchSources.join(", ")}` : ""}${match.transactionDescription ? ` / Remarks: ${match.transactionDescription}` : ""}`.trim(),
      matched_by: null,
      matched_at: null,
      instruction_id:
        (match as any).instructionId ||
        (match as any).instruction_id ||
        (match as any).referenceId ||
        null,
      connectips_ref:
        (match as any).instructionId ||
        (match as any).instruction_id ||
        (match as any).referenceId ||
        null,
      bank_name: match.bankName || null,
      bank_account_no: match.bankAccountNo || null,
      lot_name: match.lotName || null,
      match_method: match.matchMethod || "instruction_id",
      match_confidence: match.confidenceScore || 80,
      candidate_count: match.candidateCount || 1,
      rejected_candidates: match.rejectedCandidates || [],
      rule_version: match.ruleVersion || "2.0.0",
      requires_manual_approval: match.requiresManualApproval || false,
      transaction_fingerprint: match.transactionFingerprint || undefined,
    };
  });
}

export function exportReconciliationLotWorkbook(lot: ReconciliationGroupedLot) {
  const classRows: any[] = [
    [
      "S.N.",
      "Lot / Settlement Batch",
      "Company",
      "Payable Type",
      "Date",
      "Total Records",
      "Matched Count",
      "Rejected Count",
      "Discrepancy Count",
      "Total Settled Amount (NPR)",
      "Matched Amount (NPR)",
      "Rejected Amount (NPR)",
    ],
    [
      1,
      lot.lotName,
      lot.companyName,
      lot.payableType,
      lot.date,
      lot.totalRecords,
      lot.matchedCount,
      lot.rejectedCount,
      lot.discrepancyCount,
      Number(lot.totalAmount.toFixed(2)),
      Number(lot.matchedAmount.toFixed(2)),
      Number(lot.rejectedAmount.toFixed(2)),
    ],
  ];

  const matchRows: any[] = [
    [
      "S.N.",
      "BOID",
      "Shareholder Name",
      "Company",
      "Payable Type",
      "Reconciliation Status",
      "Expected System Amount (NPR)",
      "Actual Settled Amount (NPR)",
      "Difference (NPR)",
      "Bank Name",
      "Account Number",
      "Notes / Remarks",
    ],
  ];

  lot.records.forEach((r, idx) => {
    matchRows.push([
      idx + 1,
      r.client?.boid || "",
      r.client?.full_name || "Shareholder",
      r.company?.company_name || lot.companyName || "",
      r.payable_type || lot.payableType,
      r.result,
      Number(Number(r.expected_amount || 0).toFixed(2)),
      Number(Number(r.actual_amount || 0).toFixed(2)),
      Number(Number(r.difference || 0).toFixed(2)),
      r.client?.bank_name || (r as any).bank_name || "",
      r.client?.bank_account_no || (r as any).bank_account_no || "",
      r.notes || "",
    ]);
  });

  const wb = XLSX.utils.book_new();
  const wsClass = XLSX.utils.aoa_to_sheet(classRows);
  const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);

  wsClass["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 28 },
    { wch: 16 },
    { wch: 14 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 26 },
    { wch: 24 },
    { wch: 24 },
  ];

  wsMatches["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 30 },
    { wch: 28 },
    { wch: 16 },
    { wch: 20 },
    { wch: 26 },
    { wch: 26 },
    { wch: 16 },
    { wch: 25 },
    { wch: 22 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, wsClass, "Classification Summary");
  XLSX.utils.book_append_sheet(wb, wsMatches, "Shareholder List");

  const safeLotName = lot.lotName.replace(/[^a-zA-Z0-9_-]/g, "_");
  XLSX.writeFile(wb, `Reconciliation_Lot_${safeLotName}.xlsx`);
  toast.success(`Exported Excel workbook (${lot.records.length} records) for ${lot.lotName}`);
}

export function exportReconciliationReportWorkbook(
  report: ComprehensiveReconciliationReport,
  filteredMatches: ReconciliationMatch[],
) {
  const classificationRows: any[] = [
    [
      "S.N.",
      "Classification / Category",
      "Total Records",
      "Total Kitta",
      "Gross Amount (NPR)",
      "TDS Tax (NPR)",
      "Net Payable (NPR)",
      "Exact Matched",
      "Partial / Discrepancy",
      "Reconciliation Status",
    ],
  ];

  if (report.categories && report.categories.length > 0) {
    report.categories.forEach((cat, idx) => {
      classificationRows.push([
        idx + 1,
        cat.categoryName,
        cat.rowCount,
        cat.totalKitta || 0,
        Number((cat.totalGrossAmount || 0).toFixed(2)),
        Number((cat.totalTaxAmount || 0).toFixed(2)),
        Number((cat.totalNetPayable || 0).toFixed(2)),
        cat.matchedCount || 0,
        cat.mismatchedCount || 0,
        cat.matchedCount === cat.rowCount
          ? "Fully Reconciled"
          : cat.matchedCount > 0
            ? "Partially Reconciled"
            : "Pending Reconciliation",
      ]);
    });
  }

  const matchRows: any[] = [
    [
      "S.N.",
      "BOID",
      "Shareholder Name",
      "Classification / Category",
      "Reconciliation Status",
      "Expected System Amount (NPR)",
      "Actual Excel/Bank Amount (NPR)",
      "Variance (NPR)",
      "Bank Name",
      "Account Number",
      "Payable Type",
      "Fiscal Year",
      "Match Sources",
      "Confidence Score (%)",
      "Narration / Notes",
    ],
  ];

  filteredMatches.forEach((m, idx) => {
    matchRows.push([
      idx + 1,
      m.boid || "",
      m.shareholderName || "Shareholder",
      m.category || "",
      m.status || "",
      Number(Number(m.systemAmount ?? 0).toFixed(2)),
      Number(Number(m.excelAmount ?? 0).toFixed(2)),
      Number(Number(m.difference ?? 0).toFixed(2)),
      m.bankName || "",
      m.bankAccountNo || "",
      m.payableType || "",
      m.fiscalYear || "",
      m.matchSources?.join(", ") || "None",
      m.confidenceScore ?? 0,
      m.transactionDescription || "",
    ]);
  });

  const wb = XLSX.utils.book_new();
  const wsClass = XLSX.utils.aoa_to_sheet(classificationRows);
  const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);

  wsClass["!cols"] = [
    { wch: 6 },
    { wch: 32 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 16 },
    { wch: 20 },
    { wch: 15 },
    { wch: 22 },
    { wch: 24 },
  ];

  wsMatches["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 30 },
    { wch: 25 },
    { wch: 18 },
    { wch: 22 },
    { wch: 24 },
    { wch: 16 },
    { wch: 25 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 18 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, wsClass, "Classification Summary");
  XLSX.utils.book_append_sheet(wb, wsMatches, "Shareholder List");

  const safeFileName = (report.fileName || "reconciliation-report").replace(/[^a-zA-Z0-9_-]/g, "_");
  XLSX.writeFile(
    wb,
    `Reconciliation_${safeFileName}_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
  toast.success("Excel report exported with Classification Summary & Shareholder List");
}

export function exportSelectedMatchesWorkbook(toExport: ReconciliationMatch[]) {
  if (toExport.length === 0) return;

  const categoryMap = new Map<
    string,
    { count: number; expected: number; actual: number; matched: number }
  >();
  toExport.forEach((m) => {
    const cat = m.category || "General";
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { count: 0, expected: 0, actual: 0, matched: 0 });
    }
    const entry = categoryMap.get(cat)!;
    entry.count += 1;
    entry.expected += Number(m.systemAmount || 0);
    entry.actual += Number(m.excelAmount || 0);
    if (m.status === "Matched") entry.matched += 1;
  });

  const classificationRows: any[] = [
    [
      "S.N.",
      "Classification / Category",
      "Selected Records",
      "Expected System Amount (NPR)",
      "Actual Settled Amount (NPR)",
      "Variance (NPR)",
      "Matched Count",
    ],
  ];

  Array.from(categoryMap.entries()).forEach(([catName, stats], idx) => {
    classificationRows.push([
      idx + 1,
      catName,
      stats.count,
      Number(stats.expected.toFixed(2)),
      Number(stats.actual.toFixed(2)),
      Number((stats.expected - stats.actual).toFixed(2)),
      stats.matched,
    ]);
  });

  const matchRows: any[] = [
    [
      "S.N.",
      "BOID",
      "Shareholder Name",
      "Classification / Category",
      "Reconciliation Status",
      "Expected System Amount (NPR)",
      "Actual Excel/Bank Amount (NPR)",
      "Variance (NPR)",
      "Bank Name",
      "Account Number",
      "Payable Type",
      "Fiscal Year",
      "Match Sources",
      "Confidence Score (%)",
      "Narration / Notes",
    ],
  ];

  toExport.forEach((m, idx) => {
    matchRows.push([
      idx + 1,
      m.boid || "",
      m.shareholderName || "Shareholder",
      m.category || "",
      m.status || "",
      Number(Number(m.systemAmount ?? 0).toFixed(2)),
      Number(Number(m.excelAmount ?? 0).toFixed(2)),
      Number(Number(m.difference ?? 0).toFixed(2)),
      m.bankName || "",
      m.bankAccountNo || "",
      m.payableType || "",
      m.fiscalYear || "",
      m.matchSources?.join(", ") || "None",
      m.confidenceScore ?? 0,
      m.transactionDescription || "",
    ]);
  });

  const wb = XLSX.utils.book_new();
  const wsClass = XLSX.utils.aoa_to_sheet(classificationRows);
  const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);

  wsClass["!cols"] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 18 },
    { wch: 25 },
    { wch: 25 },
    { wch: 16 },
    { wch: 15 },
  ];

  wsMatches["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 30 },
    { wch: 25 },
    { wch: 18 },
    { wch: 22 },
    { wch: 24 },
    { wch: 16 },
    { wch: 25 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 18 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, wsClass, "Classification Summary");
  XLSX.utils.book_append_sheet(wb, wsMatches, "Selected Shareholder List");

  XLSX.writeFile(
    wb,
    `Reconciliation_Selected_${toExport.length}_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
  toast.success(`Exported Excel workbook with ${toExport.length} selected records`);
}
