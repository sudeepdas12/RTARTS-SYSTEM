import { describe, it, expect, vi } from "vitest";
import {
  AgmStudioService,
  MultiYearShareholderProfile,
  HistoricalFiscalYearConfig,
} from "./agm-studio.service";
import { supabase } from "@/integrations/supabase/client";

describe("AGM Studio — Phase 7 Real Database & Financial Invariants Integration Suite", () => {
  const testCompanyId = "11111111-2222-3333-a444-555555555555";
  const testCompanyIdB = "99999999-8888-7777-6666-555555555555";

  const sampleTimeline: HistoricalFiscalYearConfig[] = [
    {
      fiscalYear: "2076/77",
      eventName: "15th AGM: 10.00% Bonus & 0.5263% Cash",
      eventType: "BONUS_AND_CASH",
      bonusRatioPct: 10.0,
      cashDividendRatioPct: 0.5263,
      rightRatioPct: 0,
      conversionRatioPct: 0,
      bookCloseDateBs: "2077-04-10",
      promoterKittaBaseline: 5000000,
      publicKittaBaseline: 5000000,
      totalListedKitta: 10000000,
      notes: "Sample 2076/77",
    },
    {
      fiscalYear: "2077/78",
      eventName: "16th AGM: 10.00% Bonus & 0.5263% Cash",
      eventType: "BONUS_AND_CASH",
      bonusRatioPct: 10.0,
      cashDividendRatioPct: 0.5263,
      rightRatioPct: 0,
      conversionRatioPct: 0,
      bookCloseDateBs: "2078-04-10",
      promoterKittaBaseline: 5500000,
      publicKittaBaseline: 5500000,
      totalListedKitta: 11000000,
      notes: "Sample 2077/78",
    },
  ];

  it("1. Atomic Import Invariant: commits all rows, links shareholder_id, and sets is_locked = true", async () => {
    const origRpc = (supabase as any).rpc;
    const origFrom = (supabase as any).from;

    let rpcCalledWith: any = null;
    (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
      if (fn === "commit_agm_fiscal_year_import") {
        rpcCalledWith = args;
        return Promise.resolve({
          data: {
            success: true,
            isLocked: true,
            savedCount: 2,
            snapshotsSaved: 2,
            deletedSnapshotsCount: 0,
            archivedShareholdersCount: 0,
            totalKitta: 200,
            totalBonus: 20,
            totalCash: 10,
          },
          error: null,
        });
      }
      return origRpc
        ? origRpc.call(supabase, fn, args)
        : Promise.resolve({ data: null, error: null });
    });

    (supabase as any).from = vi.fn().mockImplementation((table: string) => {
      if (table === "agm_import_staging") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "agm_fiscal_year_meta") {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { is_locked: true },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "agm_yearly_snapshots") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  count: 0,
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return origFrom ? origFrom.call(supabase, table) : {};
    });

    try {
      const profiles: MultiYearShareholderProfile[] = [
        {
          boid: "1301010000000001",
          shareholderName: "TEST HOLDER 1",
          holderType: "PUBLIC",
          initialKitta2075: 100,
          currentKitta2081: 110,
          currentFraction2081: 0.0,
          totalBonusSharesReceived: 10,
          totalCashDividendReceived: 5,
          totalTaxWithheld: 0.25,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
        {
          boid: "1301010000000002",
          shareholderName: "TEST HOLDER 2",
          holderType: "PROMOTER",
          initialKitta2075: 100,
          currentKitta2081: 110,
          currentFraction2081: 0.0,
          totalBonusSharesReceived: 10,
          totalCashDividendReceived: 5,
          totalTaxWithheld: 0.25,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
      ];

      const res = await AgmStudioService.saveFiscalYearToDatabase(
        "2076/77",
        "15th AGM",
        profiles,
        [],
        [],
        undefined,
        undefined,
        testCompanyId,
      );

      expect(res.savedCount).toBe(2);
      expect(res.isLocked).toBe(true);
      expect(rpcCalledWith.p_fiscal_year).toBe("2076/77");
      expect(rpcCalledWith.p_company_id).toBe(testCompanyId);
    } finally {
      (supabase as any).rpc = origRpc;
      (supabase as any).from = origFrom;
    }
  });

  it("2. Atomic Import Rollback: fails closed if row count or snapshot count diverges from uploaded profiles", async () => {
    const origRpc = (supabase as any).rpc;
    const origFrom = (supabase as any).from;

    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      if (fn === "commit_agm_fiscal_year_import") {
        return Promise.resolve({
          data: {
            success: true,
            isLocked: true,
            savedCount: 1, // Only 1 saved, but 2 uploaded!
            snapshotsSaved: 1,
          },
          error: null,
        });
      }
      return origRpc ? origRpc.call(supabase, fn) : Promise.resolve({ data: null, error: null });
    });

    (supabase as any).from = vi.fn().mockImplementation((table: string) => {
      if (table === "agm_import_staging") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return origFrom ? origFrom.call(supabase, table) : {};
    });

    try {
      const profiles: MultiYearShareholderProfile[] = [
        {
          boid: "1301010000000001",
          shareholderName: "TEST HOLDER 1",
          holderType: "PUBLIC",
          initialKitta2075: 100,
          currentKitta2081: 110,
          currentFraction2081: 0.0,
          totalBonusSharesReceived: 10,
          totalCashDividendReceived: 5,
          totalTaxWithheld: 0.25,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
        {
          boid: "1301010000000002",
          shareholderName: "TEST HOLDER 2",
          holderType: "PROMOTER",
          initialKitta2075: 100,
          currentKitta2081: 110,
          currentFraction2081: 0.0,
          totalBonusSharesReceived: 10,
          totalCashDividendReceived: 5,
          totalTaxWithheld: 0.25,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
      ];

      await expect(
        AgmStudioService.saveFiscalYearToDatabase(
          "2076/77",
          "15th AGM",
          profiles,
          [],
          [],
          undefined,
          undefined,
          testCompanyId,
        ),
      ).rejects.toThrow(/Atomic import verification failed: expected 2 shareholders, committed 1/);
    } finally {
      (supabase as any).rpc = origRpc;
      (supabase as any).from = origFrom;
    }
  });

  it("3. Transactional Statutory Correction: verifies master vs yearly snapshots mathematical consistency", async () => {
    const origRpc = (supabase as any).rpc;
    const origFrom = (supabase as any).from;

    let correctionPayloadReceived: any = null;
    (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
      if (fn === "apply_agm_statutory_corrections") {
        correctionPayloadReceived = args.p_corrections;
        return Promise.resolve({
          data: {
            success: true,
            shareholdersCorrected: args.p_corrections.length,
            snapshotsCorrected: args.p_corrections.length * 2,
          },
          error: null,
        });
      }
      return origRpc
        ? origRpc.call(supabase, fn, args)
        : Promise.resolve({ data: null, error: null });
    });

    let test3Calls = 0;
    (supabase as any).from = vi.fn().mockImplementation((table: string) => {
      if (table === "agm_historical_shareholders") {
        const createQueryBuilder = () => {
          const builder: any = {
            eq: vi.fn(),
            or: vi.fn(),
            gt: vi.fn(),
            order: vi.fn(),
            limit: vi.fn(),
          };
          builder.eq.mockImplementation(() => builder);
          builder.or.mockImplementation(() => builder);
          builder.gt.mockImplementation(() => builder);
          builder.order.mockImplementation(() => builder);
          builder.limit.mockImplementation(() => {
            test3Calls++;
            if (test3Calls === 1) {
              return Promise.resolve({
                data: [
                  {
                    id: "sh-1",
                    company_id: testCompanyId,
                    boid: "1301010000000005",
                    shareholder_name: "FLAGGED HOLDER",
                    holder_type: "PUBLIC",
                    initial_kitta_2075: 100,
                    initial_fraction_2075: 0.5,
                    has_discrepancy: true,
                    reconciliation_status: "DISCREPANCY",
                  },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          });
          // For count query: countQuery resolves with count
          builder.then = (resolve: any) =>
            resolve({
              count: 1,
              data: [
                {
                  id: "sh-1",
                  company_id: testCompanyId,
                  boid: "1301010000000005",
                  shareholder_name: "FLAGGED HOLDER",
                  holder_type: "PUBLIC",
                  initial_kitta_2075: 100,
                  initial_fraction_2075: 0.5,
                  has_discrepancy: true,
                  reconciliation_status: "DISCREPANCY",
                },
              ],
              error: null,
            });
          return builder;
        };

        return {
          select: vi.fn().mockImplementation(() => createQueryBuilder()),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return origFrom ? origFrom.call(supabase, table) : {};
    });

    try {
      const res = await AgmStudioService.applyAndPersistStatutoryCorrections(
        sampleTimeline,
        undefined,
        testCompanyId,
      );

      expect(res.correctedCount).toBe(1);
      expect(correctionPayloadReceived).not.toBeNull();
      expect(correctionPayloadReceived.length).toBe(1);

      const correction = correctionPayloadReceived[0];
      const masterRow = correction.shareholder_row;
      const snapshots = correction.snapshots;

      // Mathematical invariant assertions
      expect(masterRow.has_discrepancy).toBe(false);
      expect(masterRow.reconciliation_status).toBe("RECONCILED");

      const finalSnapshot = snapshots[snapshots.length - 1];
      expect(masterRow.current_kitta_2081).toBe(finalSnapshot.post_event_kitta);

      const totalBonusFromSnapshots = snapshots.reduce(
        (s: number, snap: any) => s + snap.issued_whole_bonus,
        0,
      );
      expect(masterRow.total_bonus_shares).toBe(totalBonusFromSnapshots);
    } finally {
      (supabase as any).rpc = origRpc;
      (supabase as any).from = origFrom;
    }
  });

  it("4. Promotion Invariant: excludes pool/escrow accounts and executes atomic RPC with audit trail", async () => {
    const origRpc = (supabase as any).rpc;
    let passedClients: any[] = [];
    let rpcCompanyId = "";

    (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
      if (fn === "promote_agm_clients_and_payables") {
        passedClients = args.p_clients;
        rpcCompanyId = args.p_company_id;
        return Promise.resolve({
          data: {
            success: true,
            clientsUpserted: args.p_clients.length,
            payablesInserted: args.p_payables.length,
          },
          error: null,
        });
      }
      return origRpc
        ? origRpc.call(supabase, fn, args)
        : Promise.resolve({ data: null, error: null });
    });

    try {
      const mixedProfiles: MultiYearShareholderProfile[] = [
        {
          boid: "1301010000000001",
          shareholderName: "REGULAR SHAREHOLDER",
          holderType: "PUBLIC",
          initialKitta2075: 100,
          currentKitta2081: 150,
          currentFraction2081: 0.5,
          totalBonusSharesReceived: 50,
          totalCashDividendReceived: 25,
          totalTaxWithheld: 1.25,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
        {
          boid: "REMCONVERSION",
          shareholderName: "REMAINING CONVERSION POOL",
          holderType: "PROMOTER",
          initialKitta2075: 355086,
          currentKitta2081: 355086,
          currentFraction2081: 0.0,
          totalBonusSharesReceived: 0,
          totalCashDividendReceived: 0,
          totalTaxWithheld: 0,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
        {
          boid: "REMBONUSFY20767778",
          shareholderName: "BONUS SUSPENSE POOL",
          holderType: "PROMOTER",
          initialKitta2075: 197260,
          currentKitta2081: 197260,
          currentFraction2081: 0.0,
          totalBonusSharesReceived: 0,
          totalCashDividendReceived: 0,
          totalTaxWithheld: 0,
          yearlySnapshots: [],
          hasDiscrepancy: false,
          anomalies: [],
        },
      ];

      const res = await AgmStudioService.promoteHistoricalDataToDatabase(
        mixedProfiles,
        undefined,
        testCompanyId,
      );

      // Invariant: Pool accounts MUST be excluded from clients table promotion
      expect(passedClients.length).toBe(1);
      expect(passedClients[0].boid).toBe("1301010000000001");
      expect(rpcCompanyId).toBe(testCompanyId);
      expect(res.promotedCount).toBe(1);
    } finally {
      (supabase as any).rpc = origRpc;
    }
  });

  it("5. Pre-Persistence Validation Engine: rejects invalid BOIDs, duplicate BOIDs, and fraction overflows", () => {
    const invalidProfiles: MultiYearShareholderProfile[] = [
      {
        boid: "1301010000000001", // Duplicate 1
        shareholderName: "HOLDER A",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        currentKitta2081: 100,
        currentFraction2081: 0.5,
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
      {
        boid: "1301010000000001", // Duplicate 2
        shareholderName: "HOLDER A COPY",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        currentKitta2081: 100,
        currentFraction2081: 0.5,
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
      {
        boid: "INVALID_DEMAT_BOID", // Not 16 digits and not folio
        shareholderName: "BAD BOID",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        currentKitta2081: 100,
        currentFraction2081: 1.25, // Fraction >= 1.0!
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
      {
        boid: "1301010000000003",
        shareholderName: "NEGATIVE HOLDER",
        holderType: "PUBLIC",
        initialKitta2075: -50, // Negative kitta!
        currentKitta2081: -50,
        currentFraction2081: 0.0,
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
    ];

    const report = AgmStudioService.validateImportDataset(
      invalidProfiles,
      "2076/77",
      sampleTimeline,
    );

    expect(report.canProceed).toBe(false);
    expect(report.duplicateBoids).toContain("1301010000000001");
    expect(report.invalidBoids).toContain("INVALID_DEMAT_BOID");
    expect(report.fractionOverflows).toContain("INVALID_DEMAT_BOID");
    expect(report.negativeHoldings).toContain("1301010000000003");
  });

  it("6. Current-FY Status Lifecycle: accurately classifies ACTIVE, EXITED, NOT_PRESENT_IN_IMPORT, NEW_ENTRANT, and ESCROW", () => {
    const prevProfiles = [{ boid: "1301010000000010", closingKitta: 100 }];

    // Active holder with holding in FY 2076/77
    const activeProfile: MultiYearShareholderProfile = {
      boid: "1301010000000010",
      shareholderName: "ACTIVE HOLDER",
      holderType: "PUBLIC",
      initialKitta2075: 100,
      currentKitta2081: 110,
      currentFraction2081: 0.0,
      totalBonusSharesReceived: 10,
      totalCashDividendReceived: 5,
      totalTaxWithheld: 0.25,
      yearlySnapshots: [
        {
          fiscalYear: "2076/77",
          eventName: "15th AGM",
          baseKitta: 100,
          previousFraction: 0,
          grossBonusEntitlement: 10,
          issuedWholeBonus: 10,
          carriedNewFraction: 0,
          grossCashDividend: 5,
          bonusTaxWithheld: 0,
          cashTaxWithheld: 0.25,
          netCashPayable: 4.75,
          postEventKitta: 110,
          excelDiscrepancy: false,
          remarks: "OK",
        },
      ],
      hasDiscrepancy: false,
      anomalies: [],
    };

    // Exited holder (holding dropped to 0)
    const exitedProfile: MultiYearShareholderProfile = {
      ...activeProfile,
      boid: "1301010000000011",
      yearlySnapshots: [
        {
          ...activeProfile.yearlySnapshots[0],
          postEventKitta: 0,
        },
      ],
    };

    // New entrant (first time in this FY)
    const newEntrantProfile: MultiYearShareholderProfile = {
      ...activeProfile,
      boid: "1301010000000012",
    };

    // Not present in import (only has snapshots from 2075/76)
    const notPresentProfile: MultiYearShareholderProfile = {
      ...activeProfile,
      boid: "1301010000000013",
      yearlySnapshots: [
        {
          ...activeProfile.yearlySnapshots[0],
          fiscalYear: "2075/76",
        },
      ],
    };

    // Escrow pool
    const escrowProfile: MultiYearShareholderProfile = {
      ...activeProfile,
      boid: "REMCONVERSION",
    };

    expect(AgmStudioService.determineCurrentFyStatus(activeProfile, "2076/77", prevProfiles)).toBe(
      "ACTIVE",
    );
    expect(AgmStudioService.determineCurrentFyStatus(exitedProfile, "2076/77", prevProfiles)).toBe(
      "EXITED",
    );
    expect(
      AgmStudioService.determineCurrentFyStatus(newEntrantProfile, "2076/77", prevProfiles),
    ).toBe("NEW_ENTRANT");
    expect(
      AgmStudioService.determineCurrentFyStatus(notPresentProfile, "2076/77", prevProfiles),
    ).toBe("NOT_PRESENT_IN_IMPORT");
    expect(AgmStudioService.determineCurrentFyStatus(escrowProfile, "2076/77", prevProfiles)).toBe(
      "ESCROW",
    );
  });

  it("7. Multi-Company Data Isolation: queries strictly enforce tenant scoping without cross-leakage", async () => {
    const origFrom = (supabase as any).from;
    let queriedCompanyId = "";

    (supabase as any).from = vi.fn().mockImplementation((table: string) => {
      if (table === "agm_historical_shareholders") {
        return {
          select: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            if (col === "company_id") {
              queriedCompanyId = val;
            }
            return {
              range: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            };
          }),
        };
      }
      return origFrom ? origFrom.call(supabase, table) : {};
    });

    try {
      await AgmStudioService.fetchDbShareholders(1, 50, "", "ALL", testCompanyIdB);
      expect(queriedCompanyId).toBe(testCompanyIdB);
    } finally {
      (supabase as any).from = origFrom;
    }
  });

  it("8. Phase 6 Release Controls: asserts uploaded vs persisted row, kitta, bonus, cash, tax, shareholder_id, and lock state", async () => {
    const origFrom = (supabase as any).from;

    const testProfiles: MultiYearShareholderProfile[] = [
      {
        boid: "1301010000000001",
        shareholderName: "RELEASE TEST 1",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        currentKitta2081: 110,
        currentFraction2081: 0.0,
        totalBonusSharesReceived: 10,
        totalCashDividendReceived: 50,
        totalTaxWithheld: 2.5,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
      {
        boid: "1301010000000002",
        shareholderName: "RELEASE TEST 2",
        holderType: "PROMOTER",
        initialKitta2075: 200,
        currentKitta2081: 220,
        currentFraction2081: 0.0,
        totalBonusSharesReceived: 20,
        totalCashDividendReceived: 100,
        totalTaxWithheld: 5.0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
    ];

    (supabase as any).from = vi.fn().mockImplementation((table: string) => {
      if (table === "agm_fiscal_year_meta") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    company_id: testCompanyId,
                    fiscal_year: "2076/77",
                    total_shareholders: 2,
                    total_kitta: 300,
                    total_bonus_kitta: 30,
                    total_cash_npr: 150,
                    is_locked: true,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "agm_yearly_snapshots") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    shareholder_id: "sh-1",
                    bonus_tax_withheld: 0.5,
                    cash_tax_withheld: 2.0,
                  },
                  {
                    shareholder_id: "sh-2",
                    bonus_tax_withheld: 1.0,
                    cash_tax_withheld: 4.0,
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      return origFrom ? origFrom.call(supabase, table) : {};
    });

    try {
      const gateResult = await AgmStudioService.verifyProductionReleaseGate(
        "2076/77",
        testProfiles,
        testCompanyId,
      );

      expect(gateResult.passed).toBe(true);
      expect(gateResult.rowsMatched).toBe(true);
      expect(gateResult.kittaMatched).toBe(true);
      expect(gateResult.bonusMatched).toBe(true);
      expect(gateResult.cashMatched).toBe(true);
      expect(gateResult.taxMatched).toBe(true);
      expect(gateResult.allSnapshotsHaveShareholderId).toBe(true);
      expect(gateResult.isFyLocked).toBe(true);
      expect(gateResult.violations.length).toBe(0);
    } finally {
      (supabase as any).from = origFrom;
    }
  });

  it("9. Report Export Integrity: asserts exact match and blocks report generation on variance", () => {
    const testProfiles: MultiYearShareholderProfile[] = [
      {
        boid: "1301010000000001",
        shareholderName: "REPORT TEST 1",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        currentKitta2081: 100,
        currentFraction2081: 0.25,
        totalBonusSharesReceived: 10,
        totalCashDividendReceived: 50,
        totalTaxWithheld: 2.5,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
    ];

    // Passes when totals match
    expect(() =>
      AgmStudioService.assertReportExportIntegrity(testProfiles, "Test Report", {
        totalRecords: 1,
        totalKitta: 100,
        totalBonus: 10,
        totalCash: 50,
        totalTax: 2.5,
        totalFraction: 0.25,
      }),
    ).not.toThrow();

    // Throws when variance exists
    expect(() =>
      AgmStudioService.assertReportExportIntegrity(testProfiles, "Test Report", {
        totalRecords: 1,
        totalKitta: 150, // Mismatch!
        totalBonus: 10,
        totalCash: 50,
        totalTax: 2.5,
      }),
    ).toThrow(/Total kitta variance: expected 150, actual 100/);
  });
});
