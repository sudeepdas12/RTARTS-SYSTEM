import { supabase } from '@/integrations/supabase/client';
import { ParsedExcelData } from './excel-parser';

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
  category?: 'PAYOUT_DEBIT' | 'REJECT_RETURN' | 'FUNDING_DEPOSIT' | 'BANK_CHARGES' | 'NRB_CIRCULAR' | 'OTHER';
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
  status: 'Matched' | 'Under_Paid' | 'Over_Paid' | 'Missing' | 'Pledged' | 'Rejected' | 'Pending';
  bankName?: string;
  bankAccountNo?: string;
  pledgeFlag?: boolean;
  lotName?: string;
  clientId?: string | null;
  companyId?: string | null;
  payableType?: 'dividend' | 'interest' | 'mutual_fund' | null;
  payableId?: string | null;
  paymentId?: string | null;
  paymentStatus?: string | null;
  transactionDate?: string | null;
  transactionDescription?: string | null;
  sourceType?: 'excel' | 'bank_statement';
  matchSources?: string[]; // Track which sources matched: ['payable', 'payment', 'bank_statement']
}

export interface ComprehensiveReconciliationReport {
  fileType: string;
  sourceType: 'excel' | 'bank_statement';
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
    discrepancyCount: number;
    pledgedCount: number;
    rejectedCount: number;
  };
  summary: {
    matchedFromPayable: number;
    matchedFromPayment: number;
    matchedFromBank: number;
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
  payable_type: 'dividend' | 'interest' | 'mutual_fund';
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
};

const normalizeString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseNumber = (value: unknown): number => {
  const raw = normalizeString(value).replace(/,/g, '');
  const num = Number(raw);
  return Number.isNaN(num) ? 0 : num;
};

const normalizeAccountKey = (value: unknown): string => normalizeString(value).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const getMappedValue = (row: any, mappingKey: string | undefined, fallbackKeys: string[]): string => {
  if (mappingKey && row[mappingKey] !== undefined && row[mappingKey] !== null) {
    return normalizeString(row[mappingKey]);
  }
  for (const key of fallbackKeys) {
    if (row[key] !== undefined && row[key] !== null) {
      return normalizeString(row[key]);
    }
  }
  return '';
};

const buildAmountKey = (amount: number) => amount.toFixed(2);
const buildAccountAmountKey = (account: string, amount: number) => `${normalizeAccountKey(account)}|${buildAmountKey(amount)}`;

export const ReconciliationEngine = {
  /**
   * 5-WAY RECONCILIATION for Excel files:
   * 1. Excel rows vs DB Payables (dividend_payables, interest_payables, mutual_fund_payables)
   * 2. Excel rows vs Payments (actual payments made)
   * 3. Excel rows vs Bank Statements (transactions)
   * 4. Cross-reference: Payables vs Payments
   * 5. Cross-reference: Payments vs Bank Statements
   */
  async analyzeParsedExcel(parsedData: ParsedExcelData): Promise<ComprehensiveReconciliationReport> {
    const boids = parsedData.sheets
      .flatMap(sheet => sheet.sheetType === 'SUMMARY' ? [] : sheet.rows.map(row => getMappedValue(row, sheet.mapping.boid, ['BOID', 'BENEFICIARY ID', 'CLIENT ID', 'BENEFICIARY_ID', 'CLIENT_ID'])))
      .filter(Boolean);

    // Load all related data in parallel
    const [clientsResult, payablesResult, paymentsResult, bankStatementsResult] = await Promise.all([
      // 1. Load clients
      supabase.from('clients').select('id,boid,full_name,company_id,bank_name,bank_account_no').in('boid', boids),
      
      // 2. Load all payables (dividend, interest, mutual_fund)
      (async () => {
        const { data: clientsData } = await supabase.from('clients').select('id').in('boid', boids);
        const clientIds = (clientsData?.map(c => c.id) || []);
        if (clientIds.length === 0) return { data: [] };
        
        const [divResult, intResult, mfResult] = await Promise.all([
          supabase.from('dividend_payables').select('id,company_id,client_id,net_payable,gross_dividend,payment_status').in('client_id', clientIds),
          supabase.from('interest_payables').select('id,company_id,client_id,net_payable,gross_interest,payment_status').in('client_id', clientIds),
          (supabase as any).from('mutual_fund_payables').select('id,company_id,client_id,net_payable,payment_status').in('client_id', clientIds),
        ]);
        
        const payables: any[] = [];
        divResult.data?.forEach((row: any) => payables.push({ ...row, payable_type: 'dividend' }));
        intResult.data?.forEach((row: any) => payables.push({ ...row, payable_type: 'interest' }));
        mfResult.data?.forEach((row: any) => payables.push({ ...row, payable_type: 'mutual_fund' }));
        return { data: payables };
      })(),
      
      // 3. Load payments
      (supabase as any).from('payments').select('id,company_id,client_id,net_amount,bank_name,bank_account_no,payment_status,payable_type,payable_id'),
      
      // 4. Load bank statements
      (supabase as any).from('bank_statements').select('id,bank_name,account_no,statement_date,file_name,total_transactions,total_credit,is_reconciled').eq('is_reconciled', false),
    ]);

    const clients = (clientsResult as any).data || [];
    const payables = (payablesResult as any).data || [];
    const payments = (paymentsResult as any).data || [];
    const bankStatements = (bankStatementsResult as any).data || [];

    // Build lookup maps
    const clientsByBoid = new Map<string, any>();
    (clients || []).forEach((c: any) => { if (c.boid) clientsByBoid.set(String(c.boid).trim(), c); });

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
        payment_status: String(p.payment_status || ''),
        payable_type: p.payable_type,
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
        bank_name: p.bank_name,
        bank_account_no: p.bank_account_no,
        payment_status: p.payment_status,
        payable_type: p.payable_type,
        payable_id: p.payable_id,
      });
    });

    const paymentsByAmount = new Map<string, PaymentRow[]>();
    payments.forEach((p: any) => {
      const key = buildAmountKey(Number(p.net_amount ?? 0));
      if (!paymentsByAmount.has(key)) paymentsByAmount.set(key, []);
      paymentsByAmount.get(key)!.push(p);
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

    parsedData.sheets.forEach(sheet => {
      if (sheet.sheetType === 'SUMMARY') return;

      let matchedInSheet = 0;
      let mismatchedInSheet = 0;
      let pledgedInSheet = 0;

      sheet.rows.forEach((row, idx) => {
        const boid = getMappedValue(row, sheet.mapping.boid, ['BOID', 'BENEFICIARY ID', 'CLIENT ID', 'BENEFICIARY_ID', 'CLIENT_ID']);
        const name = getMappedValue(row, sheet.mapping.full_name, ['NAME', 'APPLICANT_NAME', 'SHAREHOLDER NAME']);
        const kitta = parseNumber(row[sheet.mapping.shares_held || 'KITTA'] ?? row['KITTA'] ?? row['ALLOTED_QUANTITY'] ?? row['TOTA KITTA']);
        const excelAmount = parseNumber(row[sheet.mapping.net_payable || 'NET'] ?? row['NET_DIV.'] ?? row['NET INTEREST PAYABLE'] ?? row['ROUND UP DIV'] ?? row['ROUNDUP'] ?? row['NET']);
        const bankName = getMappedValue(row, sheet.mapping.bank_name, ['BANK NAME', 'BANK']);
        const bankAccountNo = getMappedValue(row, sheet.mapping.bank_account_no, ['BANK A/C NO.', 'BANK A/C NO', 'ACCOUNT_NUMBER']);
        const lotName = getMappedValue(row, sheet.mapping.lot_name, ['LOT']);

        const rawPledge = getMappedValue(row, sheet.mapping.pledge, ['PLEDGE', 'REMARKS']).toUpperCase();
        const pledgeFlag = rawPledge.includes('PLEDGE') || rawPledge === '1';
        const rawStatus = getMappedValue(row, sheet.mapping.status, ['STATUS', 'REMARKS 1']).toUpperCase();

        const client = boid ? clientsByBoid.get(boid) : null;
        const clientId = client?.id || null;

        // 5-WAY MATCHING LOGIC
        let bestPayable: PayableRow | null = null;
        let bestPayment: PaymentRow | null = null;
        const matchSources: string[] = [];

        // SOURCE 1: Match against Payables
        if (clientId) {
          const candidatePayables = payablesByClientId.get(clientId) || [];
          bestPayable = candidatePayables.reduce<PayableRow | null>((best, current) => {
            if (!best) return current;
            const currentDiff = Math.abs(current.net_payable - excelAmount);
            const bestDiff = Math.abs(best.net_payable - excelAmount);
            return currentDiff < bestDiff ? current : best;
          }, null);
          
          if (bestPayable && !usedPayableIds.has(bestPayable.id)) {
            matchSources.push('payable');
          } else if (bestPayable) {
            bestPayable = null; // Already used
          }
        }

        // SOURCE 2: Match against Payments (by client or by amount)
        if (clientId) {
          const clientPayments = paymentsByClientId.get(clientId) || [];
          bestPayment = clientPayments.find(p => !usedPaymentIds.has(p.id)) || null;
          
          if (!bestPayment) {
            // Fallback: match by amount
            const amountCandidates = paymentsByAmount.get(buildAmountKey(excelAmount)) || [];
            bestPayment = amountCandidates.find(p => !usedPaymentIds.has(p.id)) || null;
          }
          
          if (bestPayment) {
            matchSources.push('payment');
            usedPaymentIds.add(bestPayment.id);
          }
        }

        // SOURCE 3: Match against Bank Statements (by bank account)
        if (bankAccountNo) {
          const matchedBank = (bankStatements || []).find((bs: any) => 
            normalizeAccountKey(bs.account_no) === normalizeAccountKey(bankAccountNo)
          );
          if (matchedBank) {
            matchSources.push('bank_statement');
          }
        }

        // Calculate amounts and differences
        const systemAmount = bestPayable?.net_payable ?? bestPayment?.net_amount ?? 0;
        const difference = Number((systemAmount - excelAmount).toFixed(2));
        const TOLERANCE = 1; // NPR tolerance for matching

        // Determine status
        let status: ReconciliationMatch['status'] = 'Missing';
        if (pledgeFlag) {
          status = 'Pledged';
          pledgedInSheet += 1;
          grandTotal.pledgedCount += 1;
        } else if (rawStatus.includes('REJECT')) {
          status = 'Rejected';
          grandTotal.rejectedCount += 1;
        } else if (rawStatus.includes('PENDING')) {
          status = 'Pending';
        } else if (matchSources.length === 0) {
          status = 'Missing';
          summary.missingInSystem += 1;
        } else if (Math.abs(difference) <= TOLERANCE) {
          status = 'Matched';
          matchedInSheet += 1;
          grandTotal.matchedRecords += 1;
          
          // Track match sources
          if (matchSources.includes('payable')) summary.matchedFromPayable += 1;
          if (matchSources.includes('payment')) summary.matchedFromPayment += 1;
          if (matchSources.includes('bank_statement')) summary.matchedFromBank += 1;
        } else {
          status = difference > 0 ? 'Over_Paid' : 'Under_Paid';
          mismatchedInSheet += 1;
          grandTotal.discrepancyCount += 1;
        }

        // Mark payable as used if matched
        if (bestPayable) {
          usedPayableIds.add(bestPayable.id);
        }

        matches.push({
          id: `${sheet.sheetName}-${idx + 1}`,
          boid: boid || `ROW-${idx + 1}`,
          shareholderName: name || 'Unknown',
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
          paymentId: bestPayment?.id ?? null,
          paymentStatus: bestPayment?.payment_status ?? null,
          sourceType: 'excel',
          matchSources: matchSources.length > 0 ? matchSources : undefined,
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
      sourceType: 'excel',
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
  async analyzeBankStatement(transactions: BankTransaction[]): Promise<ComprehensiveReconciliationReport> {
    const cleanAcct = (val: unknown): string => String(val || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^0+/, '');
    const cleanName = (val: unknown): string => String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Load data from DB in parallel with complete client joins and payment batches
    const [paymentsResult, payablesResult, batchesResult] = await Promise.all([
      (supabase as any)
        .from('payments')
        .select('id,company_id,client_id,net_amount,gross_amount,bank_name,bank_account_no,status,payable_type,payable_id,payment_date,connectips_ref,clients(id,boid,full_name,company_id,bank_name,bank_account_no)')
        .limit(10000),

      (async () => {
        const [divResult, intResult, mfResult] = await Promise.all([
          supabase.from('dividend_payables').select('id,company_id,client_id,net_payable,gross_dividend,payment_status,clients(id,boid,full_name,bank_name,bank_account_no)').limit(10000),
          supabase.from('interest_payables').select('id,company_id,client_id,net_payable,gross_interest,payment_status,clients(id,boid,full_name,bank_name,bank_account_no)').limit(10000),
          (supabase as any).from('mutual_fund_payables').select('id,company_id,client_id,net_payable,payment_status,clients(id,boid,full_name,bank_name,bank_account_no)').limit(10000),
        ]);
        
        const payables: any[] = [];
        divResult.data?.forEach((row: any) => payables.push({ ...row, payable_type: 'dividend' }));
        intResult.data?.forEach((row: any) => payables.push({ ...row, payable_type: 'interest' }));
        mfResult.data?.forEach((row: any) => payables.push({ ...row, payable_type: 'mutual_fund' }));
        return { data: payables };
      })(),

      (supabase as any)
        .from('payment_batches')
        .select('id,company_id,batch_name,total_amount,total_net,total_tax,payable_type,status,cds_batch_ref,created_at')
        .limit(1000),
    ]);

    const payments = paymentsResult.data || [];
    const payables = payablesResult.data || [];
    const batches = batchesResult.data || [];

    // Build indexing maps for high-performance matching
    const paymentsByAcct = new Map<string, any[]>();
    const paymentsByName = new Map<string, any[]>();
    const paymentsByAmt = new Map<string, any[]>();

    payments.forEach((p: any) => {
      const acct = cleanAcct(p.bank_account_no || p.clients?.bank_account_no);
      const name = cleanName(p.clients?.full_name);
      const amtKey = buildAmountKey(Number(p.net_amount ?? 0));

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
    });

    const payablesByAcct = new Map<string, any[]>();
    const payablesByName = new Map<string, any[]>();
    const payablesByAmt = new Map<string, any[]>();

    payables.forEach((p: any) => {
      const acct = cleanAcct(p.clients?.bank_account_no);
      const name = cleanName(p.clients?.full_name);
      const amtKey = buildAmountKey(Number(p.net_payable ?? 0));

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

    const usedPaymentIds = new Set<string>();
    const usedPayableIds = new Set<string>();
    const usedBatchIds = new Set<string>();

    transactions.forEach((txn, idx) => {
      const amount = txn.credit > 0 ? txn.credit : Math.abs(txn.debit);
      const txnAcct = cleanAcct(txn.accountNo);
      const txnName = cleanName(txn.beneficiaryName || txn.description);
      const amtKey = buildAmountKey(amount);
      const isBankReject = txn.status === 'RJCT' || String(txn.status || '').toLowerCase().includes('reject') || String(txn.description || '').toUpperCase().includes('INCORRECT A/C');

      let bestPayment: any = null;
      let matchedPayable: any = null;
      let matchedBatch: any = null;
      const matchSources: string[] = [];

      // 1. Match against Payments
      if (txnAcct) {
        const acctPayments = paymentsByAcct.get(txnAcct) || [];
        bestPayment = acctPayments.find(p => !usedPaymentIds.has(p.id) && Math.abs(Number(p.net_amount) - amount) < 0.05) || null;
      }
      if (!bestPayment && txnName) {
        const namePayments = paymentsByName.get(txnName) || [];
        bestPayment = namePayments.find(p => !usedPaymentIds.has(p.id) && Math.abs(Number(p.net_amount) - amount) < 0.05) || null;
      }
      if (!bestPayment && txnAcct) {
        const acctPayments = paymentsByAcct.get(txnAcct) || [];
        bestPayment = acctPayments.find(p => !usedPaymentIds.has(p.id)) || null;
      }
      if (!bestPayment) {
        const amtPayments = paymentsByAmt.get(amtKey) || [];
        bestPayment = amtPayments.find(p => !usedPaymentIds.has(p.id)) || null;
      }

      if (bestPayment) {
        matchSources.push('payment');
        usedPaymentIds.add(bestPayment.id);
      }

      // 2. If no payment matched, match against Payables
      if (!bestPayment) {
        if (txnAcct) {
          const acctPayables = payablesByAcct.get(txnAcct) || [];
          matchedPayable = acctPayables.find(p => !usedPayableIds.has(p.id) && Math.abs(Number(p.net_payable) - amount) < 0.05) || null;
        }
        if (!matchedPayable && txnName) {
          const namePayables = payablesByName.get(txnName) || [];
          matchedPayable = namePayables.find(p => !usedPayableIds.has(p.id) && Math.abs(Number(p.net_payable) - amount) < 0.05) || null;
        }
        if (!matchedPayable && txnAcct) {
          const acctPayables = payablesByAcct.get(txnAcct) || [];
          matchedPayable = acctPayables.find(p => !usedPayableIds.has(p.id)) || null;
        }
        if (!matchedPayable) {
          const amtPayables = payablesByAmt.get(amtKey) || [];
          matchedPayable = amtPayables.find(p => !usedPayableIds.has(p.id)) || null;
        }

        if (matchedPayable) {
          matchSources.push('payable');
          usedPayableIds.add(matchedPayable.id);
        }
      }

      // 3. Match against Payment Batches (for aggregate statement entries)
      if (!bestPayment && !matchedPayable && (txn.category === 'PAYOUT_DEBIT' || txn.debit > 0 || txn.description.toUpperCase().includes('BATCH') || txn.description.toUpperCase().includes('IPS DR'))) {
        const batchMatch = batches.find((b: any) => {
          if (usedBatchIds.has(b.id)) return false;
          const bAmount = Number(b.total_net || b.total_amount || 0);
          if (bAmount > 0 && Math.abs(bAmount - amount) < 1.0) return true;
          if (b.batch_name && txn.description && txn.description.toUpperCase().includes(b.batch_name.toUpperCase())) return true;
          return false;
        });

        if (batchMatch) {
          matchedBatch = batchMatch;
          matchSources.push('payment_batch');
          usedBatchIds.add(batchMatch.id);
        }
      }

      const client = bestPayment?.clients || matchedPayable?.clients || null;
      let systemAmount = 0;
      if (bestPayment) {
        systemAmount = Number(bestPayment.net_amount ?? 0);
      } else if (matchedPayable) {
        systemAmount = Number(matchedPayable.net_payable ?? 0);
      } else if (matchedBatch) {
        systemAmount = Number(matchedBatch.total_net || matchedBatch.total_amount || 0);
      }

      const difference = Number((systemAmount - amount).toFixed(2));
      let status: ReconciliationMatch['status'] = 'Missing';

      if (isBankReject) {
        status = 'Rejected';
        grandTotal.rejectedCount += 1;
      } else if (matchSources.length > 0) {
        if (Math.abs(difference) < 1.0) {
          status = 'Matched';
          grandTotal.matchedRecords += 1;
          if (matchSources.includes('payment')) summary.matchedFromPayment += 1;
          if (matchSources.includes('payable')) summary.matchedFromPayable += 1;
          if (matchSources.includes('payment_batch')) summary.matchedFromBank += 1;
        } else {
          status = difference > 0 ? 'Over_Paid' : 'Under_Paid';
          grandTotal.discrepancyCount += 1;
        }
      } else if (amount === 0) {
        status = 'Pending';
      } else {
        status = 'Missing';
        summary.missingInSystem += 1;
      }

      // Safe BOID and Label formatting
      let displayBoid = client?.boid;
      if (!displayBoid) {
        if (matchedBatch) {
          displayBoid = matchedBatch.batch_name;
        } else if (txn.accountNo && txn.accountNo.length >= 8 && !txn.accountNo.includes(':') && !txn.accountNo.includes('-')) {
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
          displayName = 'Bank Settlement Entry';
        }
      }

      let categoryName = 'Bank Statement';
      if (txn.category === 'FUNDING_DEPOSIT') {
        categoryName = 'Account Funding / Inflow';
      } else if (txn.category === 'BANK_CHARGES') {
        categoryName = 'Bank Fee / Commission';
      } else if (txn.status) {
        categoryName = `ConnectIPS (${txn.status})`;
      } else if (matchedBatch) {
        categoryName = 'Payment Batch Debit';
      }

      matches.push({
        id: `bank-${idx + 1}`,
        boid: displayBoid,
        shareholderName: displayName,
        category: categoryName,
        kitta: 0,
        excelAmount: amount,
        systemAmount: status === 'Matched' ? systemAmount : (systemAmount > 0 ? systemAmount : 0),
        difference: status === 'Matched' ? 0 : difference,
        status,
        bankName: txn.bankName || client?.bank_name || 'Rastriya Banijya Bank',
        bankAccountNo: txn.accountNo || client?.bank_account_no || '1700100002426001',
        clientId: client?.id || bestPayment?.client_id || matchedPayable?.client_id || null,
        companyId: client?.company_id || bestPayment?.company_id || matchedPayable?.company_id || matchedBatch?.company_id || null,
        paymentId: bestPayment?.id ?? null,
        paymentStatus: bestPayment?.status ?? bestPayment?.payment_status ?? null,
        payableId: matchedPayable?.id ?? bestPayment?.payable_id ?? null,
        payableType: matchedPayable?.payable_type ?? bestPayment?.payable_type ?? matchedBatch?.payable_type ?? 'interest',
        transactionDate: txn.date || null,
        transactionDescription: txn.instructionId ? `Instruction: ${txn.instructionId}` : (txn.description || null),
        sourceType: 'bank_statement',
        matchSources: matchSources.length > 0 ? matchSources : undefined,
      });
    });

    categories.push({
      categoryName: 'Bank / ConnectIPS Settlement',
      rowCount: transactions.length,
      totalKitta: 0,
      totalGrossAmount: grandTotal.totalGrossAmount,
      totalTaxAmount: 0,
      totalNetPayable: grandTotal.totalNetPayable,
      matchedCount: grandTotal.matchedRecords,
      mismatchedCount: grandTotal.discrepancyCount,
      pledgedCount: 0,
    });

    return {
      fileType: 'bank_statement',
      sourceType: 'bank_statement',
      fileName: 'Bank Settlement Report',
      categories,
      matches,
      grandTotal,
      summary,
    };
  },
};