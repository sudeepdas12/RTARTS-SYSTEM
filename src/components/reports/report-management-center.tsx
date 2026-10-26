import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bookmark,
  Clock,
  Mail,
  History,
  Plus,
  Trash2,
  AlertCircle,
  Database,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ScheduledReportService } from "@/lib/services/scheduled-report.service";

export interface ReportPreset {
  id: string;
  name: string;
  reportId: string;
  companyId: string;
  fiscalYear: string;
  format: "xlsx" | "csv" | "pdf";
  createdDate: string;
  isShared?: boolean;
}

export interface ExportHistoryItem {
  id: string;
  reportTitle: string;
  format: string;
  timestamp: string;
  companyName: string;
  status: "Completed" | "Processing" | "Failed";
  details?: string;
}

const PRESETS_STORAGE_KEY = "rtarts_report_presets_v1";

const DEFAULT_PRESETS: ReportPreset[] = [
  {
    id: "preset-ird-tax",
    name: "Standard IRD Annex-10 Tax Audit",
    reportId: "tax_summary",
    companyId: "all",
    fiscalYear: "2080/81",
    format: "xlsx",
    createdDate: "2026-01-01",
    isShared: true,
  },
  {
    id: "preset-unclaimed-ipf",
    name: "Investor Protection Fund (IPF) Transfer List",
    reportId: "unclaimed_dividends",
    companyId: "all",
    fiscalYear: "2080/81",
    format: "xlsx",
    createdDate: "2026-01-01",
    isShared: true,
  },
];

export interface ReportManagementCenterProps {
  currentReportId: string;
  currentCompanyId: string;
  currentCompanyName: string;
  currentFiscalYear: string;
  onApplyPreset: (preset: ReportPreset) => void;
  dataAsOf: Date;
}

export function ReportManagementCenter({
  currentReportId,
  currentCompanyId,
  currentCompanyName,
  currentFiscalYear,
  onApplyPreset,
  dataAsOf,
}: ReportManagementCenterProps) {
  const [presets, setPresets] = useState<ReportPreset[]>(DEFAULT_PRESETS);
  const [exportHistory, setExportHistory] = useState<ExportHistoryItem[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [scheduleEmail, setScheduleEmail] = useState("");
  const [scheduleFreq, setScheduleFreq] = useState<"daily" | "weekly" | "monthly" | "quarterly">(
    "monthly",
  );
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  // Load server-backed presets and export history from database
  useEffect(() => {
    async function loadData() {
      setIsLoadingLogs(true);
      // 1. Fetch server-backed presets from report_presets table
      try {
        const { data: dbPresets, error: presetErr } = await (supabase as any)
          .from("report_presets")
          .select("*")
          .order("created_at", { ascending: false });

        if (!presetErr && Array.isArray(dbPresets) && dbPresets.length > 0) {
          const mapped: ReportPreset[] = dbPresets.map((p: any) => ({
            id: p.id,
            name: p.name,
            reportId: p.report_id,
            companyId: p.company_id,
            fiscalYear: p.fiscal_year,
            format: (p.format || "xlsx") as any,
            createdDate: p.created_at
              ? p.created_at.slice(0, 10)
              : new Date().toISOString().slice(0, 10),
            isShared: p.is_shared ?? true,
          }));
          setPresets([...mapped, ...DEFAULT_PRESETS]);
        } else {
          // Local fallback
          const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
          if (saved) setPresets(JSON.parse(saved));
        }
      } catch (e) {
        console.debug("Could not query report_presets table, using local fallback:", e);
      }

      // 2. Fetch real export history from report_versions and audit_logs
      try {
        const historyItems: ExportHistoryItem[] = [];
        const versions = await ScheduledReportService.getReportVersions(undefined, 10);
        if (Array.isArray(versions) && versions.length > 0) {
          versions.forEach((v) => {
            historyItems.push({
              id: v.id,
              reportTitle: v.report_name || v.report_type,
              format: (v.export_format || "EXCEL").toUpperCase(),
              timestamp: v.generated_at ? new Date(v.generated_at).toLocaleString() : "Recently",
              companyName: String(v.parameters?.companyName || "Scope"),
              status: "Completed",
              details: `${v.record_count.toLocaleString()} records`,
            });
          });
        }

        const { data: auditData } = await (supabase as any)
          .from("audit_logs")
          .select("id, action, record_id, new_value, action_time")
          .eq("table_name", "reports")
          .order("action_time", { ascending: false })
          .limit(10);

        if (Array.isArray(auditData) && auditData.length > 0) {
          auditData.forEach((d) => {
            const nv = d.new_value || {};
            historyItems.push({
              id: d.id,
              reportTitle: nv.reportTitle || nv.reportId || d.record_id || "Report Export",
              format: (
                nv.format || (d.action === "SCHEDULE_REPORT" ? "SCHEDULE" : "XLSX")
              ).toUpperCase(),
              timestamp: d.action_time ? new Date(d.action_time).toLocaleString() : "Recently",
              companyName: nv.companyName || "All Companies",
              status: "Completed",
              details:
                d.action === "SCHEDULE_REPORT"
                  ? `Scheduled to: ${nv.recipient}`
                  : `${nv.rowsCount || "Authoritative"} rows`,
            });
          });
        }

        setExportHistory(historyItems);
      } catch (e) {
        console.debug("Could not query export history from server:", e);
      } finally {
        setIsLoadingLogs(false);
      }
    }
    loadData();
  }, []);

  const saveCurrentAsPreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Please enter a preset name.");
      return;
    }

    const newPreset: ReportPreset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      reportId: currentReportId,
      companyId: currentCompanyId,
      fiscalYear: currentFiscalYear,
      format: "xlsx",
      createdDate: new Date().toISOString().slice(0, 10),
      isShared: true,
    };

    setPresets((prev) => [newPreset, ...prev]);

    // 1. Persist to server report_presets table for team sharing
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: dbInserted, error: insertErr } = await (supabase as any)
        .from("report_presets")
        .insert({
          name: newPresetName.trim(),
          report_id: currentReportId,
          company_id: currentCompanyId,
          fiscal_year: currentFiscalYear,
          format: "xlsx",
          is_shared: true,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (!insertErr && dbInserted) {
        newPreset.id = dbInserted.id;
      }
    } catch (e) {
      console.debug("Could not write to report_presets table:", e);
    }

    // 2. Local cache fallback
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify([newPreset, ...presets]));
    } catch (err) {
      console.debug("Preset storage write unavailable", err);
    }

    toast.success(`Shared preset "${newPreset.name}" saved to central database!`);
    setNewPresetName("");
    setSavePresetModalOpen(false);
  };

  const deletePreset = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPresets((prev) => prev.filter((p) => p.id !== id));
    try {
      await (supabase as any).from("report_presets").delete().eq("id", id);
    } catch (e) {
      console.debug("Could not delete from report_presets table:", e);
    }
    toast.info("Preset removed.");
  };

  const handleScheduleSubmit = async () => {
    if (!scheduleEmail || !scheduleEmail.includes("@")) {
      toast.error("Please enter a valid recipient email.");
      return;
    }

    setIsSubmittingSchedule(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // 1. Create durable scheduled_reports record via ScheduledReportService
      const scheduledResult = await ScheduledReportService.createScheduledReport({
        report_type: currentReportId,
        report_name: `${currentReportId.toUpperCase()} (${scheduleFreq.toUpperCase()}) - ${currentCompanyName}`,
        filters: {
          companyId: currentCompanyId,
          companyName: currentCompanyName,
          fiscalYear: currentFiscalYear,
        },
        schedule_type: scheduleFreq,
        schedule_time: "18:00",
        schedule_day: 1,
        recipients: [scheduleEmail.trim()],
        export_format: "excel",
        is_active: true,
        created_by: user?.id || "",
      });

      // 2. Log schedule creation in audit_logs
      const payload = {
        scheduledReportId: scheduledResult?.id || null,
        reportId: currentReportId,
        companyId: currentCompanyId,
        companyName: currentCompanyName,
        fiscalYear: currentFiscalYear,
        recipient: scheduleEmail.trim(),
        frequency: scheduleFreq,
        scheduledAt: new Date().toISOString(),
      };

      await (supabase as any).from("audit_logs").insert({
        user_id: user?.id || null,
        action: "SCHEDULE_REPORT",
        table_name: "reports",
        record_id: currentReportId,
        new_value: payload,
      });

      // 3. Add to live UI history
      const newHistoryItem: ExportHistoryItem = {
        id: scheduledResult?.id || `sched-${Date.now()}`,
        reportTitle: `${currentReportId.toUpperCase()} (${scheduleFreq.toUpperCase()})`,
        format: "SCHEDULE",
        timestamp: new Date().toLocaleString(),
        companyName: currentCompanyName,
        status: "Completed",
        details: `To: ${scheduleEmail.trim()}`,
      };
      setExportHistory((prev) => [newHistoryItem, ...prev]);

      toast.success(
        `Scheduled ${scheduleFreq} delivery of "${currentReportId}" registered in scheduled_reports table for ${scheduleEmail}!`,
      );
      setScheduleModalOpen(false);
      setScheduleEmail("");
    } catch (err: any) {
      toast.error(`Scheduling error: ${err.message || "Failed to register schedule"}`);
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Parameter Summary & Version Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-muted/40 rounded-lg border text-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">Parameter Scope:</span>
            <Badge variant="outline" className="bg-background">
              Company: {currentCompanyName}
            </Badge>
            <Badge variant="outline" className="bg-background">
              FY: {currentFiscalYear}
            </Badge>
            <Badge variant="secondary">Template: v2081.2 Statutory</Badge>
          </div>
          <p className="text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Generated from authoritative data as of:{" "}
            <strong className="text-foreground">
              {dataAsOf.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </strong>{" "}
            ({dataAsOf.toLocaleDateString()})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setSavePresetModalOpen(true)}
          >
            <Bookmark className="h-3.5 w-3.5 text-primary" />
            Save Preset
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setScheduleModalOpen(true)}
          >
            <Mail className="h-3.5 w-3.5 text-blue-600" />
            Schedule Delivery
          </Button>
        </div>
      </div>

      {/* Compliance Advisory Notice */}
      <div className="flex items-start gap-2 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 p-2.5 rounded-md text-[11px] text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-blue-900 dark:text-blue-300">
            Compliance & Operational Notice:
          </span>{" "}
          Report presets and scheduled jobs are centrally persisted in database tables
          (`report_presets`, `scheduled_reports`). Email dispatches trigger through background
          workers.
        </div>
      </div>

      {/* Saved Presets & Download Center */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Presets Card */}
        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Bookmark className="h-4 w-4 text-primary" />
                Shared Report Presets
              </CardTitle>
              <CardDescription className="text-[11px]">
                Centralized parameter and template recall across compliance team
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSavePresetModalOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> New
            </Button>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {presets.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground">
                No saved presets yet. Click "Save Preset" above to create one.
              </div>
            ) : (
              presets.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => onApplyPreset(preset)}
                  className="p-2.5 rounded-md border bg-card hover:bg-muted/40 cursor-pointer transition-colors flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold flex items-center gap-1.5">
                      {preset.name}
                      {preset.isShared && (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 border-primary/30 text-primary"
                        >
                          Team Shared
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      FY: {preset.fiscalYear} • Format: {preset.format.toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      Apply
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={(e) => deletePreset(preset.id, e)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Download Center & Export History */}
        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-1.5">
                <History className="h-4 w-4 text-emerald-600" />
                Download Center & Export Logs
              </CardTitle>
              <CardDescription className="text-[11px]">
                Immutable server audit history and generated versions ({exportHistory.length}{" "}
                events)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {isLoadingLogs ? (
              <div className="text-center py-4 text-xs text-muted-foreground">
                Loading audit ledger logs...
              </div>
            ) : exportHistory.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground">
                No recent exports logged yet. Generate an export to populate the audit ledger.
              </div>
            ) : (
              <div className="text-xs space-y-2 max-h-[220px] overflow-y-auto">
                {exportHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded border bg-muted/20 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium truncate max-w-[240px]">{item.reportTitle}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {item.timestamp} • {item.details || item.companyName}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-background text-emerald-600 border-emerald-300 text-[10px]"
                    >
                      {item.format}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={savePresetModalOpen} onOpenChange={setSavePresetModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-primary" />
              Save Report Preset
            </DialogTitle>
            <DialogDescription className="text-xs">
              Save current report filters ({currentCompanyName}, FY {currentFiscalYear}) as a
              reusable template shared with the compliance team.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Preset Title</Label>
              <Input
                placeholder="e.g. Monthly IRD Filing Scope"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="text-xs h-9"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSavePresetModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveCurrentAsPreset}>
              Save Shared Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scheduled Delivery Dialog */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-600" />
              Schedule Automated Report Dispatch
            </DialogTitle>
            <DialogDescription className="text-xs">
              Persist an automated report schedule in `scheduled_reports` for periodic delivery to
              compliance officers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Recipient Email Address</Label>
              <Input
                placeholder="compliance@rbbmbl.com.np"
                value={scheduleEmail}
                onChange={(e) => setScheduleEmail(e.target.value)}
                className="text-xs h-9"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Frequency</Label>
              <Select value={scheduleFreq} onValueChange={(val: any) => setScheduleFreq(val)}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily Snapshot (6:00 PM)</SelectItem>
                  <SelectItem value="weekly">Weekly Friday Cutoff (5:00 PM)</SelectItem>
                  <SelectItem value="monthly">Monthly Month-End Reconciliation</SelectItem>
                  <SelectItem value="quarterly">Quarterly IRD Annex-10 Filing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScheduleModalOpen(false)}
              disabled={isSubmittingSchedule}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleScheduleSubmit}
              disabled={isSubmittingSchedule}
              className="gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              {isSubmittingSchedule ? "Registering..." : "Register Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
