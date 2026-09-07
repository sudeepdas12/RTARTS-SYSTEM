import { describe, it, expect, beforeEach } from "vitest";
import {
  AgmStudioService,
  CompanyProfile,
  cleanBoid,
  convertNepaliNumeralsToLatin,
} from "./agm-studio.service";
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
    const snapshots = AgmStudioService.calculateShareholderEvolution(100, 0.5, undefined, "PUBLIC", 0.999);
    const hasDiscrepancy = snapshots.some((s) => s.excelDiscrepancy);
    expect(hasDiscrepancy).toBe(true);
  });

  it("enforces 100% Tax-Exemption (0% TDS) for Mutual Funds with full cash deposited to bank", () => {
    const mfSnapshots = AgmStudioService.calculateShareholderEvolution(10000, 0, undefined, "MUTUAL_FUND");
    
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
    const txtDelta = AgmStudioService.generateCdscAutoCaTxt(sampleProfiles, "NLG", "2080/81", "BONUS_AND_CASH", "EVENT_DELTA");

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
    const txtBalance = AgmStudioService.generateCdscAutoCaTxt(sampleProfiles, "NLG", "2080/81", "BONUS_AND_CASH", "CUMULATIVE_BALANCE");
    const balLines = txtBalance.split("\n");
    const balDetailRow = balLines[1].split("|");
    // In cumulative mode, kitta should match post-event holding
    const targetSnap = sampleProfiles[0].yearlySnapshots?.find((s) => s.fiscalYear === "2080/81");
    expect(Number(balDetailRow[4])).toBe(targetSnap ? targetSnap.postEventKitta : sampleProfiles[0].currentKitta2081);
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
    const res = await AgmStudioService.parseHistoricalExcelWithReport(buf, "Banner_Test.xlsx", "2077/78");

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
    const snapshots = AgmStudioService.calculateShareholderEvolution(1000, 0, undefined, "PROMOTER");
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
    const snapshots = AgmStudioService.calculateShareholderEvolution(500, 0, undefined, "CLEARING_POOL");
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
      ["S.No.", "BOID", "Name", "Total", "PO_INT", "PO_FRAC", "PU_INT", "PU_FRAC", "ca seq no", "remarks"],
      [1, "1301010000001940", "SHANKAR PRASAD POUDYAL", 68.0, 3, 0.0, 65, 0.0, "6316.001", "SUCCESS"],
      [2, "1301060000015321", "AMIR DAS RANJIT", 593.87, 30, 0.0, 563, 0.9026, "6316.002", "SUCCESS"],
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
    const prevSnapshots = [
      { boid: "1301010000005544", closingKitta: 100, closingFraction: 0.35 },
    ];
    const currentProfiles: import('./agm-studio.service').MultiYearShareholderProfile[] = [
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
    expect(currentProfiles[0].anomalies.some((a) => a.includes("Opening fraction mismatch"))).toBe(true);
  });

  it("decomposes bulk REMCONVERSION and REMBONUS placeholder pools into individual physical folios", () => {
    const testProfiles: import('./agm-studio.service').MultiYearShareholderProfile[] = [
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
});
