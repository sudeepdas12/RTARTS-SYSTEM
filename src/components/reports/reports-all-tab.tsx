import { BarChart3, Coins, FileSpreadsheet, FileText, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { AgmDividendSummaryReportService } from "@/lib/services/dividend-summary-report.service";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
import {
  SummaryReportService,
  type MutualFundSummaryRow,
} from "@/lib/services/summary-report.service";
import { formatReportNumber } from "./reports-config";

export interface ReportsAllTabProps {
  agmSummary:
    Awaited<ReturnType<typeof AgmDividendSummaryReportService.getCompanySummary>> | undefined;
  agmSummaryLoading: boolean;
  debentureSummary:
    ReturnType<typeof DebentureSummaryReportService.generateReportFromPayables> | undefined;
  debentureSummaryLoading: boolean;
  debDisplayRates: { publicRatePct: number; institutionRatePct: number; exemptRatePct: number };
  mfSummary: MutualFundSummaryRow[];
  mfSummaryLoading: boolean;
  mfTotal: { transaction_count: number; kitta: number; gross: number; tax: number; net: number };
  mfSchemes: any[];
  selectedCompany?: { id: string; company_name: string; company_code: string };
  companyId: string;
  isSummariesLoading: boolean;
  hasAnySummaryData: boolean;
}

export function ReportsAllSummariesTab({
  agmSummary,
  agmSummaryLoading,
  debentureSummary,
  debentureSummaryLoading,
  debDisplayRates,
  mfSummary,
  mfSummaryLoading,
  mfTotal,
  mfSchemes,
  selectedCompany,
  companyId,
  isSummariesLoading,
  hasAnySummaryData,
}: ReportsAllTabProps) {
  return (
    <TabsContent value="all" className="space-y-6">
      {agmSummaryLoading ? (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center gap-3">
            <BarChart3 className="h-4 w-4 text-primary shrink-0" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </CardContent>
        </Card>
      ) : agmSummary && agmSummary.rows.length > 0 ? (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                AGM Cash & Bonus Dividend Distribution Summary
                <Badge variant="outline" className="font-mono text-[11px] ml-1">
                  {agmSummary.companyCode || "All"}{" "}
                  {agmSummary.fiscalYear ? `— FY ${agmSummary.fiscalYear}` : ""}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Promoter, Public, and Local shareholding capital, bonus shares, and net cash
                distribution.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => AgmDividendSummaryReportService.exportToExcel(agmSummary)}
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => AgmDividendSummaryReportService.exportToPdf(agmSummary)}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                  <th className="py-2.5 px-3 text-center w-10 uppercase text-[11px] whitespace-nowrap">
                    S.N.
                  </th>
                  <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                    CATEGORY
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    SHAREHOLDERS
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    KITTA
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    {agmSummary.detectedBonusRate
                      ? `BONUS ${agmSummary.detectedBonusRate}%`
                      : "BONUS"}
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                    AFTER BONUS KITTA
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    GROSS DIVIDEND
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    TAX
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                    NET DIVIDEND
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    COMPOSITION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {agmSummary.rows.map((row) => (
                  <tr
                    key={row.particular}
                    className="hover:bg-muted/30 transition-colors divide-x divide-border"
                  >
                    <td className="py-2 px-3 text-center text-muted-foreground whitespace-nowrap">
                      {row.sn}
                    </td>
                    <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                      {row.particular}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {Math.round(row.shareholderCount || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                      {formatReportNumber(row.kitta)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.issuedBonus)}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                      {formatReportNumber(row.afterBonusKitta)}
                    </td>
                    <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                      {formatReportNumber(row.grossDividend)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.divTax)}
                    </td>
                    <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                      {formatReportNumber(row.netDividend)}
                    </td>
                    <td className="py-2 px-3 text-right font-sans font-medium whitespace-nowrap">
                      {(row.composition ?? 0).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                  <td className="py-2 px-3 text-center whitespace-nowrap"></td>
                  <td className="py-2 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {Math.round(agmSummary.total.shareholderCount || 0).toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(agmSummary.total.kitta)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(agmSummary.total.issuedBonus)}
                  </td>
                  <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                    {formatReportNumber(agmSummary.total.afterBonusKitta)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(agmSummary.total.grossDividend)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(agmSummary.total.divTax)}
                  </td>
                  <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                    {formatReportNumber(agmSummary.total.netDividend)}
                  </td>
                  <td className="py-2 px-3 text-right font-sans whitespace-nowrap">
                    {agmSummary.total.composition.toFixed(2)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {debentureSummaryLoading ? (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center gap-3">
            <Coins className="h-4 w-4 text-primary shrink-0" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </CardContent>
        </Card>
      ) : debentureSummary && debentureSummary.rows.length > 0 ? (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                Debenture Interest Distribution Summary (Pumori Format)
                <Badge variant="outline" className="font-mono text-[11px] ml-1">
                  {debentureSummary.companyCode || "All"}{" "}
                  {debentureSummary.fiscalYear ? `— FY ${debentureSummary.fiscalYear}` : ""}
                </Badge>
                {debentureSummary.daysCount && (
                  <Badge
                    variant="secondary"
                    className="font-sans text-[10px] ml-1 bg-primary/10 text-primary"
                  >
                    {debentureSummary.daysCount} Days &bull;{" "}
                    {debentureSummary.daysCount >= 360
                      ? "Annual"
                      : debentureSummary.daysCount >= 180
                        ? "Semi-Annual (6M)"
                        : "Quarterly"}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Public ({debDisplayRates.publicRatePct}% TDS), Institution (
                {debDisplayRates.institutionRatePct}% TDS), and Mutual Fund (
                {debDisplayRates.exemptRatePct}% TDS) debenture coupon calculation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => DebentureSummaryReportService.exportToExcel(debentureSummary)}
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => DebentureSummaryReportService.exportToPdf(debentureSummary)}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x border-border">
                  <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                    CATEGORY
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    KITTA
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    PRINCIPAL
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    {debentureSummary.couponRate > 0
                      ? `ANNUAL INT. (${debentureSummary.couponRate}%)`
                      : "ANNUAL INT. (12M)"}
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    INT. PER DAY
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    GROSS INTEREST (COUPON)
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    TAX
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                    NET PAYABLE
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {debentureSummary.rows.map((row) => (
                  <tr
                    key={row.name}
                    className="hover:bg-muted/30 transition-colors divide-x divide-border"
                  >
                    <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                      {row.name}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.kitta)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.principalAmount)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.annualInterest)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.interestPerDay)}
                    </td>
                    <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                      {formatReportNumber(row.grossInterest)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.taxAmount)}
                    </td>
                    <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                      {formatReportNumber(row.netInterestPayable)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                  <td className="py-2 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.kitta)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.principalAmount)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.annualInterest)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.interestPerDay)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.grossInterest)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.taxAmount)}
                  </td>
                  <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                    {formatReportNumber(debentureSummary.total.netInterestPayable)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {mfSummaryLoading ? (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center gap-3">
            <Layers className="h-4 w-4 text-primary shrink-0" />
            <Skeleton className="h-4 w-60" />
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </CardContent>
        </Card>
      ) : mfSummary.length > 0 ? (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Mutual Fund Distribution Summary (CDS Format)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                CDS & Clearing format unitholder category distribution with unit counts and net
                dividends.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  SummaryReportService.exportMutualFundSummaryToExcel(
                    mfSummary,
                    `mutual_fund_summary_${selectedCompany?.company_code || "all"}`,
                  )
                }
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  SummaryReportService.exportMutualFundSummaryToPdf(
                    mfSummary,
                    selectedCompany?.company_name || "Consolidated Mutual Fund Portfolio",
                    selectedCompany
                      ? `Scheme: ${selectedCompany.company_name} (${selectedCompany.company_code})`
                      : "Consolidated Portfolio (RMF1 & RMF2)",
                    companyId === "all" ? mfSchemes : undefined,
                  )
                }
              >
                <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                  <th className="py-2.5 px-3 text-center w-10 uppercase text-[11px] whitespace-nowrap">
                    S.N.
                  </th>
                  <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                    CATEGORY
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    UNITHOLDERS
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    UNITS / KITTA
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    GROSS DIVIDEND
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    TAX
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                    NET DIVIDEND
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                    COMPOSITION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {mfSummary.map((row) => (
                  <tr
                    key={row.type}
                    className="hover:bg-muted/30 transition-colors divide-x divide-border"
                  >
                    <td className="py-2 px-3 text-center text-muted-foreground whitespace-nowrap">
                      {row.sn}
                    </td>
                    <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                      {row.type}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {Math.round(row.transaction_count || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                      {formatReportNumber(row.kitta)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.gross)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatReportNumber(row.tax)}
                    </td>
                    <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                      {formatReportNumber(row.net)}
                    </td>
                    <td className="py-2 px-3 text-right font-sans font-medium whitespace-nowrap">
                      {(row.composition ?? 0).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                  <td className="py-2 px-3 text-center whitespace-nowrap"></td>
                  <td className="py-2 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {Math.round(mfTotal.transaction_count || 0).toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(mfTotal.kitta)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(mfTotal.gross)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatReportNumber(mfTotal.tax)}
                  </td>
                  <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                    {formatReportNumber(mfTotal.net)}
                  </td>
                  <td className="py-2 px-3 text-right font-sans whitespace-nowrap">100.00%</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {!isSummariesLoading && !hasAnySummaryData && (
        <Card className="border-dashed border-muted-foreground/30 bg-muted/10">
          <CardContent className="py-12 text-center text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-sm text-foreground">No Distribution Records Found</p>
            <p>
              No AGM equity dividends, debenture coupons, or mutual fund returns are currently
              registered for this selection.
            </p>
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}
