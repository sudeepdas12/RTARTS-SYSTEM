/**
 * Deterministic Sanitized Sample Fixture for Mutual Fund Reconciliation
 * Derived from the structural characteristics of:
 * - samples/MUTUAL FUND REPORTS 82.83/ERROR REPORT 2026.10.05.xls
 * - samples/MUTUAL FUND REPORTS 82.83/MER 4.xls
 * - samples/MUTUAL FUND REPORTS 82.83/LATE RETURN/20261005 late rtn.xlsx
 * - samples/MUTUAL FUND REPORTS 82.83/Payables/RBB MF 1 Cash Dividend.xlsx
 */

export interface SanitizedPayableRow {
  id: string;
  company_id: string;
  client_id: string;
  boid: string;
  holder_name: string;
  bank_account: string;
  bank_name: string;
  shares_held: number;
  gross_dividend: number;
  tax_amount: number; // For Mutual Funds, TDS is 0%
  net_payable: number; // Exactly equals gross_dividend
  payment_status: "Pending" | "Paid" | "Partial";
  fiscal_year: string;
  payee_classification: string;
}

export interface SanitizedBankTxRow {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  accountNo?: string;
  beneficiaryName?: string;
  instructionId?: string;
  referenceId?: string;
  status: "Success" | "Rejected" | "Pending";
  category: "PAYOUT_DEBIT" | "REJECT_RETURN" | "FUNDING_DEPOSIT" | "BANK_CHARGES" | "NRB_CIRCULAR";
  fileName: string;
}

export const MUTUAL_FUND_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Expected aggregate benchmarks from the real sample files.
 */
export const SAMPLE_BENCHMARKS = {
  mer4: {
    acceptedCount: 56,
    rejectedCount: 2,
    totalAcceptedAmt: 14756304.11,
    totalRejectedAmt: 48409.62,
    fileName: "MER 4.xls",
  },
  errorReport: {
    rowCount: 24,
    totalAmt: 1593.53,
    fileName: "ERROR REPORT 2026.10.05.xls",
    category: "REJECT_RETURN",
  },
  lateReturn: {
    totalAmt: 9850.0,
    fileName: "20261005 late rtn.xlsx",
    expectedStatus: "Accepted Settlement Completed",
  },
  nrbCircular: {
    sweepAmount: 1216412.39,
    openingBalance: 3000.0,
    closingBalance: 1219412.39,
    fileName: "RBB MF 1 Cash Dividend.xlsx",
  },
};

/**
 * Deterministic set of Mutual Fund Payables with 0% TDS
 * SEBON Rule: Mutual fund distributions to tax-exempt/resident funds have 0 TDS (gross === net).
 */
export const SANITIZED_MF_PAYABLES: SanitizedPayableRow[] = [
  {
    id: "mf-pay-001",
    company_id: MUTUAL_FUND_COMPANY_ID,
    client_id: "mf-cli-001",
    boid: "1301010000000001",
    holder_name: "SHANKAR PRASAD KHANAL",
    bank_account: "5207010008021",
    bank_name: "Rastriya Banijya Bank",
    shares_held: 1000,
    gross_dividend: 26.12,
    tax_amount: 0.0,
    net_payable: 26.12,
    payment_status: "Pending",
    fiscal_year: "82/83",
    payee_classification: "MUTUAL_FUND",
  },
  {
    id: "mf-pay-002",
    company_id: MUTUAL_FUND_COMPANY_ID,
    client_id: "mf-cli-002",
    boid: "1301010000000002",
    holder_name: "RAJ SHRESTHA",
    bank_account: "071104074884701",
    bank_name: "Global IME Bank",
    shares_held: 1500,
    gross_dividend: 39.18,
    tax_amount: 0.0,
    net_payable: 39.18,
    payment_status: "Pending",
    fiscal_year: "82/83",
    payee_classification: "MUTUAL_FUND",
  },
  {
    id: "mf-pay-003",
    company_id: MUTUAL_FUND_COMPANY_ID,
    client_id: "mf-cli-003",
    boid: "1301010000000003",
    holder_name: "BASHUDEV BHANDARI",
    bank_account: "100516207012",
    bank_name: "Everest Bank Limited",
    shares_held: 26880,
    gross_dividend: 702.39,
    tax_amount: 0.0,
    net_payable: 702.39,
    payment_status: "Pending",
    fiscal_year: "82/83",
    payee_classification: "MUTUAL_FUND",
  },
  {
    id: "mf-pay-004",
    company_id: MUTUAL_FUND_COMPANY_ID,
    client_id: "mf-cli-004",
    boid: "1301010000000004",
    holder_name: "KOLAY CENTRE",
    bank_account: "1110075066019",
    bank_name: "Himalayan Bank",
    shares_held: 377000,
    gross_dividend: 9850.0,
    tax_amount: 0.0,
    net_payable: 9850.0,
    payment_status: "Pending",
    fiscal_year: "82/83",
    payee_classification: "MUTUAL_FUND",
  },
];

/**
 * Sanitized deterministic bank statement transactions including:
 * 1. Legitimate payout matches
 * 2. Rejected payouts
 * 3. Sweeps and non-payout bank operations
 */
export const SANITIZED_BANK_TRANSACTIONS: SanitizedBankTxRow[] = [
  // 1. Matched payouts
  {
    id: "bank-tx-001",
    date: "2026-10-05",
    description: "RBB MUTUAL FUND 1 ( CASH DIVIDEND ) - BASHUDEV",
    debit: 702.39,
    credit: 0.0,
    balance: 500000.0,
    accountNo: "100516207012",
    beneficiaryName: "BASHUDEV BHANDARI",
    instructionId: "0201261007HES1",
    referenceId: "NLG DIV",
    status: "Success",
    category: "PAYOUT_DEBIT",
    fileName: "REPORT 2026.10.08.xls",
  },
  {
    id: "bank-tx-002",
    date: "2026-10-05",
    description: "Accepted Settlement Completed - KOLAY CENTRE",
    debit: 9850.0,
    credit: 0.0,
    balance: 490150.0,
    accountNo: "1110075066019",
    beneficiaryName: "KOLAY CENTRE",
    instructionId: "0101261005NGD00D",
    referenceId: "Sarduljung Coy/18407900058927",
    status: "Success",
    category: "PAYOUT_DEBIT",
    fileName: "20261005 late rtn.xlsx",
  },

  // 2. Rejected payout items (from ERROR REPORT 2026.10.05.xls)
  {
    id: "bank-tx-003",
    date: "2026-10-05",
    description: "ACH REJECT - INVALID A/C NO - SHANKAR PRASAD KHANAL",
    debit: 0.0,
    credit: 26.12,
    balance: 490176.12,
    accountNo: "5207010008021",
    beneficiaryName: "SHANKAR PRASAD KHANAL",
    instructionId: "82-83-DIV-RMF1-REJ-01",
    referenceId: "RJCT-001",
    status: "Rejected",
    category: "REJECT_RETURN",
    fileName: "ERROR REPORT 2026.10.05.xls",
  },
  {
    id: "bank-tx-004",
    date: "2026-10-05",
    description: "ACH REJECT - DORMANT A/C - RAJ SHRESTHA",
    debit: 0.0,
    credit: 39.18,
    balance: 490215.3,
    accountNo: "071104074884701",
    beneficiaryName: "RAJ SHRESTHA",
    instructionId: "82-83-DIV-RMF1-REJ-02",
    referenceId: "RJCT-002",
    status: "Rejected",
    category: "REJECT_RETURN",
    fileName: "ERROR REPORT 2026.10.05.xls",
  },

  // 3. Excluded non-payout operations (Must NOT match payables)
  {
    id: "bank-tx-005",
    date: "2026-10-26",
    description: "NRB CIRCULAR SWEEP OUT",
    debit: 1216412.39,
    credit: 0.0,
    balance: 3000.0,
    status: "Success",
    category: "NRB_CIRCULAR",
    fileName: "RBB MF 1 Cash Dividend.xlsx",
  },
  {
    id: "bank-tx-006",
    date: "2026-10-27",
    description: "NRB CIRCULAR SWEEP IN",
    debit: 0.0,
    credit: 1216412.39,
    balance: 1219412.39,
    status: "Success",
    category: "NRB_CIRCULAR",
    fileName: "RBB MF 1 Cash Dividend.xlsx",
  },
  {
    id: "bank-tx-007",
    date: "2026-10-27",
    description: "QUARTERLY SMS AND LEDGER CHARGES",
    debit: 500.0,
    credit: 0.0,
    balance: 1218912.39,
    status: "Success",
    category: "BANK_CHARGES",
    fileName: "RBB MF 1 Cash Dividend.xlsx",
  },
  {
    id: "bank-tx-008",
    date: "2026-10-27",
    description: "FUNDING DEPOSIT VIA RTGS FROM SCHEME SPONSOR",
    debit: 0.0,
    credit: 5000000.0,
    balance: 6218912.39,
    status: "Success",
    category: "FUNDING_DEPOSIT",
    fileName: "RBB MF 1 Cash Dividend.xlsx",
  },
];
