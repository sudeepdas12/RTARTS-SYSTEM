import * as XLSX from "xlsx";
import { expandScientificNotation } from "./validation-engine";

export type DetectedFileType =
  | "debenture"
  | "dividend"
  | "mutual_fund"
  | "bonus_share"
  | "cash_dividend"
  | "right_share"
  | "interest"
  | "raw_demat"
  | "unknown";
export type DetectedSheetType =
  | "PUBLIC"
  | "PROMOTER"
  | "INSTITUTION"
  | "TAX_EXEMPTED"
  | "LOCAL_UNVERIFIED"
  | "PRIVATE"
  | "REJECT_PENDING"
  | "PHYSICAL"
  | "ORIGINAL"
  | "SUMMARY"
  | "UNKNOWN";

export interface ColumnMapping {
  boid?: string;
  full_name?: string;
  father_name?: string;
  grandfather_name?: string;
  citizenship?: string;
  pan?: string;
  nid_number?: string;
  date_of_birth?: string;
  gender?: string;
  occupation?: string;
  address?: string;
  province?: string;
  district?: string;
  municipality?: string;
  phone?: string;
  email?: string;
  shares_held?: string; // KITTA / ALLOTED_QUANTITY
  bonus_actual?: string; // ACTUAL_BONUS 7%
  bonus_issued?: string; // ISSUED BONUS
  bonus_fraction?: string; // REM FRACTION / FRACTION
  after_bonus_kitta?: string; // AFTER BONUS KITTA / T.KITTA
  cash_dividend?: string; // DIVIDEND / DIVIDEND 5.631 / AMOUNT
  bon_tax?: string; // BON_TAX
  div_tax?: string; // DIV_TAX / TAX @6% / TAX
  net_payable?: string; // NET_DIV. / NET INTEREST PAYABLE / NET DIVIDEND / ROUND UP DIV
  bank_code?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_account_no?: string;
  account_type?: string;
  pledge?: string;
  lot_name?: string;
  investor_type?: string; // D-PUBLIC / P-PUBLIC / TYPE
  status?: string; // STATUS / REMARKS 1
  approve_date?: string;
  isin?: string;
  client_id?: string;
  due_date?: string;
  instrument_ref?: string;
  remarks?: string;
  residency?: string;
  instruction_id?: string;
  batch_id?: string;
}

export interface ParsedSheetData {
  sheetName: string;
  sheetType: DetectedSheetType;
  defaultTdsRate: number; // 0, 0.05, 0.06, 0.15
  detectedDividendRate?: number; // e.g. 5.631 from header "DIVIDEND 5.631"
  rows: any[];
  headers: string[];
  mapping: Record<string, keyof ColumnMapping>;
  totalKitta: number;
  totalAmount: number;
  totalTax: number;
  totalNet: number;
  rowCount: number;
  isPreCalculated: boolean;
  isRawInputFile: boolean;
  detectedIsin?: string;
  calculationDiscrepancies?: { row: number; field: string; expected: number; actual: number }[];
}

export interface ParsedExcelData {
  fileType: DetectedFileType;
  fileName: string;
  sheets: ParsedSheetData[];
  detectedCompanyName?: string; // Company name extracted from title rows or file name
  detectedIsin?: string; // ISIN auto-detected from sheet columns or rows
  detectedRate?: number; // Rate auto-detected from filename
  grandTotals: {
    totalRows: number;
    totalKitta: number;
    totalAmount: number;
    totalTax: number;
    totalNet: number;
  };
}

const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  boid: [
    "BOID",
    "BENEFICIARY ID",
    "CLIENT ID",
    "BENEFICIARY_ID",
    "CLIENT_ID",
    "DP ID",
    "DPID",
    "BO ID",
    "BO_ID",
    "BENEFICIARY_NO",
    "BENEFICIARY NO",
    "BENEFICIARY NO.",
    "BENEFICIARY",
    "CLIENT CODE",
    "CLIENT_CODE",
    "CLIENTCODE",
    "CLIENT NO",
    "CLIENT_NO",
    "CLIENT NO.",
    "DP CLIENT ID",
    "DP_CLIENT_ID",
    "DPCLIENTID",
    "DP-CLIENT-ID",
    "DMAT A/C",
    "DEMAT A/C",
    "DEMAT AC",
    "DEMAT ACCOUNT",
    "DEMAT_ACCOUNT",
    "DEMAT",
    "DEMAT NO",
    "DEMAT NO.",
    "DEMAT_NO",
    "DMAT",
    "DMAT NO",
    "DMAT NO.",
    "DMAT_NO",
    "DMAT AC",
    "DMAT ACCOUNT",
    "DMAT_ACCOUNT",
    "BOID NO",
    "BOID NO.",
    "BOIDNO",
    "FOLIO",
    "FOLIO NO",
    "FOLIO NO.",
    "FOLIO_NO",
    "FOLIONO",
    "FOLIO NUMBER",
    "SH NO",
    "SH_NO",
    "SH.NO",
    "SH. NO.",
    "SH HOLDER NO",
    "SHAREHOLDER NO",
    "SHARE HOLDER NO",
    "SHAREHOLDER ID",
    "HOLDER NO",
    "HOLDER NO.",
    "HOLDER_NO",
    "HOLDER NUMBER",
    "HOLDER ID",
    "BOID / FOLIO",
    "BOID/FOLIO",
    "BOID/FOLIO NO",
    "REG NO",
    "REG_NO",
    "REGISTRATION NO",
  ],
  full_name: [
    "NAME",
    "APPLICANT_NAME",
    "APPLICANT NAME",
    "SHAREHOLDER NAME",
    "SHARE HOLDER NAME",
    "NAME ",
    "HOLDER NAME",
    "UNIT HOLDER NAME",
    "UNITHOLDER NAME",
    "DEBENTURE HOLDER",
    "INVESTOR NAME",
    "ACCOUNT HOLDER",
    "CLIENT NAME",
    "BENEFICIARY NAME",
    "FULL NAME",
    "FULL_NAME",
    "INVESTOR_NAME",
    "PARTY NAME",
    "MEMBER NAME",
  ],
  father_name: [
    "FATHER'S NAME",
    "FATHERS NAME",
    "FATHER_NAME",
    "FATHER NAME",
    "FATHER'S NAME ",
    "FATHER_NAME_MOTHER_NAME",
    "FATHER/HUSBAND NAME",
  ],
  grandfather_name: [
    "GRANDFATHER'S NAME",
    "GRANDFATHERS NAME",
    "GRANDFATHER_NAME",
    "GRANDFATHER NAME",
    "GRANDFATHER'S NAME ",
    "GRANDFATHER_NAME_SPOUSE_NAME",
    "GRAND FATHER NAME",
    "GRAND FATHER'S NAME",
  ],
  citizenship: [
    "CITIZENSHIP",
    "CITIZENSHIP_NUMBER",
    "CITIZENSHIP NUMBER",
    "CITIZENSHIP NO",
    "CITIZENSHIP_NO",
    "CITIZENSHIP NO.",
    "CITIZENSHIP/REG NO",
    "CITIZENSHIP_REG_NO",
  ],
  pan: [
    "PAN",
    "PAN NO",
    "PAN NUMBER",
    "PAN_NO",
    "PAN_NUMBER",
    "PAN NO.",
    "PAN/REG NO",
    "PAN_REG_NO",
    "REGISTRATION NO",
    "COMPANY REG NO",
  ],
  nid_number: [
    "NID",
    "NID NO",
    "NID NO.",
    "NID_NO",
    "NID_NUMBER",
    "NID NUMBER",
    "NATIONAL ID",
    "NATIONAL_ID",
    "NATIONAL ID NO",
    "NATIONAL ID NO.",
    "NATIONAL ID NUMBER",
    "NATIONAL_ID_NUMBER",
    "RASTRIYA PARICHAYAPATRA",
    "RASTRIYA_PARICHAYAPATRA",
    "RASTRIYA PARICHAYA PATRA",
    "NATIONAL IDENTITY NO",
    "NATIONAL IDENTITY NUMBER",
    "NID_NUM",
    "NID NUM",
    "NID_CARD",
    "NID CARD",
  ],
  date_of_birth: [
    "DOB",
    "DATE OF BIRTH",
    "DATE_OF_BIRTH",
    "BIRTH DATE",
    "BIRTH_DATE",
    "D.O.B",
    "D.O.B.",
    "DOB (BS)",
    "DOB (AD)",
    "BIRTHDATE",
    "DATE_OF_BIRTH_BS",
    "DATE_OF_BIRTH_AD",
    "BIRTH_DT",
  ],
  gender: ["GENDER", "SEX"],
  occupation: ["OCCUPATION", "PROFESSION"],
  address: [
    "ADDRESS",
    "LOCATION",
    "PERMANENT ADDRESS",
    "ADDRESS1",
    "FULL ADDRESS",
    "STREET",
    "CURRENT ADDRESS",
  ],
  province: ["PROVINCE", "STATE", "PROVINCE NO", "PROVINCE_NO"],
  district: ["DISTRICT"],
  municipality: [
    "MUNICIPALITY",
    "VDC",
    "MUNICIPALITY / VDC",
    "MUNICIPALITY/VDC",
    "LOCAL BODY",
    "MUNICIPALITY_VDC",
    "VDC_MUNICIPALITY",
  ],
  phone: [
    "CONTACT",
    "PHONE",
    "MOBILE",
    "CONTACT NO",
    "CONTACT ",
    "CONTACT 2",
    "MOBILE NO",
    "MOBILE_NO",
    "PHONE NO",
    "PHONE_NO",
    "MOBILE NUMBER",
    "PHONE NUMBER",
    "CONTACT NUMBER",
    "TEL NO",
  ],
  email: [
    "EMAIL",
    "EMAIL ADDRESS",
    "EMAIL_ADDRESS",
    "E-MAIL",
    "E-MAIL ADDRESS",
    "EMAIL ID",
    "E_MAIL",
  ],
  shares_held: [
    "TOTAL KITTA",
    "TOTA KITTA",
    "ALLOTED_QUANTITY",
    "ALLOTTED_QUANTITY",
    "ALLOTED QUANTITY",
    "ALLOTTED QUANTITY",
    "SHARES",
    "TOTAL SHARES",
    "KITTA",
    "TOTAL_KITTA",
    "TOT_KITTA",
    "UNITS HELD",
    "UNIT HELD",
    "UNITS",
    "NO OF UNITS",
    "NO. OF UNITS",
    "NO_OF_UNITS",
    "TOTAL UNITS",
    "TOTAL UNIT",
    "TOTAL_UNITS",
    "TOT_UNITS",
    "UNIT BALANCE",
    "BALANCE UNITS",
    "BALANCE",
    "HOLDING",
    "HOLDINGS",
    "CURRENT HOLDING",
    "HOLDING_QTY",
    "QTY",
    "QUANTITY",
    "TOTAL QTY",
    "TOT_QTY",
    "FREE BALANCE",
    "FREE_BALANCE",
    "SAFEKEEP",
    "SAFEKEEP_BALANCE",
    "FACE VALUE UNITS",
    "DEBENTURE UNITS",
    "PRINCIPAL AMOUNT",
    "NOMINAL VALUE",
    "NO. OF SHARES",
    "NO OF SHARES",
    "NO_OF_SHARES",
    "SHARE HELD",
    "SHARES HELD",
    "PREVIOUS KITTA",
    "PREV KITTA",
    "OLD KITTA",
    "EXISTING KITTA",
    "CURRENT BALANCE",
    "CURRENT KITTA",
  ],
  bonus_actual: [
    "ACTUAL_BONUS 7%",
    "ACTUAL_BONUS",
    "BONUS KITTA",
    "ACTUAL BONUS",
    "BONUS_KITTA",
    "BONUS SHARE",
    "BONUS SHARES",
    "BONUS_SHARE",
    "BONUS_SHARES",
    "BONUS",
    "BONUS QTY",
    "BONUS_QTY",
    "BONUS UNITS",
    "BONUS_UNITS",
    "STOCK DIVIDEND",
    "BONUS %",
    "BONUS (KITTA)",
    "BONUS SHARE (KITTA)",
    "BONUS SHARES (KITTA)",
  ],
  bonus_issued: [
    "ISSUED BONUS",
    "ISSUED_BONUS",
    "BONUS ISSUED",
    "BONUS_ISSUED",
    "BONUS APPROVED",
    "BONUS_APPROVED",
    "FINAL BONUS",
    "BONUS DELIVERED",
  ],
  bonus_fraction: [
    "REM FRACTION",
    "FRACTION",
    "REMAINING FRACTION",
    "REM_FRACTION",
    "FRACTION BONUS",
    "FRACTIONAL SHARE",
    "FRACTIONAL SHARES",
    "FRACTION KITTA",
    "FRACTION_KITTA",
    "FRACTIONAL",
  ],
  after_bonus_kitta: [
    "AFTER BONUS KITTA",
    "T.KITTA",
    "AFTER_BONUS_KITTA",
    "TOTAL AFTER BONUS",
    "NEW KITTA",
    "TOTAL KITTA AFTER BONUS",
    "NET KITTA",
    "TOTAL BALANCE",
    "CLOSING BALANCE",
    "CLOSING KITTA",
    "AFTER BONUS",
  ],
  cash_dividend: [
    "INTEREST",
    "INTEREST @ 8.50%",
    "INT. @ 8.50%",
    "INTEREST @ 8.5%",
    "INT. @ 8.5%",
    "DIVIDEND 5.631",
    "DIVIDEND",
    "AMOUNT/DIVIDEND",
    "AMOUNT",
    "DIVIDEND AMOUNT",
    "DIVIDEND_AMOUNT",
    "GROSS AMOUNT",
    "GROSS_AMOUNT",
    "GROSS DIVIDEND",
    "GROSS_DIVIDEND",
    "GROSS INTEREST",
    "GROSS_INTEREST",
    "GROSS PAYABLE",
    "GROSS_PAYABLE",
    "PAYABLE AMOUNT",
    "DISTRIBUTION AMOUNT",
    "DISTRIBUTION",
    "TOTAL AMOUNT",
    "TOTAL_AMOUNT",
    "RETURN AMOUNT",
    "RETURN",
    "INTEREST-PUMORI",
    "INTEREST PUMORI",
    "INT. @ 7%",
    "INTEREST AMOUNT",
    "INT AMOUNT",
    "INTEREST @ 7%",
    "COUPON AMOUNT",
  ],
  bon_tax: [
    "BON_TAX",
    "BONUS TAX",
    "BONUS_TAX",
    "TAX ON BONUS",
    "BONUS TDS",
    "TAX ON BONUS SHARE",
    "BONUS SHARE TAX",
    "BONUS TAX AMOUNT",
    "TAX (BONUS)",
  ],
  div_tax: [
    "TAX @ 6%",
    "TAX @6%",
    "TAX @ 15%",
    "TAX @15%",
    "TAX @ 5%",
    "TAX @5%",
    "TAX EXEMPTED",
    "TAX EXEMPT",
    "DIV_TAX",
    "DIVIDEND TAX",
    "TAX",
    "TAX AMOUNT",
    "TAX_AMOUNT",
    "TDS",
    "TDS AMOUNT",
    "TDS_AMOUNT",
    "WITHHOLDING TAX",
    "WHT",
    "TAX DEDUCTED",
  ],
  net_payable: [
    "NET_DIV.",
    "NET_DIV",
    "NET INTEREST PAYABLE",
    "NET DIVIDEND",
    "NET_DIVIDEND",
    "NET PAYABLE",
    "NET_PAYABLE",
    "NET AMOUNT",
    "NET_AMOUNT",
    "ROUND UP DIV",
    "ROUNDUP",
    "NET",
    "NET INT",
    "NET INTEREST",
    "NET DISTRIBUTION",
    "PAYABLE NET",
    "TOTAL NET",
    "TOTAL_NET",
  ],
  bank_code: ["B.CODE", "B CODE", "B_CODE", "BANK CODE", "BANK_CODE"],
  bank_name: [
    "BANK NAME",
    "BANK NAME ",
    "BANK",
    "BANK_NAME",
    "BANKNAME",
    "NAME OF BANK",
    "BANK/FINANCIAL INSTITUTION",
    "BANK / FINANCIAL INSTITUTION",
    "BANK DETAILS",
    "BANK_TITLE",
  ],
  bank_branch: [
    "BANK BRANCH",
    "BRANCH NAME",
    "BRANCH",
    "BANK_BRANCH",
    "BANK BRANCH NAME",
    "BRANCH_NAME",
    "BRANCHNAME",
  ],
  bank_account_no: [
    "BANK ACCOUNT",
    "BANK_ACCOUNT",
    "BANK A/C NO.",
    "BANK A/C NO",
    "BANK_A/C_NO",
    "ACCOUNT_NUMBER",
    "ACCOUNT NUMBER",
    "ACCOUNT NO",
    "ACCOUNT NO.",
    "BANK ACCOUNT NO.",
    "BANK ACCOUNT NO",
    "BANK_ACCOUNT_NO",
    "BANK ACC NO",
    "BANK ACC NO.",
    "BANK ACC NUMBER",
    "BANK ACCOUNT NUMBER",
    "A/C NO",
    "A/C NO.",
    "ACC NO",
    "ACC NO.",
    "A/C NUMBER",
    "ACC NUMBER",
    "BANK A/C.",
    "BANK ACC",
    "A/C_NO",
    "ACC_NO",
    "ACCOUNT_NO",
    "ACCT_NO",
    "ACCT NO",
  ],
  account_type: ["ACCOUNT TYPE", "ACCOUNT_TYPE", "A/C TYPE", "ACC TYPE", "A/C_TYPE"],
  pledge: ["PLEDGE", "REMARKS", "FREEZE STATUS", "PLEDGED"],
  lot_name: ["LOT", "LOT NAME", "LOT_NAME"],
  investor_type: [
    "TYPE",
    "CATEGORY",
    "INVESTOR TYPE",
    "HOLDER TYPE",
    "SHAREHOLDER TYPE",
    "INVESTOR_TYPE",
    "HOLDER_TYPE",
  ],
  status: ["STATUS", "REMARKS 1", "STATUS / REMARKS 1"],
  approve_date: ["APPROVED DATE", "APPROVE DATE", "APPROVAL_DATE"],
  isin: ["ISIN NO.", "ISIN NO", "ISIN", "ISIN_NO", "ISIN CODE", "SECURITY CODE"],
  client_id: [
    "CLIENT ID",
    "CLIENT_ID",
    "CLIENT NO",
    "CLIENT_NO",
    "CLIENT NO.",
    "MEMBER ID",
    "MEMBER_ID",
  ],
  due_date: [
    "DUE DATE",
    "DUE_DATE",
    "MATURITY DATE",
    "MATURITY_DATE",
    "PAYMENT DATE",
    "PAYMENT_DATE",
    "INTEREST DATE",
    "INTEREST_DATE",
    "DUE DT",
  ],
  instrument_ref: [
    "INSTRUMENT",
    "INSTRUMENT REF",
    "INSTRUMENT_REF",
    "INSTRUMENT NO",
    "DEBENTURE NAME",
    "SECURITY",
    "SECURITY NAME",
    "SERIES",
  ],
  remarks: [
    "REMARKS",
    "REMARK",
    "NOTE",
    "NOTES",
    "STATUS REMARKS",
    "DESCRIPTION",
    "COMMENTS",
    "REMARKS 2",
  ],
  residency: [
    "RESIDENCY",
    "RESIDENT",
    "RESIDENCY STATUS",
    "RESIDENT_TYPE",
    "RESIDENT TYPE",
    "NATIONALITY",
  ],
  instruction_id: [
    "INSTRUCTION ID",
    "INSTRUCTION_ID",
    "INSTRUCTIONID",
    "INSTRUCTION NO",
    "INSTRUCTION NO.",
    "INSTRUCTION",
    "TXN ID",
    "TRANSACTION ID",
  ],
  batch_id: ["BATCH ID", "BATCH_ID", "BATCHID", "BATCH NO", "BATCH NO.", "BATCH"],
};

/**
 * Safely decode text/CSV buffer to string with BOM handling (UTF-8, UTF-16LE, etc.)
 */
function decodeCsvBufferToString(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Prevents worksheet !ref from exploding memory if saved with empty formatted rows (e.g. A1:Z1048576)
 */
function sanitizeWorksheetRange(ws: XLSX.WorkSheet) {
  if (!ws || !ws["!ref"]) return;
  const decoded = XLSX.utils.decode_range(ws["!ref"]);
  // If the sheet range claims to exceed 200,000 rows, clamp it to actual used rows to prevent 27M empty string allocations
  if (decoded.e.r > 200000) {
    let lastRow = 0;
    // Check dense mode array rows
    for (let r = Math.min(decoded.e.r, 200000); r >= 0; r--) {
      const row = (ws as any)[r];
      if (
        Array.isArray(row) &&
        row.some((c: any) => c && c.v !== undefined && c.v !== null && String(c.v).trim() !== "")
      ) {
        lastRow = r;
        break;
      }
    }
    // Fallback if sparse keys
    if (lastRow === 0) {
      for (const k in ws) {
        if (k.charCodeAt(0) === 33) continue;
        const c = XLSX.utils.decode_cell(k);
        if (c.r > lastRow && c.r <= 200000) lastRow = c.r;
      }
    }
    decoded.e.r = Math.max(lastRow, 0);
    ws["!ref"] = XLSX.utils.encode_range(decoded);
  }
}

export const ExcelParser = {
  async parseBuffer(data: ArrayBuffer | Uint8Array, fileName: string): Promise<ParsedExcelData> {
    const isCsvOrTsv = /\.(csv|tsv|txt)$/i.test(fileName);
    let workbook: XLSX.WorkBook;

    if (isCsvOrTsv) {
      // Decode CSV/TSV safely as a text string to avoid SheetJS's buggy browser utf8reada string-concatenation loop
      const csvString = decodeCsvBufferToString(data);
      workbook = XLSX.read(csvString, { type: "string", dense: true, cellDates: true });
    } else {
      // Read Excel files in dense mode to avoid allocating millions of sparse cell keys in V8 heap
      workbook = XLSX.read(data, { type: "array", dense: true, cellDates: true });
    }

    return this.parseWorkbook(workbook, fileName);
  },

  parseSingleSheet(
    sheetName: string,
    worksheet: XLSX.WorkSheet,
    fileType: DetectedFileType,
    allowSummary: boolean = false,
  ): ParsedSheetData | null {
    if (!worksheet) return null;
    sanitizeWorksheetRange(worksheet);
    const json = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    });
    if (!json || json.length === 0) return null;

    const sheetNameUpper = sheetName.toUpperCase();
    let sheetType: DetectedSheetType = "UNKNOWN";

    if (sheetNameUpper.includes("PUBLIC")) {
      sheetType = "PUBLIC";
    } else if (sheetNameUpper.includes("PROMOTER")) {
      sheetType = "PROMOTER";
    } else if (sheetNameUpper.includes("PHYSICAL") || sheetNameUpper.includes("FOLIO")) {
      sheetType = "PHYSICAL";
    } else if (sheetNameUpper.includes("INSTITUTION")) {
      sheetType = "INSTITUTION";
    } else if (
      sheetNameUpper.includes("TAX EXEMPT") ||
      sheetNameUpper.includes("EXEMPTED") ||
      sheetNameUpper.includes("MUTUAL FUND")
    ) {
      sheetType = "TAX_EXEMPTED";
    } else if (sheetNameUpper.includes("LOCAL")) {
      sheetType = "LOCAL_UNVERIFIED";
    } else if (sheetNameUpper.includes("PRIVATE")) {
      sheetType = "PRIVATE";
    } else if (
      sheetNameUpper.includes("REJECT") ||
      sheetNameUpper.includes("PENDING") ||
      sheetNameUpper.includes("REMAINING")
    ) {
      sheetType = "REJECT_PENDING";
    } else if (sheetNameUpper.includes("ORIGINAL")) {
      sheetType = "ORIGINAL";
    } else if (sheetNameUpper.includes("SUMMARY")) {
      sheetType = "SUMMARY";
    }

    if (!allowSummary && (sheetType === "SUMMARY" || sheetType === "ORIGINAL")) {
      return null;
    }

    let defaultTdsRate = 0.05;
    if (fileType === "debenture") {
      if (sheetType === "INSTITUTION" || sheetType === "PRIVATE") defaultTdsRate = 0.15;
      else if (sheetType === "TAX_EXEMPTED") defaultTdsRate = 0;
      else defaultTdsRate = 0.06;
    } else {
      if (sheetType === "TAX_EXEMPTED" || fileType === "mutual_fund") defaultTdsRate = 0;
      else defaultTdsRate = 0.05;
    }

    const domainKeywords = [
      "boid",
      "name",
      "kitta",
      "shares",
      "amount",
      "dividend",
      "interest",
      "tax",
      "net",
      "payable",
      "gross",
      "bank",
      "account",
      "wht",
      "tds",
      "sn",
      "s.n.",
      "holder",
      "client",
      "warrant",
      "folio",
      "rate",
      "pumori",
      "actual",
      "round",
      "fiscal",
      "year",
      "fraction",
      "baseline",
      "event",
    ];

    let bestHeaderScore = -1;
    let headerRowIndex = 0;
    let headers: string[] = [];

    for (let i = 0; i < Math.min(25, json.length); i++) {
      const row = json[i] as any[];
      if (!row || row.length < 2) continue;

      const stringCells = row
        .filter((c) => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.toString().trim().toLowerCase());

      if (stringCells.length < 2) continue;

      let score = 0;
      for (const cell of stringCells) {
        const cleanCell = cell.replace(/[^a-z0-9]/g, "");
        if (domainKeywords.some((kw) => cleanCell.includes(kw.replace(/[^a-z0-9]/g, "")))) {
          score++;
        }
      }

      if (score > bestHeaderScore && score >= 2) {
        bestHeaderScore = score;
        headerRowIndex = i;
        headers = row.map((h) => (h !== undefined && h !== null ? h.toString().trim() : ""));
        if (score >= 4) {
          break;
        }
      } else if (bestHeaderScore < 0 && stringCells.length >= 2) {
        bestHeaderScore = 0;
        headerRowIndex = i;
        headers = row.map((h) => (h !== undefined && h !== null ? h.toString().trim() : ""));
      }
    }

    const mapping: Record<string, keyof ColumnMapping> = {};
    const fieldPriority: Record<string, string[]> = {
      boid: [
        "BOID",
        "BOID NO",
        "BOID NO.",
        "BENEFICIARY ID",
        "BENEFICIARY_ID",
        "DP CLIENT ID",
        "DP_CLIENT_ID",
        "CLIENT ID",
        "DEMAT ACCOUNT",
        "DEMAT A/C",
        "DMAT",
        "FOLIO NO",
        "FOLIO",
        "CLIENT CODE",
      ],
      net_payable: [
        "NET_DIV.",
        "NET PAYABLE",
        "NET DIVIDEND",
        "NET INTEREST PAYABLE",
        "NET",
        "ROUND UP DIV",
        "ROUNDUP",
      ],
      cash_dividend: [
        "DIVIDEND",
        "DIVIDEND AMOUNT",
        "GROSS DIVIDEND",
        "GROSS PAYABLE",
        "AMOUNT",
        "TOTAL AMOUNT",
      ],
      div_tax: ["DIV_TAX", "TAX @6%", "TAX", "TAX AMOUNT", "WHT"],
      bon_tax: ["BON_TAX", "BONUS TAX"],
      shares_held: [
        "TOTAL KITTA",
        "TOTA KITTA",
        "FREE BALANCE",
        "KITTA",
        "ALLOTED_QUANTITY",
        "SHARES",
        "CURRENT HOLDING",
        "HOLDING KITTA",
      ],
    };

    for (const [dbField, priorityList] of Object.entries(fieldPriority)) {
      for (const prioName of priorityList) {
        const found = headers.find((h) => h && h.toUpperCase().trim() === prioName);
        if (found && !mapping[found]) {
          mapping[found] = dbField as keyof ColumnMapping;
          break;
        }
      }
    }

    for (const header of headers) {
      if (!header || mapping[header]) continue;
      const upperHeader = header.toUpperCase().trim();
      const cleanUpper = upperHeader.replace(/[^A-Z0-9]/g, "");

      let bestMatch: keyof ColumnMapping | null = null;
      let bestPriority = -1;

      for (const [dbField, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (Object.values(mapping).includes(dbField as keyof ColumnMapping)) continue;

        for (let i = 0; i < aliases.length; i++) {
          const alias = aliases[i].toUpperCase();
          const cleanAlias = alias.replace(/[^A-Z0-9]/g, "");
          const priority = aliases.length - i;

          if (upperHeader === alias || cleanUpper === cleanAlias) {
            if (priority > bestPriority) {
              bestPriority = priority + 1000;
              bestMatch = dbField as keyof ColumnMapping;
            }
          } else if (
            (upperHeader.startsWith(alias) || cleanUpper.startsWith(cleanAlias)) &&
            alias.length >= 3
          ) {
            if (priority > bestPriority) {
              bestPriority = priority + 100;
              bestMatch = dbField as keyof ColumnMapping;
            }
          } else if (
            (upperHeader.includes(alias) || cleanUpper.includes(cleanAlias)) &&
            alias.length >= 4
          ) {
            if (priority > bestPriority) {
              bestPriority = priority;
              bestMatch = dbField as keyof ColumnMapping;
            }
          }
        }
      }

      if (bestMatch) {
        mapping[header] = bestMatch;
      }
    }

    let detectedDividendRate: number | undefined;
    headers.forEach((header) => {
      if (!header) return;
      const upperHeader = header.toUpperCase().trim();
      if (
        upperHeader.includes("DIVIDEND") ||
        upperHeader.includes("DIV") ||
        upperHeader.includes("BONUS") ||
        upperHeader.includes("INT")
      ) {
        const match = upperHeader.match(/(\d+\.?\d*)/);
        if (match && match[0]) {
          const val = Number(match[0]);
          if (val > 0 && val <= 100) {
            detectedDividendRate = val;
          }
        }
      }
    });

    const headerCountMap = new Map<string, number>();
    const uniqueHeaders: string[] = [];
    for (let idx = 0; idx < headers.length; idx++) {
      let h = headers[idx];
      if (!h || h.trim() === "") {
        h = `__COL_${idx}`;
      }
      const count = (headerCountMap.get(h) || 0) + 1;
      headerCountMap.set(h, count);
      uniqueHeaders.push(count > 1 ? `${h} (${count})` : h);
    }

    const uniqueMapping: Record<string, keyof ColumnMapping> = {};
    const mappedFieldsSeen = new Set<keyof ColumnMapping>();
    for (let idx = 0; idx < headers.length; idx++) {
      const origHeader = headers[idx];
      const uniqueHeader = uniqueHeaders[idx];
      if (mapping[origHeader] && !mappedFieldsSeen.has(mapping[origHeader])) {
        uniqueMapping[uniqueHeader] = mapping[origHeader];
        mappedFieldsSeen.add(mapping[origHeader]);
      }
    }
    for (let idx = 0; idx < headers.length; idx++) {
      const origHeader = headers[idx];
      const uniqueHeader = uniqueHeaders[idx];
      if (uniqueMapping[uniqueHeader]) continue;
      if (!origHeader) continue;
      const upperHeader = origHeader.toUpperCase().trim();
      for (const [dbField, aliases] of Object.entries(COLUMN_ALIASES)) {
        const key = dbField as keyof ColumnMapping;
        if (mappedFieldsSeen.has(key)) continue;
        if (aliases.some((alias) => upperHeader === alias || upperHeader.startsWith(alias))) {
          uniqueMapping[uniqueHeader] = key;
          mappedFieldsSeen.add(key);
          break;
        }
      }
    }

    headers = uniqueHeaders;
    Object.keys(mapping).forEach((k) => delete mapping[k]);
    Object.assign(mapping, uniqueMapping);

    if (!Object.values(mapping).some((f) => f === "boid")) {
      const clientCol = Object.entries(mapping).find(([, f]) => f === "client_id")?.[0];
      if (clientCol) {
        mapping[clientCol] = "boid";
      }
    }

    const sampleDataRows = json.slice(
      headerRowIndex + 1,
      Math.min(headerRowIndex + 25, json.length),
    );
    if (sampleDataRows.length > 0) {
      const isBoidSample = (val: any) => {
        if (val === null || val === undefined) return false;
        const expanded = expandScientificNotation(String(val));
        const clean = expanded.trim().replace(/[^0-9]/g, "");
        return clean.length === 16 && clean.startsWith("130");
      };

      const currentBoidEntry = Object.entries(mapping).find(([, f]) => f === "boid");
      const boidCol = currentBoidEntry?.[0];
      let hasValid16DigitSamples = false;

      if (boidCol) {
        const colIdx = headers.indexOf(boidCol);
        if (colIdx >= 0) {
          hasValid16DigitSamples = sampleDataRows.some(
            (r) => Array.isArray(r) && isBoidSample(r[colIdx]),
          );
        }
      }

      if (!hasValid16DigitSamples) {
        for (let c = 0; c < headers.length; c++) {
          const h = headers[c];
          if (!h) continue;
          const matches = sampleDataRows.filter(
            (r) => Array.isArray(r) && isBoidSample(r[c]),
          ).length;
          if (matches >= 2 || (sampleDataRows.length === 1 && matches === 1)) {
            if (boidCol) delete mapping[boidCol];
            mapping[h] = "boid";
            break;
          }
        }
      }
    }

    const hasInvestorIdentity = Object.values(mapping).some(
      (f) => f === "boid" || f === "client_id",
    );
    const hasShareholderData =
      Object.values(mapping).some((f) => f === "full_name") &&
      Object.values(mapping).some(
        (f) =>
          f === "shares_held" ||
          f === "bonus_actual" ||
          f === "cash_dividend" ||
          f === "net_payable",
      );
    const isSummaryOrOverview =
      sheetType === "SUMMARY" ||
      allowSummary ||
      headers.some((h) =>
        /fiscal|kitta|share|holding|dividend|tax|payable|event|baseline|summary|report/i.test(h),
      );

    if (!hasInvestorIdentity && !hasShareholderData && !isSummaryOrOverview) {
      return null;
    }

    const rawRows: Record<string, any>[] = [];
    for (let i = headerRowIndex + 1; i < json.length; i++) {
      const rowArr = json[i] as any[];
      if (!rowArr || rowArr.every((c) => c === undefined || c === null || String(c).trim() === ""))
        continue;

      const row: Record<string, any> = {};
      for (let j = 0; j < Math.max(headers.length, rowArr.length); j++) {
        const header = headers[j] || `__EXTRA_COL_${j}`;
        let val = rowArr[j];
        if (val !== null && val !== undefined && typeof val === "object") {
          if ("v" in val && val.v !== undefined) {
            val = val.v;
          } else if ("f" in val) {
            val = 0;
          } else {
            val = String(val);
          }
        }

        const rawCell = Array.isArray((worksheet as any)[i])
          ? (worksheet as any)[i][j]
          : (worksheet as any)[XLSX.utils.encode_cell({ r: i, c: j })];
        if (rawCell && typeof rawCell.v === "number" && !Number.isNaN(rawCell.v)) {
          if (rawCell.v >= 1e11 && Math.floor(rawCell.v) === rawCell.v) {
            val = BigInt(Math.trunc(rawCell.v)).toString();
          } else if (typeof val === "string" && /[eE]/.test(val)) {
            val = expandScientificNotation(val);
          }
        } else if (typeof val === "string" && /[eE]/.test(val)) {
          val = expandScientificNotation(val);
        }

        if (val !== undefined && val !== null && String(val).trim() !== "") {
          row[header] = val;
        }
      }

      for (const [colName, mappedField] of Object.entries(mapping)) {
        if (row[colName] !== undefined && row[mappedField] === undefined) {
          row[mappedField] = row[colName];
        }
      }

      const divTaxCol = Object.entries(mapping).find(([, f]) => f === "div_tax")?.[0];
      if (
        divTaxCol &&
        (row[divTaxCol] === undefined ||
          row[divTaxCol] === null ||
          String(row[divTaxCol]).trim() === "")
      ) {
        row.div_tax = null;
      }
      const bonTaxCol = Object.entries(mapping).find(([, f]) => f === "bon_tax")?.[0];
      if (
        bonTaxCol &&
        (row[bonTaxCol] === undefined ||
          row[bonTaxCol] === null ||
          String(row[bonTaxCol]).trim() === "")
      ) {
        row.bon_tax = null;
      }

      rawRows.push(row);
    }

    let sheetKitta = 0;
    let sheetAmount = 0;
    let sheetTax = 0;
    let sheetNet = 0;
    let validRowCount = 0;

    const processedRows = rawRows.filter((r) => {
      const allValues = Object.values(r).filter((v) => v !== null && v !== undefined);
      const meaningfulValues = allValues.filter((v) => String(v).trim() !== "");
      if (meaningfulValues.length === 0) return false;

      const hasTotalMarker = allValues.some((v) => {
        const s = String(v).trim().toUpperCase();
        return (
          s === "TOTAL" ||
          s === "GRAND TOTAL" ||
          s === "SUMMARY" ||
          s.startsWith("TOTAL ") ||
          s.startsWith("SUMMARY ") ||
          s.includes("AUTHORISED SIGNATORY") ||
          s.includes("AUTHORIZED SIGNATORY") ||
          s.includes("PREPARED BY") ||
          s.includes("CHECKED BY") ||
          s.includes("VERIFIED BY")
        );
      });
      if (hasTotalMarker) return false;

      if (sheetType === "SUMMARY" || allowSummary) {
        validRowCount++;
        for (const [colName, valRaw] of Object.entries(r)) {
          const colUpper = colName.toUpperCase();
          const cleanStr =
            valRaw !== null && valRaw !== undefined ? String(valRaw).replace(/,/g, "").trim() : "";
          const val = cleanStr === "" ? NaN : Number(cleanStr);
          if (!isNaN(val)) {
            if (/HOLDING KITTA|TOTAL KITTA|TOTAL SHARES/.test(colUpper)) sheetKitta += val;
            else if (/GROSS CASH|GROSS DIVIDEND|TOTAL AMOUNT/.test(colUpper)) sheetAmount += val;
            else if (/TAX WITHHELD|TOTAL TAX/.test(colUpper)) sheetTax += val;
            else if (/NET CASH|NET PAYABLE|NET DIVIDEND/.test(colUpper)) sheetNet += val;
          }
        }
        return true;
      }

      const hasRowIdentity = Boolean(
        (r.boid && String(r.boid).trim().length > 0) ||
        (r.full_name && String(r.full_name).trim().length > 0) ||
        (r.client_code && String(r.client_code).trim().length > 0),
      );
      if (!hasRowIdentity) return false;

      validRowCount++;

      for (const [colName, mappedField] of Object.entries(mapping)) {
        const rawVal = r[colName];
        const cleanStr =
          rawVal !== null && rawVal !== undefined ? String(rawVal).replace(/,/g, "").trim() : "";
        const val = cleanStr === "" ? NaN : Number(cleanStr);
        if (!isNaN(val)) {
          if (mappedField === "shares_held") sheetKitta += val;
          if (mappedField === "cash_dividend") sheetAmount += val;
          if (mappedField === "div_tax" || mappedField === "bon_tax") sheetTax += val;
          if (mappedField === "net_payable") sheetNet += val;
        }
      }

      return true;
    });

    const hasFinancialColumns = Object.values(mapping).some(
      (m) => m === "cash_dividend" || m === "div_tax" || m === "bon_tax" || m === "net_payable",
    );
    const hasKitta = Object.values(mapping).some((m) => m === "shares_held");

    let isPreCalculated = false;
    if (hasFinancialColumns && processedRows.length > 0) {
      let rowsWithFinancials = 0;
      for (const r of processedRows) {
        const cleanNum = (val: any) => {
          if (val === null || val === undefined) return NaN;
          const s = String(val).replace(/,/g, "").trim();
          return s === "" ? NaN : Number(s);
        };
        const gross = cleanNum(r[mapping["cash_dividend" as keyof ColumnMapping] || ""]);
        const tax =
          cleanNum(r[mapping["div_tax" as keyof ColumnMapping] || ""]) ||
          cleanNum(r[mapping["bon_tax" as keyof ColumnMapping] || ""]);
        const net = cleanNum(r[mapping["net_payable" as keyof ColumnMapping] || ""]);
        if (!isNaN(gross) && !isNaN(tax) && !isNaN(net) && (gross > 0 || net > 0)) {
          rowsWithFinancials++;
        }
      }
      isPreCalculated = rowsWithFinancials / processedRows.length > 0.8;
    }

    const isRawInputFile = !hasFinancialColumns && hasKitta;

    let detectedIsin: string | undefined;
    for (const r of processedRows.slice(0, 50)) {
      const val = String(r.isin || r["ISIN NO."] || r["ISIN NO"] || r["ISIN"] || "").trim();
      if (
        val &&
        val.length >= 6 &&
        val.toUpperCase() !== "ISIN" &&
        val.toUpperCase() !== "ISIN NO."
      ) {
        detectedIsin = val;
        break;
      }
    }

    return {
      sheetName,
      sheetType,
      defaultTdsRate,
      detectedDividendRate,
      headers,
      mapping,
      rows: processedRows,
      rowCount: validRowCount,
      totalKitta: Math.round(sheetKitta),
      totalAmount: Math.round(sheetAmount * 100) / 100,
      totalTax: Math.round(sheetTax * 100) / 100,
      totalNet: Math.round(sheetNet * 100) / 100,
      isPreCalculated,
      isRawInputFile,
      detectedIsin,
    };
  },

  parseWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedExcelData {
    let fileType: DetectedFileType = "unknown";
    const fileNameLower = fileName.toLowerCase();
    let detectedRate: number | undefined;

    // Detect rate from filename, e.g., "PRIME DEBENTURE_8.75%.xlsx" -> 8.75
    const rateMatch = fileName.match(/(\d+(?:\.\d+)?)\s*%/);
    if (rateMatch && rateMatch[1]) {
      detectedRate = Number(rateMatch[1]);
    }

    // --- Filename-based detection (strong signals first) ---
    // NOTE: 'agm' is NOT a bonus signal. AGM files are typically cash dividend distributions.
    // Only 'bonus' in the filename explicitly means bonus shares.
    if (fileNameLower.includes("debenture") || fileNameLower.includes("interest")) {
      fileType = "debenture";
    } else if (
      fileNameLower.includes("mutual fund") ||
      fileNameLower.includes("mutual_fund") ||
      fileNameLower.includes("mutualfund") ||
      fileNameLower.includes("rmf") ||
      fileNameLower.includes("mf ") ||
      fileNameLower.includes("mf-") ||
      fileNameLower.includes("mf_")
    ) {
      fileType = "mutual_fund";
    } else if (
      fileNameLower.includes("bonus share") ||
      (fileNameLower.includes("bonus") && !fileNameLower.includes("dividend"))
    ) {
      fileType = "bonus_share";
    } else if (
      fileNameLower.includes("right share") ||
      (fileNameLower.includes("right") && !fileNameLower.includes("copyright"))
    ) {
      fileType = "right_share";
    } else if (
      fileNameLower.includes("dividend") ||
      fileNameLower.includes("book close") ||
      fileNameLower.includes("agm") || // AGM distributions are cash dividends
      fileNameLower.includes("div ") || // "DIV " prefix
      fileNameLower.includes("batch") ||
      fileNameLower.includes("report") ||
      fileNameLower.includes("arko") ||
      fileNameLower.includes("neco") ||
      fileNameLower.includes("payout")
    ) {
      fileType = "dividend";
    }

    // --- Content-based detection (when filename is ambiguous) ---
    // IMPORTANT: FREE BALANCE, SAFEKEEP, ISIN are standard CDS demat export columns that
    // appear in ALL file types (dividend, debenture, bonus). Do NOT use them alone to
    // classify a file as debenture — they are not debenture-specific.
    if (fileType === "unknown") {
      for (const sheetName of workbook.SheetNames.slice(0, 5)) {
        const ws = workbook.Sheets[sheetName];
        // Only inspect the first 25 rows for file type detection — never parse the entire sheet!
        const json2 = XLSX.utils.sheet_to_json<any[]>(ws, {
          header: 1,
          range: { s: { r: 0, c: 0 }, e: { r: 25, c: 60 } },
          blankrows: false,
        });
        if (!json2 || json2.length === 0) continue;

        const sampleText = json2
          .slice(0, 15)
          .flat()
          .filter((c) => c !== null && c !== undefined)
          .map((c) => String(c).toUpperCase())
          .join(" ");
        const sheetUpper = sheetName.toUpperCase();

        // Mutual fund — strong column signals
        if (
          /MUTUAL|RETIREMENT|RMF|UNIT HOLDER|UNIT BALANCE|DISTRIBUTION AMOUNT/.test(
            sheetUpper + " " + sampleText,
          )
        ) {
          fileType = "mutual_fund";
          break;
        }

        // Debenture — requires EXPLICIT debenture markers, not generic CDS columns.
        // FREE BALANCE / SAFEKEEP / ISIN alone are NOT debenture indicators.
        if (
          /DEBENTURE|COUPON|COUPON AMOUNT|INT\.\s*@\s*\d|GROSS INTEREST|NET INTEREST/.test(
            sheetUpper + " " + sampleText,
          )
        ) {
          fileType = "debenture";
          break;
        }

        // Bonus share — must have bonus-specific calculation columns
        if (/ACTUAL_BONUS|ISSUED BONUS|AFTER BONUS KITTA|BON_TAX|BONUS KITTA/.test(sampleText)) {
          fileType = "bonus_share";
          break;
        }

        // Dividend — standard CDS cash dividend indicators
        if (
          /DIVIDEND|DIV_TAX|NET_DIV|TOTA KITTA|TOTAL KITTA|GROSS DIVIDEND|DIVIDEND AMOUNT/.test(
            sampleText,
          )
        ) {
          fileType = "dividend";
          break;
        }

        // Raw demat / CDS shareholder register — BOID + FREE BALANCE but no financial columns
        if (
          /FREE BALANCE|SAFEKEEP|TOTAL KITTA/.test(sampleText) &&
          !/DIVIDEND|DEBENTURE|COUPON|BONUS/.test(sampleText)
        ) {
          fileType = "raw_demat";
          break;
        }
      }
    }

    const sheets: ParsedSheetData[] = [];
    const grandTotals = { totalRows: 0, totalKitta: 0, totalAmount: 0, totalTax: 0, totalNet: 0 };
    const deferredSummarySheets: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheetNameUpper = sheetName.toUpperCase();
      if (sheetNameUpper.includes("SUMMARY") || sheetNameUpper.includes("ORIGINAL")) {
        deferredSummarySheets.push(sheetName);
        continue;
      }

      const parsedSheet = this.parseSingleSheet(
        sheetName,
        workbook.Sheets[sheetName],
        fileType,
        false,
      );
      if (parsedSheet && parsedSheet.rows.length > 0) {
        sheets.push(parsedSheet);
        grandTotals.totalRows += parsedSheet.rowCount;
        grandTotals.totalKitta += parsedSheet.totalKitta;
        grandTotals.totalAmount += parsedSheet.totalAmount;
        grandTotals.totalTax += parsedSheet.totalTax;
        grandTotals.totalNet += parsedSheet.totalNet;
      }
    }

    // If no active data sheets were found, fall back to parsing summary sheets (e.g., standalone multi-year summary report)
    if (sheets.length === 0 && deferredSummarySheets.length > 0) {
      for (const sheetName of deferredSummarySheets) {
        const parsedSheet = this.parseSingleSheet(
          sheetName,
          workbook.Sheets[sheetName],
          fileType,
          true,
        );
        if (parsedSheet && parsedSheet.rows.length > 0) {
          sheets.push(parsedSheet);
          grandTotals.totalRows += parsedSheet.rowCount;
          grandTotals.totalKitta += parsedSheet.totalKitta;
          grandTotals.totalAmount += parsedSheet.totalAmount;
          grandTotals.totalTax += parsedSheet.totalTax;
          grandTotals.totalNet += parsedSheet.totalNet;
        }
      }
    }

    // --- Company Name Detection ---
    // Strategy: Look at title rows (before header row) in the first data sheet for company name
    let detectedCompanyName: string | undefined;

    // 1. Try to extract from title rows before header in first non-summary sheet
    for (const wsName of workbook.SheetNames) {
      const ws = workbook.Sheets[wsName];
      // Only inspect the top 10 rows for company name detection — never parse the entire sheet!
      const json2 = XLSX.utils.sheet_to_json<any[]>(ws, {
        header: 1,
        range: { s: { r: 0, c: 0 }, e: { r: 10, c: 30 } },
        blankrows: false,
      });
      if (!json2 || json2.length === 0) continue;

      const sheetNameUpper = wsName.toUpperCase();
      if (sheetNameUpper.includes("SUMMARY")) continue; // Skip summary sheets for title row search

      // Check first 3 rows for single-cell title text that looks like a company name
      for (let i = 0; i < Math.min(3, json2.length); i++) {
        const row = json2[i] as any[];
        if (!row || row.length === 0) continue;

        // Filter non-null, non-empty cells with string values
        const cells = row.filter(
          (c) => c !== null && c !== undefined && String(c).trim().length > 0,
        );

        // A company name title row typically has 1-3 cells, with the first being the company name
        if (cells.length >= 1 && cells.length <= 3) {
          const firstCell = String(cells[0]).trim();
          // Check if it looks like a company name (contains LTD, Ltd, Company, Bank, etc. or is relatively long)
          const companyKeywords = [
            "ltd",
            "limited",
            "bank",
            "company",
            "hydropower",
            "finance",
            "insurance",
            "microfinance",
            "debenture",
            "fund",
          ];
          const hasKeyword = companyKeywords.some((k) => firstCell.toLowerCase().includes(k));
          // Also check if it's a long title text (not a column header like "S.N" or "BOID")
          const isLongText = firstCell.length > 15;
          const isNotHeader = !["S.N", "S.NO", "SN", "BOID", "TYPE", "PARTICULAR"].includes(
            firstCell.toUpperCase().trim(),
          );

          if ((hasKeyword || isLongText) && isNotHeader) {
            detectedCompanyName = firstCell;
            break;
          }
        }
      }
      if (detectedCompanyName) break;
    }

    // 2. Fallback: Try to extract from file name
    if (!detectedCompanyName) {
      // Common patterns: "COMPANY NAME - TYPE" or "TYPE - COMPANY NAME" or "COMPANY TYPE"
      const fileNameNoExt = fileName.replace(/\.[^/.]+$/, ""); // remove extension

      // Remove common suffixes/prefixes that are not company names
      const cleanName = fileNameNoExt
        .replace(
          /RECONCILATION|RECONCILIATION|RECON|BOOK CLOSE|DIVIDEND|BONUS|AGM|FY \d+|FY-\d+|\d{4}-\d{2}|\b(20[789]\d)\b/gi,
          "",
        )
        .replace(/[-_()]/g, " ")
        .replace(/\.(?!\d)/g, " ") // preserve decimal points in numbers like 8.5%
        .replace(/\s+/g, " ")
        .trim();

      if (cleanName.length > 3) {
        detectedCompanyName = cleanName;
      }
    }

    const overallIsin = sheets.find((s) => s.detectedIsin)?.detectedIsin;

    return {
      fileType,
      fileName,
      sheets,
      detectedCompanyName,
      detectedIsin: overallIsin,
      detectedRate,
      grandTotals,
    };
  },

  async parseOnServer(file: File): Promise<ParsedExcelData> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/parse-excel", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errText = "Server failed to parse spreadsheet";
      try {
        const errJson = await response.json();
        if (errJson.error) errText = errJson.error;
      } catch {
        // fallback
      }
      throw new Error(errText);
    }

    return response.json();
  },

  async parseFile(file: File, onProgress?: (msg: string) => void): Promise<ParsedExcelData> {
    const isBrowser = typeof window !== "undefined";
    const isLarge = file.size > 3 * 1024 * 1024; // > 3MB: use server parser directly to avoid browser heap/freeze

    if (isBrowser && isLarge) {
      onProgress?.(
        `Processing large file (${(file.size / (1024 * 1024)).toFixed(1)} MB) on server engine...`,
      );
      return this.parseOnServer(file);
    }

    try {
      const isCsvOrTsv = /\.(csv|tsv|txt)$/i.test(file.name);
      if (isCsvOrTsv) {
        try {
          const text = await file.text();
          const workbook = XLSX.read(text, { type: "string", dense: true, cellDates: true });
          return this.parseWorkbook(workbook, file.name);
        } catch (err: any) {
          console.warn("Direct text CSV parse failed, falling back to buffer decoding:", err);
        }
      }
      const data = await file.arrayBuffer();
      return this.parseBuffer(data, file.name);
    } catch (err: any) {
      if (isBrowser) {
        console.warn(
          "Client-side parse encountered issue, automatically falling back to server parser:",
          err,
        );
        onProgress?.(
          "Browser limit reached. Seamlessly processing spreadsheet on server engine...",
        );
        return this.parseOnServer(file);
      }
      throw err;
    }
  },

  /**
   * Parse multiple Excel workbooks and combine their sheets into a single consolidated ParsedExcelData
   */
  async parseMultipleFiles(
    files: File[],
    onProgress?: (current: number, total: number, fileName: string) => void,
  ): Promise<ParsedExcelData> {
    if (!files.length) {
      throw new Error("No files provided");
    }
    if (files.length === 1) {
      return this.parseFile(files[0]);
    }

    const mergedSheets: ParsedSheetData[] = [];
    let detectedCompanyName: string | undefined;
    let detectedIsin: string | undefined;
    let detectedRate: number | undefined;
    let detectedType: ParsedExcelData["fileType"] = "unknown";

    const grandTotals = {
      totalRows: 0,
      totalKitta: 0,
      totalAmount: 0,
      totalTax: 0,
      totalNet: 0,
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i + 1, files.length, file.name);

      try {
        const parsed = await this.parseFile(file);
        if (parsed.fileType !== "unknown" && detectedType === "unknown") {
          detectedType = parsed.fileType;
        }
        if (parsed.detectedCompanyName && !detectedCompanyName) {
          detectedCompanyName = parsed.detectedCompanyName;
        }
        if (parsed.detectedIsin && !detectedIsin) {
          detectedIsin = parsed.detectedIsin;
        }
        if (parsed.detectedRate && !detectedRate) {
          detectedRate = parsed.detectedRate;
        }

        const baseName = file.name.replace(/\.[^/.]+$/, "");
        for (const sheet of parsed.sheets) {
          const sheetName = mergedSheets.some((s) => s.sheetName === sheet.sheetName)
            ? `[${baseName}] ${sheet.sheetName}`
            : sheet.sheetName;

          mergedSheets.push({
            ...sheet,
            sheetName,
          });

          grandTotals.totalRows += sheet.rowCount;
          grandTotals.totalKitta += sheet.totalKitta;
          grandTotals.totalAmount += sheet.totalAmount;
          grandTotals.totalTax += sheet.totalTax;
          grandTotals.totalNet += sheet.totalNet;
        }
      } catch (err) {
        console.warn(`Failed to parse Excel file ${file.name}:`, err);
      }
    }

    return {
      fileType: detectedType,
      fileName: `${files.length} Excel Files (${files.map((f) => f.name).join(", ")})`,
      sheets: mergedSheets,
      detectedCompanyName,
      detectedIsin,
      detectedRate,
      grandTotals,
    };
  },
};

export const parseExcelFile = (
  data: ArrayBuffer | Uint8Array | File,
  fileName?: string,
): Promise<ParsedExcelData> => {
  if (data instanceof File) {
    return ExcelParser.parseFile(data);
  }
  return ExcelParser.parseBuffer(data, fileName || "upload.xlsx");
};
