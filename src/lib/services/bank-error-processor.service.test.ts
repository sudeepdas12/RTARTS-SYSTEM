import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { BankErrorProcessorService, BankErrorRow } from "./bank-error-processor.service";

describe("BankErrorProcessorService", () => {
  it("should segregate bank rejection rows from bank response file", async () => {
    // Construct sample bank response data containing 1 success and 2 rejections
    const sampleHeaders = [
      "Instruction ID",
      "Beneficiary Name",
      "Account No",
      "Bank Name",
      "Amount",
      "Status",
      "Reject Remarks",
    ];
    const sampleRows = [
      [
        "0201260721JWX461",
        "Ram Bahadur Shrestha",
        "0123456789012345",
        "Nabil Bank",
        5000,
        "ACSC",
        "Success",
      ],
      [
        "0201260721JWX462",
        "Sita Devi Sharma",
        "0987654321098765",
        "Global IME Bank",
        3500,
        "RJCT",
        "Account Closed",
      ],
      [
        "0201260721JWX463",
        "Hari Prasad Thapa",
        "1122334455667788",
        "NIC Asia Bank",
        12000,
        "FAILED",
        "Invalid Account Number",
      ],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([sampleHeaders, ...sampleRows]);
    XLSX.utils.book_append_sheet(wb, ws, "Returns");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const file = new File([buffer], "ConnectIPS_Return_Batch.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const parsed = await BankErrorProcessorService.parseBankResponseFile(file);

    expect(parsed.allRowsCount).toBe(3);
    expect(parsed.errorRows.length).toBe(2);

    // Verify first segregated error
    expect(parsed.errorRows[0].beneficiaryName).toBe("Sita Devi Sharma");
    expect(parsed.errorRows[0].instructionId).toBe("0201260721JWX462");
    expect(parsed.errorRows[0].amount).toBe(3500);
    expect(parsed.errorRows[0].errorReason).toBe("Account Closed");

    // Verify second segregated error
    expect(parsed.errorRows[1].beneficiaryName).toBe("Hari Prasad Thapa");
    expect(parsed.errorRows[1].instructionId).toBe("0201260721JWX463");
    expect(parsed.errorRows[1].amount).toBe(12000);
    expect(parsed.errorRows[1].errorReason).toBe("Invalid Account Number");
  });

  it("should handle error reports where status is headerless or named reason", async () => {
    const sampleHeaders = ["Client Name", "Account", "Payable Amount", "Error Message"];
    const sampleRows = [
      ["Krishna Bahadur", "5544332211009988", "15000.50", "Beneficiary Name Mismatch"],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([sampleHeaders, ...sampleRows]);
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const file = new File([buffer], "Bank_Rejections.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const parsed = await BankErrorProcessorService.parseBankResponseFile(file);
    expect(parsed.errorRows.length).toBe(1);
    expect(parsed.errorRows[0].amount).toBe(15000.5);
    expect(parsed.errorRows[0].errorReason).toBe("Beneficiary Name Mismatch");
  });
});
