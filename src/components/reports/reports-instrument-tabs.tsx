import { Building2, FileSpreadsheet, FileText, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgmDividendSummaryReportService } from "@/lib/services/dividend-summary-report.service";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
import {
  SummaryReportService,
  type MutualFundSummaryRow,
} from "@/lib/services/summary-report.service";
import { formatReportCurrency, formatReportNumber, type ReportId } from "./reports-config";

export function ReportsAgmTab({
  agmSummary,
}: {
  agmSummary:
    Awaited<ReturnType<typeof AgmDividendSummaryReportService.getCompanySummary>> | undefined;
}) {
  return (
    <TabsContent value="agm" className="space-y-4">
      {agmSummary && agmSummary.rows.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>AGM Shareholder Category Summary</CardTitle>
              <CardDescription>
                Official AGM distribution sheet matching regulatory RTA format.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => AgmDividendSummaryReportService.exportToExcel(agmSummary)}
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => AgmDividendSummaryReportService.exportToPdf(agmSummary)}
              >
                <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>S.N.</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Shareholders</TableHead>
                  <TableHead className="text-right">Kitta</TableHead>
                  <TableHead className="text-right">Bonus Issued</TableHead>
                  <TableHead className="text-right">After Bonus Kitta</TableHead>
                  <TableHead className="text-right">Gross Dividend</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Net Dividend</TableHead>
                  <TableHead className="text-right">Composition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agmSummary.rows.map((row) => (
                  <TableRow key={row.particular}>
                    <TableCell>{row.sn}</TableCell>
                    <TableCell className="font-medium">{row.particular}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Math.round(row.shareholderCount || 0).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportNumber(row.kitta)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportNumber(row.issuedBonus)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-medium text-emerald-600">
                      {formatReportNumber(row.afterBonusKitta)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(row.grossDividend)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-600">
                      {formatReportCurrency(row.divTax + row.bonTax)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-bold text-emerald-600">
                      {formatReportCurrency(row.netDividend)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {(row.composition ?? 0).toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {agmSummary.total && (
                <TableFooter>
                  <TableRow className="bg-muted/90 font-bold border-t-2 border-foreground/30 font-mono">
                    <TableCell></TableCell>
                    <TableCell className="font-sans uppercase">TOTAL</TableCell>
                    <TableCell className="text-right">
                      {Math.round(agmSummary.total.shareholderCount || 0).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportNumber(agmSummary.total.kitta)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportNumber(agmSummary.total.issuedBonus)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                      {formatReportNumber(agmSummary.total.afterBonusKitta)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportCurrency(agmSummary.total.grossDividend)}
                    </TableCell>
                    <TableCell className="text-right text-amber-600">
                      {formatReportCurrency(agmSummary.total.divTax + agmSummary.total.bonTax)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                      {formatReportCurrency(agmSummary.total.netDividend)}
                    </TableCell>
                    <TableCell className="text-right font-sans">
                      {agmSummary.total.composition.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">
              No equity dividend records found for the selected company.
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              The AGM Equities tab generates distributions for listed shares. If you are managing
              Mutual Funds (such as RMF1 or RMF2), unitholder returns are calculated under the{" "}
              <strong>Mutual Funds (CDS)</strong> tab.
            </p>
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}

export function ReportsDebentureTab({
  debentureSummary,
  isLoading,
}: {
  debentureSummary:
    ReturnType<typeof DebentureSummaryReportService.generateReportFromPayables> | undefined;
  isLoading: boolean;
}) {
  return (
    <TabsContent value="debenture" className="space-y-4">
      {isLoading ? (
        <Card className="border-primary/20 shadow-sm">
          <CardContent className="p-4 space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </CardContent>
        </Card>
      ) : debentureSummary && debentureSummary.rows.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Debenture Interest Distribution Summary
                {debentureSummary.daysCount && (
                  <Badge variant="outline" className="font-sans text-xs bg-primary/10 text-primary">
                    {debentureSummary.daysCount} Days &bull;{" "}
                    {debentureSummary.daysCount >= 360
                      ? "Annual (12 Months)"
                      : debentureSummary.daysCount >= 180
                        ? "Semi-Annual (6 Months)"
                        : "Quarterly"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Pumori banking & CDS format for Public, Institution, and Mutual Fund debentures.
                Displays both Full Annual (12M) baseline interest and the actual Coupon Period (
                {debentureSummary.daysCount
                  ? `${debentureSummary.daysCount} Days`
                  : "6 Months / Semi-Annual"}
                ) disbursed.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => DebentureSummaryReportService.exportToExcel(debentureSummary)}
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => DebentureSummaryReportService.exportToPdf(debentureSummary)}
              >
                <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Kitta</TableHead>
                  <TableHead className="text-right">Principal Amount</TableHead>
                  <TableHead className="text-right">Annual Interest (12M)</TableHead>
                  <TableHead className="text-right">Int. Per Day</TableHead>
                  <TableHead className="text-right">Gross Interest (Coupon)</TableHead>
                  <TableHead className="text-right">Tax Withheld</TableHead>
                  <TableHead className="text-right">Net Payable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debentureSummary.rows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportNumber(row.kitta)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(row.principalAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(row.annualInterest)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(row.interestPerDay)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(row.grossInterest)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-600">
                      {formatReportCurrency(row.taxAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-bold text-emerald-600">
                      {formatReportCurrency(row.netInterestPayable)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {debentureSummary.total && (
                <TableFooter>
                  <TableRow className="bg-muted/90 font-bold border-t-2 border-foreground/30 font-mono">
                    <TableCell className="font-sans uppercase">TOTAL</TableCell>
                    <TableCell className="text-right">
                      {formatReportNumber(debentureSummary.total.kitta)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportCurrency(debentureSummary.total.principalAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportCurrency(debentureSummary.total.annualInterest)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportCurrency(debentureSummary.total.interestPerDay)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatReportCurrency(debentureSummary.total.grossInterest)}
                    </TableCell>
                    <TableCell className="text-right text-amber-600">
                      {formatReportCurrency(debentureSummary.total.taxAmount)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                      {formatReportCurrency(debentureSummary.total.netInterestPayable)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">
              No debenture interest records found for the selected company.
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Debenture coupon reports apply to bond issuances. For mutual fund unitholder
              distributions, please check the <strong>Mutual Funds (CDS)</strong> tab.
            </p>
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}

export function ReportsMutualFundTab({
  companyId,
  mfSchemes,
  mfSummary,
  mfTotal,
  selectedCompany,
  onSelectCompanyAndView,
  onExportReport,
}: {
  companyId: string;
  mfSchemes: any[];
  mfSummary: MutualFundSummaryRow[];
  mfTotal: { transaction_count: number; kitta: number; gross: number; tax: number; net: number };
  selectedCompany?: { id: string; company_name: string; company_code: string };
  onSelectCompanyAndView: (schemeCompanyId: string, reportId: ReportId) => void;
  onExportReport: (id: ReportId, kind: "xlsx" | "pdf", options?: { companyId?: string }) => void;
}) {
  return (
    <TabsContent value="mf" className="space-y-4">
      {companyId === "all" && mfSchemes.length > 0 && (
        <Card className="border-indigo-200 dark:border-indigo-900 shadow-xs">
          <CardHeader className="py-3 px-4 bg-indigo-50/60 dark:bg-indigo-950/30 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
                <Building2 className="h-4 w-4 text-indigo-600" />
                Mutual Fund Schemes Breakdown (All Active Funds)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Independent financial totals per scheme (RMF1, RMF2) with unitholder counts, kitta,
                gross distribution, and TDS deductions.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-[11px] uppercase">
                  <TableHead className="w-10">S.N.</TableHead>
                  <TableHead>Scheme Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Unitholders</TableHead>
                  <TableHead className="text-right">Units / Kitta</TableHead>
                  <TableHead className="text-right">Gross Dividend</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Net Payable</TableHead>
                  <TableHead className="text-right pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mfSchemes.map((s: any, idx: number) => (
                  <TableRow key={s.company_id} className="hover:bg-muted/30">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-semibold text-foreground flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                      {s.company_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {s.company_code}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Math.round(s.unitholders || 0).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportNumber(s.kitta)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(s.gross)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-600">
                      {formatReportCurrency(s.tax)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-bold text-emerald-600">
                      {formatReportCurrency(s.net)}
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          onClick={() =>
                            onSelectCompanyAndView(s.company_id, "mutual_fund_register")
                          }
                        >
                          View Register
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] px-2 text-rose-600 hover:text-rose-700"
                          onClick={() =>
                            onExportReport("mutual_fund_register", "pdf", {
                              companyId: s.company_id,
                            })
                          }
                        >
                          <FileText className="h-3 w-3 mr-1" />
                          PDF
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-indigo-50/80 dark:bg-indigo-950/50 font-bold border-t-2 border-indigo-300 dark:border-indigo-800 font-mono">
                  <TableCell
                    colSpan={3}
                    className="font-sans uppercase text-indigo-950 dark:text-indigo-200"
                  >
                    TOTAL PORTFOLIO ({mfSchemes.length} SCHEMES)
                  </TableCell>
                  <TableCell className="text-right">
                    {Math.round(
                      mfSchemes.reduce(
                        (acc: number, s: any) => acc + Number(s.unitholders || 0),
                        0,
                      ),
                    ).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatReportNumber(
                      mfSchemes.reduce((acc: number, s: any) => acc + Number(s.kitta || 0), 0),
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatReportCurrency(
                      mfSchemes.reduce((acc: number, s: any) => acc + Number(s.gross || 0), 0),
                    )}
                  </TableCell>
                  <TableCell className="text-right text-amber-600">
                    {formatReportCurrency(
                      mfSchemes.reduce((acc: number, s: any) => acc + Number(s.tax || 0), 0),
                    )}
                  </TableCell>
                  <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-bold">
                    {formatReportCurrency(
                      mfSchemes.reduce((acc: number, s: any) => acc + Number(s.net || 0), 0),
                    )}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      {mfSummary.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Mutual Fund Distribution Summary</CardTitle>
              <CardDescription>CDS standard category returns for unitholders.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  SummaryReportService.exportMutualFundSummaryToExcel(
                    mfSummary,
                    `mutual_fund_summary_${selectedCompany?.company_code || "all"}`,
                  )
                }
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  SummaryReportService.exportMutualFundSummaryToPdf(
                    mfSummary,
                    selectedCompany?.company_name || "RTARTS System",
                  )
                }
              >
                <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>S.N.</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Unitholders</TableHead>
                  <TableHead className="text-right">Units / Kitta</TableHead>
                  <TableHead className="text-right">Gross Dividend</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Net Dividend</TableHead>
                  <TableHead className="text-right">Composition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mfSummary.map((row) => (
                  <TableRow key={row.type}>
                    <TableCell>{row.sn}</TableCell>
                    <TableCell className="font-medium">{row.type}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Math.round(row.transaction_count || 0).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportNumber(row.kitta)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatReportCurrency(row.gross)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-600">
                      {formatReportCurrency(row.tax)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-bold text-emerald-600">
                      {formatReportCurrency(row.net)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {(row.composition ?? 0).toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/90 font-bold border-t-2 border-foreground/30 font-mono">
                  <TableCell></TableCell>
                  <TableCell className="font-sans uppercase">TOTAL</TableCell>
                  <TableCell className="text-right">
                    {Math.round(mfTotal.transaction_count || 0).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right">{formatReportNumber(mfTotal.kitta)}</TableCell>
                  <TableCell className="text-right">
                    {formatReportCurrency(mfTotal.gross)}
                  </TableCell>
                  <TableCell className="text-right text-amber-600">
                    {formatReportCurrency(mfTotal.tax)}
                  </TableCell>
                  <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                    {formatReportCurrency(mfTotal.net)}
                  </TableCell>
                  <TableCell className="text-right font-sans">100.00%</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No mutual fund records found for the selected company.
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}
