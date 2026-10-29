import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "./services/database";
import { ParsedExcelData } from "./excel-parser";
import { RECONCILIATION_TOLERANCE_NPR, BULK_CHUNK_SIZE } from "./constants";
import { toPaisa, fromPaisa, roundToPaisa } from "./currency";

/**
 * Compares two amounts in integer paisa to eliminate IEEE 754 float drift.
 */
export const amountEqualsPaisa = (
  amt1: number,
  amt2: number,
  tolerancePaisa: number = Math.round(RECONCILIATION_TOLERANCE_NPR * 100),
): boolean => {
  return Math.abs(toPaisa(amt1) - toPaisa(amt2)) <= tolerancePaisa;
};

export interface CategorySummary {
  categoryName: string;
  rowCount: number;
  totalKitta: number;
  totalGrossAmount: number;
  totalTaxAmount: number;
  totalNetPayable: number;
  matchedCount: number;
  mismatchedCount: number;
  pledgedCount: number;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  bankName?: string;
  accountNo?: string;
  beneficiaryName?: string;
  status?: string;
  referenceId?: string;
  batchId?: string;
  instructionId?: string;
  fileName?: string;
  category?:
    | "PAYOUT_DEBIT"
    | "REJECT_RETURN"
    | "FUNDING_DEPOSIT"
    | "BANK_CHARGES"
    | "NRB_CIRCULAR"
    | "OTHER";
  isLiquiditySweep?: boolean;
  accountHolder?: string;
}

export interface ReconciliationMatch {
  id: string;
  boid: string;
  shareholderName: string;
  category: string;
  kitta: number;
  excelAmount: number;
  systemAmount: number;
  difference: number;
  status: "Matched" | "Under_Paid" | "Over_Paid" | "Missing" | "Pledged" | "Rejected" | "Pending";
  bankName?: string;
  bankAccountNo?: string;
  pledgeFlag?: boolean;
  lotName?: string;
  clientId?: string | null;
  companyId?: string | null;
  payableType?: "dividend" | "interest" | "mutual_fund" | null;
  payableId?: string | null;
  paymentId?: string | null;
  batchId?: string | null;
  paymentStatus?: string | null;
  fiscalYear?: string | null;
  transactionDate?: string | null;
  transactionDescription?: string | null;
  sourceType?: "excel" | "bank_statement";
  matchSources?: string[]; // Track which sources matched: ['payable', 'payment', 'bank_statement']
  instructionId?: string;
  referenceId?: string;
  confidenceScore?: number;
}

export interface ComprehensiveReconciliationReport {
  fileType: string;
  sourceType: "excel" | "bank_statement";
  fileName: string;
  categories: CategorySummary[];
  matches: ReconciliationMatch[];
  grandTotal: {
    totalRecords: number;
    totalKitta: number;
    totalGrossAmount: number;
    totalTaxAmount: number;
    totalNetPayable: number;
    matchedRecords: number;
    partialRecords?: number;
    discrepancyCount: number;
    pledgedCount: number;
    rejectedCount: number;
  };
  summary: {
    matchedFromPayable: number;
    matchedFromPayment: number;
    matchedFromBank: number;
    partialMatches?: number;
    missingInSystem: number;
    unmatchedBankTransactions: number;
  };
}

type PayableRow = {
  id: string;
  company_id: string;
  client_id: string;
  net_payable: number;
  gross_amount: number;
  payment_status: string;
  payable_type: "dividend" | "interest" | "mutual_fund";
  fiscal_year?: string | null;
  days_count?: number | null;
  paid_amount?: number | null;
  remaining_amount?: number | null;
};

type PaymentRow = {
  id: string;
  company_id: string | null;
  client_id: string | null;
  net_amount: number;
  bank_name: string | null;
  bank_account_no: string | null;
  payment_status: string | null;
  payable_type: string | null;
  payable_id: string | null;
  paid_amount?: number | null;
  connectips_ref?: string | null;
};

const normalizeString = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const parseNumber = (value: unknown): number => {
  const raw = normalizeString(value).replace(/,/g, "");
  const num = Number(raw);
  return Number.isNaN(num) ? 0 : num;
};

const normalizeAccountKey = (value: unknown): string =>
  normalizeString(value)
    .replace(/[^0-9A-Za-z]/g, "")
    .replace(/^0+/, "")
    .toUpperCase();

const getMappedValue = (
  row: any,
  mappingKey: string | undefined,
  fallbackKeys: string[],
): string => {
  if (mappingKey && row[mappingKey] !== undefined && row[mappingKey] !== null) {
    return normalizeString(row[mappingKey]);
  }
  for (const key of fallbackKeys) {
    if (row[key] !== undefined && row[key] !== null) {
      return normalizeString(row[key]);
    }
  }
  // Case-insensitive and punctuation-insensitive fallback lookup across row keys
  const rowEntries = Object.entries(row);
  for (const fbKey of fallbackKeys) {
    const cleanFb = fbKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const [rKey, rVal] of rowEntries) {
      if (rVal !== undefined && rVal !== null && String(rVal).trim() !== "") {
        const cleanR = rKey.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanR === cleanFb) {
          return normalizeString(rVal);
        }
      }
    }
  }
  return "";
};

const buildAmountKey = (amount: number) => amount.toFixed(2);
const buildAccountAmountKey = (account: string, amount: number) =>
  `${normalizeAccountKey(account)}|${buildAmountKey(amount)}`;

export const ReconciliationEngine = {
  /**
   * 5-WAY RECONCILIATION for Excel files:
   * 1. Excel rows vs DB Payables (dividend_payables, interest_payables, mutual_fund_payables)
   * 2. Excel rows vs Payments (actual payments made)
   * 3. Excel rows vs Bank Statements (transactions)
   * 4. Cross-reference: Payables vs Payments
   * 5. Cross-reference: Payments vs Bank Statements
   */
  async analyzeParsedExcel(
    parsedData: ParsedExcelData,
    options?: { companyId?: string | null; client?: any },
  ): Promise<ComprehensiveReconciliationReport> {
    const db = options?.client || supabase;
    const filterByCompany = Boolean(options?.companyId && options.companyId !== "all");
    const companyId = filterByCompany ? options!.companyId! : null;

    const boids = parsedData.sheets
      .flatMap((sheet) => {
        if (sheet.sheetType === "SUMMARY") return [];
        const boidCol = Object.entries(sheet.mapping).find(([_, f]) => f === "boid")?.[0];
        return sheet.rows.flatMap((row) => {
          const list: string[] = [];
          const primaryBoid = normalizeString(
            row.boid ||
              (boidCol ? row[boidCol] : null) ||
              getMappedValue(row, undefined, [
                "BOID",
                "BENEFICIARY ID",
                "CLIENT ID",
                "BENEFICIARY_ID",
                "CLIENT_ID",
              ]),
          );
          if (primaryBoid) list.push(primaryBoid);
          // Also collect any alternate 16-digit BOID in row values (e.g. transfer/seller BOID)
          for (const val of Object.values(row)) {
            if (typeof val === "string") {
              const cleaned = val.trim();
              if (/^\d{16}$/.test(cleaned) && !list.includes(cleaned)) {
                list.push(cleaned);
              }
            }
          }
          return list;
        });
      })
      .filter(Boolean);

    // Helper to fetch in safe chunks to avoid PostgREST URL length limits (max 100 UUIDs per GET URL)
    const fetchInChunks = async <T>(
      items: string[],
      fetcher: (chunk: string[]) => PromiseLike<{ data: T[] | null; error?: any }> | any,
    ): Promise<T[]> => {
      if (!items || items.length === 0) return [];
      const safeChunkSize = 200;
      const results: T[] = [];
      for (let i = 0; i < items.length; i += safeChunkSize) {
        const chunk = items.slice(i, i + safeChunkSize);
        const { data, error } = await fetcher(chunk);
        if (error) console.warn("Chunk fetch warning:", error.message);
        if (data) results.push(...data);
      }
      return results;
    };

    // Load all related data in parallel scoped by companyId
    const [clients, payables, paymentsResult, bankStatementsResult] = await Promise.all([
      // 1. Load all client profiles matching the BOIDs in chunks
      fetchInChunks(boids, (chunk) => {
        return (db as any)
          .from("clients")
          .select("id,boid,company_id,full_name,bank_name,bank_account_no")
          .in("boid", chunk);
      }),

      // 2. Load all payables (dividend, interest, mutual_fund) in chunks scoped to companyId
      (async () => {
        const clientsData = await fetchInChunks(boids, (chunk) => {
          return db.from("clients").select("id").in("boid", chunk);
        });
        const clientIds = clientsData?.map((c: any) => c.id) || [];
        if (clientIds.length === 0) return [];

        const [divData, intData, mfData] = await Promise.all([
          fetchInChunks(clientIds, (chunk) => {
            let q = db
              .from("dividend_payables")
              .select(
                "id,company_id,client_id,net_payable,gross_dividend,payment_status,fiscal_year,paid_amount,remaining_amount",
              )
              .in("client_id", chunk);
            if (companyId) q = q.eq("company_id", companyId);
            return q;
          }),
          fetchInChunks(clientIds, (chunk) => {
            let q = db
              .from("interest_payables")
              .select(
                "id,company_id,client_id,net_payable,gross_interest,payment_status,fiscal_year,days_count,paid_amount,remaining_amount",
              )
              .in("client_id", chunk);
            if (companyId) q = q.eq("company_id", companyId);
            return q;
          }),
          fetchInChunks(clientIds, (chunk) => {
            let q = (db as any)
              .from("mutual_fund_payables")
              .select(
                "id,company_id,client_id,net_payable,payment_status,fiscal_year,paid_amount,remaining_amount",
              )
              .in("client_id", chunk);
            if (companyId) q = q.eq("company_id", companyId);
            return q;
          }),
        ]);

        const payablesList: any[] = [];
        divData.forEach((row: any) => payablesList.push({ ...row, payable_type: "dividend" }));
        intData.forEach((row: any) => payablesList.push({ ...row, payable_type: "interest" }));
        mfData.forEach((row: any) => payablesList.push({ ...row, payable_type: "mutual_fund" }));
        return payablesList;
      })(),

      // 3. Load payments
      (() => {
        let q = (db as any)
          .from("payments")
          .select(
            "id,company_id,client_id,net_amount,paid_amount,connectips_ref,bank_name,bank_account_no,status,payable_type,payable_id",
          );
        if (companyId) q = q.eq("company_id", companyId);
        return q;
      })(),

      // 4. Load bank statements
      (db as any)
        .from("bank_statements")
        .select(
          "id,bank_name,account_no,statement_date,file_name,total_transactions,total_credit,is_reconciled",
        )
        .eq("is_reconciled", false),
    ]);

    const payments = (paymentsResult as any).data || [];
    const bankStatements = (bankStatementsResult as any).data || [];

    // Build lookup maps
    const clientsByBoid = new Map<string, any>();
    (clients || []).forEach((c: any) => {
      if (c.boid) {
        const boidKey = String(c.boid).trim();
        // If companyId is provided, prioritize client record belonging to that company
        if (!clientsByBoid.has(boidKey) || (companyId && c.company_id === companyId)) {
          clientsByBoid.set(boidKey, c);
        }
      }
    });

    const payablesByClientId = new Map<string, PayableRow[]>();
    payables.forEach((p: any) => {
      const key = p.client_id;
      if (!payablesByClientId.has(key)) payablesByClientId.set(key, []);
      payablesByClientId.get(key)!.push({
        id: p.id,
        company_id: p.company_id,
        client_id: p.client_id,
        net_payable: Number(p.net_payable ?? 0),
        gross_amount: Number(p.gross_dividend ?? p.gross_interest ?? 0),
        payment_status: String(p.payment_status || ""),
        payable_type: p.payable_type,
        fiscal_year: p.fiscal_year || null,
        days_count: p.days_count != null ? Number(p.days_count) : null,
        paid_amount: p.paid_amount != null ? Number(p.paid_amount) : null,
        remaining_amount: p.remaining_amount != null ? Number(p.remaining_amount) : null,
      });
    });

    const paymentsByClientId = new Map<string, PaymentRow[]>();
    payments.forEach((p: any) => {
      if (!p.client_id) return;
      const key = p.client_id;
      if (!paymentsByClientId.has(key)) paymentsByClientId.set(key, []);
      paymentsByClientId.get(key)!.push({
        id: p.id,
        company_id: p.company_id,
        client_id: p.client_id,
        net_amount: Number(p.net_amount ?? 0),
        paid_amount: Number(p.paid_amount ?? 0),
        connectips_ref: p.connectips_ref || null,
        bank_name: p.bank_name,
        bank_account_no: p.bank_account_no,
        payment_status: p.status || p.payment_status || null,
        payable_type: p.payable_type,
        payable_id: p.payable_id,
      });
    });

    const paymentsByAmount = new Map<string, PaymentRow[]>();
    payments.forEach((p: any) => {
      const netAmt = Number(p.net_amount ?? 0);
      const paidAmt = Number(p.paid_amount ?? 0);
      const key = buildAmountKey(netAmt);
      if (!paymentsByAmount.has(key)) paymentsByAmount.set(key, []);
      paymentsByAmount.get(key)!.push(p);

      if (paidAmt > 0 && Math.abs(paidAmt - netAmt) > 0.01) {
        const paidKey = buildAmountKey(paidAmt);
        if (!paymentsByAmount.has(paidKey)) paymentsByAmount.set(paidKey, []);
        paymentsByAmount.get(paidKey)!.push(p);
      }
    });

    // Reconciliation logic
    const categories: CategorySummary[] = [];
    const matches: ReconciliationMatch[] = [];
    const grandTotal = {
      totalRecords: 0,
      totalKitta: 0,
      totalGrossAmount: 0,
      totalTaxAmount: 0,
      totalNetPayable: 0,
      matchedRecords: 0,
      discrepancyCount: 0,
      pledgedCount: 0,
      rejectedCount: 0,
    };

    const summary = {
      matchedFromPayable: 0,
      matchedFromPayment: 0,
      matchedFromBank: 0,
      missingInSystem: 0,
      unmatchedBankTransactions: 0,
    };

    const usedPayableIds = new Set<string>();
    const usedPaymentIds = new Set<string>();

    parsedData.sheets.forEach((sheet) => {
      if (sheet.sheetType === "SUMMARY") return;

      const getColByField = (target: string): string | undefined =>
        Object.entries(sheet.mapping || {}).find(([_, f]) => f === target)?.[0];

      const boidCol = getColByField("boid");
      const nameCol = getColByField("full_name");
      const kittaCol = getColByField("shares_held");
      const netPayableCol = getColByField("net_payable");
      const bankNameCol = getColByField("bank_name");
      const bankAccountCol = getColByField("bank_account_no");
      const lotNameCol = getColByField("lot_name");
      const instructionCol = getColByField("instruction_id");
      const batchCol = getColByField("batch_id");
      const pledgeCol = getColByField("pledge");
      const statusCol = getColByField("status");

      let matchedInSheet = 0;
      let mismatchedInSheet = 0;
      let pledgedInSheet = 0;

      sheet.rows.forEach((row, idx) => {
        const boid = getMappedValue(row, boidCol, [
          "BOID",
          "BENEFICIARY ID",
          "CLIENT ID",
          "BENEFICIARY_ID",
          "CLIENT_ID",
        ]);
        const name = getMappedValue(row, nameCol, ["NAME", "APPLICANT_NAME", "SHAREHOLDER NAME"]);
        const kitta = parseNumber(
          (kittaCol ? row[kittaCol] : undefined) ??
            row["KITTA"] ??
            row["ALLOTED_QUANTITY"] ??
            row["TOTA KITTA"],
        );
        const rawAmountVal =
          getMappedValue(row, netPayableCol, [
            "NET INTEREST PAYABLE",
            "NET PAYABLE",
            "NET_PAYABLE",
            "NET AMOUNT",
            "NET_AMOUNT",
            "NET_DIV.",
            "NET DIVIDEND",
            "ACTUAL AMOUNT",
            "PAID AMOUNT",
            "TRANSACTION AMOUNT",
            "ROUND UP DIV",
            "ROUNDUP",
            "NET",
            "AMOUNT",
            "AMT",
            "CR_AMT",
          ]) ||
          (netPayableCol ? row[netPayableCol] : undefined) ||
          row["NET"] ||
          row["AMOUNT"] ||
          row["Amount"];
        const excelAmount = parseNumber(rawAmountVal);
        const bankName = getMappedValue(row, bankNameCol, [
          "BANK NAME",
          "BANK",
          "CREDITOR BANK",
          "BANK_NAME",
        ]);
        const bankAccountNo = getMappedValue(row, bankAccountCol, [
          "BANK A/C NO.",
          "BANK A/C NO",
          "BANK ACCOUNT",
          "ACCOUNT NUMBER",
          "ACCOUNT NO",
          "ACCOUNT_NUMBER",
          "CREDITOR ACCOUNT",
          "A/C NO",
          "A/C NO.",
        ]);
        const lotName = getMappedValue(row, lotNameCol, ["LOT", "BATCH"]);
        const instructionId =
          getMappedValue(row, instructionCol, [
            "INSTRUCTION ID",
            "INSTRUCTION_ID",
            "INSTRUCTIONID",
            "INSTRUCTION NO",
            "INSTRUCTION NO.",
            "INSTRUCTION",
            "TXN ID",
            "TRANSACTION ID",
          ]) || undefined;
        const batchIdVal =
          getMappedValue(row, batchCol, [
            "BATCH ID",
            "BATCH_ID",
            "BATCHID",
            "BATCH NO",
            "BATCH NO.",
            "BATCH",
          ]) || undefined;

        const rawPledge = getMappedValue(row, pledgeCol, ["PLEDGE", "REMARKS"]).toUpperCase();
        const pledgeFlag = rawPledge.includes("PLEDGE") || rawPledge === "1";
        const rawStatus = getMappedValue(row, statusCol, [
          "STATUS",
          "REMARKS 1",
          "CREDIT STATUS",
          "TRANSACTION STATUS",
        ]).toUpperCase();

        let client = boid ? clientsByBoid.get(boid) : null;
        // If not matched by primary BOID, check if any other field in the row has a matching BOID (e.g. trading transfer from previous holder)
        if (!client) {
          for (const val of Object.values(row)) {
            if (typeof val === "string") {
              const cleaned = val.trim();
              if (cleaned.length === 16 && clientsByBoid.has(cleaned)) {
                client = clientsByBoid.get(cleaned);
                break;
              }
            }
          }
        }
        const clientId = client?.id || null;

        // 5-WAY MATCHING LOGIC
        let bestPayable: PayableRow | null = null;
        let bestPayment: PaymentRow | null = null;
        const matchSources: string[] = [];

        // Helper to get effective comparison amount for a payable (supporting prorated debenture interest and remaining partial installments)
        const getPayableAmounts = (
          p: PayableRow,
        ): {
          full: number;
          prorated: number | null;
          prorated182: number | null;
          remaining: number | null;
        } => {
          const full = Number(p.net_payable ?? 0);
          const remaining =
            p.remaining_amount != null && Number(p.remaining_amount) > 0
              ? Number(p.remaining_amount)
              : null;
          if (p.payable_type === "interest") {
            const days =
              p.days_count && p.days_count > 0 && p.days_count < 365 ? p.days_count : 183;
            const prorated = Number(((full / 365.0) * days).toFixed(2));
            const prorated182 = Number(((full / 365.0) * 182).toFixed(2));
            return { full, prorated, prorated182, remaining };
          }
          return { full, prorated: null, prorated182: null, remaining };
        };

        const matchesPayableAmount = (p: PayableRow, amt: number): boolean => {
          const { full, prorated, prorated182, remaining } = getPayableAmounts(p);
          if (amountEqualsPaisa(full, amt)) return true;
          if (prorated !== null && amountEqualsPaisa(prorated, amt)) return true;
          if (prorated182 !== null && amountEqualsPaisa(prorated182, amt)) return true;
          if (remaining !== null && amountEqualsPaisa(remaining, amt)) return true;
          return false;
        };

        // SOURCE 1: Match against Payables
        if (clientId) {
          const candidatePayables = (payablesByClientId.get(clientId) || []).filter(
            (p) => !usedPayableIds.has(p.id) && (!companyId || p.company_id === companyId),
          );
          if (candidatePayables.length > 0) {
            // Prioritize exact or within-tolerance amount matches (preferring Pending/unpaid over Paid)
            const exactMatches = candidatePayables.filter((p) =>
              matchesPayableAmount(p, excelAmount),
            );
            if (exactMatches.length > 0) {
              bestPayable =
                exactMatches.find((p) => p.payment_status !== "Paid") || exactMatches[0];
            } else {
              bestPayable = candidatePayables.reduce<PayableRow | null>((best, current) => {
                if (!best) return current;
                const {
                  full: curFull,
                  prorated: curPro,
                  prorated182: cur182,
                  remaining: curRem,
                } = getPayableAmounts(current);
                const curDiff = Math.min(
                  Math.abs(curFull - excelAmount),
                  curPro !== null ? Math.abs(curPro - excelAmount) : Infinity,
                  cur182 !== null ? Math.abs(cur182 - excelAmount) : Infinity,
                  curRem !== null ? Math.abs(curRem - excelAmount) : Infinity,
                );
                const {
                  full: bestFull,
                  prorated: bestPro,
                  prorated182: best182,
                  remaining: bestRem,
                } = getPayableAmounts(best);
                const bestDiff = Math.min(
                  Math.abs(bestFull - excelAmount),
                  bestPro !== null ? Math.abs(bestPro - excelAmount) : Infinity,
                  best182 !== null ? Math.abs(best182 - excelAmount) : Infinity,
                  bestRem !== null ? Math.abs(bestRem - excelAmount) : Infinity,
                );
                return curDiff < bestDiff ? current : best;
              }, null);
            }
          }
        } else if (excelAmount > 0) {
          // Fallback: match by exact amount across company payables when BOID is transferred/traded
          const unassignedCandidates = payables.filter(
            (p) =>
              !usedPayableIds.has(p.id) &&
              (!companyId || p.company_id === companyId) &&
              matchesPayableAmount(p, excelAmount),
          );
          if (unassignedCandidates.length === 1) {
            bestPayable = unassignedCandidates[0];
          }
        }

        if (bestPayable) {
          matchSources.push("payable");
          usedPayableIds.add(bestPayable.id);
        }

        // SOURCE 2: Match against Payments (strictly by payable linkage, client + amount, or verified amount fallback)
        if (clientId) {
          const clientPayments = (paymentsByClientId.get(clientId) || []).filter(
            (p: any) => !companyId || p.company_id === companyId,
          );

          // 2a. Priority: Payment linked directly to bestPayable
          if (bestPayable) {
            bestPayment =
              clientPayments.find(
                (p) => !usedPaymentIds.has(p.id) && p.payable_id === bestPayable.id,
              ) || null;
          }

          // 2b. Priority: Client payment matching exact or near amount (net_amount or paid_amount)
          if (!bestPayment) {
            bestPayment =
              clientPayments.find(
                (p) =>
                  !usedPaymentIds.has(p.id) &&
                  (Math.abs(p.net_amount - excelAmount) <= RECONCILIATION_TOLERANCE_NPR ||
                    (Number(p.paid_amount || 0) > 0 &&
                      Math.abs(Number(p.paid_amount) - excelAmount) <=
                        RECONCILIATION_TOLERANCE_NPR)),
              ) || null;
          }

          // 2c. Fallback: match by amount across system, strictly scoped to same company
          if (!bestPayment && excelAmount > 0) {
            const amountCandidates = paymentsByAmount.get(buildAmountKey(excelAmount)) || [];
            const targetCompId = bestPayable?.company_id || (client as any)?.company_id || null;
            bestPayment =
              amountCandidates.find(
                (p) =>
                  !usedPaymentIds.has(p.id) &&
                  (!targetCompId || p.company_id === targetCompId) &&
                  (p.client_id === clientId || !clientId),
              ) || null;
          }

          if (bestPayment) {
            matchSources.push("payment");
            usedPaymentIds.add(bestPayment.id);
          }
        }

        // SOURCE 3: Match against Bank Statements (by bank account)
        if (bankAccountNo) {
          const matchedBank = (bankStatements || []).find(
            (bs: any) => normalizeAccountKey(bs.account_no) === normalizeAccountKey(bankAccountNo),
          );
          if (matchedBank) {
            matchSources.push("bank_statement");
          }
        }

        // Calculate amounts and differences
        let systemAmount = bestPayable?.net_payable ?? bestPayment?.net_amount ?? 0;
        if (bestPayable) {
          const { full, prorated, prorated182, remaining } = getPayableAmounts(bestPayable);
          const diffFull = Math.abs(full - excelAmount);
          const diffPro = prorated !== null ? Math.abs(prorated - excelAmount) : Infinity;
          const diff182 = prorated182 !== null ? Math.abs(prorated182 - excelAmount) : Infinity;
          const diffRem = remaining !== null ? Math.abs(remaining - excelAmount) : Infinity;
          const minDiff = Math.min(diffFull, diffPro, diff182, diffRem);

          if (minDiff === diffRem && remaining !== null) {
            systemAmount = remaining;
          } else if (minDiff === diffPro && prorated !== null) {
            systemAmount = prorated;
          } else if (minDiff === diff182 && prorated182 !== null) {
            systemAmount = prorated182;
          } else {
            systemAmount = full;
          }
        } else if (bestPayment) {
          const pNet = Number(bestPayment.net_amount ?? 0);
          const pPaid = Number(bestPayment.paid_amount ?? 0);
          if (pPaid > 0 && Math.abs(pPaid - excelAmount) < Math.abs(pNet - excelAmount)) {
            systemAmount = pPaid;
          } else {
            systemAmount = pNet;
          }
        }
        const difference = Number((systemAmount - excelAmount).toFixed(2));
        const absDiff = Math.abs(difference);

        // Standard NCHL ConnectIPS bank transaction charges in Nepal: NPR 2 (<=500), NPR 8 (500-50k), NPR 15 (>50k)
        const isRecognizedBankCharge =
          systemAmount >= 10 && (absDiff === 2.0 || absDiff === 8.0 || absDiff === 15.0);

        const isWithinTolerance =
          absDiff <= RECONCILIATION_TOLERANCE_NPR ||
          (systemAmount > 1000 && absDiff / systemAmount <= 0.001) ||
          isRecognizedBankCharge;

        // Determine status
        let status: ReconciliationMatch["status"] = "Missing";
        const isRemainingOrRejectSheet =
          sheet.sheetName.toUpperCase().includes("REMAINING") ||
          sheet.sheetType === "REJECT_PENDING";
        const isFailedStatus =
          rawStatus.includes("REJECT") ||
          rawStatus.includes("MERGER") ||
          rawStatus.includes("NO BANK") ||
          rawStatus.includes("FAILED");
        const isPendingStatus =
          rawStatus.includes("PENDING") ||
          rawStatus === "11" ||
          rawStatus === "12" ||
          rawStatus === "14";

        if (pledgeFlag) {
          status = "Pledged";
          pledgedInSheet += 1;
          grandTotal.pledgedCount += 1;
        } else if (isFailedStatus) {
          status = "Rejected";
          grandTotal.rejectedCount += 1;
        } else if (isRemainingOrRejectSheet || isPendingStatus) {
          status = "Pending";
        } else if (matchSources.length === 0) {
          status = "Missing";
          summary.missingInSystem += 1;
        } else if (isWithinTolerance) {
          status = "Matched";
          matchedInSheet += 1;
          grandTotal.matchedRecords += 1;

          // Track match sources
          if (matchSources.includes("payable")) summary.matchedFromPayable += 1;
          if (matchSources.includes("payment")) summary.matchedFromPayment += 1;
          if (matchSources.includes("bank_statement")) summary.matchedFromBank += 1;
        } else {
          status = difference > 0 ? "Under_Paid" : "Over_Paid";
          mismatchedInSheet += 1;
          grandTotal.discrepancyCount += 1;
        }

        // Mark payable as used if matched
        if (bestPayable) {
          usedPayableIds.add(bestPayable.id);
        }

        let confidenceScore = 0;
        if (status === "Matched") {
          confidenceScore = 70;
          if (clientId) confidenceScore += 15;
          if (bankAccountNo) confidenceScore += 10;
          if (instructionId || batchIdVal) confidenceScore += 5;
        } else if (status === "Under_Paid" || status === "Over_Paid") {
          confidenceScore = clientId ? 65 : 45;
        } else if (status === "Pending") {
          confidenceScore = clientId ? 50 : 25;
        } else if (status === "Pledged" || status === "Rejected") {
          confidenceScore = clientId ? 80 : 50;
        } else {
          confidenceScore = 0;
        }
        confidenceScore = Math.min(100, Math.max(0, confidenceScore));

        matches.push({
          id: `${sheet.sheetName}-${idx + 1}`,
          boid: boid || `ROW-${idx + 1}`,
          shareholderName: name || "Unknown",
          category: sheet.sheetName,
          kitta,
          excelAmount,
          systemAmount,
          difference,
          status,
          bankName,
          bankAccountNo,
          pledgeFlag,
          lotName,
          clientId,
          companyId: bestPayable?.company_id ?? bestPayment?.company_id ?? null,
          payableType: (bestPayable?.payable_type ?? bestPayment?.payable_type ?? null) as any,
          payableId: bestPayable?.id ?? null,
          fiscalYear: bestPayable?.fiscal_year ?? null,
          paymentId: bestPayment?.id ?? null,
          paymentStatus: bestPayment?.payment_status ?? null,
          sourceType: "excel",
          matchSources: matchSources.length > 0 ? matchSources : undefined,
          instructionId,
          batchId: batchIdVal || null,
          confidenceScore,
        });
      });

      categories.push({
        categoryName: sheet.sheetName,
        rowCount: sheet.rowCount,
        totalKitta: sheet.totalKitta,
        totalGrossAmount: sheet.totalAmount,
        totalTaxAmount: sheet.totalTax,
        totalNetPayable: sheet.totalNet,
        matchedCount: matchedInSheet,
        mismatchedCount: mismatchedInSheet,
        pledgedCount: pledgedInSheet,
      });

      grandTotal.totalRecords += sheet.rowCount;
      grandTotal.totalKitta += sheet.totalKitta;
      grandTotal.totalGrossAmount += sheet.totalAmount;
      grandTotal.totalTaxAmount += sheet.totalTax;
      grandTotal.totalNetPayable += sheet.totalNet;
    });

    return {
      fileType: parsedData.fileType,
      sourceType: "excel",
      fileName: parsedData.fileName,
      categories,
      matches,
      grandTotal,
      summary,
    };
  },

  /**
   * 5-WAY RECONCILIATION for Bank Statements & ConnectIPS Settlement Files:
   * 1. Bank transactions vs Payments
   * 2. Bank transactions vs Payables
   * 3. Bank transactions vs Excel records
   * 4. Cross-reference: Payments vs Payables
   * 5. Identify unmatched bank transactions & rejected payouts
   */
  async analyzeBankStatement(
    transactions: BankTransaction[],
    options?: { fileName?: string; companyId?: string | null; client?: any },
  ): Promise<ComprehensiveReconciliationReport> {
    const db = options?.client || supabase;
    const cleanAcct = (val: unknown): string =>
      String(val || "")
        .replace(/[^0-9A-Za-z]/g, "")
        .toUpperCase()
        .replace(/^0+/, "");
    const cleanName = (val: unknown): string =>
      String(val || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const filterByCompany = options?.companyId && options.companyId !== "all";
    const companyId = filterByCompany ? options!.companyId! : null;

    // Load data from DB in parallel with complete client joins and payment batches
    // Load data from DB in parallel with complete client joins and payment batches
    // Filter by company_id when provided to prevent cross-company data leakage
    const [payments, payables, batchesResult] = await Promise.all([
      fetchAllRows<any>(async (from, to) => {
        let q = (db as any)
          .from("payments")
          .select(
            "id,company_id,client_id,net_amount,paid_amount,gross_amount,bank_name,bank_account_no,status,payable_type,payable_id,payment_date,payment_reference,connectips_ref,clients(id,boid,full_name,company_id,bank_name,bank_account_no)",
          )
          .range(from, to);
        if (companyId) q = q.eq("company_id", companyId);
        return await q;
      }),

      (async () => {
        const [divRows, intRows, mfRows] = await Promise.all([
          fetchAllRows<any>(async (from, to) => {
            let q = (db as any)
              .from("dividend_payables")
              .select(
                "id,company_id,client_id,net_payable,gross_dividend,payment_status,fiscal_year,bank_name,bank_account_no,paid_amount,remaining_amount,clients(id,boid,full_name,bank_name,bank_account_no)",
              )
              .range(from, to);
            if (companyId) q = q.eq("company_id", companyId);
            return await q;
          }),
          fetchAllRows<any>(async (from, to) => {
            let q = (db as any)
              .from("interest_payables")
              .select(
                "id,company_id,client_id,net_payable,gross_interest,days_count,payment_status,fiscal_year,bank_name,bank_account_no,paid_amount,remaining_amount,clients(id,boid,full_name,bank_name,bank_account_no)",
              )
              .range(from, to);
            if (companyId) q = q.eq("company_id", companyId);
            return await q;
          }),
          fetchAllRows<any>(async (from, to) => {
            let q = (db as any)
              .from("mutual_fund_payables")
              .select(
                "id,company_id,client_id,net_payable,payment_status,fiscal_year,bank_name,bank_account_no,paid_amount,remaining_amount,clients(id,boid,full_name,bank_name,bank_account_no)",
              )
              .range(from, to);
            if (companyId) q = q.eq("company_id", companyId);
            return await q;
          }),
        ]);

        const payablesList: any[] = [];
        divRows.forEach((row: any) => payablesList.push({ ...row, payable_type: "dividend" }));
        intRows.forEach((row: any) => payablesList.push({ ...row, payable_type: "interest" }));
        mfRows.forEach((row: any) => payablesList.push({ ...row, payable_type: "mutual_fund" }));
        return payablesList;
      })(),

      fetchAllRows<any>(async (from, to) => {
        let q = (db as any)
          .from("payment_batches")
          .select(
            "id,company_id,batch_name,total_amount,total_tax,total_payments,payable_type,status,cds_batch_ref,created_at",
          )
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
        if (companyId) q = q.or(`company_id.eq.${companyId},company_id.is.null`);
        return await q;
      }),
    ]);

    const paymentsList: any[] = Array.isArray(payments) ? payments : (payments as any)?.data || [];
    const payablesList: any[] = Array.isArray(payables) ? payables : (payables as any)?.data || [];
    const batches: any[] = Array.isArray(batchesResult)
      ? batchesResult
      : (batchesResult as any)?.data || [];

    // Helper to get effective comparison amount for a payable (supporting prorated debenture interest and remaining partial installments)
    const getPayableAmounts = (
      p: any,
    ): {
      full: number;
      prorated: number | null;
      prorated182: number | null;
      remaining: number | null;
    } => {
      const full = Number(p.net_payable ?? 0);
      const remaining =
        p.remaining_amount != null && Number(p.remaining_amount) > 0
          ? Number(p.remaining_amount)
          : null;
      if (p.payable_type === "interest") {
        const days = p.days_count && p.days_count > 0 && p.days_count < 365 ? p.days_count : 183;
        const prorated = Number(((full / 365.0) * days).toFixed(2));
        const prorated182 = Number(((full / 365.0) * 182).toFixed(2));
        return { full, prorated, prorated182, remaining };
      }
      return { full, prorated: null, prorated182: null, remaining };
    };

    const matchesPayableAmount = (p: any, amt: number): boolean => {
      const { full, prorated, prorated182, remaining } = getPayableAmounts(p);
      if (amountEqualsPaisa(full, amt)) return true;
      if (prorated !== null && amountEqualsPaisa(prorated, amt)) return true;
      if (prorated182 !== null && amountEqualsPaisa(prorated182, amt)) return true;
      if (remaining !== null && amountEqualsPaisa(remaining, amt)) return true;
      return false;
    };

    // Build indexing maps for high-performance matching
    const paymentsByAcct = new Map<string, any[]>();
    const paymentsByName = new Map<string, any[]>();
    const paymentsByAmt = new Map<string, any[]>();
    const paymentsByRef = new Map<string, any[]>();

    paymentsList.forEach((p: any) => {
      const acct = cleanAcct(p.bank_account_no || p.clients?.bank_account_no);
      const name = cleanName(p.clients?.full_name);
      const netAmt = Number(p.net_amount ?? 0);
      const paidAmt = Number(p.paid_amount ?? 0);
      const amtKey = buildAmountKey(netAmt);

      if (acct) {
        if (!paymentsByAcct.has(acct)) paymentsByAcct.set(acct, []);
        paymentsByAcct.get(acct)!.push(p);
      }
      if (name) {
        if (!paymentsByName.has(name)) paymentsByName.set(name, []);
        paymentsByName.get(name)!.push(p);
      }
      if (!paymentsByAmt.has(amtKey)) paymentsByAmt.set(amtKey, []);
      paymentsByAmt.get(amtKey)!.push(p);

      if (paidAmt > 0 && Math.abs(paidAmt - netAmt) > 0.01) {
        const paidKey = buildAmountKey(paidAmt);
        if (!paymentsByAmt.has(paidKey)) paymentsByAmt.set(paidKey, []);
        paymentsByAmt.get(paidKey)!.push(p);
      }

      if (p.connectips_ref) {
        const ref = String(p.connectips_ref).trim().toUpperCase();
        if (!paymentsByRef.has(ref)) paymentsByRef.set(ref, []);
        paymentsByRef.get(ref)!.push(p);
      }
      if (p.payment_reference) {
        const pRef = String(p.payment_reference).trim().toUpperCase();
        if (!paymentsByRef.has(pRef)) paymentsByRef.set(pRef, []);
        paymentsByRef.get(pRef)!.push(p);
      }
    });

    const payablesByAcct = new Map<string, any[]>();
    const payablesByName = new Map<string, any[]>();
    const payablesByAmt = new Map<string, any[]>();

    payablesList.forEach((p: any) => {
      const acct = cleanAcct(p.bank_account_no || p.clients?.bank_account_no);
      const name = cleanName(p.clients?.full_name);
      const { full, prorated, prorated182, remaining } = getPayableAmounts(p);
      const amtKey = buildAmountKey(full);

      if (acct) {
        if (!payablesByAcct.has(acct)) payablesByAcct.set(acct, []);
        payablesByAcct.get(acct)!.push(p);
      }
      if (name) {
        if (!payablesByName.has(name)) payablesByName.set(name, []);
        payablesByName.get(name)!.push(p);
      }
      if (!payablesByAmt.has(amtKey)) payablesByAmt.set(amtKey, []);
      payablesByAmt.get(amtKey)!.push(p);

      if (prorated !== null) {
        const proratedKey = buildAmountKey(prorated);
        if (!payablesByAmt.has(proratedKey)) payablesByAmt.set(proratedKey, []);
        payablesByAmt.get(proratedKey)!.push(p);
      }
      if (prorated182 !== null) {
        const prorated182Key = buildAmountKey(prorated182);
        if (!payablesByAmt.has(prorated182Key)) payablesByAmt.set(prorated182Key, []);
        payablesByAmt.get(prorated182Key)!.push(p);
      }
      if (remaining !== null) {
        const remainingKey = buildAmountKey(remaining);
        if (!payablesByAmt.has(remainingKey)) payablesByAmt.set(remainingKey, []);
        payablesByAmt.get(remainingKey)!.push(p);
      }
    });

    const categories: CategorySummary[] = [];
    const matches: ReconciliationMatch[] = [];
    const grandTotal = {
      totalRecords: transactions.length,
      totalKitta: 0,
      totalGrossAmount: transactions.reduce((sum, txn) => sum + txn.credit + txn.debit, 0),
      totalTaxAmount: 0,
      totalNetPayable: transactions.reduce((sum, txn) => sum + (txn.credit || txn.debit), 0),
      matchedRecords: 0,
      partialRecords: 0,
      discrepancyCount: 0,
      pledgedCount: 0,
      rejectedCount: 0,
    };

    const summary = {
      matchedFromPayable: 0,
      matchedFromPayment: 0,
      matchedFromBank: 0,
      partialMatches: 0,
      missingInSystem: 0,
      unmatchedBankTransactions: 0,
    };

    const usedPaymentIds = new Set<string>();
    const usedPayableIds = new Set<string>();
    const usedBatchIds = new Set<string>();
    const payableMatchedPeriods = new Map<string, Set<number>>();

    // Helper to check if bank transaction date is compatible with payable fiscal year
    const isDateCompatible = (
      txnDate: string | undefined,
      fy: string | null | undefined,
    ): boolean => {
      if (!txnDate || !fy) return true;
      const dStr = String(txnDate).slice(0, 10);
      // In Nepal, fiscal years start in mid-July (Shrawan):
      // FY 2082/83 debenture interest payments occurred in calendar year 2026 (Jan 2026 for Poush, July 2026 for Asar)
      if (fy === "2082/83" && dStr < "2026-01-01") return false;
      if (fy === "2081/82" && (dStr < "2024-07-01" || dStr > "2025-07-15")) return false;
      if (fy === "2080/81" && (dStr < "2023-07-01" || dStr > "2024-07-15")) return false;
      return true;
    };

    const canUsePayable = (p: any, amt: number): boolean => {
      if (usedPayableIds.has(p.id)) return false;
      const { full, prorated, prorated182, remaining } = getPayableAmounts(p);
      if (
        remaining !== null &&
        amountEqualsPaisa(remaining, amt) &&
        p.payment_status === "Partial"
      ) {
        return true;
      }
      if (p.payable_type !== "interest") return true;
      const periods = payableMatchedPeriods.get(p.id) || new Set<number>();
      if (amountEqualsPaisa(full, amt)) {
        return periods.size === 0;
      }
      if (prorated !== null && amountEqualsPaisa(prorated, amt)) {
        return !periods.has(183);
      }
      if (prorated182 !== null && amountEqualsPaisa(prorated182, amt)) {
        return !periods.has(182);
      }
      return true;
    };

    const recordPayableUsage = (p: any, amt: number) => {
      const { remaining } = getPayableAmounts(p);
      if (p.payable_type !== "interest") {
        usedPayableIds.add(p.id);
        return;
      }
      if (
        remaining !== null &&
        amountEqualsPaisa(remaining, amt) &&
        p.payment_status === "Partial"
      ) {
        usedPayableIds.add(p.id);
        return;
      }
      const { prorated, prorated182 } = getPayableAmounts(p);
      if (!payableMatchedPeriods.has(p.id)) {
        payableMatchedPeriods.set(p.id, new Set<number>());
      }
      const periods = payableMatchedPeriods.get(p.id)!;
      if (prorated !== null && amountEqualsPaisa(prorated, amt)) {
        periods.add(183);
      } else if (prorated182 !== null && amountEqualsPaisa(prorated182, amt)) {
        periods.add(182);
      } else {
        periods.add(182);
        periods.add(183);
      }
      if (periods.has(182) && periods.has(183)) {
        usedPayableIds.add(p.id);
      }
    };

    transactions.forEach((txn, idx) => {
      const amount = txn.credit > 0 ? txn.credit : Math.abs(txn.debit);
      const txnAcct = cleanAcct(txn.accountNo);
      const txnName = cleanName(txn.beneficiaryName || txn.description);
      const amtKey = buildAmountKey(amount);
      const isBankReject =
        txn.category === "REJECT_RETURN" ||
        txn.status === "RJCT" ||
        String(txn.status || "")
          .toLowerCase()
          .includes("reject") ||
        String(txn.description || "")
          .toUpperCase()
          .includes("INCORRECT A/C");

      let bestPayment: any = null;
      let matchedPayable: any = null;
      let matchedBatch: any = null;
      const matchSources: string[] = [];

      // PHASE 1: EXACT MATCHES (within RECONCILIATION_TOLERANCE_NPR)
      // 1a. Match against Payments by ConnectIPS Reference or Instruction ID (MUST match amount within tolerance)
      const refToSearch = txn.instructionId || txn.referenceId;
      if (refToSearch) {
        const refPayments = paymentsByRef.get(String(refToSearch).trim().toUpperCase()) || [];
        bestPayment =
          refPayments.find(
            (p) =>
              !usedPaymentIds.has(p.id) &&
              (amountEqualsPaisa(Number(p.net_amount), amount) ||
                (Number(p.paid_amount || 0) > 0 &&
                  amountEqualsPaisa(Number(p.paid_amount), amount))),
          ) || null;
      }
      if (!bestPayment && txn.description) {
        // Extract 10-20 char alphanumeric reference pattern from description (e.g. 0201260720JRL7)
        const matchRef = txn.description.match(/[0-9]{4,}[A-Za-z0-9]{6,}/);
        if (matchRef) {
          const candRef = matchRef[0].toUpperCase();
          const refPayments = paymentsByRef.get(candRef) || [];
          bestPayment =
            refPayments.find(
              (p) =>
                !usedPaymentIds.has(p.id) &&
                (amountEqualsPaisa(Number(p.net_amount), amount) ||
                  (Number(p.paid_amount || 0) > 0 &&
                    amountEqualsPaisa(Number(p.paid_amount), amount))),
            ) || null;
        }
      }

      // 1b. Match against Payments by Account + Exact Amount (net_amount or paid_amount)
      if (!bestPayment && txnAcct) {
        const acctPayments = paymentsByAcct.get(txnAcct) || [];
        bestPayment =
          acctPayments.find(
            (p) =>
              !usedPaymentIds.has(p.id) &&
              (amountEqualsPaisa(Number(p.net_amount), amount) ||
                (Number(p.paid_amount || 0) > 0 &&
                  amountEqualsPaisa(Number(p.paid_amount), amount))),
          ) || null;
      }

      // 1c. Match against Payables by Account + Exact Amount (full or prorated) with Date Compatibility
      if (!bestPayment && txnAcct) {
        const acctPayables = payablesByAcct.get(txnAcct) || [];
        matchedPayable =
          acctPayables.find(
            (p) =>
              canUsePayable(p, amount) &&
              isDateCompatible(txn.date, p.fiscal_year) &&
              matchesPayableAmount(p, amount),
          ) || null;
      }

      // 1d. Match against Payments by Name + Exact Amount (net_amount or paid_amount)
      if (!bestPayment && !matchedPayable && txnName) {
        const namePayments = paymentsByName.get(txnName) || [];
        bestPayment =
          namePayments.find(
            (p) =>
              !usedPaymentIds.has(p.id) &&
              (amountEqualsPaisa(Number(p.net_amount), amount) ||
                (Number(p.paid_amount || 0) > 0 &&
                  amountEqualsPaisa(Number(p.paid_amount), amount))),
          ) || null;
      }

      // 1e. Match against Payables by Name + Exact Amount (full or prorated) with Date Compatibility
      if (!bestPayment && !matchedPayable && txnName) {
        const namePayables = payablesByName.get(txnName) || [];
        matchedPayable =
          namePayables.find(
            (p) =>
              canUsePayable(p, amount) &&
              isDateCompatible(txn.date, p.fiscal_year) &&
              matchesPayableAmount(p, amount),
          ) || null;
      }

      // 1f. Match against Payment Batches (for aggregate statement entries) by Exact Amount or Batch Reference
      if (
        !bestPayment &&
        !matchedPayable &&
        (txn.category === "PAYOUT_DEBIT" ||
          txn.debit > 0 ||
          txn.description.toUpperCase().includes("BATCH") ||
          txn.description.toUpperCase().includes("IPS DR") ||
          txn.batchId)
      ) {
        const batchMatch = batches.find((b: any) => {
          if (usedBatchIds.has(b.id)) return false;
          const bAmount = Number(b.total_amount || 0);
          const bNet = Number(b.total_net || 0);
          if (
            (bAmount > 0 && Math.abs(bAmount - amount) <= RECONCILIATION_TOLERANCE_NPR) ||
            (bNet > 0 && Math.abs(bNet - amount) <= RECONCILIATION_TOLERANCE_NPR)
          )
            return true;
          if (
            txn.batchId &&
            (String(b.cds_batch_ref || "")
              .toUpperCase()
              .includes(txn.batchId.toUpperCase()) ||
              String(b.batch_name || "")
                .toUpperCase()
                .includes(txn.batchId.toUpperCase()))
          )
            return true;
          if (
            (txn.instructionId || txn.batchId) &&
            b.cds_batch_ref &&
            (String(b.cds_batch_ref)
              .toUpperCase()
              .includes(
                String(txn.instructionId || txn.batchId)
                  .toUpperCase()
                  .slice(0, 11),
              ) ||
              String(txn.instructionId || txn.batchId)
                .toUpperCase()
                .includes(String(b.cds_batch_ref).toUpperCase().slice(0, 11)))
          )
            return true;
          if (
            b.batch_name &&
            txn.description &&
            txn.description.toUpperCase().includes(b.batch_name.toUpperCase())
          )
            return true;
          return false;
        });

        if (batchMatch) {
          matchedBatch = batchMatch;
        }
      }

      // 1g. Match against Payments by Exact Amount only (fallback for known amount, strictly isolated by company)
      if (!bestPayment && !matchedPayable && !matchedBatch && amount > 0) {
        const amtPayments = paymentsByAmt.get(amtKey) || [];
        bestPayment =
          amtPayments.find(
            (p) => !usedPaymentIds.has(p.id) && (!companyId || p.company_id === companyId),
          ) || null;
      }

      // 1h. Match against Payables by Exact Amount only (strictly isolated by company and fiscal year compatible)
      if (!bestPayment && !matchedPayable && !matchedBatch && amount > 0) {
        const amtPayables = payablesByAmt.get(amtKey) || [];
        matchedPayable =
          amtPayables.find(
            (p) =>
              canUsePayable(p, amount) &&
              isDateCompatible(txn.date, p.fiscal_year) &&
              (!companyId || p.company_id === companyId),
          ) || null;
      }

      // PHASE 2: PARTIAL / DISCREPANCY MATCHES (Only if NO exact match was found anywhere)
      if (!bestPayment && !matchedPayable && !matchedBatch) {
        if (txnAcct) {
          const acctPayments = paymentsByAcct.get(txnAcct) || [];
          bestPayment =
            acctPayments.find(
              (p) => !usedPaymentIds.has(p.id) && (!companyId || p.company_id === companyId),
            ) || null;
        }
        if (!bestPayment && txnAcct) {
          const acctPayables = payablesByAcct.get(txnAcct) || [];
          matchedPayable =
            acctPayables.find(
              (p) =>
                canUsePayable(p, amount) &&
                isDateCompatible(txn.date, p.fiscal_year) &&
                (!companyId || p.company_id === companyId),
            ) || null;
        }
        if (!bestPayment && !matchedPayable && txnName) {
          const namePayments = paymentsByName.get(txnName) || [];
          bestPayment =
            namePayments.find(
              (p) => !usedPaymentIds.has(p.id) && (!companyId || p.company_id === companyId),
            ) || null;
        }
        if (!bestPayment && !matchedPayable && txnName) {
          const namePayables = payablesByName.get(txnName) || [];
          matchedPayable =
            namePayables.find(
              (p) =>
                canUsePayable(p, amount) &&
                isDateCompatible(txn.date, p.fiscal_year) &&
                (!companyId || p.company_id === companyId),
            ) || null;
        }
      }

      // Link payment to payable if payable matched and payment not yet linked
      if (matchedPayable && !bestPayment) {
        const pmtForPayable = payments.find((p: any) => p.payable_id === matchedPayable.id);
        if (pmtForPayable && !usedPaymentIds.has(pmtForPayable.id)) {
          bestPayment = pmtForPayable;
        }
      }

      if (bestPayment) {
        matchSources.push("payment");
        usedPaymentIds.add(bestPayment.id);
      }
      if (matchedPayable) {
        matchSources.push("payable");
        recordPayableUsage(matchedPayable, amount);
      }
      if (matchedBatch) {
        matchSources.push("payment_batch");
        usedBatchIds.add(matchedBatch.id);
      }

      const client = bestPayment?.clients || matchedPayable?.clients || null;
      let systemAmount = 0;
      if (matchedPayable) {
        const { full, prorated, prorated182 } = getPayableAmounts(matchedPayable);
        const diffFull = Math.abs(full - amount);
        const diffPro = prorated !== null ? Math.abs(prorated - amount) : Infinity;
        const diff182 = prorated182 !== null ? Math.abs(prorated182 - amount) : Infinity;
        const minDiff = Math.min(diffFull, diffPro, diff182);

        if (minDiff === diffPro && prorated !== null) {
          systemAmount = prorated;
        } else if (minDiff === diff182 && prorated182 !== null) {
          systemAmount = prorated182;
        } else {
          systemAmount = full;
        }
      } else if (bestPayment) {
        const pNet = Number(bestPayment.net_amount ?? 0);
        const pPaid = Number(bestPayment.paid_amount ?? 0);
        if (pPaid > 0 && Math.abs(pPaid - amount) < Math.abs(pNet - amount)) {
          systemAmount = pPaid;
        } else {
          systemAmount = pNet;
        }
      } else if (matchedBatch) {
        systemAmount = Number(matchedBatch.total_net || matchedBatch.total_amount || 0);
      }

      const difference = fromPaisa(toPaisa(systemAmount) - toPaisa(amount));
      let status: ReconciliationMatch["status"] = "Missing";

      if (isBankReject) {
        status = "Rejected";
        grandTotal.rejectedCount += 1;
      } else if (matchSources.length > 0) {
        if (amountEqualsPaisa(systemAmount, amount)) {
          status = "Matched";
          grandTotal.matchedRecords += 1;
          if (matchSources.includes("payment")) summary.matchedFromPayment += 1;
          if (matchSources.includes("payable")) summary.matchedFromPayable += 1;
          if (matchSources.includes("payment_batch")) summary.matchedFromBank += 1;
        } else {
          status = difference > 0 ? "Under_Paid" : "Over_Paid";
          grandTotal.partialRecords = (grandTotal.partialRecords || 0) + 1;
          grandTotal.discrepancyCount += 1;
          summary.partialMatches = (summary.partialMatches || 0) + 1;
          if (matchSources.includes("payable")) summary.matchedFromPayable += 1;
          if (matchSources.includes("payment")) summary.matchedFromPayment += 1;
          if (matchSources.includes("payment_batch")) summary.matchedFromBank += 1;
        }
      } else if (amount === 0) {
        status = "Pending";
      } else {
        status = "Missing";
        summary.missingInSystem += 1;
      }

      // Safe BOID and Label formatting
      let displayBoid = client?.boid;
      if (!displayBoid) {
        if (matchedBatch) {
          displayBoid = matchedBatch.batch_name;
        } else if (
          txn.accountNo &&
          txn.accountNo.length >= 8 &&
          !txn.accountNo.includes(":") &&
          !txn.accountNo.includes("-")
        ) {
          displayBoid = `A/C: ${txn.accountNo}`;
        } else if (txn.instructionId) {
          displayBoid = `Ref: ${txn.instructionId}`;
        } else {
          displayBoid = `Bank Statement Row ${idx + 1}`;
        }
      }

      let displayName = client?.full_name;
      if (!displayName) {
        if (matchedBatch) {
          displayName = `Batch: ${matchedBatch.batch_name}`;
        } else if (txn.beneficiaryName) {
          displayName = txn.beneficiaryName;
        } else if (txn.description) {
          displayName = txn.description;
        } else {
          displayName = "Bank Settlement Entry";
        }
      }

      let categoryName = "Bank Statement";
      if (txn.category === "FUNDING_DEPOSIT") {
        categoryName = "Account Funding / Inflow";
      } else if (txn.category === "BANK_CHARGES") {
        categoryName = "Bank Fee / Commission";
      } else if (txn.status) {
        categoryName = `ConnectIPS (${txn.status})`;
      } else if (matchedBatch) {
        categoryName = "Payment Batch Debit";
      }

      let confidenceScore = 0;
      if (status === "Matched") {
        confidenceScore = 70;
        if (client) confidenceScore += 15;
        if (txn.accountNo && client?.bank_account_no) confidenceScore += 10;
        if (txn.instructionId || txn.referenceId) confidenceScore += 5;
      } else if (status === "Under_Paid" || status === "Over_Paid") {
        confidenceScore = client ? 65 : 45;
      } else if (status === "Rejected") {
        confidenceScore = 80;
      } else if (status === "Pending") {
        confidenceScore = 40;
      } else {
        confidenceScore = 0;
      }
      confidenceScore = Math.min(100, Math.max(0, confidenceScore));

      matches.push({
        id: `bank-${idx + 1}`,
        boid: displayBoid,
        shareholderName: displayName,
        category: categoryName,
        kitta: 0,
        excelAmount: amount,
        systemAmount: status === "Matched" ? systemAmount : systemAmount > 0 ? systemAmount : 0,
        difference: status === "Matched" ? 0 : difference,
        status,
        bankName: txn.bankName || client?.bank_name || "",
        bankAccountNo: txn.accountNo || client?.bank_account_no || "",
        lotName: txn.batchId ? `Batch ${txn.batchId}` : txn.fileName || categoryName,
        clientId: client?.id || bestPayment?.client_id || matchedPayable?.client_id || null,
        companyId:
          client?.company_id ||
          bestPayment?.company_id ||
          matchedPayable?.company_id ||
          matchedBatch?.company_id ||
          null,
        paymentId: bestPayment?.id ?? null,
        paymentStatus: bestPayment?.status ?? bestPayment?.payment_status ?? null,
        payableId: matchedPayable?.id ?? bestPayment?.payable_id ?? null,
        batchId: matchedBatch?.id ?? null,
        fiscalYear: matchedPayable?.fiscal_year ?? (matchedBatch as any)?.fiscal_year ?? null,
        payableType: (() => {
          const raw =
            matchedPayable?.payable_type ??
            bestPayment?.payable_type ??
            matchedBatch?.payable_type ??
            "interest";
          return raw === "dividend_payables" || raw === "dividend"
            ? "dividend"
            : raw === "interest_payables" || raw === "interest"
              ? "interest"
              : raw === "mutual_fund_payables" || raw === "mutual_fund"
                ? "mutual_fund"
                : "interest";
        })(),
        transactionDate: txn.date || null,
        transactionDescription: txn.instructionId
          ? `Instruction: ${txn.instructionId}`
          : txn.description || null,
        sourceType: "bank_statement",
        matchSources: matchSources.length > 0 ? matchSources : undefined,
        instructionId: txn.instructionId || undefined,
        referenceId: txn.referenceId || undefined,
        confidenceScore,
      });
    });

    // Build distinct classification summaries from bank statement matches
    const catMap = new Map<string, CategorySummary>();
    matches.forEach((m) => {
      const cName = m.category || "General Settlement";
      if (!catMap.has(cName)) {
        catMap.set(cName, {
          categoryName: cName,
          rowCount: 0,
          totalKitta: 0,
          totalGrossAmount: 0,
          totalTaxAmount: 0,
          totalNetPayable: 0,
          matchedCount: 0,
          mismatchedCount: 0,
          pledgedCount: 0,
        });
      }
      const entry = catMap.get(cName)!;
      entry.rowCount += 1;
      entry.totalGrossAmount += m.excelAmount;
      entry.totalNetPayable += m.excelAmount;
      if (m.status === "Matched") entry.matchedCount += 1;
      else if (m.status === "Pledged") entry.pledgedCount += 1;
      else entry.mismatchedCount += 1;
    });

    if (catMap.size > 0) {
      categories.push(...Array.from(catMap.values()));
    } else {
      categories.push({
        categoryName: "Bank / ConnectIPS Settlement",
        rowCount: transactions.length,
        totalKitta: 0,
        totalGrossAmount: grandTotal.totalGrossAmount,
        totalTaxAmount: 0,
        totalNetPayable: grandTotal.totalNetPayable,
        matchedCount: grandTotal.matchedRecords,
        mismatchedCount: grandTotal.discrepancyCount,
        pledgedCount: 0,
      });
    }

    const uniqueFiles = Array.from(
      new Set(transactions.map((t) => t.fileName).filter(Boolean)),
    ) as string[];
    const defaultFileName =
      uniqueFiles.length > 1
        ? `${uniqueFiles.length} Settlement Files (${uniqueFiles.join(", ")})`
        : uniqueFiles[0] || "Bank Settlement Report";

    return {
      fileType: "bank_statement",
      sourceType: "bank_statement",
      fileName: options?.fileName || defaultFileName,
      categories,
      matches,
      grandTotal,
      summary,
    };
  },
};

export interface ReconciliationExceptionItem {
  id: string;
  type:
    | "UNMATCHED_BANK_CREDIT"
    | "LARGE_VARIANCE"
    | "MISMATCHED_REFERENCE"
    | "UNDER_OVER_PAID"
    | "UNMATCHED_RECORD";
  severity: "critical" | "warning" | "info";
  description: string;
  amount: number;
  varianceAmount: number;
  bankReference?: string | null;
  systemReference?: string | null;
  boid?: string | null;
  shareholderName?: string | null;
  status: string;
  actionRequired: "REVIEW" | "FORCE_MATCH" | "REMEDIATE" | "ACKNOWLEDGE";
}

export interface ReconciliationExceptionSummary {
  unmatchedBankTxnCount: number;
  unmatchedBankTotalAmount: number;
  largeVarianceCount: number;
  largeVarianceTotalAmount: number;
  mismatchedReferenceCount: number;
  totalExceptions: number;
  exceptions: ReconciliationExceptionItem[];
}

export function extractReconciliationExceptions(
  matchesOrReport: ComprehensiveReconciliationReport | ReconciliationMatch[],
  varianceThresholdNpr = 1.0,
): ReconciliationExceptionSummary {
  const matches = Array.isArray(matchesOrReport) ? matchesOrReport : matchesOrReport.matches;
  const exceptions: ReconciliationExceptionItem[] = [];

  let unmatchedBankTxnCount = 0;
  let unmatchedBankTotalAmount = 0;
  let largeVarianceCount = 0;
  let largeVarianceTotalAmount = 0;
  let mismatchedReferenceCount = 0;

  for (const m of matches) {
    const isBankSource = m.sourceType === "bank_statement";
    const diff = Math.abs(m.difference || 0);

    // 1. Unmatched Bank Transactions
    if (
      isBankSource &&
      (m.status === "Missing" || m.status === "Rejected" || (!m.payableId && !m.paymentId))
    ) {
      unmatchedBankTxnCount++;
      unmatchedBankTotalAmount += m.excelAmount || 0;
      exceptions.push({
        id: `exc-bank-${m.id}`,
        type: "UNMATCHED_BANK_CREDIT",
        severity: "critical",
        description: `Unmatched bank statement transaction: ${m.shareholderName || "Unknown Beneficiary"} (NPR ${(m.excelAmount || 0).toLocaleString()})`,
        amount: m.excelAmount || 0,
        varianceAmount: m.excelAmount || 0,
        bankReference: m.referenceId || null,
        systemReference: null,
        boid: m.boid || null,
        shareholderName: m.shareholderName || null,
        status: m.status,
        actionRequired: "REVIEW",
      });
      continue;
    }

    // 2. Large Variance Alerts
    if (diff > varianceThresholdNpr) {
      largeVarianceCount++;
      largeVarianceTotalAmount += diff;
      exceptions.push({
        id: `exc-var-${m.id}`,
        type: "LARGE_VARIANCE",
        severity: diff > 100 ? "critical" : "warning",
        description: `Variance exceeds threshold (NPR ${diff.toFixed(2)}): System NPR ${(m.systemAmount || 0).toFixed(2)} vs Bank/File NPR ${(m.excelAmount || 0).toFixed(2)}`,
        amount: m.excelAmount || m.systemAmount || 0,
        varianceAmount: diff,
        bankReference: m.referenceId || null,
        systemReference: m.instructionId || null,
        boid: m.boid || null,
        shareholderName: m.shareholderName || null,
        status: m.status,
        actionRequired: "REMEDIATE",
      });
    }

    // 3. Mismatched Payment Reference
    if (m.referenceId && m.instructionId && m.referenceId !== m.instructionId) {
      mismatchedReferenceCount++;
      exceptions.push({
        id: `exc-ref-${m.id}`,
        type: "MISMATCHED_REFERENCE",
        severity: "warning",
        description: `Payment reference mismatch: Bank ref "${m.referenceId}" does not match system ref "${m.instructionId}"`,
        amount: m.excelAmount || m.systemAmount || 0,
        varianceAmount: diff,
        bankReference: m.referenceId,
        systemReference: m.instructionId,
        boid: m.boid || null,
        shareholderName: m.shareholderName || null,
        status: m.status,
        actionRequired: "FORCE_MATCH",
      });
    }
  }

  return {
    unmatchedBankTxnCount,
    unmatchedBankTotalAmount: Math.round(unmatchedBankTotalAmount * 100) / 100,
    largeVarianceCount,
    largeVarianceTotalAmount: Math.round(largeVarianceTotalAmount * 100) / 100,
    mismatchedReferenceCount,
    totalExceptions: exceptions.length,
    exceptions,
  };
}
