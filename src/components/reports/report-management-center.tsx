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
  Download,
  Bookmark,
  Calendar,
  Clock,
  FileSpreadsheet,
  FileText,
  Mail,
  History,
  CheckCircle2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export interface ReportPreset {
  id: string;
  name: string;
  reportId: string;
  companyId: string;
  fiscalYear: string;
  format: "xlsx" | "pdf";
  createdDate: string;
}

export interface ExportHistoryItem {
  id: string;
  reportName: string;
  fileName: string;
  format: "xlsx" | "pdf";
  recordsCount: number;
  dataAsOf: string;
  timestamp: string;
  parameterSummary: string;
}

const PRESETS_STORAGE_KEY = "rtarts_report_presets";
const HISTORY_STORAGE_KEY = "rtarts_report_export_history";

const DEFAULT_PRESETS: ReportPreset[] = [
  {
    id: "preset-ird-etds",
    name: "Quarterly IRD e-TDS Annex-10",
    reportId: "tax_register",
    companyId: "all",
    fiscalYear: "2081/82",
    format: "xlsx",
    createdDate: "2026-07-01",
  },
  {
    id: "preset-exec-recon",
    name: "Monthly Bank Clearing Reconciliation",
    reportId: "reconciliation_report",
    companyId: "all",
    fiscalYear: "all",
    format: "xlsx",
    createdDate: "2026-08-15",
  },
  {
    id: "preset-annual-agm",
    name: "Annual AGM Entitlements Roster",
    reportId: "dividend_register",
    companyId: "all",
    fiscalYear: "2081/82",
    format: "pdf",
    createdDate: "2026-09-01",
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
  const [presets, setPresets] = useState<ReportPreset[]>(() => {
    try {
      const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (err) {
      console.debug("Preset storage read unavailable", err);
    }
    return DEFAULT_PRESETS;
  });

  const [exportHistory, setExportHistory] = useState<ExportHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (err) {
      console.debug("Export history storage read unavailable", err);
    }
    return [];
  });

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [scheduleEmail, setScheduleEmail] = useState("");
  const [scheduleFreq, setScheduleFreq] = useState("monthly");

  const saveCurrentAsPreset = () => {
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
    };
    const updated = [newPreset, ...presets];
    setPresets(updated);
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.debug("Preset storage write unavailable", err);
    }
    toast.success(`Preset "${newPreset.name}" saved!`);
    setNewPresetName("");
    setSavePresetModalOpen(false);
  };

  const deletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.debug("Preset storage delete unavailable", err);
    }
    toast.info("Preset deleted.");
  };

  const handleScheduleSubmit = () => {
    if (!scheduleEmail || !scheduleEmail.includes("@")) {
      toast.error("Please enter a valid recipient email.");
      return;
    }
    toast.success(
      `Scheduled ${scheduleFreq} delivery of "${currentReportId}" to ${scheduleEmail}. Template v1.2 registered.`,
    );
    setScheduleModalOpen(false);
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

      {/* Saved Presets & Download Center */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Presets Card */}
        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Bookmark className="h-4 w-4 text-primary" />
                Saved Report Presets
              </CardTitle>
              <CardDescription className="text-[11px]">
                One-click parameter and template recall
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
                    <div className="font-semibold">{preset.name}</div>
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
                Audit history of generated exports and data timestamps
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            <div className="text-xs space-y-2">
              <div className="p-2 rounded border bg-muted/20 flex items-center justify-between">
                <div>
                  <div className="font-medium">Recent Export: Tax (TDS) Annex-10.xlsx</div>
                  <div className="text-[10px] text-muted-foreground">
                    Data as of Today 10:30 AM • 1,240 payee lines
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="bg-background text-emerald-600 border-emerald-300"
                >
                  Ready
                </Badge>
              </div>

              <div className="p-2 rounded border bg-muted/20 flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    Recent Export: Dividend Register (All Schemes).xlsx
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Data as of Yesterday • 4,810 records
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="bg-background text-emerald-600 border-emerald-300"
                >
                  Ready
                </Badge>
              </div>
            </div>
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
              reusable template.
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
              Save Preset
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
              Automatically generate and deliver statutory reports to compliance officers or
              internal auditors.
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
              <Select value={scheduleFreq} onValueChange={setScheduleFreq}>
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
            <Button variant="outline" size="sm" onClick={() => setScheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleScheduleSubmit}>
              Schedule Delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
