export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val?: string | null): boolean {
  if (!val || typeof val !== "string") return false;
  return UUID_REGEX.test(val.trim());
}

export interface HistoricalFiscalYearConfig {
  fiscalYear: string;
  eventName: string;
  eventType:
    | "RIGHT_ISSUE"
    | "PROMOTER_CONVERSION"
    | "BONUS_AND_CASH"
    | "IPF_TRANSFER"
    | "PRE_BASELINE_BONUS";
  bonusRatioPct: number;
  cashDividendRatioPct: number;
  rightRatioPct: number;
  conversionRatioPct: number;
  bookCloseDateBs: string;
  bookCloseDateAd?: string;
  agmDateBs?: string;
  agmDateAd?: string;
  allotmentDateBs?: string;
  allotmentDateAd?: string;
  promoterKittaBaseline: number;
  publicKittaBaseline: number;
  totalListedKitta: number;
  notes: string;
}

export interface CompanyProfile {
  id: string;
  code: string;
  name: string;
  isinPromoter?: string;
  isinPublic?: string;
  baseFiscalYear: string;
  currentFiscalYear: string;
  currentPaidUpCapital?: number;
  timeline: HistoricalFiscalYearConfig[];
}

export interface ShareholderYearlySnapshot {
  fiscalYear: string;
  eventName: string;
  baseKitta: number;
  previousFraction: number;
  rightSharesAllotted?: number;
  rightSubscriptionStatus?: "SUBSCRIBED" | "PARTIAL" | "UNSUBSCRIBED";
  convertedShares?: number;
  grossBonusEntitlement: number;
  issuedWholeBonus: number;
  carriedNewFraction: number;
  grossCashDividend: number;
  bonusTaxWithheld: number;
  cashTaxWithheld: number;
  netCashPayable: number;
  postEventKitta: number;
  excelReportedFraction?: number;
  excelDiscrepancy: boolean;
  discrepancyDetails?: string;
  remarks: string;
}

export interface YoYChainResult {
  boid: string;
  shareholderName: string;
  previousClosingKitta: number;
  previousClosingFraction: number;
  currentOpeningKitta: number;
  currentOpeningFraction: number;
  tradeDeltaKitta: number;
  tradeDeltaFraction: number;
  status: "MATCHED" | "TRADE_BUY" | "TRADE_SELL" | "NEW_ENTRANT" | "EXITED";
  remarks: string;
}

export interface YoYChainReport {
  previousFiscalYear: string;
  currentFiscalYear: string;
  matchedCount: number;
  tradeBuyCount: number;
  tradeSellCount: number;
  newEntrantsCount: number;
  exitedCount: number;
  openingFractionMismatchesCount?: number;
  netTradeDeltaKitta: number;
  sampleDeltas: YoYChainResult[];
}

export type CurrentFyStatus =
  "ACTIVE" | "EXITED" | "NOT_PRESENT_IN_IMPORT" | "NEW_ENTRANT" | "ESCROW" | "PHYSICAL_PENDING";

export interface MultiYearShareholderProfile {
  companyId?: string;
  boid: string;
  shareholderName: string;
  fatherName?: string;
  grandfatherName?: string;
  guardianName?: string;
  spouseName?: string;
  citizenshipNo?: string;
  address?: string;
  district?: string;
  contactNo?: string;
  email?: string;
  bankName?: string;
  bankAccountNo?: string;
  panNo?: string;
  originalFolioNo?: string;
  linkedBoid?: string;
  holderType: "PROMOTER" | "PUBLIC" | "MUTUAL_FUND" | "CLEARING_POOL" | "PHYSICAL";
  initialKitta2075: number;
  trueInitialKitta2075?: number;
  importedBaseKitta?: number;
  importedOpeningFraction?: number;
  importedBaseFiscalYear?: string;
  initialFraction2075?: number;
  targetFySnapshot?: ShareholderYearlySnapshot;
  convertedShares?: number;
  isConversionMerged?: boolean;
  yoyDelta?: number;
  yoyStatus?: "MATCHED" | "TRADE_BUY" | "TRADE_SELL" | "NEW_ENTRANT" | "EXITED";
  currentFyStatus?: CurrentFyStatus;
  currentKitta2081: number;
  currentFraction2081: number;
  totalBonusSharesReceived: number;
  totalCashDividendReceived: number;
  totalTaxWithheld: number;
  yearlySnapshots: ShareholderYearlySnapshot[];
  hasDiscrepancy: boolean;
  anomalies: string[];
}

export interface BrokerPoolRecord {
  id?: string;
  companyId?: string;
  brokerCode: string;
  brokerName: string;
  poolBoid: string;
  fiscalYear: string;
  unclaimedKitta: number;
  unclaimedCash: number;
  claimedKitta: number;
  claimedCash: number;
  activeBalanceKitta: number;
  activeBalanceCash: number;
  claimsCount: number;
}

export interface BrokerPoolClaim {
  id: string;
  companyId?: string;
  seqNo: number;
  brokerCode: string;
  brokerName: string;
  poolBoid: string;
  claimantBoid: string;
  claimantName: string;
  fiscalYear: string;
  claimedKitta: number;
  claimedCash: number;
  contractNoteNo: string;
  tradeDateBs: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  approveDate?: string;
  approvedBy?: string;
  remarks: string;
}

export interface PhysicalDrnRecord {
  id: string;
  companyId?: string;
  folioNo: string;
  certificateNoStart?: number;
  certificateNoEnd?: number;
  distinctiveNoStart?: number;
  distinctiveNoEnd?: number;
  totalKitta: number;
  holderName: string;
  drnNo?: string;
  drnDate?: string;
  status: "PHYSICAL" | "POSTED" | "ACCEPTED" | "REJECTED";
  targetBoid?: string;
  reconciledAt?: string;
}

export interface PromoterConversionRecord {
  id: string;
  companyId?: string;
  boidOrFolio: string;
  holderName: string;
  holderCategory?: "PROMOTER" | "PUBLIC" | "PHYSICAL";
  preConversionTotal: number;
  promoterRetainedInt: number;
  promoterRetainedFrac: number;
  publicConvertedInt: number;
  publicConvertedFrac: number;
  totalConverted: number;
  fractionRemainder: number;
  caSeqNo: string;
  status: "CONVERTED" | "PHYSICAL_PENDING" | "RECONCILED";
  remarks?: string;
}

export interface ConversionSummaryReport {
  totalAccounts: number;
  totalPreConversionKitta: number;
  totalPromoterRetained: number;
  totalPublicConverted: number;
  totalFractionsPreserved: number;
  ratioActualPromoterPct: number;
  ratioActualPublicPct: number;
  floatingLotDifference: number;
  caSeqList: string[];
}

export interface ImportValidationReport {
  fileName: string;
  fileSizeBytes: number;
  sheetNames: string[];
  totalRowsScanned: number;
  validRecords: number;
  skippedRowsCount: number;
  skippedRows: { sheet: string; rowNumber: number; reason: string }[];
  duplicateBoidsCount: number;
  convertedShareholdersCount?: number;
  totalConvertedKitta?: number;
  discrepanciesCount: number;
  criticalCapitalVariance?: boolean;
  openingFractionMismatchesCount?: number;
  byCategory: {
    promoterDemat: number;
    publicDemat: number;
    physicalFolios: number;
    mutualFunds: number;
    clearingPools: number;
  };
  totalKitta: number;
  totalFraction: number;
  estimatedGrossCash: number;
  estimatedNetCash: number;
  mutualFundCashPayable: number;
  warnings: string[];
  yoyReport?: YoYChainReport;
}

export interface ImportPrePersistenceValidation {
  canProceed: boolean;
  criticalErrors: string[];
  warnings: string[];
  duplicateBoids: string[];
  invalidBoids: string[];
  negativeHoldings: string[];
  fractionOverflows: string[];
  capitalVariancePct: number;
  promoterRatioPct: number;
  publicRatioPct: number;
  mutualFundsCount: number;
  missingBankCount: number;
}

export interface ReleaseGateCheckResult {
  passed: boolean;
  uploadedRows: number;
  persistedRows: number;
  rowsMatched: boolean;
  uploadedKitta: number;
  reportKitta: number;
  kittaMatched: boolean;
  uploadedBonus: number;
  reportBonus: number;
  bonusMatched: boolean;
  uploadedCash: number;
  reportCash: number;
  cashMatched: boolean;
  uploadedTax: number;
  reportTax: number;
  taxMatched: boolean;
  allSnapshotsHaveShareholderId: boolean;
  isFyLocked: boolean;
  violations: string[];
}

export interface FiscalYearMetaRecord {
  companyId?: string;
  fiscalYear: string;
  eventName: string;
  totalShareholders: number;
  totalKitta: number;
  totalBonusKitta: number;
  totalCashNpr: number;
  isLocked: boolean;
  importedBy: string;
  importedAt: string;
  importReport?: ImportValidationReport;
}
