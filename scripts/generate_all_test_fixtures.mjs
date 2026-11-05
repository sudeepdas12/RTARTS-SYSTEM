import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.resolve(process.cwd(), "test-fixtures");
if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

console.log("Generating comprehensive test fixtures for all upload sections...");

// -------------------------------------------------------------
// 1. DIVIDEND WORKBOOK (Multi-category statutory rates)
// -------------------------------------------------------------
const dividendRows = [
  {
    "BOID": "1301020000000001",
    "Shareholder Name": "Ram Prasad Sharma",
    "Father Name": "Hari Prasad Sharma",
    "Grandfather Name": "Krishna Prasad Sharma",
    "PAN": "100234567",
    "Bank Name": "Rastriya Banijya Bank",
    "Bank Account No": "109000123456",
    "Kitta": 1000,
    "Gross Dividend": 5000.00,
    "Tax Amount": 250.00, // 5% Natural Person
    "Net Dividend": 4750.00,
  },
  {
    "BOID": "1301020000000002",
    "Shareholder Name": "HIMALAYAN INVESTMENTS PVT LTD",
    "Father Name": "",
    "Grandfather Name": "",
    "PAN": "300456789",
    "Bank Name": "Nabil Bank",
    "Bank Account No": "010010002345",
    "Kitta": 5000,
    "Gross Dividend": 25000.00,
    "Tax Amount": 3750.00, // 15% Corporate
    "Net Dividend": 21250.00,
  },
  {
    "BOID": "1301020000000003",
    "Shareholder Name": "NAGARIK LAGANI KOSH",
    "Father Name": "",
    "Grandfather Name": "",
    "PAN": "300000001",
    "Bank Name": "Nepal Bank Limited",
    "Bank Account No": "002001000456",
    "Kitta": 10000,
    "Gross Dividend": 50000.00,
    "Tax Amount": 0.00, // 0% Tax Exempt (Sec 10)
    "Net Dividend": 50000.00,
  },
  {
    "BOID": "1301020000000004",
    "Shareholder Name": "GLOBAL CAPITAL VENTURES LLC",
    "Father Name": "",
    "Grandfather Name": "",
    "PAN": "999888777",
    "Bank Name": "Standard Chartered Bank",
    "Bank Account No": "012345678901",
    "Kitta": 2000,
    "Gross Dividend": 10000.00,
    "Tax Amount": 1500.00, // 15% Foreign
    "Net Dividend": 8500.00,
  }
];

const wbDiv = XLSX.utils.book_new();
const wsDiv = XLSX.utils.json_to_sheet(dividendRows);
XLSX.utils.book_append_sheet(wbDiv, wsDiv, "Dividend_Payables");
XLSX.writeFile(wbDiv, path.join(FIXTURES_DIR, "section1_dividend_payables.xlsx"));
console.log("✓ Created section1_dividend_payables.xlsx");

// -------------------------------------------------------------
// 2. DEBENTURE / INTEREST WORKBOOK
// -------------------------------------------------------------
const debentureRows = [
  {
    "Bondholder Name": "Sita Devi Adhikari",
    "BOID": "1301020000000010",
    "Citizenship No": "27-01-72-04561",
    "PAN": "102345678",
    "Bank Name": "Global IME Bank",
    "Account Number": "0010100009876",
    "Gross Interest": 8500.00,
    "TDS Amount": 425.00, // 5% Individual
    "Net Interest": 8075.00,
  },
  {
    "Bondholder Name": "PRABHU INSURANCE LIMITED",
    "BOID": "1301020000000011",
    "Citizenship No": "",
    "PAN": "301234567",
    "Bank Name": "Prabhu Bank Limited",
    "Account Number": "0120010008888",
    "Gross Interest": 42500.00,
    "TDS Amount": 6375.00, // 15% Institutional
    "Net Interest": 36125.00,
  }
];

const wbDeb = XLSX.utils.book_new();
const wsDeb = XLSX.utils.json_to_sheet(debentureRows);
XLSX.utils.book_append_sheet(wbDeb, wsDeb, "Debenture_Interest");
XLSX.writeFile(wbDeb, path.join(FIXTURES_DIR, "section2_debenture_interest.xlsx"));
console.log("✓ Created section2_debenture_interest.xlsx");

// -------------------------------------------------------------
// 3. MUTUAL FUND PAYABLES WORKBOOK
// -------------------------------------------------------------
const mfRows = [
  {
    "Unit Holder Name": "Bikash Thapa",
    "BOID": "1301020000000020",
    "PAN": "109876543",
    "Units Held": 2000,
    "Gross Distribution": 3000.00,
    "Tax Rate %": 5,
    "Tax Amount": 150.00,
    "Net Payable": 2850.00,
    "Bank Name": "Everest Bank",
    "Bank Account No": "0150010003456"
  },
  {
    "Unit Holder Name": "KOSH BYAWASTHAPAN COMPANY",
    "BOID": "1301020000000021",
    "PAN": "309876543",
    "Units Held": 10000,
    "Gross Distribution": 15000.00,
    "Tax Rate %": 15,
    "Tax Amount": 2250.00,
    "Net Payable": 12750.00,
    "Bank Name": "Sanima Bank",
    "Bank Account No": "0250010006789"
  }
];

const wbMf = XLSX.utils.book_new();
const wsMf = XLSX.utils.json_to_sheet(mfRows);
XLSX.utils.book_append_sheet(wbMf, wsMf, "Mutual_Fund_Distribution");
XLSX.writeFile(wbMf, path.join(FIXTURES_DIR, "section3_mutual_fund.xlsx"));
console.log("✓ Created section3_mutual_fund.xlsx");

// -------------------------------------------------------------
// 4. BANK STATEMENT (Excel & CSV formats)
// -------------------------------------------------------------
const bankRows = [
  {
    "Date": "2026-05-15",
    "Description": "DIVIDEND PAYOUT BATCH 1",
    "Reference / Txn ID": "TXN-20260515-001",
    "Debit": 4750.00,
    "Credit": 0.00,
    "Balance": 995250.00
  },
  {
    "Date": "2026-05-15",
    "Description": "DIVIDEND PAYOUT BATCH 2",
    "Reference / Txn ID": "TXN-20260515-002",
    "Debit": 21250.00,
    "Credit": 0.00,
    "Balance": 974000.00
  },
  {
    "Date": "2026-05-16",
    "Description": "RETURNED UNCLAIMED PAYOUT",
    "Reference / Txn ID": "TXN-20260515-003",
    "Debit": 0.00,
    "Credit": 8500.00,
    "Balance": 982500.00
  }
];

const wbBank = XLSX.utils.book_new();
const wsBank = XLSX.utils.json_to_sheet(bankRows);
XLSX.utils.book_append_sheet(wbBank, wsBank, "Statement");
XLSX.writeFile(wbBank, path.join(FIXTURES_DIR, "section4_bank_statement.xlsx"));

const csvContent = [
  "Date,Particulars,Instruction ID,Debit,Credit,Balance",
  "2026-05-15,DIVIDEND PAYOUT BATCH 1,TXN-20260515-001,4750.00,0,995250.00",
  "2026-05-15,DIVIDEND PAYOUT BATCH 2,TXN-20260515-002,21250.00,0,974000.00",
  "2026-05-16,RETURNED UNCLAIMED PAYOUT,TXN-20260515-003,0,8500.00,982500.00"
].join("\n");
fs.writeFileSync(path.join(FIXTURES_DIR, "section4_bank_statement.csv"), csvContent);
console.log("✓ Created section4_bank_statement.xlsx and .csv");

// -------------------------------------------------------------
// 5. CLIENT / SHAREHOLDER MASTER REGISTER
// -------------------------------------------------------------
const clientRows = [
  {
    "Full Name": "Ram Prasad Sharma",
    "BOID": "1301020000000001",
    "PAN": "100234567",
    "Citizenship No": "12-01-70-12345",
    "Father Name": "Hari Prasad Sharma",
    "Grandfather Name": "Krishna Prasad Sharma",
    "Address": "Kathmandu-32, Bagmati",
    "Phone": "9851000001",
    "Bank Name": "Rastriya Banijya Bank",
    "Account Number": "109000123456",
    "Holder Type": "Individual",
    "Payee Classification": "NATURAL_PERSON"
  },
  {
    "Full Name": "HIMALAYAN INVESTMENTS PVT LTD",
    "BOID": "1301020000000002",
    "PAN": "300456789",
    "Citizenship No": "",
    "Father Name": "",
    "Grandfather Name": "",
    "Address": "Lalitpur-03, Bagmati",
    "Phone": "01-5544332",
    "Bank Name": "Nabil Bank",
    "Account Number": "010010002345",
    "Holder Type": "Corporate",
    "Payee Classification": "COMPANY_INSTITUTION"
  }
];

const wbClient = XLSX.utils.book_new();
const wsClient = XLSX.utils.json_to_sheet(clientRows);
XLSX.utils.book_append_sheet(wbClient, wsClient, "Clients");
XLSX.writeFile(wbClient, path.join(FIXTURES_DIR, "section5_clients_master.xlsx"));
console.log("✓ Created section5_clients_master.xlsx");

// -------------------------------------------------------------
// 6. COMPANY MASTER DATA
// -------------------------------------------------------------
const companyRows = [
  {
    "Company Code": "TESTCO",
    "Company Name": "Test Commercial Corporation Ltd.",
    "Sector": "Commercial Banks",
    "Registration Number": "998877-080/081",
    "PAN Number": "301122334",
    "Is Active": "TRUE"
  },
  {
    "Company Code": "TESTHYDRO",
    "Company Name": "Test Hydropower Power Development Ltd.",
    "Sector": "Hydro Power",
    "Registration Number": "112233-079/080",
    "PAN Number": "305566778",
    "Is Active": "TRUE"
  }
];

const wbComp = XLSX.utils.book_new();
const wsComp = XLSX.utils.json_to_sheet(companyRows);
XLSX.utils.book_append_sheet(wbComp, wsComp, "Companies");
XLSX.writeFile(wbComp, path.join(FIXTURES_DIR, "section6_companies_master.xlsx"));
console.log("✓ Created section6_companies_master.xlsx");

// -------------------------------------------------------------
// 7. EDGE CASE 1: ARITHMETIC MISMATCH (Gross - Tax != Net)
// -------------------------------------------------------------
const mathMismatchRows = [
  {
    "BOID": "1301020000000099",
    "Shareholder Name": "Faulty Calculation Record",
    "Gross Dividend": 10000.00,
    "Tax Amount": 500.00,
    "Net Dividend": 8000.00, // Should be 9500! 1500 discrepancy
    "Bank Name": "RBB",
    "Bank Account No": "123456789"
  }
];

const wbMismatch = XLSX.utils.book_new();
const wsMismatch = XLSX.utils.json_to_sheet(mathMismatchRows);
XLSX.utils.book_append_sheet(wbMismatch, wsMismatch, "Mismatch");
XLSX.writeFile(wbMismatch, path.join(FIXTURES_DIR, "edge_case_math_mismatch.xlsx"));
console.log("✓ Created edge_case_math_mismatch.xlsx");

// -------------------------------------------------------------
// 8. EDGE CASE 2: INVALID BOID & EMPTY REQUIRED FIELDS
// -------------------------------------------------------------
const invalidBoidRows = [
  {
    "BOID": "130102000012", // Truncated Demat BOID (12 digits starting with 130)
    "Shareholder Name": "Truncated Demat User",
    "Gross Dividend": 500.00,
    "Tax Amount": 25.00,
    "Net Dividend": 475.00,
    "Bank Name": "Rastriya Banijya Bank",
    "Bank Account No": "123456789"
  },
  {
    "BOID": "13010200@#$%9999", // Contains illegal characters
    "Shareholder Name": "Corrupted Chars User",
    "Gross Dividend": 500.00,
    "Tax Amount": 25.00,
    "Net Dividend": 475.00,
    "Bank Name": "Rastriya Banijya Bank",
    "Bank Account No": "987654321"
  }
];

const wbInvalidBoid = XLSX.utils.book_new();
const wsInvalidBoid = XLSX.utils.json_to_sheet(invalidBoidRows);
XLSX.utils.book_append_sheet(wbInvalidBoid, wsInvalidBoid, "InvalidBOID");
XLSX.writeFile(wbInvalidBoid, path.join(FIXTURES_DIR, "edge_case_invalid_boid.xlsx"));
console.log("✓ Created edge_case_invalid_boid.xlsx");

console.log("\nAll 8 section test fixture files successfully generated in test-fixtures/!");
