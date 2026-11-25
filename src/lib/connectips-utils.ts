export type ConnectIpsGatewayStatus = "SUCCESS" | "FAILED" | "PENDING";

export type ConnectIpsLedgerPaymentStatus =
  | "Completed"
  | "Paid"
  | "Processing"
  | "Pending"
  | "Failed"
  | "Rejected"
  | "Returned"
  | "Reversed"
  | "Cancelled";

export type ConnectIpsBatchStatus =
  "Draft" | "Pending" | "Approved" | "Rejected" | "Returned" | "Processed" | "Completed" | "Failed";

export interface NormalizedNchlStatus {
  gatewayStatus: ConnectIpsGatewayStatus;
  ledgerStatus: ConnectIpsLedgerPaymentStatus;
  label: string;
}

/**
 * Generates the standard NCHL ConnectIPS validation signature string.
 * Format: MERCHANTID={merchantId},APPID={appId},APPPAYMENTID={appPaymentId},AMOUNT={amount}
 */
export function buildConnectIpsSignatureString(tx: {
  merchantId: string;
  appId: string;
  appPaymentId: string;
  amount: number;
}): string {
  const formattedAmount = Number(tx.amount).toFixed(2);
  return `MERCHANTID=${tx.merchantId},APPID=${tx.appId},APPPAYMENTID=${tx.appPaymentId},AMOUNT=${formattedAmount}`;
}

/**
 * Maps raw NCHL ConnectIPS gateway status strings/codes and descriptions
 * into normalized system gateway + database ledger statuses.
 */
export function normalizeNchlStatus(
  rawStatus: unknown,
  rawDescription?: string | null,
): NormalizedNchlStatus {
  const code = String(rawStatus ?? "")
    .trim()
    .toUpperCase();
  const desc = String(rawDescription ?? "")
    .trim()
    .toUpperCase();
  const combined = `${code} ${desc}`.trim();

  // Check explicit return / reversal markers before generic failed states
  if (
    code === "RETURN" ||
    code === "RETURNED" ||
    code === "BOUNCED" ||
    code === "REVERSED" ||
    /\b(RETURNED|BOUNCED|UNPAID\s+RTS|REVERSAL)\b/.test(desc)
  ) {
    return {
      gatewayStatus: "FAILED",
      ledgerStatus: code === "REVERSED" ? "Reversed" : "Returned",
      label: code === "REVERSED" ? "Reversed" : "Returned by Bank",
    };
  }

  // Check explicit NCHL rejection markers
  if (code === "REJECT" || code === "REJECTED" || code === "RJCT") {
    return {
      gatewayStatus: "FAILED",
      ledgerStatus: "Rejected",
      label: "Rejected by NCHL",
    };
  }

  // Settled / Paid confirmation from NCHL ConnectIPS or system ledger
  if (
    code === "SUCCESS" ||
    code === "COMPLETED" ||
    code === "COMPLETE" ||
    code === "SETTLED" ||
    code === "PAID" ||
    code === "CREDIT_SUCCESS" ||
    code === "OK" ||
    code === "00" ||
    code === "000"
  ) {
    return {
      gatewayStatus: "SUCCESS",
      ledgerStatus: "Completed",
      label: "Completed",
    };
  }

  // In-flight NCHL clearing / debit accepted awaiting final beneficiary settlement
  if (
    code === "PROCESSING" ||
    code === "SUBMITTED" ||
    code === "ACCEPTED" ||
    code === "INITIATED" ||
    code === "IN_PROGRESS" ||
    code === "QUEUED" ||
    code === "DEBITED" ||
    code === "PENDING_CLEARING"
  ) {
    return {
      gatewayStatus: "PENDING",
      ledgerStatus: "Processing",
      label: "Processing (NCHL Clearing)",
    };
  }

  // Explicit failed / invalid / cancelled markers
  if (
    code === "FAIL" ||
    code === "FAILED" ||
    code === "ERROR" ||
    code === "INVALID" ||
    code === "CANCELLED" ||
    code === "CANCELED" ||
    code === "EXPIRED" ||
    code === "INSUFFICIENT" ||
    /\b(RJCT|REJECTED|DORMANT|MISMATCH|INVALID|INSUFFICIENT|FAILED)\b/.test(combined)
  ) {
    return {
      gatewayStatus: "FAILED",
      ledgerStatus: code === "CANCELLED" || code === "CANCELED" ? "Cancelled" : "Failed",
      label: code === "CANCELLED" || code === "CANCELED" ? "Cancelled" : "Failed",
    };
  }

  return {
    gatewayStatus: "PENDING",
    ledgerStatus: "Pending",
    label: "Pending",
  };
}

/**
 * Computes parent payment_batches lifecycle status deterministically from its line item statuses.
 * Mirrors PostgreSQL `sync_connectips_payment_results`.
 */
export function deriveBatchStatusFromLineStatuses(
  statuses: Array<string | null | undefined>,
  fallbackStatus: ConnectIpsBatchStatus = "Approved",
): ConnectIpsBatchStatus {
  const active = statuses
    .map((s) => String(s || "Pending").trim())
    .filter((s) => s !== "Cancelled");

  if (active.length === 0) {
    return fallbackStatus;
  }

  let settled = 0;
  let processing = 0;
  let pending = 0;
  let failed = 0;
  let returned = 0;

  for (const status of active) {
    if (status === "Completed" || status === "Paid") {
      settled += 1;
    } else if (status === "Processing") {
      processing += 1;
    } else if (status === "Pending" || status === "Draft") {
      pending += 1;
    } else if (status === "Failed" || status === "Rejected") {
      failed += 1;
    } else if (status === "Returned" || status === "Reversed") {
      returned += 1;
    } else {
      pending += 1;
    }
  }

  const total = active.length;
  if (settled > 0 && processing === 0 && pending === 0 && failed === 0 && returned === 0) {
    return "Completed";
  }
  if (processing > 0 || (settled > 0 && (pending > 0 || failed > 0 || returned > 0))) {
    return "Processed";
  }
  if (returned > 0 && returned + failed === total) {
    return "Returned";
  }
  if (failed === total) {
    return "Failed";
  }

  return fallbackStatus;
}

/**
 * Computes updated payable settlement amounts and status given cumulative settled payments.
 */
export function calculatePayableSettlementFromPaid(
  netPayable: number,
  cumulativePaid: number,
): {
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: "Paid" | "Partial" | "Pending";
} {
  const target = Math.max(0, Number(netPayable || 0));
  const boundedPaid = Math.min(target, Math.max(0, Number(cumulativePaid || 0)));
  const remaining = Math.max(0, Number((target - boundedPaid).toFixed(2)));
  const paymentStatus: "Paid" | "Partial" | "Pending" =
    remaining <= 0.05 && target > 0 ? "Paid" : boundedPaid > 0 ? "Partial" : "Pending";

  return {
    paidAmount: Number(boundedPaid.toFixed(2)),
    remainingAmount: remaining,
    paymentStatus,
  };
}

/**
 * Semantic Badge variant + Tailwind styling for payment & batch statuses in the UI.
 */
export function getPaymentStatusPresentation(status?: string | null): {
  variant: "default" | "secondary" | "outline" | "destructive";
  className: string;
} {
  const s = String(status || "Draft").trim();
  switch (s) {
    case "Completed":
    case "Paid":
      return {
        variant: "default",
        className: "bg-emerald-600 hover:bg-emerald-600 text-white border-transparent",
      };
    case "Approved":
      return {
        variant: "secondary",
        className:
          "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
      };
    case "Processing":
    case "Processed":
      return {
        variant: "outline",
        className:
          "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
      };
    case "Pending":
      return {
        variant: "outline",
        className:
          "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "Partial":
      return {
        variant: "outline",
        className:
          "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
      };
    case "Draft":
      return {
        variant: "outline",
        className: "text-muted-foreground border-border bg-muted/40",
      };
    case "Failed":
    case "Rejected":
    case "Returned":
    case "Reversed":
    case "Cancelled":
      return {
        variant: "destructive",
        className: "",
      };
    default:
      return {
        variant: "outline",
        className: "",
      };
  }
}
