import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { ExcelParser } from "../src/lib/excel-parser";
import { ValidationEngine } from "../src/lib/validation-engine";
import { BankParser } from "../src/lib/bank-parser";
import { importFromExcel } from "../src/lib/xlsx-utils";

async function run() {
  console.log("=== STARTING COMPREHENSIVE UPLOAD FIXTURES VERIFICATION ===");
  const fixturesDir = path.resolve(process.cwd(), "test-fixtures");
  const files = fs.readdirSync(fixturesDir);
  console.log(`Found ${files.length} fixture files in ${fixturesDir}:`, files);

  // 1. Test ExcelParser on Dividend Payables
  console.log("\n--- 1. Testing Section 1: Dividend Payables ---");
  const divPath = path.join(fixturesDir, "section1_dividend_payables.xlsx");
  const divBuf = fs.readFileSync(divPath);
  const divParsed = await ExcelParser.parseBuffer(divBuf, "section1_dividend_payables.xlsx");
  console.log(`Dividend File Type detected: ${divParsed.fileType}`);
  console.log(`Sheets detected: ${divParsed.sheets.length}`);
  divParsed.sheets.forEach((s) => {
    console.log(
      `  Sheet: "${s.sheetName}", Type: ${s.sheetType}, Rows: ${s.rowCount}, Mapped cols:`,
      Object.keys(s.mapping || {}),
    );
    console.log(
      `  Totals: Gross=${s.totalAmount}, Tax=${s.totalTax}, Net=${s.totalNet}, Kitta=${s.totalKitta}`,
    );
  });

  const divErrors = await ValidationEngine.validateBatch(
    divParsed.sheets[0].rows,
    divParsed.sheets[0].mapping as any,
    undefined,
    divParsed.fileType,
  );
  console.log(`Validation errors on valid dividend fixture: ${divErrors.length}`);
  divErrors.forEach((e) => console.log(`  Row ${e.row}: ${e.message} (${e.type})`));

  // 2. Test ExcelParser on Debenture / Interest Payables
  console.log("\n--- 2. Testing Section 2: Debenture Interest Payables ---");
  const debPath = path.join(fixturesDir, "section2_debenture_interest.xlsx");
  const debBuf = fs.readFileSync(debPath);
  const debParsed = await ExcelParser.parseBuffer(debBuf, "section2_debenture_interest.xlsx");
  console.log(`Debenture File Type detected: ${debParsed.fileType}`);
  console.log(`Sheets detected: ${debParsed.sheets.length}`);
  debParsed.sheets.forEach((s) => {
    console.log(
      `  Sheet: "${s.sheetName}", Type: ${s.sheetType}, Rows: ${s.rowCount}, Mapped cols:`,
      Object.keys(s.mapping || {}),
    );
    console.log(`  Totals: Gross=${s.totalAmount}, Tax=${s.totalTax}, Net=${s.totalNet}`);
  });
  const debErrors = await ValidationEngine.validateBatch(
    debParsed.sheets[0].rows,
    debParsed.sheets[0].mapping as any,
    undefined,
    debParsed.fileType,
  );
  console.log(`Validation errors on valid debenture fixture: ${debErrors.length}`);
  debErrors.forEach((e) => console.log(`  Row ${e.row}: ${e.message} (${e.type})`));

  // 3. Test ExcelParser on Mutual Fund Payables
  console.log("\n--- 3. Testing Section 3: Mutual Fund Payables ---");
  const mfPath = path.join(fixturesDir, "section3_mutual_fund.xlsx");
  const mfBuf = fs.readFileSync(mfPath);
  const mfParsed = await ExcelParser.parseBuffer(mfBuf, "section3_mutual_fund.xlsx");
  console.log(`Mutual Fund File Type detected: ${mfParsed.fileType}`);
  console.log(`Sheets detected: ${mfParsed.sheets.length}`);
  mfParsed.sheets.forEach((s) => {
    console.log(
      `  Sheet: "${s.sheetName}", Type: ${s.sheetType}, Rows: ${s.rowCount}, Mapped cols:`,
      Object.keys(s.mapping || {}),
    );
    console.log(`  Totals: Gross=${s.totalAmount}, Tax=${s.totalTax}, Net=${s.totalNet}`);
  });
  const mfErrors = await ValidationEngine.validateBatch(
    mfParsed.sheets[0].rows,
    mfParsed.sheets[0].mapping as any,
    undefined,
    mfParsed.fileType,
  );
  console.log(`Validation errors on valid mutual fund fixture: ${mfErrors.length}`);
  mfErrors.forEach((e) => console.log(`  Row ${e.row}: ${e.message} (${e.type})`));

  // 4. Test BankParser on Bank Statement (xlsx and csv)
  console.log("\n--- 4. Testing Section 4: Bank Statement Reconciliation ---");
  const bankXlsxPath = path.join(fixturesDir, "section4_bank_statement.xlsx");
  const bankXlsxBuf = fs.readFileSync(bankXlsxPath);
  const bankXlsxParsed = await BankParser.parseExcelSettlement(
    new File([bankXlsxBuf], "section4_bank_statement.xlsx"),
  );
  console.log(`Bank Statement XLSX: txnCount=${bankXlsxParsed.length}`);
  if (bankXlsxParsed.length > 0) {
    console.log("  First bank record sample:", bankXlsxParsed[0]);
  }

  const bankCsvPath = path.join(fixturesDir, "section4_bank_statement.csv");
  const bankCsvBuf = fs.readFileSync(bankCsvPath);
  const bankCsvParsed = await BankParser.parseBankStatement(
    new File([bankCsvBuf], "section4_bank_statement.csv"),
  );
  console.log(`Bank Statement CSV: txnCount=${bankCsvParsed.length}`);
  if (bankCsvParsed.length > 0) {
    console.log("  First bank record sample:", bankCsvParsed[0]);
  }

  // 5. Test importFromExcel on Clients Master
  console.log("\n--- 5. Testing Section 5: Clients Master Data ---");
  const clientPath = path.join(fixturesDir, "section5_clients_master.xlsx");
  const clientBuf = fs.readFileSync(clientPath);
  const clientRows = await importFromExcel(new File([clientBuf], "section5_clients_master.xlsx"));
  console.log(`Clients Master Rows parsed: ${clientRows.length}`);
  console.log("  Sample row:", clientRows[0]);

  // 6. Test importFromExcel on Companies Master
  console.log("\n--- 6. Testing Section 6: Companies Master Data ---");
  const compPath = path.join(fixturesDir, "section6_companies_master.xlsx");
  const compBuf = fs.readFileSync(compPath);
  const compRows = await importFromExcel(new File([compBuf], "section6_companies_master.xlsx"));
  console.log(`Companies Master Rows parsed: ${compRows.length}`);
  console.log("  Sample row:", compRows[0]);

  // 7. Test Edge Case: Math Mismatch
  console.log("\n--- 7. Testing Edge Case: Math Mismatch ---");
  const mathPath = path.join(fixturesDir, "edge_case_math_mismatch.xlsx");
  const mathBuf = fs.readFileSync(mathPath);
  const mathParsed = await ExcelParser.parseBuffer(mathBuf, "edge_case_math_mismatch.xlsx");
  const mathErrors = await ValidationEngine.validateBatch(
    mathParsed.sheets[0].rows,
    mathParsed.sheets[0].mapping as any,
    undefined,
    mathParsed.fileType,
  );
  console.log(`Validation errors on Math Mismatch fixture: ${mathErrors.length}`);
  mathErrors.forEach((e) => console.log(`  Row ${e.row}: ${e.message} (${e.type})`));

  // 8. Test Edge Case: Invalid BOID
  console.log("\n--- 8. Testing Edge Case: Invalid BOID ---");
  const boidPath = path.join(fixturesDir, "edge_case_invalid_boid.xlsx");
  const boidBuf = fs.readFileSync(boidPath);
  const boidParsed = await ExcelParser.parseBuffer(boidBuf, "edge_case_invalid_boid.xlsx");
  const boidErrors = await ValidationEngine.validateBatch(
    boidParsed.sheets[0].rows,
    boidParsed.sheets[0].mapping as any,
    undefined,
    boidParsed.fileType,
  );
  console.log(`Validation errors on Invalid BOID fixture: ${boidErrors.length}`);
  boidErrors.forEach((e) => console.log(`  Row ${e.row}: ${e.message} (${e.type})`));

  console.log("\n=== VERIFICATION FINISHED SUCCESSFULLY ===");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
