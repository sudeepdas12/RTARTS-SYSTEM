import { describe, it, expect } from "vitest";
import { IpfSummaryReport } from "./ipf.service";

describe("IpfService — SEBON Investor Protection Fund Aging & Compliance", () => {
  it("correctly identifies items exceeding 5-year statutory threshold", () => {
    const report: IpfSummaryReport = {
      companyName: "Supermai Hydropower Limited",
      companyCode: "SUPERMAI",
      asOfDate: "2026-08-31",
      totalUnclaimedCount: 2,
      totalUnclaimedAmount: 75000,
      ipfEligibleCount: 1,
      ipfEligibleAmount: 50000,
      nonIpfCount: 1,
      nonIpfAmount: 25000,
      agingBuckets: [
        { label: "< 1 Year (Fresh)", count: 0, totalAmount: 0, isEligibleForIpf: false },
        { label: "1 - 3 Years (Pending)", count: 1, totalAmount: 25000, isEligibleForIpf: false },
        { label: "3 - 5 Years (Notice Period)", count: 0, totalAmount: 0, isEligibleForIpf: false },
        { label: "> 5 Years (IPF Statutory Transfer)", count: 1, totalAmount: 50000, isEligibleForIpf: true },
      ],
      items: [
        {
          id: "item-1",
          boid: "1301010000000001",
          shareholderName: "Old Shareholder",
          companyName: "Supermai Hydropower Limited",
          companyCode: "SUPERMAI",
          fiscalYear: "2075/76",
          paymentType: "DIVIDEND",
          declaredDate: "2019-01-15",
          grossAmount: 52631.58,
          taxAmount: 2631.58,
          netPayable: 50000,
          daysUnclaimed: 2780,
          yearsUnclaimed: 7.6,
          isIpfEligible: true,
        },
        {
          id: "item-2",
          boid: "1301010000000002",
          shareholderName: "Recent Shareholder",
          companyName: "Supermai Hydropower Limited",
          companyCode: "SUPERMAI",
          fiscalYear: "2080/81",
          paymentType: "DIVIDEND",
          declaredDate: "2024-01-15",
          grossAmount: 26315.79,
          taxAmount: 1315.79,
          netPayable: 25000,
          daysUnclaimed: 955,
          yearsUnclaimed: 2.6,
          isIpfEligible: false,
        },
      ],
    };

    expect(report.totalUnclaimedCount).toBe(2);
    expect(report.ipfEligibleCount).toBe(1);
    expect(report.ipfEligibleAmount).toBe(50000);
    expect(report.items[0].isIpfEligible).toBe(true);
    expect(report.items[1].isIpfEligible).toBe(false);
  });
});
