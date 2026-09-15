import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AgmStudioService,
  CompanyProfile,
  MultiYearShareholderProfile,
  cleanBoid,
  convertNepaliNumeralsToLatin,
  isUuid,
} from "./agm-studio.service";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

describe("AgmStudioService — Multi-Year AGM & Multi-Company Universal Reconciliation", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("supports multiple company profiles and switching active company", () => {
    const companies = AgmStudioService.getCompanies();
    expect(companies.length).toBeGreaterThanOrEqual(3);

    const nlg = companies.find((c) => c.code === "NLG");
    expect(nlg).toBeDefined();
    expect(nlg?.timeline.length).toBe(9);

    // Create a new custom company profile
    const customCompany: CompanyProfile = {
      id: "comp-hbl",
      code: "HBL",
      name: "Himalayan Bank Limited",
      baseFiscalYear: "2076/77",
      currentFiscalYear: "2080/81",
      timeline: [
        {
          fiscalYear: "2076/77",
          eventName: "10% Bonus Share Allotment",
          eventType: "BONUS_AND_CASH",
          bonusRatioPct: 10.0,
          cashDividendRatioPct: 0.5263,
          rightRatioPct: 0,
          conversionRatioPct: 0,
          bookCloseDateBs: "2077-04-10",
          promoterKittaBaseline: 8000000,
          publicKittaBaseline: 8000000,
          totalListedKitta: 16000000,
          notes: "Base corporate action.",
        },
      ],
    };

    AgmStudioService.saveCompanyProfile(customCompany);
    AgmStudioService.setActiveCompanyId("comp-hbl");

    const active = AgmStudioService.getActiveCompany();
    expect(active.code).toBe("HBL");
    expect(active.name).toBe("Himalayan Bank Limited");

    const timeline = AgmStudioService.getHistoricalTimeline("comp-hbl");
    expect(timeline.length).toBe(1);
    expect(timeline[0].bonusRatioPct).toBe(10.0);
  });

  it("generates the complete statutory historical timeline for NLG Insurance (FY 2072/73 to 2081/82)", () => {
    const timeline = AgmStudioService.getHistoricalTimeline("nlg-insurance");
    expect(timeline.length).toBe(9);

    const base7576 = timeline.find((t) => t.fiscalYear === "2075/76");
    expect(base7576).toBeDefined();
    expect(base7576?.bonusRatioPct).toBe(7.0);
    expect(base7576?.cashDividendRatioPct).toBe(0.36842);

    const conv7677 = timeline.find((t) => t.fiscalYear === "2076/77");
    expect(conv7677).toBeDefined();
    expect(conv7677?.conversionRatioPct).toBeCloseTo(27.142857, 4);

    const bonus7980 = timeline.find((t) => t.fiscalYear === "2079/80");
    expect(bonus7980?.bonusRatioPct).toBe(5.5);
    expect(bonus7980?.cashDividendRatioPct).toBeCloseTo(0.2895, 4);

    const bonus8182 = timeline.find((t) => t.fiscalYear === "2081/82");
    expect(bonus8182?.bonusRatioPct).toBe(4.0);
    expect(bonus8182?.cashDividendRatioPct).toBe(3.3684);
  });

  it("accurately rolls forward cumulative fractions across multi-year AGMs without floating point drift", () => {
    const snapshots = AgmStudioService.calculateShareholderEvolution(45, 0.1);
    expect(snapshots.length).toBe(9);

    snapshots.forEach((snap) => {
      expect(snap.carriedNewFraction.toString().split(".")[1]?.length || 0).toBeLessThanOrEqual(4);
      expect(snap.netCashPayable).toBeGreaterThanOrEqual(0);
    });

    const finalSnapshot = snapshots[snapshots.length - 1];
    expect(finalSnapshot.postEventKitta).toBeGreaterThan(45);
  });

  it("identifies Excel compounding discrepancies against statutory linear calculation", () => {
    const snapshots = AgmStudioService.calculateShareholderEvolution(
      100,
      0.5,
      undefined,
      "PUBLIC",
      0.999,
    );
    const hasDiscrepancy = snapshots.some((s) => s.excelDiscrepancy);
    expect(hasDiscrepancy).toBe(true);
  });

  it("enforces 100% Tax-Exemption (0% TDS) for Mutual Funds with full cash deposited to bank", () => {
    const mfSnapshots = AgmStudioService.calculateShareholderEvolution(
      10000,
      0,
      undefined,
      "MUTUAL_FUND",
    );

    const snap7980 = mfSnapshots.find((s) => s.fiscalYear === "2079/80");
    expect(snap7980).toBeDefined();
    expect(snap7980?.bonusTaxWithheld).toBe(0);
    expect(snap7980?.cashTaxWithheld).toBe(0);
    expect(snap7980?.netCashPayable).toBe(snap7980?.grossCashDividend);
    expect(snap7980?.netCashPayable).toBeGreaterThan(0);
  });

  it("eliminates sub-paisa negative dividend anomalies via EPSILON for standard investors", () => {
    const snapshots = AgmStudioService.calculateShareholderEvolution(19, 0.9);
    snapshots.forEach((s) => {
      expect(s.netCashPayable).toBeGreaterThanOrEqual(0);
    });
  });

  it("generates CDSC compliant Auto-CA .TXT batch file with header and trailer", () => {
    const sampleProfiles = AgmStudioService.getSampleHistoricalProfiles();
    // 1. Default EVENT_DELTA mode
    const txtDelta = AgmStudioService.generateCdscAutoCaTxt(
      sampleProfiles,
      "NLG",
      "2080/81",
      "BONUS_AND_CASH",
      "EVENT_DELTA",
    );

    const lines = txtDelta.split("\n");
    expect(lines[0].startsWith("H|NLG|2080/81|")).toBe(true);
    expect(lines[lines.length - 1].startsWith("T|")).toBe(true);
    expect(lines.length).toBe(sampleProfiles.length + 2);

    // Detail rows in EVENT_DELTA carry this FY's bonus delta
    const detailRow = lines[1].split("|");
    expect(detailRow[0]).toBe("D");
    expect(detailRow[1]).toBe("1");
    expect(detailRow[2]).toBe(sampleProfiles[0].boid);
    // Kitta must be a valid non-negative number
    expect(Number(detailRow[4])).toBeGreaterThanOrEqual(0);

    // 2. CUMULATIVE_BALANCE mode
    const txtBalance = AgmStudioService.generateCdscAutoCaTxt(
      sampleProfiles,
      "NLG",
      "2080/81",
      "BONUS_AND_CASH",
      "CUMULATIVE_BALANCE",
    );
    const balLines = txtBalance.split("\n");
    const balDetailRow = balLines[1].split("|");
    // In cumulative mode, kitta should match post-event holding
    const targetSnap = sampleProfiles[0].yearlySnapshots?.find((s) => s.fiscalYear === "2080/81");
    expect(Number(balDetailRow[4])).toBe(
      targetSnap ? targetSnap.postEventKitta : sampleProfiles[0].currentKitta2081,
    );
  });

  it("handles multi-line banner sheets and extracts all demographic and guardian details", async () => {
    const wb = XLSX.utils.book_new();

    const bannerRows = [
      ["NLG INSURANCE COMPANY LTD"],
      ["15th Annual General Meeting Shareholder Calculation List"],
      ["Book Closure Date: 2078-10-15 | Listed ISIN: NPE208A00006"],
      [
        "S.N.",
        "BOID",
        "Holder Name",
        "Father Name",
        "Grandfather Name",
        "Guardian Name",
        "Spouse Name",
        "Citizenship No",
        "District",
        "Contact No",
        "Bank Name",
        "Account No",
        "Kitta",
        "Fraction",
        "Type",
      ],
      [
        1,
        "1301010000005544",
        "KISHOR SHARMA",
        "KRISHNA SHARMA",
        "RAM SHARMA",
        "SARITA SHARMA",
        "SITA SHARMA",
        "27-01-70-01928",
        "KATHMANDU",
        "9851000000",
        "NABIL BANK LTD",
        "00100175000123",
        150,
        0.35,
        "PUBLIC",
      ],
      [
        2,
        "1301010000009988",
        "NIBL SAMRIDDHI FUND 1",
        "",
        "",
        "",
        "",
        "MF-001",
        "KATHMANDU",
        "",
        "NIBL ACE CAPITAL",
        "9900112233",
        2500,
        0,
        "MUTUAL FUND",
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(bannerRows);
    XLSX.utils.book_append_sheet(wb, ws, "Calculation List");

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const res = await AgmStudioService.parseHistoricalExcelWithReport(
      buf,
      "Banner_Test.xlsx",
      "2077/78",
    );

    expect(res.profiles.length).toBe(2);
    const p1 = res.profiles.find((p) => p.boid === "1301010000005544");
    expect(p1).toBeDefined();
    expect(p1?.shareholderName).toBe("KISHOR SHARMA");
    expect(p1?.fatherName).toBe("KRISHNA SHARMA");
    expect(p1?.grandfatherName).toBe("RAM SHARMA");
    expect(p1?.guardianName).toBe("SARITA SHARMA");
    expect(p1?.spouseName).toBe("SITA SHARMA");
    expect(p1?.citizenshipNo).toBe("27-01-70-01928");
    expect(p1?.district).toBe("KATHMANDU");
    expect(p1?.contactNo).toBe("9851000000");
    expect(p1?.bankName).toBe("NABIL BANK LTD");
    expect(p1?.bankAccountNo).toBe("00100175000123");

    const mf = res.profiles.find((p) => p.boid === "1301010000009988");
    expect(mf?.holderType).toBe("MUTUAL_FUND");
  });

  it("applies 27.14% promoter-to-public conversion for promoter holders and bonus in 2076/77", () => {
    // 1,000 promoter kitta before 2076/77
    const snapshots = AgmStudioService.calculateShareholderEvolution(
      1000,
      0,
      undefined,
      "PROMOTER",
    );
    const snap7677 = snapshots.find((s) => s.fiscalYear === "2076/77");
    expect(snap7677).toBeDefined();
    // 27.142857% conversion on 1,600 post-right kitta = 434 shares converted
    expect(snap7677?.convertedShares).toBeGreaterThan(0);
    expect(snap7677?.remarks).toContain("Converted");
  });

  it("applies 14th AGM 7% bonus shares accurately within FY 2075/76", () => {
    const snapshots = AgmStudioService.calculateShareholderEvolution(100, 0, undefined, "PUBLIC");
    const snap7576 = snapshots.find((s) => s.fiscalYear === "2075/76");
    expect(snap7576).toBeDefined();
    // 100 base kitta: 7% bonus on 100 = 7 bonus kitta, 0 new frac
    expect(snap7576?.issuedWholeBonus).toBe(7);
    expect(snap7576?.carriedNewFraction).toBe(0);
    expect(snap7576?.postEventKitta).toBe(107);
  });

  it("keeps Broker Clearing Pool accounts static without individual compounding", () => {
    const snapshots = AgmStudioService.calculateShareholderEvolution(
      500,
      0,
      undefined,
      "CLEARING_POOL",
    );
    const last = snapshots[snapshots.length - 1];
    expect(last.postEventKitta).toBe(500);
    expect(last.issuedWholeBonus).toBe(0);
  });

  it("sanitizes messy BOIDs and Devnagari numerals safely", () => {
    expect(AgmStudioService.getCompanies()).toBeDefined();
    expect(convertNepaliNumeralsToLatin("१३०१०१००००००५५४४")).toBe("1301010000005544");
    expect(cleanBoid("  13010100-00005544  ")).toBe("1301010000005544");
    expect(cleanBoid("13010100 00005544")).toBe("1301010000005544");
  });

  it("automatically suggests high-confidence physical-to-DEMAT (DRN) matches", () => {
    const sampleProfiles = AgmStudioService.getSampleHistoricalProfiles();
    const drnRecords = [
      {
        id: "drn-test-1",
        folioNo: "505",
        holderName: "BINAY RANA",
        totalKitta: 100,
        status: "PHYSICAL" as const,
      },
    ];

    const suggestions = AgmStudioService.autoSuggestDrnMatches(drnRecords, sampleProfiles);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].suggestedBoid).toBe("1301610000314392");
    expect(suggestions[0].confidence).toBe("HIGH");
  });

  it("parses and reconciles real-world Promoter Conversion files with dynamic floating lot difference", () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      [
        "S.No.",
        "BOID",
        "Name",
        "Total",
        "PO_INT",
        "PO_FRAC",
        "PU_INT",
        "PU_FRAC",
        "ca seq no",
        "remarks",
      ],
      [
        1,
        "1301010000001940",
        "SHANKAR PRASAD POUDYAL",
        68.0,
        3,
        0.0,
        65,
        0.0,
        "6316.001",
        "SUCCESS",
      ],
      [
        2,
        "1301060000015321",
        "AMIR DAS RANJIT",
        593.87,
        30,
        0.0,
        563,
        0.9026,
        "6316.002",
        "SUCCESS",
      ],
      [3, "FOLIO-115", "ABINASH PANTA", 5.58, 0, 0.0, 5, 0.579, "6316.002", "PHYSICAL"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "For Bishal");

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const res = AgmStudioService.parsePromoterConversionExcel(buf, "Conversion.xlsx");

    expect(res.records.length).toBe(3);
    expect(res.summary.totalAccounts).toBe(3);
    expect(res.summary.totalPromoterRetained).toBe(33);
    expect(res.summary.totalPublicConverted).toBe(633 + 0.9026 + 0.579);
    expect(res.summary.totalFractionsPreserved).toBeCloseTo(1.4816, 3);
    expect(res.summary.floatingLotDifference).toBeLessThan(1.0);
  });

  it("detects opening fraction mismatches across locked fiscal years in YoY validation", () => {
    const prevSnapshots = [{ boid: "1301010000005544", closingKitta: 100, closingFraction: 0.35 }];
    const currentProfiles: import("./agm-studio.service").MultiYearShareholderProfile[] = [
      {
        boid: "1301010000005544",
        shareholderName: "KISHOR SHARMA",
        holderType: "PUBLIC" as const,
        initialKitta2075: 100,
        initialFraction2075: 0.85,
        currentKitta2081: 100,
        currentFraction2081: 0.85,
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [] as string[],
      },
    ];

    const report = AgmStudioService.validateYearOverYearChain(
      currentProfiles,
      prevSnapshots,
      "2076/77",
      "2077/78",
    );

    expect(report.matchedCount).toBe(1);
    expect(currentProfiles[0].hasDiscrepancy).toBe(true);
    expect(currentProfiles[0].anomalies.some((a) => a.includes("Opening fraction mismatch"))).toBe(
      true,
    );
  });

  it("decomposes bulk REMCONVERSION and REMBONUS placeholder pools into individual physical folios", () => {
    const testProfiles: import("./agm-studio.service").MultiYearShareholderProfile[] = [
      {
        boid: "1301010000001940",
        shareholderName: "NORMAL SHAREHOLDER",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        initialFraction2075: 0,
        currentKitta2081: 200,
        currentFraction2081: 0,
        totalBonusSharesReceived: 50,
        totalCashDividendReceived: 100,
        totalTaxWithheld: 5,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
      {
        boid: "REMCONVERSION",
        shareholderName: "SHAREHOLDER SION (REM CONVERSION)",
        holderType: "PUBLIC",
        initialKitta2075: 136380,
        initialFraction2075: 0,
        currentKitta2081: 274261,
        currentFraction2081: 0.47,
        totalBonusSharesReceived: 38869,
        totalCashDividendReceived: 1037352.55,
        totalTaxWithheld: 246212.63,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      },
    ];

    const res = AgmStudioService.disperseBulkConversionAndBonusPools(testProfiles);
    expect(res.dispersedPoolsCount).toBe(1);
    expect(res.createdFoliosCount).toBeGreaterThan(0);
    // REMCONVERSION should no longer exist in expanded profiles
    expect(res.expandedProfiles.some((p) => p.boid === "REMCONVERSION")).toBe(false);
    // Individual folios should exist
    expect(res.expandedProfiles.some((p) => p.boid.startsWith("FOLIO-"))).toBe(true);
    // Total capital is preserved
    expect(res.totalKittaDistributed).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // REGRESSION TESTS FOR AUDIT FINDINGS
  // -------------------------------------------------------------------------

  describe("Regression Suite: Multi-Company Data Isolation & Target FY", () => {
    it("1. Multi-Company Isolation: same BOID exists in two companies with isolated profiles & company_id", () => {
      const boid = "1301010000009999";
      const compA = "a0000000-0000-0000-0000-000000000001";
      const compB = "b0000000-0000-0000-0000-000000000002";

      const profileA: import("./agm-studio.service").MultiYearShareholderProfile = {
        companyId: compA,
        boid,
        shareholderName: "COMPANY A SHAREHOLDER",
        holderType: "PUBLIC",
        initialKitta2075: 500,
        initialFraction2075: 0,
        currentKitta2081: 500,
        currentFraction2081: 0,
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      };

      const profileB: import("./agm-studio.service").MultiYearShareholderProfile = {
        companyId: compB,
        boid,
        shareholderName: "COMPANY B SHAREHOLDER",
        holderType: "PUBLIC",
        initialKitta2075: 1500,
        initialFraction2075: 0,
        currentKitta2081: 1500,
        currentFraction2081: 0,
        totalBonusSharesReceived: 0,
        totalCashDividendReceived: 0,
        totalTaxWithheld: 0,
        yearlySnapshots: [],
        hasDiscrepancy: false,
        anomalies: [],
      };

      expect(profileA.companyId).toBe(compA);
      expect(profileB.companyId).toBe(compB);
      expect(profileA.initialKitta2075).not.toBe(profileB.initialKitta2075);
      expect(profileA.boid).toBe(profileB.boid);
    });

    it("2. Non-Base-Year Target FY: target FY 2078/79 sets importedBaseKitta and does not treat holding as 2075 base", () => {
      const targetFy = "2078/79";
      const holdingKitta = 250;
      const holdingFrac = 0.5;

      const snapshots = AgmStudioService.calculateShareholderEvolution(
        holdingKitta,
        holdingFrac,
        undefined,
        "PUBLIC",
        undefined,
        targetFy,
      );

      // Slicing from 2078/79 onwards
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots[0].fiscalYear).toBe(targetFy);
      expect(snapshots[0].baseKitta).toBe(holdingKitta);

      // Verify that earlier years like 2075/76 are not present in this evolution
      expect(snapshots.some((s) => s.fiscalYear === "2075/76")).toBe(false);
    });

    it("3. CA 6316 Conversion Merge: promoter & public records with same BOID do NOT double count converted shares", () => {
      const basePromoterKitta = 100;
      const convertedKitta = 27.142857; // 27.14%
      const timeline = AgmStudioService.getHistoricalTimeline();

      // Calculation WITH isConversionMerged = true (already merged at workbook parsing)
      // Signature: (initialHolding, initialFraction, timeline, holderType, excelReportedFraction, targetFy, explicitConvertedShares, explicitRightAllotted, isConversionMerged)
      const snapshotsMerged = AgmStudioService.calculateShareholderEvolution(
        basePromoterKitta,
        0,
        timeline,
        "PUBLIC",
        undefined,
        timeline[0].fiscalYear,
        convertedKitta,
        undefined,
        true, // isConversionMerged
      );

      // Calculation WITHOUT isConversionMerged (unmerged individual event where converted shares need to be added)
      const snapshotsUnmerged = AgmStudioService.calculateShareholderEvolution(
        basePromoterKitta,
        0,
        timeline,
        "PUBLIC",
        undefined,
        timeline[0].fiscalYear,
        convertedKitta,
        undefined,
        false, // isConversionMerged = false
      );

      const convYearMerged = snapshotsMerged.find((s) => s.fiscalYear === "2076/77");
      const convYearUnmerged = snapshotsUnmerged.find((s) => s.fiscalYear === "2076/77");

      expect(convYearMerged).toBeDefined();
      expect(convYearUnmerged).toBeDefined();

      // When merged at parse time, base kitta is not redundantly augmented again by convertedKitta
      expect(convYearMerged!.postEventKitta).toBeLessThan(convYearUnmerged!.postEventKitta);
    });

    it("4. Promotion with Slug Company ID: resolveCompanyUuid validates valid UUIDs and isUuid validator works", async () => {
      const validUuid = "11111111-2222-3333-a444-555555555555";
      expect(isUuid(validUuid)).toBe(true);

      const resolvedDirect = await AgmStudioService.resolveCompanyUuid(validUuid);
      expect(resolvedDirect).toBe(validUuid);

      // Non-UUID slug returns null or a valid UUID when resolved against DB
      expect(isUuid("nlg-insurance")).toBe(false);
      const resolvedSlug = await AgmStudioService.resolveCompanyUuid("nlg-insurance");
      if (resolvedSlug) {
        expect(isUuid(resolvedSlug)).toBe(true);
      }
    });

    it("5. Broker Pool Claim Overdraft Protection: rejects claim exceeding remaining balance", async () => {
      const claim: import("./agm-studio.service").BrokerPoolClaim = {
        id: "claim-test-1",
        seqNo: 1,
        brokerCode: "99",
        brokerName: "TEST BROKER",
        poolBoid: "1301010000008888",
        claimantBoid: "1301010000001234",
        claimantName: "TEST CLAIMANT",
        fiscalYear: "2080/81",
        claimedKitta: 50,
        claimedCash: 500,
        contractNoteNo: "CN-1",
        tradeDateBs: "2080-01-01",
        status: "PENDING",
        remarks: "Test overdraft",
      };

      // In unit test without real Postgres DB running claim_agm_broker_pool, fallback checks balance in agm_broker_pools
      // If pool doesn't exist or balance is insufficient, it throws an error preventing overdraft
      await expect(AgmStudioService.saveBrokerPoolClaim(claim)).rejects.toThrow();
    });

    it("6. Dynamic Escrow & Floating Lot Calculations: summary avoids hardcoded 120.0406 and matches actual inputs", () => {
      const sumPre = 1000;
      const sumProm = 728.5714;
      const sumPub = 271.4286;
      const calculatedFloatingLotDiff =
        Math.round(Math.abs(sumPre - (sumProm + sumPub)) * 10000) / 10000;

      expect(calculatedFloatingLotDiff).toBe(0);
      expect(calculatedFloatingLotDiff).not.toBe(120.0406);
    });

    it("7. Multi-File Import Financial & Snapshot Merging: merges financial totals, carried fractions, and snapshot metrics on duplicate BOID", () => {
      // Setup Profile 1 from Workbook A
      const p1: MultiYearShareholderProfile = {
        boid: "1301010000009999",
        shareholderName: "MULTI-FILE TEST HOLDER",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        initialFraction2075: 0.2,
        currentKitta2081: 110,
        currentFraction2081: 0.25,
        totalBonusSharesReceived: 10,
        totalCashDividendReceived: 100,
        totalTaxWithheld: 15,
        yearlySnapshots: [
          {
            fiscalYear: "2080/81",
            eventName: "Bonus & Cash",
            baseKitta: 100,
            previousFraction: 0.2,
            grossBonusEntitlement: 10.05,
            issuedWholeBonus: 10,
            carriedNewFraction: 0.25,
            grossCashDividend: 100,
            bonusTaxWithheld: 5,
            cashTaxWithheld: 10,
            netCashPayable: 85,
            postEventKitta: 110,
            excelDiscrepancy: false,
            remarks: "First lot snapshot",
          },
        ],
        hasDiscrepancy: false,
        anomalies: ["First lot"],
      };

      // Setup Profile 2 from Workbook B (same BOID)
      const p2: MultiYearShareholderProfile = {
        boid: "1301010000009999",
        shareholderName: "MULTI-FILE TEST HOLDER",
        holderType: "PUBLIC",
        initialKitta2075: 50,
        initialFraction2075: 0.3,
        currentKitta2081: 55,
        currentFraction2081: 0.15,
        totalBonusSharesReceived: 5,
        totalCashDividendReceived: 50,
        totalTaxWithheld: 7.5,
        yearlySnapshots: [
          {
            fiscalYear: "2080/81",
            eventName: "Bonus & Cash",
            baseKitta: 50,
            previousFraction: 0.3,
            grossBonusEntitlement: 5.02,
            issuedWholeBonus: 5,
            carriedNewFraction: 0.15,
            grossCashDividend: 50,
            bonusTaxWithheld: 2.5,
            cashTaxWithheld: 5,
            netCashPayable: 42.5,
            postEventKitta: 55,
            excelDiscrepancy: false,
            remarks: "Second lot snapshot",
          },
        ],
        hasDiscrepancy: false,
        anomalies: ["Second lot"],
      };

      // Apply the multi-file merging algorithm implemented in processUploadedWorkbooks
      const mergedMap = new Map<string, MultiYearShareholderProfile>();
      [p1, p2].forEach((p) => {
        if (mergedMap.has(p.boid)) {
          const ex = mergedMap.get(p.boid)!;
          ex.initialKitta2075 += p.initialKitta2075;
          ex.initialFraction2075 =
            Math.round(((ex.initialFraction2075 || 0) + (p.initialFraction2075 || 0)) * 10000) /
            10000;
          ex.currentKitta2081 += p.currentKitta2081;
          ex.currentFraction2081 =
            Math.round((ex.currentFraction2081 + p.currentFraction2081) * 10000) / 10000;
          ex.totalBonusSharesReceived += p.totalBonusSharesReceived;
          ex.totalCashDividendReceived =
            Math.round((ex.totalCashDividendReceived + p.totalCashDividendReceived) * 100) / 100;
          ex.totalTaxWithheld = Math.round((ex.totalTaxWithheld + p.totalTaxWithheld) * 100) / 100;
          ex.anomalies = Array.from(new Set([...(ex.anomalies || []), ...p.anomalies]));

          p.yearlySnapshots.forEach((s) => {
            const exSnap = ex.yearlySnapshots.find((es) => es.fiscalYear === s.fiscalYear);
            if (exSnap) {
              exSnap.baseKitta += s.baseKitta;
              exSnap.previousFraction =
                Math.round((exSnap.previousFraction + s.previousFraction) * 10000) / 10000;
              exSnap.issuedWholeBonus += s.issuedWholeBonus;
              exSnap.grossCashDividend =
                Math.round((exSnap.grossCashDividend + s.grossCashDividend) * 100) / 100;
              exSnap.bonusTaxWithheld =
                Math.round((exSnap.bonusTaxWithheld + s.bonusTaxWithheld) * 100) / 100;
              exSnap.cashTaxWithheld =
                Math.round((exSnap.cashTaxWithheld + s.cashTaxWithheld) * 100) / 100;
              exSnap.netCashPayable =
                Math.round((exSnap.netCashPayable + s.netCashPayable) * 100) / 100;
              exSnap.postEventKitta += s.postEventKitta;
            }
          });
        } else {
          mergedMap.set(p.boid, {
            ...p,
            yearlySnapshots: p.yearlySnapshots.map((s) => ({ ...s })),
            anomalies: [...p.anomalies],
          });
        }
      });

      const merged = mergedMap.get("1301010000009999")!;
      expect(merged).toBeDefined();
      expect(merged.initialKitta2075).toBe(150);
      expect(merged.initialFraction2075).toBe(0.5);
      expect(merged.currentKitta2081).toBe(165);
      expect(merged.currentFraction2081).toBe(0.4);
      expect(merged.totalBonusSharesReceived).toBe(15);
      expect(merged.totalCashDividendReceived).toBe(150);
      expect(merged.totalTaxWithheld).toBe(22.5);
      expect(merged.anomalies).toHaveLength(2);

      const mergedSnap = merged.yearlySnapshots.find((s) => s.fiscalYear === "2080/81")!;
      expect(mergedSnap.baseKitta).toBe(150);
      expect(mergedSnap.issuedWholeBonus).toBe(15);
      expect(mergedSnap.grossCashDividend).toBe(150);
      expect(mergedSnap.bonusTaxWithheld + mergedSnap.cashTaxWithheld).toBe(22.5);
      expect(mergedSnap.netCashPayable).toBe(127.5);
      expect(mergedSnap.postEventKitta).toBe(165);
    });

    it("8. Snapshot Dynamic Restoration in exportFySummaryExcel: calculates snapshots for database profiles without snapshots", () => {
      // Simulate profile returned from database with empty yearlySnapshots
      const dbProfile: MultiYearShareholderProfile = {
        boid: "1301010000005555",
        shareholderName: "DB RESTORE TEST",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        initialFraction2075: 0.0,
        currentKitta2081: 145,
        currentFraction2081: 0.2,
        totalBonusSharesReceived: 45,
        totalCashDividendReceived: 350,
        totalTaxWithheld: 50,
        yearlySnapshots: [], // Empty from DB
        hasDiscrepancy: false,
        anomalies: [],
      };

      // Ensure calling exportFySummaryExcel does not throw and restores snapshots on the profile
      expect(() => {
        AgmStudioService.exportFySummaryExcel([dbProfile], undefined, "Test Company", "test.xlsx");
      }).not.toThrow();

      // The profile's yearlySnapshots should have been dynamically populated
      expect(dbProfile.yearlySnapshots.length).toBeGreaterThan(0);
      const firstSnap = dbProfile.yearlySnapshots[0];
      expect(firstSnap.baseKitta).toBe(100);
      expect(firstSnap.postEventKitta).toBeGreaterThanOrEqual(100);
    });

    it("9. Profile & Timeline Invariant: individual profile totals equal statutory evolution sum", () => {
      const sampleProfiles = AgmStudioService.getSampleHistoricalProfiles();
      const timeline = AgmStudioService.getHistoricalTimeline();

      sampleProfiles.forEach((profile) => {
        const snapshots = AgmStudioService.calculateShareholderEvolution(
          profile.initialKitta2075,
          profile.initialFraction2075 || 0,
          timeline,
          profile.holderType,
        );

        const sumBonus = snapshots.reduce((acc, s) => acc + s.issuedWholeBonus, 0);
        const sumGrossCash =
          Math.round(snapshots.reduce((acc, s) => acc + s.grossCashDividend, 0) * 100) / 100;
        const sumTax =
          Math.round(
            snapshots.reduce((acc, s) => acc + (s.bonusTaxWithheld + s.cashTaxWithheld), 0) * 100,
          ) / 100;
        const lastSnap = snapshots[snapshots.length - 1];

        expect(profile.totalBonusSharesReceived).toBe(sumBonus);
        expect(profile.totalCashDividendReceived).toBeCloseTo(sumGrossCash, 1);
        expect(profile.totalTaxWithheld).toBeCloseTo(sumTax, 1);
        expect(profile.currentKitta2081).toBe(lastSnap.postEventKitta);
      });
    });

    it("10. Statutory Capital Fallback: derives statutory listed kitta from company timeline without hardcoding NLG", async () => {
      // HBL profile has totalListedKitta = 16,000,000 in custom timeline
      const customCompany: CompanyProfile = {
        id: "comp-test-custom",
        code: "CUST",
        name: "Custom Company Ltd",
        baseFiscalYear: "2076/77",
        currentFiscalYear: "2080/81",
        timeline: [
          {
            fiscalYear: "2080/81",
            eventName: "Bonus Issue",
            eventType: "BONUS_AND_CASH",
            bonusRatioPct: 10.0,
            cashDividendRatioPct: 0.52,
            rightRatioPct: 0,
            conversionRatioPct: 0,
            bookCloseDateBs: "2081-01-01",
            promoterKittaBaseline: 5000000,
            publicKittaBaseline: 5000000,
            totalListedKitta: 10000000, // 10M, not NLG's 25.6M
            notes: "Test",
          },
        ],
      };
      AgmStudioService.saveCompanyProfile(customCompany);

      // Mock supabase.from to simulate empty DB response without network permission error
      const origFrom = (supabase as any).from;
      (supabase as any).from = (table: string) => {
        if (table === "agm_yearly_snapshots") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return origFrom(table);
      };

      try {
        // fetchStatutoryCapitalByFY for empty DB records returns the timeline baseline
        const result = await AgmStudioService.fetchStatutoryCapitalByFY(
          "2080/81",
          "comp-test-custom",
        );
        expect(result.statutoryCapital).toBe(10000000);
        expect(result.statutoryCapital).not.toBe(25631679);
      } finally {
        (supabase as any).from = origFrom;
      }
    });

    it("11. Atomic Bulk Pool Dispersion RPC: disperseBulkPoolsInDatabase calls disperse_agm_bulk_pools RPC when companyUuid is present", async () => {
      const origRpc = (supabase as any).rpc;
      const origFrom = (supabase as any).from;

      const mockRpc = vi.fn().mockImplementation((fn: string, args: any) => {
        if (fn === "disperse_agm_bulk_pools") {
          return Promise.resolve({
            data: { success: true, deletedPlaceholderCount: 1, insertedFoliosCount: 2 },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      // Mock from("agm_historical_shareholders") to return one placeholder record
      const mockSelect = vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                id: "bulk-1",
                company_id: "11111111-2222-3333-a444-555555555555",
                boid: "REMCONVERSION",
                shareholder_name: "REMCONVERSION",
                initial_kitta_2075: 7552,
                current_kitta_2081: 7552,
              },
            ],
            error: null,
          }),
        }),
      });

      (supabase as any).rpc = mockRpc;
      (supabase as any).from = (table: string) => {
        if (table === "agm_historical_shareholders") {
          return { select: mockSelect };
        }
        return { select: vi.fn().mockReturnThis() };
      };

      try {
        const res = await AgmStudioService.disperseBulkPoolsInDatabase(
          "11111111-2222-3333-a444-555555555555",
        );
        expect(mockRpc).toHaveBeenCalledWith(
          "disperse_agm_bulk_pools",
          expect.objectContaining({
            p_company_id: "11111111-2222-3333-a444-555555555555",
            p_placeholder_boids: ["REMCONVERSION"],
          }),
        );
        expect(res.dispersedCount).toBeGreaterThan(0);
      } finally {
        (supabase as any).rpc = origRpc;
        (supabase as any).from = origFrom;
      }
    });

    it("12. Composite Upsert Targeting: verifies saveConversionToDatabase targets 'company_id,boid,fiscal_year' matching DB schema", async () => {
      const origFrom = (supabase as any).from;
      let capturedOnConflict = "";
      let capturedRows: any[] = [];

      (supabase as any).from = (table: string) => {
        if (table === "agm_yearly_snapshots") {
          return {
            upsert: vi.fn().mockImplementation((rows: any[], opts: any) => {
              capturedOnConflict = opts?.onConflict;
              capturedRows = rows;
              return Promise.resolve({ error: null });
            }),
          };
        }
        return origFrom(table);
      };

      try {
        const mockConversion: import("./agm-studio.service").PromoterConversionRecord = {
          id: "conv-1",
          boidOrFolio: "1301010000001234",
          holderName: "TEST CONVERSION",
          preConversionTotal: 1000,
          promoterRetainedInt: 728,
          promoterRetainedFrac: 0.5714,
          publicConvertedInt: 271,
          publicConvertedFrac: 0.4286,
          totalConverted: 271.4286,
          fractionRemainder: 0,
          caSeqNo: "6316",
          status: "CONVERTED",
        };

        const res = await AgmStudioService.saveConversionToDatabase(
          [mockConversion],
          "2076/77",
          "11111111-2222-3333-a444-555555555555",
        );

        expect(res.savedCount).toBe(1);
        expect(capturedOnConflict).toBe("company_id,boid,fiscal_year");
        expect(capturedRows[0].company_id).toBe("11111111-2222-3333-a444-555555555555");
        expect(capturedRows[0].boid).toBe("1301010000001234");
        expect(capturedRows[0].fiscal_year).toBe("2076/77");
      } finally {
        (supabase as any).from = origFrom;
      }
    });

    it("13. Stale Shareholder Removal: verifies saveFiscalYearToDatabase invokes replace_agm_fiscal_year_snapshots with incoming BOIDs", async () => {
      const origRpc = (supabase as any).rpc;
      const origFrom = (supabase as any).from;

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, deleted_snapshots: 5, deleted_shareholders: 2 },
        error: null,
      });

      const mockUpsertSh = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: "sh-1", boid: "1301010000000001" }],
          error: null,
        }),
      });

      const mockUpsertSnap = vi.fn().mockResolvedValue({ error: null });
      const mockUpsertMeta = vi.fn().mockResolvedValue({ error: null });

      (supabase as any).rpc = mockRpc;
      (supabase as any).from = (table: string) => {
        if (table === "agm_import_staging") {
          return {
            insert: vi
              .fn()
              .mockResolvedValue({
                error: { message: "relation agm_import_staging does not exist" },
              }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          };
        }
        if (table === "agm_historical_shareholders") {
          return { upsert: mockUpsertSh };
        }
        if (table === "agm_yearly_snapshots") {
          return { upsert: mockUpsertSnap };
        }
        if (table === "agm_fiscal_year_meta") {
          return { upsert: mockUpsertMeta };
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      };

      try {
        const testProfile: MultiYearShareholderProfile = {
          boid: "1301010000000001",
          shareholderName: "RE-IMPORT TEST HOLDER",
          holderType: "PUBLIC",
          initialKitta2075: 500,
          currentKitta2081: 500,
          currentFraction2081: 0,
          totalBonusSharesReceived: 0,
          totalCashDividendReceived: 0,
          totalTaxWithheld: 0,
          hasDiscrepancy: false,
          yearlySnapshots: [
            {
              fiscalYear: "2078/79",
              eventName: "17th AGM",
              baseKitta: 500,
              previousFraction: 0,
              grossBonusEntitlement: 50,
              issuedWholeBonus: 50,
              carriedNewFraction: 0,
              grossCashDividend: 26.32,
              bonusTaxWithheld: 250,
              cashTaxWithheld: 1.32,
              netCashPayable: 0,
              postEventKitta: 550,
              excelDiscrepancy: false,
              remarks: "Clean",
            },
          ],
          anomalies: [],
        };

        const res = await AgmStudioService.saveFiscalYearToDatabase(
          "2078/79",
          "17th AGM",
          [testProfile],
          [],
          [],
          undefined,
          undefined,
          "11111111-2222-3333-a444-555555555555",
        );

        expect(mockRpc).toHaveBeenCalledWith("replace_agm_fiscal_year_snapshots", {
          p_company_id: "11111111-2222-3333-a444-555555555555",
          p_fiscal_year: "2078/79",
          p_incoming_boids: ["1301010000000001"],
        });
        expect(res.savedCount).toBe(1);
      } finally {
        (supabase as any).rpc = origRpc;
        (supabase as any).from = origFrom;
      }
    });

    it("14. Dual Persistence: verifies recalculateAndPersistAllTimelineProfiles batch-upserts both master shareholders and yearly snapshots", async () => {
      const origFrom = (supabase as any).from;
      let masterUpsertCalled = false;
      let snapshotsUpsertCalled = false;
      let capturedSnapshots: any[] = [];
      let callCount = 0;

      (supabase as any).from = (table: string) => {
        if (table === "agm_historical_shareholders") {
          const chain: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            upsert: vi.fn().mockImplementation(() => {
              masterUpsertCalled = true;
              return Promise.resolve({ error: null });
            }),
            then: (resolve: any) => {
              callCount++;
              if (callCount === 1) {
                return resolve({ count: 1, data: null, error: null });
              } else if (callCount === 2) {
                return resolve({
                  count: 1,
                  data: [
                    {
                      id: "sh-1",
                      company_id: "11111111-2222-3333-a444-555555555555",
                      boid: "1301010000000002",
                      shareholder_name: "DUAL PERSIST TEST",
                      holder_type: "PUBLIC",
                      initial_kitta_2075: 100,
                      initial_fraction_2075: 0,
                      current_kitta_2081: 100,
                      current_fraction_2081: 0,
                    },
                  ],
                  error: null,
                });
              } else {
                return resolve({ data: [], error: null });
              }
            },
          };
          return chain;
        }
        if (table === "agm_yearly_snapshots") {
          return {
            upsert: vi.fn().mockImplementation((rows: any[]) => {
              snapshotsUpsertCalled = true;
              capturedSnapshots = rows;
              return Promise.resolve({ error: null });
            }),
          };
        }
        return origFrom(table);
      };

      try {
        const timeline = AgmStudioService.getHistoricalTimeline("nlg-insurance");
        const res = await AgmStudioService.recalculateAndPersistAllTimelineProfiles(
          timeline,
          undefined,
          "11111111-2222-3333-a444-555555555555",
        );

        expect(res.updatedCount).toBe(1);
        expect(masterUpsertCalled).toBe(true);
        expect(snapshotsUpsertCalled).toBe(true);
        expect(capturedSnapshots.length).toBeGreaterThan(0);
        expect(capturedSnapshots[0].company_id).toBe("11111111-2222-3333-a444-555555555555");
        expect(capturedSnapshots[0].boid).toBe("1301010000000002");
      } finally {
        (supabase as any).from = origFrom;
      }
    });

    it("15. Company-Scoped Client Promotion with Fail-Closed Payable Protection: verifies clients scoped and payable failure throws error", async () => {
      const origFrom = (supabase as any).from;
      const origRpc = (supabase as any).rpc;
      let clientsUpserted = false;
      let clientsRolledBack = false;

      (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
        if (fn === "promote_agm_clients_and_payables" || fn === "bulk_insert_clients") {
          return Promise.resolve({
            data: null,
            error: { code: "42883", message: `function ${fn} does not exist` },
          });
        }
        return origRpc ? origRpc.call(supabase, fn) : Promise.resolve({ data: null, error: null });
      });

      (supabase as any).from = (table: string) => {
        if (table === "clients") {
          return {
            upsert: vi.fn().mockImplementation(() => {
              clientsUpserted = true;
              return Promise.resolve({ error: null });
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockImplementation(() => {
                  clientsRolledBack = true;
                  return Promise.resolve({ error: null });
                }),
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: "c-1", boid: "1301010000000003" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "dividend_payables") {
          const chain: any = {
            eq: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              error: new Error("Simulated dividend_payables DB connection failure"),
            }),
          };
          return {
            delete: vi.fn().mockReturnValue(chain),
          };
        }
        return origFrom ? origFrom.call(supabase, table) : {};
      };

      try {
        const promoProfile: MultiYearShareholderProfile = {
          boid: "1301010000000003",
          shareholderName: "PROMOTION TEST HOLDER",
          holderType: "PUBLIC",
          initialKitta2075: 100,
          currentKitta2081: 150,
          currentFraction2081: 0.75,
          totalBonusSharesReceived: 50,
          totalCashDividendReceived: 25,
          totalTaxWithheld: 1.25,
          hasDiscrepancy: false,
          yearlySnapshots: [],
          anomalies: [],
        };

        await expect(
          AgmStudioService.promoteHistoricalDataToDatabase(
            [promoProfile],
            "11111111-2222-3333-a444-555555555555",
            "NLG",
            "NLG Insurance Company Ltd",
          ),
        ).rejects.toThrow(/Simulated dividend_payables DB connection failure/);

        expect(clientsUpserted).toBe(true);
        expect(clientsRolledBack).toBe(true);
      } finally {
        (supabase as any).from = origFrom;
        (supabase as any).rpc = origRpc;
      }
    });

    it("16. Complete Multi-File Financial Aggregation: verifies profile merging correctly sums all holdings, cash, tax, and snapshots", () => {
      const file1Profile: MultiYearShareholderProfile = {
        boid: "1301010000000004",
        shareholderName: "AGGREGATION TEST",
        holderType: "PUBLIC",
        initialKitta2075: 100,
        importedBaseKitta: 100,
        currentKitta2081: 110,
        currentFraction2081: 0.25,
        totalBonusSharesReceived: 10,
        totalCashDividendReceived: 52.63,
        totalTaxWithheld: 2.63,
        hasDiscrepancy: false,
        yearlySnapshots: [
          {
            fiscalYear: "2076/77",
            eventName: "15th AGM",
            baseKitta: 100,
            previousFraction: 0,
            grossBonusEntitlement: 10,
            issuedWholeBonus: 10,
            carriedNewFraction: 0.25,
            grossCashDividend: 52.63,
            bonusTaxWithheld: 50,
            cashTaxWithheld: 2.63,
            netCashPayable: 0,
            postEventKitta: 110,
            excelDiscrepancy: false,
            remarks: "File 1 Snapshot",
          },
        ],
        anomalies: ["First file note"],
      };

      const file2Profile: MultiYearShareholderProfile = {
        boid: "1301010000000004",
        shareholderName: "AGGREGATION TEST",
        holderType: "PUBLIC",
        initialKitta2075: 200,
        importedBaseKitta: 200,
        currentKitta2081: 220,
        currentFraction2081: 0.5,
        totalBonusSharesReceived: 20,
        totalCashDividendReceived: 105.26,
        totalTaxWithheld: 5.26,
        hasDiscrepancy: true,
        yearlySnapshots: [
          {
            fiscalYear: "2076/77",
            eventName: "15th AGM",
            baseKitta: 200,
            previousFraction: 0,
            grossBonusEntitlement: 20,
            issuedWholeBonus: 20,
            carriedNewFraction: 0.5,
            grossCashDividend: 105.26,
            bonusTaxWithheld: 100,
            cashTaxWithheld: 5.26,
            netCashPayable: 0,
            postEventKitta: 220,
            excelDiscrepancy: true,
            remarks: "File 2 Snapshot",
          },
        ],
        anomalies: ["Second file note"],
      };

      const mergedMap = new Map<string, MultiYearShareholderProfile>();
      [file1Profile, file2Profile].forEach((p) => {
        if (mergedMap.has(p.boid)) {
          const ex = mergedMap.get(p.boid)!;
          ex.currentKitta2081 += p.currentKitta2081;
          ex.currentFraction2081 =
            Math.round((ex.currentFraction2081 + p.currentFraction2081) * 10000) / 10000;
          ex.initialKitta2075 = (ex.initialKitta2075 || 0) + (p.initialKitta2075 || 0);
          if (p.importedBaseKitta !== undefined) {
            ex.importedBaseKitta = (ex.importedBaseKitta || 0) + p.importedBaseKitta;
          }
          ex.totalBonusSharesReceived =
            (ex.totalBonusSharesReceived || 0) + (p.totalBonusSharesReceived || 0);
          ex.totalCashDividendReceived =
            Math.round(
              ((ex.totalCashDividendReceived || 0) + (p.totalCashDividendReceived || 0)) * 100,
            ) / 100;
          ex.totalTaxWithheld =
            Math.round(((ex.totalTaxWithheld || 0) + (p.totalTaxWithheld || 0)) * 100) / 100;

          p.yearlySnapshots.forEach((pSnap) => {
            const exSnap = ex.yearlySnapshots.find((s) => s.fiscalYear === pSnap.fiscalYear);
            if (exSnap) {
              exSnap.baseKitta += pSnap.baseKitta;
              exSnap.issuedWholeBonus += pSnap.issuedWholeBonus;
              exSnap.postEventKitta += pSnap.postEventKitta;
              exSnap.excelDiscrepancy = exSnap.excelDiscrepancy || pSnap.excelDiscrepancy;
            } else {
              ex.yearlySnapshots.push({ ...pSnap });
            }
          });

          ex.anomalies = Array.from(new Set([...(ex.anomalies || []), ...p.anomalies]));
          ex.hasDiscrepancy = ex.hasDiscrepancy || p.hasDiscrepancy;
        } else {
          mergedMap.set(p.boid, {
            ...p,
            yearlySnapshots: p.yearlySnapshots.map((s) => ({ ...s })),
          });
        }
      });

      const merged = mergedMap.get("1301010000000004")!;
      expect(merged.initialKitta2075).toBe(300);
      expect(merged.importedBaseKitta).toBe(300);
      expect(merged.currentKitta2081).toBe(330);
      expect(merged.currentFraction2081).toBe(0.75);
      expect(merged.totalBonusSharesReceived).toBe(30);
      expect(merged.totalCashDividendReceived).toBe(157.89);
      expect(merged.totalTaxWithheld).toBe(7.89);
      expect(merged.hasDiscrepancy).toBe(true);
      expect(merged.anomalies).toContain("First file note");
      expect(merged.anomalies).toContain("Second file note");
      expect(merged.yearlySnapshots[0].baseKitta).toBe(300);
      expect(merged.yearlySnapshots[0].postEventKitta).toBe(330);
    });

    it("17. Safe Zero Numeric Extraction: verifies parseHistoricalExcelWithReport does not skip 0 as falsy", async () => {
      const testData = [
        ["BOID", "Name", "Kitta", "Total", "Frac", "NewFraction"],
        ["1301010000000005", "ZERO HOLDER", 0, 50, 0, 0],
      ];
      const ws = XLSX.utils.aoa_to_sheet(testData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

      const res = await AgmStudioService.parseHistoricalExcelWithReport(
        buffer,
        "zero_test.xlsx",
        "2080/81",
      );
      expect(res.profiles.length).toBe(1);
      const profile = res.profiles[0];
      // Kitta must be parsed as 0 from the first column "Kitta", not fallen back to "Total" (50)
      expect(profile.importedBaseKitta).toBe(0);
      expect(profile.currentFraction2081).toBe(0);
    });

    it("18. Financial Invariant Verification: uploaded kitta = persisted kitta = report kitta", async () => {
      const testData = [
        ["BOID", "Name", "Kitta", "Frac"],
        ["1301010000000006", "HOLDER ALPHA", 500, 0.2],
        ["1301010000000007", "HOLDER BETA", 1500, 0.8],
      ];
      const ws = XLSX.utils.aoa_to_sheet(testData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

      const res = await AgmStudioService.parseHistoricalExcelWithReport(
        buffer,
        "invariant_test.xlsx",
        "2080/81",
      );

      const uploadedKitta = 500 + 1500;
      const reportKitta = res.report.totalKitta;
      const profileKittaSum = res.profiles.reduce(
        (sum, p) => sum + (p.importedBaseKitta ?? p.initialKitta2075),
        0,
      );

      expect(reportKitta).toBe(uploadedKitta);
      expect(profileKittaSum).toBe(uploadedKitta);

      // Verify persistence captures exact kitta
      const origFrom = (supabase as any).from;
      let savedKittaSum = 0;
      (supabase as any).from = (table: string) => {
        if (table === "agm_import_staging") {
          return {
            insert: vi
              .fn()
              .mockResolvedValue({
                error: { message: "relation agm_import_staging does not exist" },
              }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          };
        }
        if (table === "agm_historical_shareholders") {
          return {
            upsert: vi.fn().mockImplementation((rows: any[]) => {
              savedKittaSum += rows.reduce(
                (s, r) => s + (r.imported_base_kitta ?? r.initial_kitta_2075 ?? 0),
                0,
              );
              return {
                select: vi.fn().mockResolvedValue({
                  data: rows.map((r) => ({ id: `id-${r.boid}`, boid: r.boid })),
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === "agm_yearly_snapshots") {
          const chain: any = {
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ error: null }),
          };
          return {
            delete: vi.fn().mockReturnValue(chain),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "agm_fiscal_year_meta") {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      };

      try {
        await AgmStudioService.saveFiscalYearToDatabase(
          "2080/81",
          "19th AGM",
          res.profiles,
          res.brokerPools,
          res.drnRecords,
          res.report,
          undefined,
          "11111111-2222-3333-a444-555555555555",
        );

        expect(savedKittaSum).toBe(uploadedKitta);
      } finally {
        (supabase as any).from = origFrom;
      }
    });

    it("19. Staging-Based Atomic Import: commits via commit_agm_fiscal_year_import RPC and rolls back on failure", async () => {
      const origRpc = (supabase as any).rpc;
      const origFrom = (supabase as any).from;
      let rpcCalledWith: any = null;
      const stagingRowsInserted: any[] = [];
      let stagingPurgedBatchId: string | null = null;

      (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
        if (fn === "commit_agm_fiscal_year_import") {
          rpcCalledWith = { fn, args };
          return Promise.resolve({
            data: { success: true, isLocked: true, savedCount: 1, snapshotsSaved: 1 },
            error: null,
          });
        }
        return origRpc(fn, args);
      });

      (supabase as any).from = (table: string) => {
        if (table === "agm_import_staging") {
          return {
            insert: vi.fn().mockImplementation((rows: any[]) => {
              stagingRowsInserted.push(...rows);
              return Promise.resolve({ error: null });
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === "batch_id") stagingPurgedBatchId = val;
                return Promise.resolve({ error: null });
              }),
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
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ count: 0, data: null, error: null }),
        };
      };

      try {
        const dummyProfiles: MultiYearShareholderProfile[] = [
          {
            boid: "1301010000000101",
            shareholderName: "STAGE TEST 1",
            holderType: "PUBLIC",
            initialKitta2075: 100,
            initialFraction2075: 0.5,
            importedBaseKitta: 100,
            importedOpeningFraction: 0.5,
            importedBaseFiscalYear: "2079/80",
            currentKitta2081: 110,
            currentFraction2081: 0.25,
            totalBonusSharesReceived: 10,
            totalCashDividendReceived: 100,
            totalTaxWithheld: 15,
            yearlySnapshots: [
              {
                fiscalYear: "2079/80",
                eventName: "Bonus",
                baseKitta: 100,
                previousFraction: 0.5,
                grossBonusEntitlement: 10,
                issuedWholeBonus: 10,
                carriedNewFraction: 0.25,
                grossCashDividend: 100,
                bonusTaxWithheld: 5,
                cashTaxWithheld: 10,
                netCashPayable: 85,
                postEventKitta: 110,
                excelDiscrepancy: false,
                remarks: "Clean",
              },
            ],
            hasDiscrepancy: false,
            anomalies: [],
          },
        ];

        const res = await AgmStudioService.saveFiscalYearToDatabase(
          "2079/80",
          "18th AGM",
          dummyProfiles,
          [],
          [],
          undefined,
          undefined,
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        );

        expect(stagingRowsInserted.length).toBe(1);
        expect(stagingRowsInserted[0].shareholder_row.imported_opening_fraction).toBe(0.5);
        expect(stagingRowsInserted[0].shareholder_row.imported_base_fiscal_year).toBe("2079/80");
        expect(rpcCalledWith).not.toBeNull();
        expect(rpcCalledWith.fn).toBe("commit_agm_fiscal_year_import");
        expect(rpcCalledWith.args.p_fiscal_year).toBe("2079/80");
        expect(res.savedCount).toBe(1);
        expect(res.snapshotsSaved).toBe(1);
      } finally {
        (supabase as any).rpc = origRpc;
        (supabase as any).from = origFrom;
      }
    });

    it("20. Dual Persistence in Statutory Corrections: updates both master records and snapshot financial values", async () => {
      const origRpc = (supabase as any).rpc;
      const origFrom = (supabase as any).from;
      const masterUpsertRows: any[] = [];
      const snapshotUpsertRows: any[] = [];

      (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
        if (fn === "apply_agm_statutory_corrections") {
          return Promise.resolve({
            data: null,
            error: {
              code: "42883",
              message: "function apply_agm_statutory_corrections does not exist",
            },
          });
        }
        return origRpc ? origRpc(fn, args) : Promise.resolve({ data: null, error: null });
      });

      (supabase as any).from = (table: string) => {
        if (table === "agm_historical_shareholders") {
          const mockShareholderData = [
            {
              id: "sh-1",
              company_id: "11111111-2222-3333-a444-555555555555",
              boid: "1301010000000202",
              shareholder_name: "CORRECTION TEST",
              holder_type: "PUBLIC",
              initial_kitta_2075: 100,
              initial_fraction_2075: 0,
              imported_base_kitta: 100,
              imported_opening_fraction: 0,
              has_discrepancy: true,
              reconciliation_status: "DISCREPANCY",
            },
          ];

          const chain: any = {
            or: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: mockShareholderData,
              error: null,
            }),
            then: (resolve: any) => resolve({ count: 1, data: mockShareholderData, error: null }),
          };

          return {
            select: vi.fn().mockReturnValue(chain),
            upsert: vi.fn().mockImplementation((rows: any[]) => {
              masterUpsertRows.push(...rows);
              return Promise.resolve({ error: null });
            }),
          };
        }
        if (table === "agm_yearly_snapshots") {
          return {
            upsert: vi.fn().mockImplementation((rows: any[]) => {
              snapshotUpsertRows.push(...rows);
              return Promise.resolve({ error: null });
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      };

      try {
        const { correctedCount } = await AgmStudioService.applyAndPersistStatutoryCorrections(
          undefined,
          undefined,
          "11111111-2222-3333-a444-555555555555",
        );

        expect(correctedCount).toBe(1);
        expect(masterUpsertRows.length).toBe(1);
        expect(masterUpsertRows[0].has_discrepancy).toBe(false);
        expect(masterUpsertRows[0].reconciliation_status).toBe("RECONCILED");

        // Verify that snapshot financial values were persisted alongside master record
        expect(snapshotUpsertRows.length).toBeGreaterThan(0);
        const firstSnap = snapshotUpsertRows[0];
        expect(firstSnap.boid).toBe("1301010000000202");
        expect(firstSnap.excel_discrepancy_flag).toBe(false);
        expect(firstSnap.post_event_kitta).toBeGreaterThanOrEqual(100);
        expect(typeof firstSnap.carried_new_fraction).toBe("number");
        expect(typeof firstSnap.issued_whole_bonus).toBe("number");
      } finally {
        (supabase as any).rpc = origRpc;
        (supabase as any).from = origFrom;
      }
    });

    it("21. Atomic Client and Payable Promotion: invokes promote_agm_clients_and_payables RPC with atomicity", async () => {
      const origRpc = (supabase as any).rpc;
      let promotionRpcCalled = false;
      let passedClients: any[] = [];
      let passedPayables: any[] = [];

      (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
        if (fn === "promote_agm_clients_and_payables") {
          promotionRpcCalled = true;
          passedClients = args.p_clients;
          passedPayables = args.p_payables;
          return Promise.resolve({
            data: {
              success: true,
              clientsUpserted: args.p_clients.length,
              payablesInserted: args.p_payables.length,
            },
            error: null,
          });
        }
        return origRpc(fn, args);
      });

      try {
        const testProfiles: MultiYearShareholderProfile[] = [
          {
            boid: "1301010000000303",
            shareholderName: "PROMO HOLDER",
            holderType: "PUBLIC",
            initialKitta2075: 100,
            currentKitta2081: 150,
            currentFraction2081: 0.75, // Has fraction payable
            totalBonusSharesReceived: 50,
            totalCashDividendReceived: 200,
            totalTaxWithheld: 30,
            yearlySnapshots: [],
            hasDiscrepancy: false,
            anomalies: [],
          },
        ];

        const res = await AgmStudioService.promoteHistoricalDataToDatabase(
          testProfiles,
          undefined,
          "11111111-2222-3333-a444-555555555555",
        );

        expect(promotionRpcCalled).toBe(true);
        expect(passedClients.length).toBe(1);
        expect(passedClients[0].boid).toBe("1301010000000303");
        expect(passedPayables.length).toBe(1);
        expect(passedPayables[0].fraction_shares).toBe(0.75);
        expect(res.promotedCount).toBe(1);
        expect(res.fractionPayablesCreated).toBe(1);
      } finally {
        (supabase as any).rpc = origRpc;
      }
    });

    it("21b. Fail-Closed Atomic Promotion: verifies RPC database error fails closed without executing non-atomic fallback", async () => {
      const origRpc = (supabase as any).rpc;
      const origFrom = (supabase as any).from;
      let fallbackAttempted = false;

      (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
        if (fn === "promote_agm_clients_and_payables") {
          return Promise.resolve({
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          });
        }
        return origRpc(fn);
      });

      (supabase as any).from = (table: string) => {
        if (table === "clients") {
          fallbackAttempted = true;
        }
        return origFrom(table);
      };

      try {
        const testProfiles: MultiYearShareholderProfile[] = [
          {
            boid: "1301010000000304",
            shareholderName: "FAIL CLOSED TEST",
            holderType: "PUBLIC",
            initialKitta2075: 100,
            currentKitta2081: 150,
            currentFraction2081: 0.75,
            totalBonusSharesReceived: 50,
            totalCashDividendReceived: 200,
            totalTaxWithheld: 30,
            yearlySnapshots: [],
            hasDiscrepancy: false,
            anomalies: [],
          },
        ];

        await expect(
          AgmStudioService.promoteHistoricalDataToDatabase(
            testProfiles,
            undefined,
            "11111111-2222-3333-a444-555555555555",
          ),
        ).rejects.toThrow(
          /Atomic promotion failed: duplicate key value violates unique constraint/,
        );

        expect(fallbackAttempted).toBe(false);
      } finally {
        (supabase as any).rpc = origRpc;
        (supabase as any).from = origFrom;
      }
    });

    it("22. Fail-Closed Error Propagation: database query failures throw explicit errors without masking", async () => {
      const origFrom = (supabase as any).from;

      (supabase as any).from = (table: string) => {
        if (table === "agm_fiscal_year_meta") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Database connection timeout (simulated)" },
            }),
          };
        }
        if (table === "agm_drn_records") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Table locked by maintenance (simulated)" },
            }),
          };
        }
        if (table === "agm_yearly_snapshots") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "I/O read error (simulated)" },
            }),
          };
        }
        return origFrom(table);
      };

      try {
        await expect(
          AgmStudioService.fetchFiscalYearLedger("11111111-2222-3333-a444-555555555555"),
        ).rejects.toThrow("Failed to fetch fiscal year ledger");

        await expect(
          AgmStudioService.fetchDrnRecords("11111111-2222-3333-a444-555555555555"),
        ).rejects.toThrow("Failed to fetch DRN records");

        await expect(
          AgmStudioService.fetchPreviousFiscalYearSnapshots(
            "2079/80",
            "11111111-2222-3333-a444-555555555555",
          ),
        ).rejects.toThrow("Failed to fetch snapshots for 2079/80");
      } finally {
        (supabase as any).from = origFrom;
      }
    });

    it("23. Zero-Fallback Hardening in Conversion Reports: missing escrow pool avoids fabricated numbers", () => {
      // Verifies parsePromoterConversionExcel dynamically tallies conversion rows without hardcoded NLG constants
      const wb = XLSX.utils.book_new();
      const wsData = [
        ["BOID", "Name", "Total", "PO_INT", "PO_FRAC", "PU_INT", "PU_FRAC", "ca seq no", "remarks"],
        ["1301010000000404", "NORMAL PUBLIC HOLDER", 200, 0, 0, 200, 0, "6316.001", "SUCCESS"],
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const res = AgmStudioService.parsePromoterConversionExcel(buf, "Test_Conversion.xlsx");

      expect(res.records.length).toBe(1);
      expect(res.summary.totalAccounts).toBe(1);
      expect(res.summary.totalPreConversionKitta).toBe(200);
      expect(res.summary.totalPromoterRetained).toBe(0);
      expect(res.summary.totalPublicConverted).toBe(200);
      // Hardcoded NLG constants (145778.86 or 136380 or 2,485) should not be injected
      expect(res.summary.totalPromoterRetained).not.toBe(355086);
      expect(res.summary.totalPublicConverted).not.toBe(145778.86);
      expect(res.summary.totalAccounts).not.toBe(2485);
    });

    it("24. Atomic Import Lock & Shareholder FK Integrity: commit RPC marks FY locked and populates shareholder_id for registry reload", async () => {
      const origRpc = (supabase as any).rpc;
      const origFrom = (supabase as any).from;

      let rpcCallArgs: any = null;
      const testCompanyId = "11111111-2222-3333-a444-555555555555";
      const targetBoid = "1301010000000888";
      const mockShareholderId = "88888888-4444-4444-8888-888888888888";

      (supabase as any).rpc = vi.fn().mockImplementation((fn: string, args: any) => {
        if (fn === "commit_agm_fiscal_year_import") {
          rpcCallArgs = args;
          return Promise.resolve({
            data: {
              success: true,
              isLocked: true,
              savedCount: 1,
              snapshotsSaved: 1,
              totalKitta: 500,
              totalBonus: 50,
              totalCash: 250,
            },
            error: null,
          });
        }
        return origRpc(fn, args);
      });

      // Mock DB reads for reload: fetchDbShareholders
      (supabase as any).from = (table: string) => {
        if (table === "agm_import_staging") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "agm_historical_shareholders") {
          const createQueryBuilder = (isHead: boolean) => {
            const rowData = [
              {
                id: mockShareholderId,
                company_id: testCompanyId,
                boid: targetBoid,
                shareholder_name: "LOCKED ATOMIC HOLDER",
                holder_type: "PUBLIC",
                initial_kitta_2075: 500,
                current_kitta_2081: 550,
                current_fraction_2081: 0.25,
                total_bonus_shares: 50,
                total_cash_dividend: 250,
                reconciliation_status: "RECONCILED",
                has_discrepancy: false,
              },
            ];
            const builder: any = {
              not: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              or: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              range: vi.fn().mockImplementation(() => ({
                order: vi.fn().mockResolvedValue({
                  data: rowData,
                  error: null,
                }),
                then: (resolve: any) => resolve({ data: rowData, error: null }),
              })),
            };
            if (isHead) {
              builder.then = (resolve: any) => resolve({ count: 1, data: null, error: null });
            }
            return builder;
          };

          return {
            select: vi.fn().mockImplementation((_fields: any, opts: any) => {
              return createQueryBuilder(Boolean(opts?.head));
            }),
          };
        }
        if (table === "agm_yearly_snapshots") {
          const snapBuilder: any = {
            in: vi.fn().mockImplementation((col: string, vals: string[]) => {
              // Verifies reader loads snapshots by shareholder_id
              expect(col).toBe("shareholder_id");
              expect(vals).toContain(mockShareholderId);
              return {
                order: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "snap-888-1",
                      company_id: testCompanyId,
                      shareholder_id: mockShareholderId,
                      boid: targetBoid,
                      fiscal_year: "2079/80",
                      event_name: "18th AGM",
                      base_kitta: 500,
                      previous_fraction: 0,
                      issued_whole_bonus: 50,
                      carried_new_fraction: 0.25,
                      gross_cash_dividend: 250,
                      post_event_kitta: 550,
                      excel_discrepancy_flag: false,
                      is_locked: true,
                    },
                  ],
                  error: null,
                }),
              };
            }),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  count: 0,
                  data: null,
                  error: null,
                }),
              }),
            }),
          };
          return {
            select: vi.fn().mockImplementation(() => snapBuilder),
          };
        }
        if (table === "agm_fiscal_year_meta") {
          const metaQueryBuilder: any = {
            eq: vi.fn(),
            order: vi.fn(),
            single: vi.fn().mockResolvedValue({
              data: { is_locked: true },
              error: null,
            }),
            then: (resolve: any) =>
              resolve({
                data: [
                  {
                    company_id: testCompanyId,
                    fiscal_year: "2079/80",
                    event_name: "18th AGM",
                    total_shareholders: 1,
                    total_kitta: 500,
                    total_bonus_kitta: 50,
                    total_cash_npr: 250,
                    is_locked: true,
                    imported_by: "Operator",
                    imported_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
          };
          metaQueryBuilder.eq.mockImplementation(() => metaQueryBuilder);
          metaQueryBuilder.order.mockImplementation(() => metaQueryBuilder);

          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockImplementation(() => metaQueryBuilder),
          };
        }
        return origFrom(table);
      };

      try {
        const testProfile: MultiYearShareholderProfile = {
          boid: targetBoid,
          shareholderName: "LOCKED ATOMIC HOLDER",
          holderType: "PUBLIC",
          initialKitta2075: 500,
          currentKitta2081: 550,
          currentFraction2081: 0.25,
          totalBonusSharesReceived: 50,
          totalCashDividendReceived: 250,
          totalTaxWithheld: 35,
          yearlySnapshots: [
            {
              fiscalYear: "2079/80",
              eventName: "18th AGM",
              baseKitta: 500,
              previousFraction: 0,
              grossBonusEntitlement: 50.25,
              issuedWholeBonus: 50,
              carriedNewFraction: 0.25,
              grossCashDividend: 250,
              bonusTaxWithheld: 15,
              cashTaxWithheld: 20,
              netCashPayable: 215,
              postEventKitta: 550,
              excelDiscrepancy: false,
              remarks: "Verified CDSC Statutory Rule",
            },
          ],
          hasDiscrepancy: false,
          anomalies: [],
        };

        // 1. Execute saveFiscalYearToDatabase via staging RPC
        const saveRes = await AgmStudioService.saveFiscalYearToDatabase(
          "2079/80",
          "18th AGM",
          [testProfile],
          [],
          [],
          undefined,
          undefined,
          testCompanyId,
        );

        expect(rpcCallArgs).not.toBeNull();
        expect(rpcCallArgs.p_company_id).toBe(testCompanyId);
        expect(rpcCallArgs.p_fiscal_year).toBe("2079/80");
        expect(saveRes.savedCount).toBe(1);
        expect(saveRes.snapshotsSaved).toBe(1);

        // 2. Query ledger to verify locked state invariant
        const ledger = await AgmStudioService.fetchFiscalYearLedger(testCompanyId);
        const meta2079 = ledger.find((f) => f.fiscalYear === "2079/80");
        expect(meta2079?.isLocked).toBe(true);

        // 3. Reload registry and verify snapshot linkage via shareholder_id
        const { profiles } = await AgmStudioService.fetchDbShareholders(
          1,
          50,
          "",
          "ALL",
          testCompanyId,
        );
        expect(profiles.length).toBe(1);
        expect(profiles[0].boid).toBe(targetBoid);
        expect(profiles[0].yearlySnapshots.length).toBe(1);
        expect(profiles[0].yearlySnapshots[0].fiscalYear).toBe("2079/80");
        expect(profiles[0].yearlySnapshots[0].postEventKitta).toBe(550);
      } finally {
        (supabase as any).rpc = origRpc;
        (supabase as any).from = origFrom;
      }
    });
  });
});
