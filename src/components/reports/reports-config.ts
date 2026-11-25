export type ReportId =
  | "dividend_register"
  | "interest_register"
  | "mutual_fund_register"
  | "tax_register"
  | "pending_register"
  | "payment_register"
  | "reconciliation_report"
  | "upload_history_report";

export const PAYABLE_REPORTS: Array<{ id: ReportId; title: string; description: string }> = [
  {
    id: "dividend_register",
    title: "Dividend Register",
    description:
      "Cash, stock, bonus, and right-share transactions with BOID & bank account details.",
  },
  {
    id: "interest_register",
    title: "Interest Register",
    description: "Debenture coupon interest dues, TDS deductions, and payment statuses.",
  },
  {
    id: "mutual_fund_register",
    title: "Mutual Fund Register",
    description: "Unit-holder distribution records, bank accounts, and payment statuses.",
  },
  {
    id: "tax_register",
    title: "Tax (TDS) Register",
    description: "Payable-level TDS breakdowns with payee PAN, gross, rate %, and tax withheld.",
  },
  {
    id: "pending_register",
    title: "Pending Payables",
    description: "Outstanding amounts across instruments awaiting payment or approval.",
  },
];

export const OPERATIONS_REPORTS: Array<{ id: ReportId; title: string; description: string }> = [
  {
    id: "payment_register",
    title: "Payment Batches",
    description: "Batch payout processing, authorization status, and disbursement totals.",
  },
  {
    id: "reconciliation_report",
    title: "Reconciliation Results",
    description: "Bank settlement matches, discrepancy logs, and variance analysis.",
  },
  {
    id: "upload_history_report",
    title: "Upload History",
    description: "Import logs, validation diagnostics, and processed vs failed counts.",
  },
];

export const REPORT_COLUMNS: Record<ReportId, Array<{ header: string; dataKey: string }>> = {
  dividend_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Shares / Kitta", dataKey: "shares_held" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_dividend" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
    { header: "Paid (NPR)", dataKey: "paid_amount" },
    { header: "Remaining (NPR)", dataKey: "remaining_amount" },
    { header: "Status", dataKey: "payment_status" },
  ],
  interest_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Instrument", dataKey: "instrument_ref" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_interest" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
    { header: "Paid (NPR)", dataKey: "paid_amount" },
    { header: "Remaining (NPR)", dataKey: "remaining_amount" },
    { header: "Status", dataKey: "payment_status" },
  ],
  mutual_fund_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Units / Kitta", dataKey: "shares_held" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_dividend" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
    { header: "Paid (NPR)", dataKey: "paid_amount" },
    { header: "Remaining (NPR)", dataKey: "remaining_amount" },
    { header: "Status", dataKey: "payment_status" },
  ],
  tax_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "PAN / Ctz", dataKey: "pan_or_citizenship" },
    { header: "Company", dataKey: "company_name" },
    { header: "Type", dataKey: "payable_type" },
    { header: "Gross (NPR)", dataKey: "gross_amount" },
    { header: "Rate %", dataKey: "tds_rate" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
  ],
  pending_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Type", dataKey: "payable_type" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_amount" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
  ],
  payment_register: [
    { header: "Batch Name", dataKey: "batch_name" },
    { header: "Method", dataKey: "payment_method" },
    { header: "Payments", dataKey: "total_payments" },
    { header: "Amount (NPR)", dataKey: "total_amount" },
    { header: "Fiscal Year", dataKey: "fiscal_year" },
    { header: "Status", dataKey: "status" },
  ],
  reconciliation_report: [
    { header: "Shareholder", dataKey: "shareholder_name" },
    { header: "Category", dataKey: "category" },
    { header: "Expected (NPR)", dataKey: "system_amount" },
    { header: "Actual (NPR)", dataKey: "excel_amount" },
    { header: "Difference", dataKey: "difference" },
    { header: "Status", dataKey: "status" },
  ],
  upload_history_report: [
    { header: "File Name", dataKey: "file_name" },
    { header: "Type", dataKey: "file_type" },
    { header: "Processed", dataKey: "rows_processed" },
    { header: "Failed", dataKey: "rows_failed" },
    { header: "Status", dataKey: "status" },
    { header: "Uploaded At", dataKey: "created_at" },
  ],
};

export function formatReportCurrency(value: number): string {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatReportNumber(value: number): string {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
