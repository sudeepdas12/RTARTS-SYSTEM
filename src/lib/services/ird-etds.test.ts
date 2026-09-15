import { describe, it, expect } from "vitest";
import { IrdEtdsService, IrdAnnex10Summary } from "./ird-etds.service";

describe("IrdEtdsService — Nepal Tax Compliance & Annex-10 Formatting", () => {
  it("computes accurate Annex-10 summary totals", () => {
    const sampleSummary: IrdAnnex10Summary = {
      companyName: "Supermai Hydropower Limited",
      companyPan: "600123456",
      fiscalYear: "2081/82",
      payableType: "DIVIDEND",
      totalWithholdees: 3,
      panWithholdees: 2,
      unregisteredWithholdees: 1,
      totalGrossAmount: 100000,
      totalTdsAmount: 5000,
      totalNetAmount: 95000,
      rows: [
        {
          sn: 1,
          withholdeePan: "123456789",
          withholdeeName: "Ram Sharma",
          boid: "1301010000000001",
          paymentType: "DIVIDEND",
          paymentDate: "2081-05-15",
          grossAmount: 50000,
          tdsRate: 5,
          tdsAmount: 2500,
          netPayable: 47500,
        },
        {
          sn: 2,
          withholdeePan: "987654321",
          withholdeeName: "Sita Poudel",
          boid: "1301010000000002",
          paymentType: "DIVIDEND",
          paymentDate: "2081-05-15",
          grossAmount: 30000,
          tdsRate: 5,
          tdsAmount: 1500,
          netPayable: 28500,
        },
        {
          sn: 3,
          withholdeePan: "UNREGISTERED",
          withholdeeName: "Hari Thapa",
          boid: "1301010000000003",
          paymentType: "DIVIDEND",
          paymentDate: "2081-05-15",
          grossAmount: 20000,
          tdsRate: 5,
          tdsAmount: 1000,
          netPayable: 19000,
        },
      ],
    };

    expect(sampleSummary.totalWithholdees).toBe(3);
    expect(sampleSummary.panWithholdees).toBe(2);
    expect(sampleSummary.unregisteredWithholdees).toBe(1);
    expect(sampleSummary.totalGrossAmount).toBe(100000);
    expect(sampleSummary.totalTdsAmount).toBe(5000);
    expect(sampleSummary.totalNetAmount).toBe(95000);
    expect(sampleSummary.rows[0].tdsRate).toBe(5);
  });

  it("passes invariant checks when row counts and financial totals match", () => {
    const validSummary: IrdAnnex10Summary = {
      companyName: "Consolidated Test Entity",
      companyPan: "CONSOLIDATED",
      fiscalYear: "2081/82",
      payableType: "DIVIDEND",
      totalWithholdees: 2,
      panWithholdees: 2,
      unregisteredWithholdees: 0,
      totalGrossAmount: 15000,
      totalTdsAmount: 750,
      totalNetAmount: 14250,
      rows: [
        {
          sn: 1,
          withholdeePan: "123456789",
          withholdeeName: "Person A",
          boid: "1301010000000001",
          paymentType: "DIVIDEND",
          paymentDate: "2026-01-01",
          grossAmount: 10000,
          tdsRate: 5,
          tdsAmount: 500,
          netPayable: 9500,
        },
        {
          sn: 2,
          withholdeePan: "987654321",
          withholdeeName: "Person B",
          boid: "1301010000000002",
          paymentType: "DIVIDEND",
          paymentDate: "2026-01-01",
          grossAmount: 5000,
          tdsRate: 5,
          tdsAmount: 250,
          netPayable: 4750,
        },
      ],
    };

    expect(() => IrdEtdsService.assertReportInvariants(validSummary)).not.toThrow();
  });

  it("fails invariant checks when row count or financial balance is violated", () => {
    const invalidSummary: IrdAnnex10Summary = {
      companyName: "Invalid Entity",
      companyPan: "123456789",
      fiscalYear: "2081/82",
      payableType: "DIVIDEND",
      totalWithholdees: 5, // Count mismatch
      panWithholdees: 1,
      unregisteredWithholdees: 0,
      totalGrossAmount: 10000,
      totalTdsAmount: 500,
      totalNetAmount: 9500,
      rows: [
        {
          sn: 1,
          withholdeePan: "123456789",
          withholdeeName: "Person A",
          boid: "1301010000000001",
          paymentType: "DIVIDEND",
          paymentDate: "2026-01-01",
          grossAmount: 10000,
          tdsRate: 5,
          tdsAmount: 500,
          netPayable: 9500,
        },
      ],
    };

    expect(() => IrdEtdsService.assertReportInvariants(invalidSummary)).toThrow(
      /Report invariant violation/,
    );
  });
});
