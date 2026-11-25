import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FileParseStatus, FileVariantWarning } from "@/lib/bank-parser";
import type { ComprehensiveReconciliationReport } from "@/lib/reconciliation-engine";
import { ReconciliationDashboard } from "@/components/reconciliation/reconciliation-dashboard";

export interface ReconciliationOverviewProps {
  report: ComprehensiveReconciliationReport;
  variantAlerts: FileVariantWarning[];
  parsedFileStatuses: FileParseStatus[];
  selectedCategoryFilter: string;
  onSelectCategoryFilter: (category: string) => void;
}

export function ReconciliationOverviewSection({
  report,
  variantAlerts,
  parsedFileStatuses,
  selectedCategoryFilter,
  onSelectCategoryFilter,
}: ReconciliationOverviewProps) {
  return (
    <>
      {variantAlerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Source Variant Discrepancy Detected
              </h4>
              {variantAlerts.map((va, idx) => (
                <p key={idx} className="text-xs text-amber-800 dark:text-amber-300">
                  • {va.reason} ({va.fileA}: {va.countA.toLocaleString()} rows vs {va.fileB}:{" "}
                  {va.countB.toLocaleString()} rows).
                </p>
              ))}
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200 pt-1">
                Please confirm whether one file represents an incomplete version, copy, or
                supplementary sheet before applying reconciliation.
              </p>
            </div>
          </div>
        </div>
      )}

      {parsedFileStatuses.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between pb-2 border-b">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Source File Ingestion Provenance ({parsedFileStatuses.length} files)
                </span>
              </div>
            </div>
            <div className="divide-y text-xs mt-2 max-h-40 overflow-y-auto">
              {parsedFileStatuses.map((fs, idx) => (
                <div key={idx} className="py-1.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium truncate">{fs.fileName}</span>
                    {fs.status === "duplicate" && (
                      <Badge variant="outline" className="text-[10px] text-amber-600">
                        Duplicate (Skipped)
                      </Badge>
                    )}
                    {fs.status === "failed" && (
                      <Badge variant="destructive" className="text-[10px]">
                        Failed
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-muted-foreground font-mono text-[11px]">
                    <span>{fs.transactionCount.toLocaleString()} rows</span>
                    {fs.rejectedCount > 0 && (
                      <span className="text-red-600">
                        {fs.rejectedCount.toLocaleString()} rejects
                      </span>
                    )}
                    {fs.fileHash && (
                      <span className="text-[10px] opacity-70" title={`SHA-256: ${fs.fileHash}`}>
                        Hash: {fs.fileHash.slice(0, 8)}...
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ReconciliationDashboard report={report} />

      {report.summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Exact Matches</p>
              <p className="text-lg font-bold text-green-600">{report.grandTotal.matchedRecords}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Partial / Installments</p>
              <p className="text-lg font-bold text-amber-600">
                {report.grandTotal.partialRecords || 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Matched (Payment)</p>
              <p className="text-lg font-bold text-blue-600">{report.summary.matchedFromPayment}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Matched (Bank)</p>
              <p className="text-lg font-bold text-purple-600">{report.summary.matchedFromBank}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Missing in System</p>
              <p className="text-lg font-bold text-red-600">{report.summary.missingInSystem}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Rejected / Bounced</p>
              <p className="text-lg font-bold text-rose-600">{report.grandTotal.rejectedCount}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {report.summary && (
        <Card className="bg-muted/30">
          <CardContent className="py-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">Overall Match Rate</span>
              <span className="font-medium text-primary">
                {Math.round(
                  (((report.grandTotal.matchedRecords || 0) +
                    (report.grandTotal.partialRecords || 0)) /
                    Math.max(1, report.grandTotal.totalRecords)) *
                    100,
                )}
                % (
                {(report.grandTotal.matchedRecords || 0) + (report.grandTotal.partialRecords || 0)}{" "}
                of {report.grandTotal.totalRecords} matched
                {(report.grandTotal.partialRecords || 0) > 0
                  ? ` • ${report.grandTotal.partialRecords} partial/installments`
                  : ""}
                )
              </span>
            </div>
            <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex">
              <div
                className="bg-green-500 h-full transition-all"
                style={{
                  width: `${(report.grandTotal.matchedRecords / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                }}
                title={`Exact Matches (${report.grandTotal.matchedRecords})`}
              />
              {(report.grandTotal.partialRecords || 0) > 0 && (
                <div
                  className="bg-amber-400 h-full transition-all"
                  style={{
                    width: `${((report.grandTotal.partialRecords || 0) / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                  }}
                  title={`Partial / Installment Matches (${report.grandTotal.partialRecords})`}
                />
              )}
              <div
                className="bg-blue-500 h-full transition-all"
                style={{
                  width: `${(report.summary.matchedFromPayment / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                }}
                title="Matched from Payment"
              />
              <div
                className="bg-purple-500 h-full transition-all"
                style={{
                  width: `${(report.summary.matchedFromBank / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                }}
                title="Matched from Bank"
              />
              <div
                className="bg-red-500 h-full transition-all"
                style={{
                  width: `${(report.summary.missingInSystem / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                }}
                title="Missing"
              />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-green-500 mr-1" /> Exact Match
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-amber-400 mr-1" /> Partial / Installment
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-blue-500 mr-1" /> Payment Match
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-purple-500 mr-1" /> Bank Match
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-red-500 mr-1" /> Missing
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {report.categories && report.categories.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Classification Summary Breakdown
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Exact category-wise totals across all sheets and settlement lots. Click any category
                row to filter shareholder matches below.
              </CardDescription>
            </div>
            {selectedCategoryFilter !== "all" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-primary"
                onClick={() => onSelectCategoryFilter("all")}
              >
                Clear Filter ({selectedCategoryFilter})
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="py-2.5 px-3 text-left font-semibold">
                      Classification / Category
                    </th>
                    <th className="py-2.5 px-3 text-right font-semibold">Shareholders</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Total Kitta</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Gross Amount (NPR)</th>
                    <th className="py-2.5 px-3 text-right font-semibold">TDS Tax (NPR)</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Net Payable (NPR)</th>
                    <th className="py-2.5 px-3 text-right font-semibold text-green-600 dark:text-green-400">
                      Matched
                    </th>
                    <th className="py-2.5 px-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                      Discrepancy
                    </th>
                    <th className="py-2.5 px-3 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.categories.map((cat) => {
                    const isSelected = selectedCategoryFilter === cat.categoryName;
                    return (
                      <tr
                        key={cat.categoryName}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/10 font-semibold" : "hover:bg-muted/40"
                        }`}
                        onClick={() =>
                          onSelectCategoryFilter(isSelected ? "all" : cat.categoryName)
                        }
                      >
                        <td className="py-2.5 px-3 font-medium flex items-center gap-2">
                          <span>{cat.categoryName}</span>
                          {isSelected && (
                            <Badge variant="secondary" className="text-[10px] h-4">
                              Filtered
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {cat.rowCount.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {cat.totalKitta > 0 ? cat.totalKitta.toLocaleString() : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {cat.totalGrossAmount > 0
                            ? cat.totalGrossAmount.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })
                            : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                          {cat.totalTaxAmount > 0
                            ? cat.totalTaxAmount.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })
                            : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-primary">
                          {cat.totalNetPayable > 0
                            ? cat.totalNetPayable.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })
                            : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-green-600 dark:text-green-400 font-semibold">
                          {cat.matchedCount.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {cat.mismatchedCount > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {cat.mismatchedCount.toLocaleString()}
                            </span>
                          ) : (
                            "0"
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {cat.matchedCount === cat.rowCount ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300 text-[10px] h-4">
                              100% Matched
                            </Badge>
                          ) : cat.matchedCount > 0 ? (
                            <Badge
                              variant="outline"
                              className="text-amber-600 border-amber-300 text-[10px] h-4"
                            >
                              Partial
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px] h-4">
                              Unmatched
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {report.grandTotal.matchedRecords === 0 &&
        (report.grandTotal.partialRecords || 0) === 0 &&
        report.matches.length > 0 && (
          <div className="flex items-start gap-2.5 p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 rounded-xl text-xs mb-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold text-sm mb-1">No Matching Records Found (0 Matches)</p>
              <p>
                All {report.matches.length.toLocaleString()} records in this file are currently
                categorized as &ldquo;Missing&rdquo; because no matching Pending payables or
                payments could be found by Account Number, Shareholder Name, or ConnectIPS
                Reference.
              </p>
              <ul className="list-disc pl-4 mt-1.5 space-y-1">
                <li>
                  <strong>General Bank Statements:</strong> Consolidated sweep entries (e.g.{" "}
                  <em>NRB Circular</em>) and lump-sum batch debits (e.g. <em>IPS DR</em>) require
                  the individual ConnectIPS LOT settlement reports to be uploaded and applied first
                  so payment batches exist.
                </li>
                <li>
                  <strong>ConnectIPS Settlement Reports (LOT files):</strong> Ensure that the
                  underlying payables (Dividend, Interest/Debenture, or Mutual Fund) for this
                  company and fiscal year have been imported via the <strong>Upload</strong>{" "}
                  section.
                </li>
                <li>
                  <strong>Company Filter:</strong> Verify that the company selected in the top
                  filter matches the company whose disbursements are in this file.
                </li>
              </ul>
            </div>
          </div>
        )}

      {(report.grandTotal.partialRecords || 0) > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 dark:text-emerald-200 rounded-xl text-xs mb-3">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold text-sm mb-1">
              Semi-Annual / Installment Matches Detected ({report.grandTotal.partialRecords}{" "}
              records)
            </p>
            <p>
              These records successfully matched shareholder accounts in the system with partial
              payout amounts (e.g. semi-annual debenture interest). Applying reconciliation will
              update these payables to <strong>&ldquo;Partial&rdquo;</strong> status and create
              corresponding payment records with the disbursed installment amount.
            </p>
          </div>
        </div>
      )}

      {report.sourceType === "bank_statement" && (
        <div className="flex items-start gap-2.5 p-3.5 bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-200 rounded-xl text-xs mb-3">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div className="space-y-1.5">
            <p className="font-semibold text-sm">
              Bank Statement Multi-Source Reconciliation Guide
            </p>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground dark:text-muted-foreground">
              <li>
                <strong className="text-foreground">Multi-Year Statements:</strong> Statements
                spanning prior fiscal years (2021–2025) will show as &ldquo;Missing&rdquo; because
                only the active fiscal year payables (e.g. FY 2082/83) are currently imported.
              </li>
              <li>
                <strong className="text-foreground">ConnectIPS Batch Withdrawals:</strong> Lump-sum
                payout debits (e.g. <em>IPS DR</em> or bulk transfers) represent the pool funding
                for ConnectIPS LOT settlement files (LOT 1, LOT 2, LOT 3). Ensure the LOT settlement
                files are uploaded and applied first to register the payment batches.
              </li>
              <li>
                <strong className="text-foreground">Bounced Returns & Credits:</strong> Failed
                payouts credited back into the bank account are automatically recognized and flagged
                as bounced returns.
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
