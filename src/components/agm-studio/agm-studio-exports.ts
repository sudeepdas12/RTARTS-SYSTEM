import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  AgmStudioService,
  type CompanyProfile,
  type HistoricalFiscalYearConfig,
  type MultiYearShareholderProfile,
  type PhysicalDrnRecord,
  type PromoterConversionRecord,
} from "@/lib/services/agm-studio.service";
import { IafGeneratorService } from "@/lib/services/iaf-generator.service";

export interface AgmStudioExportContext {
  activeCompany: CompanyProfile;
  activeCompanyId: string;
  dataSourceMode: "MEMORY" | "DATABASE";
  parsedProfiles: MultiYearShareholderProfile[];
  activeProfiles: MultiYearShareholderProfile[];
  timeline: HistoricalFiscalYearConfig[];
  wizardTargetFy: string;
  drnList: PhysicalDrnRecord[];
  conversionRecords: PromoterConversionRecord[];
  selectedCdscFy: string;
}

export interface DecompositionScheduleRow {
  folioNo: string;
  holderName: string;
  fatherName: string;
  address: string;
  baseKitta: number;
  fromRemConversion: number;
  fromRemBonus: number;
  totalClosingKitta: number;
  grossCash: number;
  netCash: number;
}

export interface RemPoolSummary {
  remConvKitta: number;
  remConvCash: number;
  remBonusKitta: number;
}

async function resolveExportProfiles(
  ctx: AgmStudioExportContext,
  loadingMessage: string,
  withProgress = false,
): Promise<MultiYearShareholderProfile[]> {
  let listToExport = ctx.parsedProfiles;
  if (ctx.dataSourceMode === "DATABASE" || listToExport.length === 0) {
    const toastId = toast.loading(loadingMessage);
    listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase(
      withProgress
        ? (fetched, total) => {
            toast.loading(
              `Querying database: ${fetched.toLocaleString()} / ${total.toLocaleString()}...`,
              { id: toastId },
            );
          }
        : undefined,
      ctx.activeCompanyId,
    );
    toast.dismiss(toastId);
  }
  return listToExport;
}

function dispersePoolsIfNeeded(
  listToExport: MultiYearShareholderProfile[],
): MultiYearShareholderProfile[] {
  const dispersalRes = AgmStudioService.disperseBulkConversionAndBonusPools(listToExport);
  if (
    dispersalRes.dispersedPoolsCount > 0 ||
    listToExport.length !== dispersalRes.expandedProfiles.length
  ) {
    return dispersalRes.expandedProfiles;
  }
  return listToExport;
}

export async function downloadCdscAutoCaTxt(ctx: AgmStudioExportContext) {
  let listToExport = await resolveExportProfiles(
    ctx,
    "Querying complete database records for CDSC TXT file...",
  );
  listToExport = dispersePoolsIfNeeded(listToExport);
  const targetEvent = ctx.timeline.find((t) => t.fiscalYear === ctx.selectedCdscFy);
  const eventType = targetEvent ? targetEvent.eventType : "BONUS_AND_CASH";
  const content = AgmStudioService.generateCdscAutoCaTxt(
    listToExport,
    ctx.activeCompany.code || "NLG",
    ctx.selectedCdscFy,
    eventType,
  );
  const fileName = `CDSC_AUTO_CA_${ctx.activeCompany.code || "NLG"}_${ctx.selectedCdscFy.replace("/", "_")}.TXT`;
  IafGeneratorService.downloadFile(content, fileName, "text/plain");
  toast.success(
    `Downloaded CDSC Auto-CA Batch File (.TXT) for FY ${ctx.selectedCdscFy} with ${listToExport.length.toLocaleString()} records.`,
  );
}

export async function downloadChronologicalLedgerWorkbook(ctx: AgmStudioExportContext) {
  let listToExport = await resolveExportProfiles(
    ctx,
    "Querying complete database for chronological ledger...",
    true,
  );
  listToExport = dispersePoolsIfNeeded(listToExport);
  const fileName = `${ctx.activeCompany.code || "COMPANY"}_Chronological_Shareholder_Lifecycle.xlsx`;
  AgmStudioService.exportChronologicalLedger(
    listToExport,
    ctx.activeCompany.name,
    fileName,
    ctx.timeline,
  );
  toast.success(
    `Downloaded Chronological Ledger (.xlsx) with ${listToExport.length.toLocaleString()} records.`,
  );
}

export async function downloadMasterAgmWorkbook(ctx: AgmStudioExportContext) {
  let listToExport = await resolveExportProfiles(
    ctx,
    "Querying complete historical database records for export...",
    true,
  );
  listToExport = dispersePoolsIfNeeded(listToExport);

  const fileName = `${ctx.activeCompany.code || "COMPANY"}_AGM_MultiYear_Reconciliation_Ledger.xlsx`;
  AgmStudioService.exportAgmWorkbook(
    listToExport,
    ctx.activeCompany.name,
    fileName,
    ctx.timeline,
    ctx.wizardTargetFy,
    ctx.drnList,
  );
  toast.success(
    `Downloaded Multi-Year AGM Reconciliation Workbook (.xlsx) with ${listToExport.length.toLocaleString()} records.`,
  );
}

export async function downloadMutualFundsWorkbook(ctx: AgmStudioExportContext) {
  const listToExport = await resolveExportProfiles(
    ctx,
    "Querying database for Mutual Funds records...",
  );
  const mfOnly = listToExport.filter((p) => p.holderType === "MUTUAL_FUND");
  if (mfOnly.length === 0) {
    toast.info("No Mutual Fund accounts found in current dataset.");
    return;
  }
  const fileName = `${ctx.activeCompany.code || "COMPANY"}_Tax_Exempt_Mutual_Funds_0_TDS.xlsx`;
  AgmStudioService.exportMutualFundsExcel(listToExport, ctx.activeCompany.name, fileName);
  toast.success(
    `Exported Tax-Exempt Mutual Funds Statement (.xlsx) with ${mfOnly.length} schemes.`,
  );
}

export async function downloadDrnLedgerWorkbook(ctx: AgmStudioExportContext) {
  const records = ctx.drnList.length > 0 ? ctx.drnList : AgmStudioService.getPhysicalDrnRecords();
  const fileName = `${ctx.activeCompany.code || "COMPANY"}_Physical_Folio_DRN_Dematerialisation_Ledger.xlsx`;
  AgmStudioService.exportDrnExcel(records, ctx.activeCompany.name, fileName);
  toast.success(
    `Exported Physical DRN Dematerialisation Ledger (.xlsx) with ${records.length} folios.`,
  );
}

export async function downloadFySummaryWorkbook(ctx: AgmStudioExportContext) {
  let listToExport = await resolveExportProfiles(ctx, "Querying database for Multi-FY Summary...");
  listToExport = dispersePoolsIfNeeded(listToExport);
  const fileName = `${ctx.activeCompany.code || "COMPANY"}_MultiYear_Statutory_Fiscal_Summary.xlsx`;
  AgmStudioService.exportFySummaryExcel(
    listToExport,
    ctx.timeline,
    ctx.activeCompany.name,
    fileName,
  );
  toast.success(`Exported Multi-Year Fiscal Action Summary Report (.xlsx).`);
}

export async function downloadAgmSpecificWorkbook(ctx: AgmStudioExportContext, targetFy: string) {
  const listToExport = await resolveExportProfiles(
    ctx,
    `Querying database records for ${targetFy}...`,
  );
  const cleanFy = targetFy.replace("FY ", "").trim();
  const fileName = `${ctx.activeCompany.code || "COMPANY"}_${cleanFy.replace("/", "-")}_Promoter_and_Public.xlsx`;
  AgmStudioService.exportAgmSpecificWorkbook(
    listToExport,
    targetFy,
    ctx.activeCompany.name,
    fileName,
    ctx.timeline,
  );
  toast.success(
    `Exported ${targetFy} Promoter & Public Ledger (.xlsx) with ${listToExport.length.toLocaleString()} records.`,
  );
}

export async function exportShareholderRegistryWorkbook(ctx: AgmStudioExportContext) {
  let listToExport = await resolveExportProfiles(
    ctx,
    "Querying all historical database records for export...",
    true,
  );
  listToExport = dispersePoolsIfNeeded(listToExport);
  if (listToExport.length === 0) {
    toast.error("No shareholder records to export.");
    return;
  }
  const wb = XLSX.utils.book_new();
  const headers = [
    "S.N.",
    "BOID / Folio",
    "Shareholder Name",
    "Father's Name",
    "Grandfather's Name",
    "Guardian Name",
    "Spouse Name",
    "Citizenship No",
    "PAN No",
    "District",
    "Contact No",
    "Email",
    "Bank Name",
    "Bank Account No",
    "Holder Type",
    "Opening Base Kitta (2075/76)",
    "Opening Fraction (2075/76)",
    "Right Shares Subscribed (62.56%)",
    "Total Bonus Shares Issued",
    "Closing Kitta (2080/81)",
    "Closing Carried Fraction",
    "Total Gross Cash Dividend (NPR)",
    "Total Tax Withheld (Statutory TDS)",
    "Net Cash Payable (NPR)",
    "Account Classification",
    "Audit & Statutory Status",
  ];
  const rows = listToExport.map((p, idx) => {
    let rightShares: number;
    if (p.yearlySnapshots && p.yearlySnapshots.length > 0) {
      rightShares = p.yearlySnapshots.reduce((s, snap) => s + (snap.rightSharesAllotted || 0), 0);
    } else {
      const diff = p.currentKitta2081 - (p.initialKitta2075 + p.totalBonusSharesReceived);
      rightShares = diff > 0 ? diff : 0;
    }

    const netCash = Math.round((p.totalCashDividendReceived - p.totalTaxWithheld) * 100) / 100;

    let accountClass = "Active Equity Shareholder";
    if (
      p.initialKitta2075 === 0 &&
      p.currentKitta2081 === 0 &&
      (p.currentFraction2081 > 0 || (p.initialFraction2075 || 0) > 0)
    ) {
      accountClass = "Fractional-Only Holding (Residual Kaser / Non-Whole Share)";
    } else if (p.holderType === "MUTUAL_FUND") {
      accountClass = "Mutual Fund (0% TDS Tax-Exempt)";
    } else if (p.holderType === "PROMOTER") {
      accountClass = "Promoter Equity Shareholder";
    }

    return [
      idx + 1,
      p.boid,
      p.shareholderName,
      p.fatherName || "",
      p.grandfatherName || "",
      p.guardianName || "",
      p.spouseName || "",
      p.citizenshipNo || "",
      p.panNo || "",
      p.district || "",
      p.contactNo || "",
      p.email || "",
      p.bankName || "",
      p.bankAccountNo || "",
      p.holderType,
      p.initialKitta2075,
      p.initialFraction2075 ? Number(p.initialFraction2075.toFixed(4)) : 0,
      rightShares,
      p.totalBonusSharesReceived,
      p.currentKitta2081,
      Number(p.currentFraction2081.toFixed(4)),
      p.totalCashDividendReceived,
      p.totalTaxWithheld,
      netCash,
      accountClass,
      p.hasDiscrepancy ? "Excel Variance Corrected (CDSC Linear)" : "Matched Statutory",
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([
    [`${ctx.activeCompany.name.toUpperCase()} — SHAREHOLDER MULTI-YEAR EVOLUTION REGISTRY`],
    [
      `Generated: ${new Date().toLocaleString()} | Total Accounts: ${listToExport.length.toLocaleString()}`,
    ],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Shareholder_Registry");
  XLSX.writeFile(wb, `${ctx.activeCompany.code}_Shareholder_Evolution_Registry.xlsx`);
  toast.success(`Exported ${listToExport.length.toLocaleString()} shareholder records to Excel!`);
}

export function exportDiscrepancyAuditWorkbook(ctx: AgmStudioExportContext) {
  const list = ctx.activeProfiles.filter((p) => p.hasDiscrepancy);
  if (list.length === 0) {
    toast.info("No discrepancy records found to export.");
    return;
  }
  const wb = XLSX.utils.book_new();
  const headers = [
    "S.N.",
    "BOID / Folio",
    "Shareholder Name",
    "Holder Type",
    "Base Kitta",
    "Carried Fraction (CDSC)",
    "Total Bonus Shares",
    "Total Cash Dividend (NPR)",
    "Audit Finding / Resolution",
  ];
  const rows = list.map((p, idx) => [
    idx + 1,
    p.boid,
    p.shareholderName,
    p.holderType,
    p.initialKitta2075,
    p.currentFraction2081,
    p.totalBonusSharesReceived,
    p.totalCashDividendReceived,
    p.anomalies.join(" | ") || "Excel manual compounding variance sanitized to CDSC rule.",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    [`${ctx.activeCompany.name.toUpperCase()} — FORENSIC EXCEL DISCREPANCY & AUDIT REPORT`],
    [
      `Generated: ${new Date().toLocaleString()} | Total Flagged Accounts: ${list.length.toLocaleString()}`,
    ],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Discrepancy_Audit");
  XLSX.writeFile(wb, `${ctx.activeCompany.code}_Forensic_Discrepancy_Audit.xlsx`);
  toast.success(`Exported ${list.length.toLocaleString()} discrepancy records to Excel!`);
}

export function exportConversionReportWorkbook(ctx: AgmStudioExportContext) {
  const sourceList = ctx.parsedProfiles.length > 0 ? ctx.parsedProfiles : ctx.activeProfiles;
  const list = sourceList.filter(
    (p) =>
      p.convertedShares ||
      p.isConversionMerged ||
      p.anomalies.some((a) => a.includes("CA 6316") || a.includes("conversion")),
  );
  if (list.length === 0 && ctx.conversionRecords.length > 0) {
    const wb = XLSX.utils.book_new();
    const headers = [
      "S.N.",
      "BOID / Folio",
      "Shareholder Name",
      "Pre-Conv Total",
      "Promoter Retained (Whole)",
      "Promoter Retained (Frac)",
      "Public Converted (Whole)",
      "Public Converted (Frac)",
      "Fraction Remainder",
      "CA Seq No",
      "Status",
    ];
    const rows = ctx.conversionRecords.map((r, idx) => [
      idx + 1,
      r.boidOrFolio,
      r.holderName,
      r.preConversionTotal,
      r.promoterRetainedInt,
      r.promoterRetainedFrac,
      r.publicConvertedInt,
      r.publicConvertedFrac,
      r.fractionRemainder,
      r.caSeqNo,
      r.status,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      [
        `${ctx.activeCompany.name.toUpperCase()} — CA 6316 PROMOTER-TO-PUBLIC CONVERSION RECONCILIATION REPORT`,
      ],
      [`Total Converted Accounts: ${ctx.conversionRecords.length.toLocaleString()}`],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "CA6316_Conversion_List");
    XLSX.writeFile(wb, `${ctx.activeCompany.code}_CA6316_Conversion_Reconciliation.xlsx`);
    toast.success(
      `Exported ${ctx.conversionRecords.length.toLocaleString()} conversion records to Excel!`,
    );
    return;
  }
  if (list.length === 0) {
    toast.info("No CA 6316 conversion records found to export.");
    return;
  }
  const wb = XLSX.utils.book_new();
  const headers = [
    "S.N.",
    "BOID / Folio",
    "Shareholder Name",
    "Active Classification",
    "Active Public Base Kitta",
    "Promoter Converted Shares",
    "Bonus Issued (10%)",
    "Gross Cash Dividend (NPR)",
    "Audit & Traceability",
  ];
  const rows = list.map((p, idx) => {
    const snap =
      p.yearlySnapshots.find((s) => s.fiscalYear === ctx.wizardTargetFy) || p.yearlySnapshots[0];
    return [
      idx + 1,
      p.boid,
      p.shareholderName,
      p.holderType,
      p.initialKitta2075,
      snap?.convertedShares || 0,
      snap?.issuedWholeBonus || 0,
      snap?.grossCashDividend || 0,
      p.anomalies.find((a) => a.includes("CA 6316")) ||
        "CA 6316 Promoter-to-Public conversion segregated",
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([
    [
      `${ctx.activeCompany.name.toUpperCase()} — CA 6316 PROMOTER-TO-PUBLIC CONVERSION RECONCILIATION REPORT`,
    ],
    [
      `Target Fiscal Year: ${ctx.wizardTargetFy} | Total Converted Accounts: ${list.length.toLocaleString()}`,
    ],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "CA6316_Conversion_List");
  XLSX.writeFile(wb, `${ctx.activeCompany.code}_CA6316_Conversion_Reconciliation.xlsx`);
  toast.success(`Exported ${list.length.toLocaleString()} CA 6316 conversion records to Excel!`);
}

export function exportShareholderJourneyWorkbook(
  p: MultiYearShareholderProfile,
  ctx: Pick<AgmStudioExportContext, "activeCompany" | "timeline">,
) {
  const wb = XLSX.utils.book_new();
  const headers = [
    "Fiscal Year",
    "Corporate Event Name",
    "Base Kitta",
    "Converted Shares (CA 6316)",
    "Right Shares Allotted",
    "Previous Fraction",
    "Issued Whole Bonus",
    "Carried New Fraction",
    "Gross Cash Div (NPR)",
    "Bonus Tax Withheld",
    "Cash Tax Withheld",
    "Net Cash Payable",
    "Post-Event Kitta",
    "Escrow / Demat Status",
    "Audit Finding",
  ];
  const snapshots =
    p.yearlySnapshots && p.yearlySnapshots.length > 0
      ? p.yearlySnapshots
      : AgmStudioService.calculateShareholderEvolution(
          p.trueInitialKitta2075 || p.initialKitta2075 || p.currentKitta2081 || 0,
          p.initialFraction2075 || 0,
          ctx.timeline,
          p.holderType,
          undefined,
          ctx.timeline[0]?.fiscalYear,
          (p as any).convertedShares,
        );

  const rows = snapshots.map((s) => [
    s.fiscalYear,
    s.eventName,
    s.baseKitta,
    s.convertedShares || 0,
    s.rightSharesAllotted || 0,
    s.previousFraction,
    s.issuedWholeBonus,
    s.carriedNewFraction,
    s.grossCashDividend,
    s.bonusTaxWithheld,
    s.cashTaxWithheld,
    s.netCashPayable,
    s.postEventKitta,
    p.boid === "REMCONVERSION" || p.boid === "REMBONUSFY20767778"
      ? "REM_ESCROW_POOL"
      : p.originalFolioNo
        ? `DEMATTED_FROM_${p.originalFolioNo}`
        : p.boid.length < 16
          ? "PHYSICAL_FOLIO"
          : "DIRECT_DEMAT",
    s.excelDiscrepancy ? "Excel variance sanitized" : "Statutory CDSC verified",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    [`${ctx.activeCompany.name.toUpperCase()} — SHAREHOLDER 360° HISTORICAL EVOLUTION JOURNEY`],
    [
      `Shareholder: ${p.shareholderName} | BOID: ${p.boid} | Physical Folio No: ${p.originalFolioNo || (p.boid.length < 16 ? p.boid : "Direct Electronic")} | Holder Type: ${p.holderType}`,
    ],
    [`PAN: ${p.panNo || "—"} | Bank: ${p.bankName || "—"} (${p.bankAccountNo || "—"})`],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Evolution_Journey");
  XLSX.writeFile(wb, `${ctx.activeCompany.code}_${p.boid}_Journey.xlsx`);
  toast.success(`Exported journey for ${p.shareholderName} to Excel!`);
}

export function exportConversionLedgerWorkbook(
  ctx: Pick<AgmStudioExportContext, "activeCompany" | "conversionRecords">,
) {
  const wb = XLSX.utils.book_new();
  const headers = [
    "S.N.",
    "BOID / Folio",
    "Shareholder Name",
    "Pre-Conversion Total",
    "Promoter Retained (PO_INT)",
    "Promoter Frac (PO_FRAC)",
    "Public Converted (PU_INT)",
    "Public Frac (PU_FRAC)",
    "Total Converted (PUB)",
    "Fraction Remainder Preserved",
    "CA Seq No",
    "Status",
    "Remarks",
  ];
  const rows = ctx.conversionRecords.map((r, idx) => [
    idx + 1,
    r.boidOrFolio,
    r.holderName,
    r.preConversionTotal,
    r.promoterRetainedInt,
    r.promoterRetainedFrac,
    r.publicConvertedInt,
    r.publicConvertedFrac,
    r.totalConverted,
    r.fractionRemainder,
    r.caSeqNo,
    r.status,
    r.remarks || "",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    [
      `${ctx.activeCompany.name.toUpperCase()} — PROMOTER TO PUBLIC CONVERSION RECONCILIATION LEDGER`,
    ],
    [
      `Generated at: ${new Date().toLocaleString()} | Total Accounts: ${ctx.conversionRecords.length.toLocaleString()}`,
    ],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Conversion_Reconciliation");
  XLSX.writeFile(wb, `${ctx.activeCompany.code}_CA6316_Conversion_Reconciliation.xlsx`);
  toast.success(
    `Exported ${ctx.conversionRecords.length.toLocaleString()} conversion records to Excel!`,
  );
}

export function exportDecompositionScheduleWorkbook(
  ctx: Pick<AgmStudioExportContext, "activeCompany" | "activeCompanyId"> & {
    remPoolData: RemPoolSummary;
    decompositionSchedule: DecompositionScheduleRow[];
  },
) {
  const { remConvKitta, remBonusKitta } = ctx.remPoolData;
  if (!remConvKitta || remConvKitta <= 0) {
    toast.error(
      "Cannot export decomposition schedule: REMCONVERSION source pool is missing or zero.",
    );
    return;
  }

  const wb = XLSX.utils.book_new();
  const headers = [
    "S.N.",
    "Physical Folio",
    "Shareholder Name",
    "Father's Name",
    "Address",
    "Base Physical Certificate Kitta",
    "Remaining Converted Public Kitta (CA 6316 Only)",
    "Gross Cash Dividend (NPR)",
    "Net Cash Payable (NPR)",
  ];
  const rows = ctx.decompositionSchedule.map((r, idx) => [
    idx + 1,
    r.folioNo,
    r.holderName,
    r.fatherName,
    r.address,
    r.baseKitta,
    r.fromRemConversion,
    r.grossCash,
    r.netCash,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    [
      `${ctx.activeCompany.name.toUpperCase()} — REMAINING CONVERSION (CA 6316.001) DISTRIBUTION SCHEDULE`,
    ],
    [
      `Source Pool: REMCONVERSION ONLY (${remConvKitta.toLocaleString()} kitta) | REMBONUS (${remBonusKitta.toLocaleString()} kitta) Excluded & Preserved | Generated: ${new Date().toLocaleString()}`,
    ],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Conversion_Only_Schedule");

  AgmStudioService.appendAuditMetadataSheet(wb, {
    companyName: ctx.activeCompany.name,
    companyCode: ctx.activeCompany.code,
    companyId: ctx.activeCompanyId,
    targetFy: "2076/77",
    batchRef: "CA 6316.001 Promoter Conversion",
    totalRecords: ctx.decompositionSchedule.length,
    totalKitta: remConvKitta,
    totalBonus: 0,
    totalCash:
      Math.round(ctx.decompositionSchedule.reduce((s, r) => s + r.grossCash, 0) * 100) / 100,
    totalTax:
      Math.round(
        ctx.decompositionSchedule.reduce((s, r) => s + (r.grossCash - r.netCash), 0) * 100,
      ) / 100,
    reconciliationStatus: "RECONCILED",
  });

  XLSX.writeFile(wb, `${ctx.activeCompany.code}_Remaining_Conversion_Only_Schedule.xlsx`);
  toast.success("Exported Remaining Conversion Only schedule to Excel!");
}
