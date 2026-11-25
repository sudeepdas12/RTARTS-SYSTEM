import { describe, it, expect } from "vitest";
import {
  redactSensitiveText,
  maskIdentifier,
  triageClassificationQueue,
  triageWorkbookMappings,
  clusterReconciliationExceptions,
} from "./hitl-triage-agent.service";
import type { ParsedExcelData } from "@/lib/excel-parser";
import type { ReconciliationExceptionItem } from "@/lib/reconciliation-engine";

describe("HITL Triage Agent Service", () => {
  it("masks 16-digit BOIDs, PAN/account numbers, and email addresses strictly", () => {
    const raw =
      "Holder BOID 1301010000123456 with bank acct 019001050041234 email investor@example.com failed.";
    const redacted = redactSensitiveText(raw);

    expect(redacted).not.toContain("1301010000123456");
    expect(redacted).not.toContain("019001050041234");
    expect(redacted).not.toContain("investor@example.com");
    expect(redacted).toContain("1301********3456");
    expect(redacted).toContain("[REDACTED_EMAIL]");
    expect(maskIdentifier("1301010000123456")).toBe("1301********3456");
  });

  it("triages Nepali mutual funds, statutory trusts, institutions, and individuals deterministically", () => {
    const queue = [
      { id: "c1", full_name: "Nabil Balanced Fund 2", boid: "1301010000000001" },
      { id: "c2", full_name: "Citizen Investment Trust (CIT)", boid: "1301010000000002" },
      { id: "c3", full_name: "Himalayan Hydropower Company Pvt. Ltd.", boid: "1301010000000003" },
      { id: "c4", full_name: "Sita Kumari Thapa", boid: "1301010000000004" },
      { id: "c5", full_name: "Aarav Trading Concern", boid: "1301010000000005" },
    ];

    const summary = triageClassificationQueue(queue);
    expect(summary.totalAnalyzed).toBe(5);
    expect(summary.proposals[0].suggestedClassification).toBe("TAX_EXEMPT");
    expect(summary.proposals[1].suggestedClassification).toBe("PUBLIC_LEGAL_PERSON");
    expect(summary.proposals[2].suggestedClassification).toBe("COMPANY_INSTITUTION");
    expect(summary.proposals[3].suggestedClassification).toBe("NATURAL_PERSON");
    expect(summary.proposals[4].requiresHumanJudgment).toBe(true);
    expect(summary.bySuggestedClass.TAX_EXEMPT).toBe(1);
    expect(summary.bySuggestedClass.COMPANY_INSTITUTION).toBe(1);
  });

  it("proposes safe unmapped workbook headers while avoiding father-name or principal collisions", () => {
    const parsed: ParsedExcelData = {
      fileType: "dividend",
      fileName: "sample.xlsx",
      sheets: [
        {
          sheetName: "Public",
          sheetType: "PUBLIC",
          defaultTdsRate: 0.05,
          headers: [
            "BOID NO",
            "FATHER NAME",
            "SHAREHOLDER NAME",
            "KITTA HELD",
            "PRINCIPAL AMOUNT",
            "TDS AMOUNT",
            "NET DIVIDEND",
          ],
          mapping: {
            "BOID NO": "boid",
            "FATHER NAME": "father_name",
          },
          rows: [],
          totalKitta: 0,
          totalAmount: 0,
          totalTax: 0,
          totalNet: 0,
          rowCount: 0,
          isPreCalculated: true,
          isRawInputFile: false,
        },
      ],
      grandTotals: {
        totalRows: 0,
        totalKitta: 0,
        totalAmount: 0,
        totalTax: 0,
        totalNet: 0,
      },
    };

    const report = triageWorkbookMappings(parsed, 0);
    expect(
      report.suggestions.some(
        (s) => s.excelHeader === "SHAREHOLDER NAME" && s.suggestedField === "full_name",
      ),
    ).toBe(true);
    expect(
      report.suggestions.some(
        (s) => s.excelHeader === "TDS AMOUNT" && s.suggestedField === "div_tax",
      ),
    ).toBe(true);
    expect(
      report.suggestions.some(
        (s) => s.excelHeader === "NET DIVIDEND" && s.suggestedField === "net_payable",
      ),
    ).toBe(true);
    expect(
      report.suggestions.some(
        (s) => s.excelHeader === "PRINCIPAL AMOUNT" && s.suggestedField === "shares_held",
      ),
    ).toBe(false);
    expect(report.suggestions.some((s) => s.excelHeader === "FATHER NAME")).toBe(false);
  });

  it("clusters reconciliation exceptions into NCHL rejections, sub-5 NPR drifts, sweeps, and large variances", () => {
    const exceptions: ReconciliationExceptionItem[] = [
      {
        id: "e1",
        type: "UNMATCHED_RECORD",
        severity: "critical",
        description: "ConnectIPS RJCT AC01 closed account",
        amount: 2500,
        varianceAmount: 2500,
        status: "Rejected",
        actionRequired: "REMEDIATE",
      },
      {
        id: "e2",
        type: "UNDER_OVER_PAID",
        severity: "info",
        description: "Minor fee variance",
        amount: 495,
        varianceAmount: -5,
        status: "Under_Paid",
        actionRequired: "ACKNOWLEDGE",
      },
      {
        id: "e3",
        type: "UNMATCHED_BANK_CREDIT",
        severity: "warning",
        description: "Consolidated IPS DR sweep",
        amount: 150000,
        varianceAmount: 150000,
        status: "Missing",
        actionRequired: "REVIEW",
      },
      {
        id: "e4",
        type: "LARGE_VARIANCE",
        severity: "critical",
        description: "Bank differs from ledger",
        amount: 5000,
        varianceAmount: 1200,
        status: "Over_Paid",
        actionRequired: "REVIEW",
      },
    ];

    const clusters = clusterReconciliationExceptions(exceptions);
    expect(clusters.find((c) => c.category === "NCHL_REJECTED_OR_INVALID_ACCOUNT")?.itemCount).toBe(
      1,
    );
    expect(
      clusters.find((c) => c.category === "BANK_FEE_OR_PAISA_DRIFT")?.supportsToleranceAcknowledge,
    ).toBe(true);
    expect(clusters.find((c) => c.category === "UNMATCHED_SWEEP_OR_PRIOR_FY")?.itemCount).toBe(1);
    expect(clusters.find((c) => c.category === "REFERENCE_OR_AMOUNT_VARIANCE")?.itemCount).toBe(1);
  });
});
