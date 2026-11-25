import {
  Coins,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IrdEtdsService } from "@/lib/services/ird-etds.service";
import { IpfService } from "@/lib/services/ipf.service";
import {
  OPERATIONS_REPORTS,
  PAYABLE_REPORTS,
  formatReportCurrency,
  formatReportNumber,
  type ReportId,
} from "./reports-config";

export function ReportsRegistersTab({
  activeExport,
  onViewReport,
  onExportReport,
}: {
  activeExport: string | null;
  onViewReport: (id: ReportId) => void;
  onExportReport: (id: ReportId, kind: "xlsx" | "pdf") => void;
}) {
  return (
    <TabsContent value="registers" className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-base">Payable Registers</h3>
            <p className="text-xs text-muted-foreground">
              Download transaction-level registers with BOID, bank account numbers, and tax rates.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PAYABLE_REPORTS.map((report) => (
            <Card key={report.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm">{report.title}</h4>
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
                </div>
                <div className="mt-4 flex gap-1.5 pt-2 border-t">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 text-xs flex-1 bg-primary/90 hover:bg-primary"
                    onClick={() => onViewReport(report.id)}
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2.5"
                    disabled={activeExport === `${report.id}-xlsx`}
                    onClick={() => onExportReport(report.id, "xlsx")}
                    title="Export Excel"
                  >
                    {activeExport === `${report.id}-xlsx` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2.5"
                    disabled={activeExport === `${report.id}-pdf`}
                    onClick={() => onExportReport(report.id, "pdf")}
                    title="Export PDF"
                  >
                    {activeExport === `${report.id}-pdf` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-rose-600" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-base">Operations & Audit Exports</h3>
            <p className="text-xs text-muted-foreground">
              Export system batch approvals, bank reconciliation discrepancies, and data uploads.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {OPERATIONS_REPORTS.map((report) => (
            <Card key={report.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm">{report.title}</h4>
                    <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
                </div>
                <div className="mt-4 flex gap-1.5 pt-2 border-t">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 text-xs flex-1 bg-primary/90 hover:bg-primary"
                    onClick={() => onViewReport(report.id)}
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2.5"
                    disabled={activeExport === `${report.id}-xlsx`}
                    onClick={() => onExportReport(report.id, "xlsx")}
                    title="Export Excel"
                  >
                    {activeExport === `${report.id}-xlsx` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2.5"
                    disabled={activeExport === `${report.id}-pdf`}
                    onClick={() => onExportReport(report.id, "pdf")}
                    title="Export PDF"
                  >
                    {activeExport === `${report.id}-pdf` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-rose-600" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </TabsContent>
  );
}

export function ReportsIrdEtdsTab({
  irdEtds,
  isLoading,
}: {
  irdEtds: Awaited<ReturnType<typeof IrdEtdsService.getAnnex10Report>> | undefined;
  isLoading: boolean;
}) {
  return (
    <TabsContent value="ird_etds" className="space-y-6">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="py-4 px-6 bg-muted/40 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-600" />
              Government of Nepal — Inland Revenue Department (IRD) Annex-10 e-TDS Return
            </CardTitle>
            <CardDescription className="text-xs">
              Pursuant to Section 87 & 88 of the Nepal Income Tax Act 2058. Formatted for direct
              upload to the IRD e-filing portal.
            </CardDescription>
          </div>
          {irdEtds && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 h-9"
                onClick={() => IrdEtdsService.exportAnnex10Json(irdEtds)}
                title="Export IRD Integrated Tax System (ITS) JSON Payload"
              >
                <Download className="mr-1.5 h-4 w-4 text-emerald-600" />
                Download IRD e-TDS JSON
              </Button>
              <Button
                variant="default"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 h-9"
                onClick={() => IrdEtdsService.exportAnnex10Excel(irdEtds)}
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                Download Annex-10 Excel
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : irdEtds ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-muted/30 border rounded-lg">
                  <span className="text-xs text-muted-foreground font-medium uppercase">
                    Total Withholdees
                  </span>
                  <div className="text-xl font-bold mt-1">
                    {irdEtds.totalWithholdees.toLocaleString()}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    PAN: {irdEtds.panWithholdees} | Unregistered: {irdEtds.unregisteredWithholdees}
                  </span>
                </div>
                <div className="p-4 bg-muted/30 border rounded-lg">
                  <span className="text-xs text-muted-foreground font-medium uppercase">
                    Total Gross Payment
                  </span>
                  <div className="text-xl font-bold mt-1 text-primary">
                    {formatReportCurrency(irdEtds.totalGrossAmount)}
                  </div>
                </div>
                <div className="p-4 bg-muted/30 border rounded-lg">
                  <span className="text-xs text-muted-foreground font-medium uppercase">
                    Total TDS Withheld
                  </span>
                  <div className="text-xl font-bold mt-1 text-rose-600">
                    {formatReportCurrency(irdEtds.totalTdsAmount)}
                  </div>
                </div>
                <div className="p-4 bg-muted/30 border rounded-lg">
                  <span className="text-xs text-muted-foreground font-medium uppercase">
                    Total Net Payment
                  </span>
                  <div className="text-xl font-bold mt-1 text-emerald-600">
                    {formatReportCurrency(irdEtds.totalNetAmount)}
                  </div>
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-12">S.N.</TableHead>
                      <TableHead>Withholdee PAN</TableHead>
                      <TableHead>Shareholder / Payee</TableHead>
                      <TableHead>BOID</TableHead>
                      <TableHead>Payment Head</TableHead>
                      <TableHead className="text-right">Gross (NPR)</TableHead>
                      <TableHead className="text-right">TDS %</TableHead>
                      <TableHead className="text-right">TDS (NPR)</TableHead>
                      <TableHead className="text-right">Net (NPR)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {irdEtds.rows.slice(0, 15).map((row) => (
                      <TableRow key={row.sn}>
                        <TableCell className="font-mono text-xs">{row.sn}</TableCell>
                        <TableCell className="font-mono text-xs font-medium">
                          {row.withholdeePan === "UNREGISTERED" ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/20"
                            >
                              Unregistered
                            </Badge>
                          ) : (
                            row.withholdeePan
                          )}
                        </TableCell>
                        <TableCell className="font-medium text-xs">{row.withholdeeName}</TableCell>
                        <TableCell className="font-mono text-xs">{row.boid}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="secondary" className="text-[10px]">
                            {row.paymentType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {formatReportNumber(row.grossAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs font-semibold">
                          {row.tdsRate.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs text-rose-600 font-semibold">
                          {formatReportNumber(row.tdsAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs text-emerald-600 font-semibold">
                          {formatReportNumber(row.netPayable)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {irdEtds.rows.length > 15 && (
                <p className="text-xs text-muted-foreground text-center">
                  Showing first 15 of {irdEtds.rows.length.toLocaleString()} withholdee records.
                  Download full Annex-10 Excel file for complete e-filing schedule.
                </p>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No withholding tax records found for the selected criteria.
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export function ReportsIpfAgingTab({
  ipfReport,
  isLoading,
}: {
  ipfReport: Awaited<ReturnType<typeof IpfService.getIpfAgingReport>> | undefined;
  isLoading: boolean;
}) {
  return (
    <TabsContent value="ipf_aging" className="space-y-6">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="py-4 px-6 bg-muted/40 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-600" />
              SEBON & Office of Company Registrar — Investor Protection Fund (IPF) 5-Year Aging
              Tracker
            </CardTitle>
            <CardDescription className="text-xs">
              Pursuant to Section 182 of the Nepal Companies Act 2063: Unclaimed dividends older
              than 5 years must be transferred to the Investor Protection Fund.
            </CardDescription>
          </div>
          {ipfReport && ipfReport.ipfEligibleCount > 0 && (
            <Button
              variant="default"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 h-9"
              onClick={() => IpfService.exportIpfTransferSchedule(ipfReport)}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              Download SEBON IPF Transfer Schedule
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : ipfReport ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {ipfReport.agingBuckets.map((bucket, idx) => (
                  <div
                    key={idx}
                    className={`p-4 border rounded-lg ${
                      bucket.isEligibleForIpf
                        ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                        : "bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase">{bucket.label}</span>
                      {bucket.isEligibleForIpf && (
                        <Badge variant="destructive" className="text-[9px]">
                          IPF STATUTORY
                        </Badge>
                      )}
                    </div>
                    <div className="text-xl font-bold mt-2 font-mono">
                      {formatReportCurrency(bucket.totalAmount)}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {bucket.count.toLocaleString()} payables
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-muted/40 border rounded-lg flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-sm">Total Unclaimed Payable Balance</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Total {ipfReport.totalUnclaimedCount.toLocaleString()} unclaimed payables
                    amounting to {formatReportCurrency(ipfReport.totalUnclaimedAmount)}.
                    {ipfReport.ipfEligibleCount > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400 font-semibold ml-1">
                        {ipfReport.ipfEligibleCount.toLocaleString()} payables (
                        {formatReportCurrency(ipfReport.ipfEligibleAmount)}) have exceeded 5 years
                        and are ready for statutory transfer.
                      </span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold ml-1">
                        No payables currently exceed the 5-year threshold.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No unclaimed dividend records found.
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
