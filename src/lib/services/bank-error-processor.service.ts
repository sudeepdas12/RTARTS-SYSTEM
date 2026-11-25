import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { exportToExcel } from "@/lib/xlsx-utils";

export interface BankErrorRow {
  rowNumber: number;
  instructionId?: string;
  referenceId?: string;
  batchId?: string;
  accountNumber?: string;
  bankName?: string;
  beneficiaryName?: string;
  amount: number;
  status: string;
  errorReason: string;
  matchedPayableId?: string;
  matchedClientName?: string;
  matchedBoid?: string;
  payableType?: "dividend" | "interest" | "mutual_fund";
}

export interface BankErrorProcessingResult {
  fileName: string;
  totalRows: number;
  segregatedErrorCount: number;
  matchedPayablesCount: number;
  totalRemainingPayableAmount: number;
  errors: string[];
  items: BankErrorRow[];
}

export const BankErrorProcessorService = {
  /**
   * Parse an uploaded bank response/error file and segregate failure rows.
   */
  async parseBankResponseFile(file: File): Promise<{
    allRowsCount: number;
    errorRows: BankErrorRow[];
  }> {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    if (!workbook.SheetNames.length) {
      throw new Error("Uploaded workbook contains no sheets.");
    }

    const prioritizedSheets = workbook.SheetNames.filter((name) =>
      /late\s*[_-]?\s*(rtn|return)|error|reject|fail|return/i.test(name),
    );
    const sheetsToScan =
      prioritizedSheets.length > 0 ? prioritizedSheets : [workbook.SheetNames[0]];

    const errorRows: BankErrorRow[] = [];
    let totalRowsCount = 0;

    for (const sheetName of sheetsToScan) {
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null });
      if (!rawRows || rawRows.length === 0) continue;

      const isLateReturnContext =
        /late\s*[_-]?\s*(rtn|return)|error\s*report|\breturn\b|\breject/i.test(
          `${file.name} ${sheetName}`,
        );

      // Find header row strictly (search first 10 non-empty rows)
      let headerIndex = -1;
      let headers: string[] = [];

      for (let i = 0; i < Math.min(10, rawRows.length); i++) {
        const row = rawRows[i];
        if (!Array.isArray(row)) continue;
        const lowerCols = row.map((c) =>
          String(c ?? "")
            .trim()
            .toLowerCase(),
        );
        const headerSignalCount = lowerCols.filter(
          (h) =>
            h.includes("instruction") ||
            h.includes("reference") ||
            h.includes("beneficiary") ||
            h.includes("shareholder") ||
            h.includes("account") ||
            h.includes("amount") ||
            h.includes("ach status") ||
            h === "status" ||
            h.includes("tx status") ||
            h.includes("reason") ||
            h.includes("remarks") ||
            h.includes("error message"),
        ).length;
        // Require >= 2 header keyword signals so a headerless data row with "FAILED"/"Account closed" is not eaten as a header
        if (headerSignalCount >= 2) {
          headerIndex = i;
          headers = lowerCols;
          break;
        }
      }

      const findCol = (patterns: string[], excludePatterns: string[] = []): number => {
        if (headerIndex < 0) return -1;
        // Exact header match by pattern priority first
        for (const p of patterns) {
          const exactIdx = headers.findIndex(
            (h) => h && !excludePatterns.some((ex) => h.includes(ex)) && h === p,
          );
          if (exactIdx >= 0) return exactIdx;
        }
        // Substring match by pattern priority
        for (const p of patterns) {
          const subIdx = headers.findIndex(
            (h) => h && !excludePatterns.some((ex) => h.includes(ex)) && h.includes(p),
          );
          if (subIdx >= 0) return subIdx;
        }
        return -1;
      };

      let instructionCol = findCol([
        "transid",
        "transaction id",
        "connectips ref",
        "instruction id",
        "instructionid",
        "instruction",
      ]);
      let refCol = findCol([
        "reference id",
        "referenceid",
        "endtoendid",
        "ref id",
        "payment ref",
        "reference",
      ]);
      const batchCol = findCol(["batch.sessionid", "batch id", "batch", "lot"]);
      let accCol = findCol([
        "creditor account",
        "creditoraccount",
        "beneficiary account",
        "account",
        "acc no",
        "acc_no",
        "acct",
      ]);
      const bankCol = findCol(["creditor agent", "bank name", "beneficiary bank", "bank"]);
      let nameCol = findCol([
        "creditor name",
        "creditorname",
        "beneficiary name",
        "shareholder",
        "client name",
        "name",
      ]);
      let amtCol = findCol(["amount", "net amount", "payable amount", "amt"]);
      let statusCol = findCol(
        [
          "achstatus",
          "ach status",
          "achstatus.description",
          "credit status",
          "txn status",
          "status",
          "state",
        ],
        ["statusid", "status id", "replystatus"],
      );
      let reasonCol = findCol([
        "achmainreason",
        "achmainadditionalinfo",
        "return remarks",
        "rejection reason",
        "creditorreplyreason",
        "error message",
        "errormessage",
        "reject remarks",
        "status remarks",
        "reason",
        "remarks",
        "error",
      ]);

      const dataRows = headerIndex >= 0 ? rawRows.slice(headerIndex + 1) : rawRows;
      totalRowsCount += dataRows.length;

      // Positional inference when file is headerless (e.g., NCHL/ConnectIPS ERROR REPORT BIFF export)
      if (headerIndex < 0 && dataRows.length > 0) {
        const sampleRows = dataRows.filter((r) => Array.isArray(r)).slice(0, 15);
        const maxCols = sampleRows.reduce((m, r) => Math.max(m, r.length), 0);
        for (let colIdx = 0; colIdx < maxCols; colIdx++) {
          const vals = sampleRows.map((r) => String(r[colIdx] ?? "").trim()).filter(Boolean);
          if (vals.length === 0) continue;

          if (
            statusCol < 0 &&
            vals.every((v) => /^(ACSC|RJCT|FAILED|REJECTED|RETURNED?|ERROR|SUCCESS)\b/i.test(v))
          ) {
            statusCol = colIdx;
            continue;
          }
          if (
            amtCol < 0 &&
            vals.every((v) => {
              const num = Number(v.replace(/[,\s]/g, ""));
              return !Number.isNaN(num) && num > 0;
            }) &&
            vals.some((v) => Number(v.replace(/[,\s]/g, "")) >= 200 || v.includes("."))
          ) {
            amtCol = colIdx;
            continue;
          }
          if (
            accCol < 0 &&
            vals.some(
              (v) => /^AC[_-]/i.test(v) || /^\d{8,20}$/.test(v) || /^[A-Z0-9_-]{6,24}$/i.test(v),
            ) &&
            !vals.some((v) => /\s/.test(v))
          ) {
            accCol = colIdx;
            continue;
          }
          if (reasonCol < 0 && vals.some((v) => /\s/.test(v))) {
            reasonCol = colIdx;
          } else if (nameCol < 0 && vals.some((v) => /[A-Za-z]{3,}/.test(v))) {
            nameCol = colIdx;
          } else if (instructionCol < 0 && vals.every((v) => /^\d{6,20}$/.test(v))) {
            instructionCol = colIdx;
          } else if (refCol < 0 && vals.every((v) => /^[A-Z0-9_-]{3,}$/i.test(v))) {
            refCol = colIdx;
          }
        }
      }

      dataRows.forEach((row: any[], idx: number) => {
        if (
          !Array.isArray(row) ||
          row.every((c) => c === undefined || c === null || String(c).trim() === "")
        ) {
          return;
        }

        const instructionId =
          instructionCol >= 0 ? String(row[instructionCol] ?? "").trim() : undefined;
        const referenceId = refCol >= 0 ? String(row[refCol] ?? "").trim() : undefined;
        const batchId = batchCol >= 0 ? String(row[batchCol] ?? "").trim() : undefined;
        const accountNumber = accCol >= 0 ? String(row[accCol] ?? "").trim() : undefined;
        const bankName = bankCol >= 0 ? String(row[bankCol] ?? "").trim() : undefined;
        const beneficiaryName = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : undefined;

        const rawAmt = amtCol >= 0 ? row[amtCol] : 0;
        const numAmt = Number(String(rawAmt ?? "").replace(/[,\s]/g, ""));
        const amount = Number.isNaN(numAmt) ? 0 : numAmt;

        const rawStatus = statusCol >= 0 ? String(row[statusCol] ?? "").trim() : "";
        const rawReason = reasonCol >= 0 ? String(row[reasonCol] ?? "").trim() : "";

        // Skip trailing Excel SUM / subtotal rows that carry only an amount with no beneficiary, account, status, or ref
        const hasIdentityOrStatus = Boolean(
          instructionId ||
          referenceId ||
          accountNumber ||
          beneficiaryName ||
          rawStatus ||
          rawReason,
        );
        if (!hasIdentityOrStatus) {
          return;
        }

        const upperStatus = rawStatus.toUpperCase();
        const isAcscLateReturn =
          isLateReturnContext &&
          (upperStatus === "ACSC" ||
            upperStatus.startsWith("ACSC") ||
            upperStatus.includes("ACCEPTED SETTLEMENT"));

        const isRejectStatus =
          isAcscLateReturn ||
          upperStatus === "RJCT" ||
          upperStatus === "REJECTED" ||
          upperStatus === "FAILED" ||
          upperStatus === "RETURN" ||
          upperStatus === "RETURNED" ||
          upperStatus === "ERROR" ||
          upperStatus.includes("FAIL") ||
          upperStatus.includes("REJECT") ||
          upperStatus.includes("RETURN");

        const hasErrorReason =
          Boolean(rawReason) &&
          !/^(success|ok|completed|acsc|processed|none|na|n\/a)$/i.test(rawReason);

        if (isRejectStatus || hasErrorReason) {
          errorRows.push({
            rowNumber: (headerIndex >= 0 ? headerIndex + 2 : 1) + idx,
            instructionId: instructionId || undefined,
            referenceId: referenceId || undefined,
            batchId: batchId || undefined,
            accountNumber: accountNumber || undefined,
            bankName: bankName || undefined,
            beneficiaryName: beneficiaryName || undefined,
            amount,
            status: isAcscLateReturn ? "LATE_RETURN (ACSC)" : rawStatus || "REJECTED",
            errorReason:
              rawReason ||
              (isAcscLateReturn ? "NCHL Late Return (ACSC)" : "Bank rejection (unspecified error)"),
          });
        }
      });
    }

    if (totalRowsCount === 0 && errorRows.length === 0) {
      throw new Error("File contains insufficient data (no error or response rows found).");
    }

    return {
      allRowsCount: totalRowsCount,
      errorRows,
    };
  },

  /**
   * Ingest segregated error file, match against payables/payments, and update remaining payable balances.
   */
  async processAndApplyBankErrors(
    file: File,
    companyId?: string,
    client: any = supabase,
  ): Promise<BankErrorProcessingResult> {
    const { allRowsCount, errorRows } = await this.parseBankResponseFile(file);

    if (errorRows.length === 0) {
      return {
        fileName: file.name,
        totalRows: allRowsCount,
        segregatedErrorCount: 0,
        matchedPayablesCount: 0,
        totalRemainingPayableAmount: 0,
        errors: ["No error/rejection rows were found in the uploaded file."],
        items: [],
      };
    }

    let matchedCount = 0;
    let totalRemaining = 0;
    const errors: string[] = [];

    // Process each failed bank record
    for (const item of errorRows) {
      try {
        let matchedPayment: any = null;

        // 1. Try matching by connectips_ref / instructionId
        if (item.instructionId) {
          let qInst = client
            .from("payments")
            .select("id, payable_id, payable_type, company_id, client_id, net_amount, status")
            .eq("connectips_ref", item.instructionId);
          if (companyId) qInst = qInst.eq("company_id", companyId);
          const { data: pByInst } = await qInst.maybeSingle();
          if (pByInst) matchedPayment = pByInst;
        }

        // 2. Try matching by payment_reference / referenceId
        if (!matchedPayment && item.referenceId) {
          let qRef = client
            .from("payments")
            .select("id, payable_id, payable_type, company_id, client_id, net_amount, status")
            .eq("payment_reference", item.referenceId);
          if (companyId) qRef = qRef.eq("company_id", companyId);
          const { data: pByRef } = await qRef.maybeSingle();
          if (pByRef) matchedPayment = pByRef;
        }

        // 3. Try matching by account number and exact amount
        if (!matchedPayment && item.accountNumber && item.amount > 0) {
          let pQuery = client
            .from("payments")
            .select("id, payable_id, payable_type, company_id, client_id, net_amount, status")
            .eq("bank_account_no", item.accountNumber)
            .eq("net_amount", item.amount);

          if (companyId) {
            pQuery = pQuery.eq("company_id", companyId);
          }
          const { data: pByAcc } = await pQuery.limit(1).maybeSingle();
          if (pByAcc) matchedPayment = pByAcc;
        }

        if (matchedPayment) {
          item.matchedPayableId = matchedPayment.payable_id;
          const pTypeLower = String(matchedPayment.payable_type || "").toLowerCase();
          item.payableType = pTypeLower.includes("interest")
            ? "interest"
            : pTypeLower.includes("mutual")
              ? "mutual_fund"
              : "dividend";

          // Fetch client info for enriched report
          if (matchedPayment.client_id) {
            const { data: clientRow } = await client
              .from("clients")
              .select("full_name, boid")
              .eq("id", matchedPayment.client_id)
              .maybeSingle();
            if (clientRow) {
              item.matchedClientName = clientRow.full_name;
              item.matchedBoid = clientRow.boid;
            }
          }

          // Mark payment status as 'Returned'
          await client
            .from("payments")
            .update({
              status: "Returned",
              remarks: `Bank Error: ${item.errorReason}`,
              reversal_reason: item.errorReason,
              reversed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", matchedPayment.id);

          // Update underlying payable:
          // Keep remaining_amount = net_payable, payment_status = Pending, returned_status = errorReason
          const targetTable =
            item.payableType === "interest"
              ? "interest_payables"
              : item.payableType === "mutual_fund"
                ? "mutual_fund_payables"
                : "dividend_payables";

          const { data: payableRow } = await client
            .from(targetTable)
            .select("net_payable, paid_amount")
            .eq("id", matchedPayment.payable_id)
            .single();

          const netPay = Number(payableRow?.net_payable || item.amount);

          await client
            .from(targetTable)
            .update({
              payment_status: "Pending",
              returned_status: `Bank Error: ${item.errorReason}`,
              remaining_amount: netPay,
              paid_amount: 0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", matchedPayment.payable_id);

          matchedCount += 1;
          totalRemaining += netPay;
        } else {
          // If no payment record matched, attempt matching direct pending payable by account & amount
          if (item.accountNumber && item.amount > 0) {
            let clientQ = client
              .from("clients")
              .select("id, full_name, boid")
              .eq("bank_account_no", item.accountNumber);
            if (companyId) clientQ = clientQ.eq("company_id", companyId);
            const { data: clients } = await clientQ.limit(1);

            if (clients && clients.length > 0) {
              const matchedClient = clients[0];
              item.matchedClientName = matchedClient.full_name;
              item.matchedBoid = matchedClient.boid;

              for (const [candidateType, tableName] of [
                ["dividend", "dividend_payables"],
                ["interest", "interest_payables"],
                ["mutual_fund", "mutual_fund_payables"],
              ] as const) {
                let payQ = client
                  .from(tableName)
                  .select("id, net_payable")
                  .eq("client_id", matchedClient.id)
                  .eq("net_payable", item.amount);
                if (companyId) payQ = payQ.eq("company_id", companyId);

                const { data: foundPayable } = await payQ.limit(1).maybeSingle();
                if (foundPayable) {
                  item.matchedPayableId = foundPayable.id;
                  item.payableType = candidateType;
                  await client
                    .from(tableName)
                    .update({
                      payment_status: "Pending",
                      returned_status: `Bank Error: ${item.errorReason}`,
                      remaining_amount: Number(foundPayable.net_payable),
                      paid_amount: 0,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", foundPayable.id);
                  matchedCount += 1;
                  totalRemaining += Number(foundPayable.net_payable);
                  break;
                }
              }
            }
          }
        }
      } catch (rowErr: any) {
        errors.push(`Row ${item.rowNumber}: ${rowErr?.message || String(rowErr)}`);
      }
    }

    return {
      fileName: file.name,
      totalRows: allRowsCount,
      segregatedErrorCount: errorRows.length,
      matchedPayablesCount: matchedCount,
      totalRemainingPayableAmount: totalRemaining,
      errors,
      items: errorRows,
    };
  },

  /**
   * Export segregated bank error list to Excel format.
   */
  async exportSegregatedErrorReport(items: BankErrorRow[], filename = "Bank_Error_Report") {
    const exportRows = items.map((it, idx) => ({
      "S.N.": idx + 1,
      "Shareholder Name": it.matchedClientName || it.beneficiaryName || "—",
      "BOID / Folio": it.matchedBoid || "—",
      "Bank Name": it.bankName || "—",
      "Account Number": it.accountNumber || "—",
      "Amount (NPR)": it.amount,
      "Bank Error Reason": it.errorReason,
      "Instruction / Ref ID": it.instructionId || it.referenceId || "—",
      Status: "Remaining Payable (Unpaid)",
    }));

    await exportToExcel(exportRows, filename, "Segregated Bank Errors");
  },
};
