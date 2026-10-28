import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Users,
  Eye,
  Settings2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  ShareholderNoticeService,
  type NoticeMissingType,
  type ShareholderNoticeClient,
} from "@/lib/services/shareholder-notice.service";
import {
  sendShareholderNoticeServerFn,
  sendShareholderBatchNoticesServerFn,
  type SendBatchNoticesResult,
} from "@/lib/shareholder-notice.functions";

export interface ShareholderNoticeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog runs in Single Shareholder Mode */
  client?: ShareholderNoticeClient | null;
  /** Pre-selected company for batch mode */
  defaultCompanyId?: string;
  onNoticeSent?: () => void;
}

export function ShareholderNoticeDialog({
  open,
  onOpenChange,
  client,
  defaultCompanyId,
  onNoticeSent,
}: ShareholderNoticeDialogProps) {
  const isSingle = Boolean(client);

  // Single mode state
  const [singleSubject, setSingleSubject] = useState("");
  const [singleCustomNote, setSingleCustomNote] = useState("");
  const [isSendingSingle, setIsSendingSingle] = useState(false);

  // Batch mode state
  const [selectedCompany, setSelectedCompany] = useState<string>(defaultCompanyId || "all");
  const [targetIssue, setTargetIssue] = useState<
    "ALL" | "MISSING_BANK" | "MISSING_PAN" | "MISSING_BOTH"
  >("ALL");
  const [batchSubject, setBatchSubject] = useState("");
  const [batchCustomNote, setBatchCustomNote] = useState("");
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [batchResult, setBatchResult] = useState<SendBatchNoticesResult | null>(null);

  const [activeTab, setActiveTab] = useState<"compose" | "preview">("compose");

  // Fetch companies for batch filter
  const { data: companies = [] } = useQuery({
    queryKey: ["notice-companies"],
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .order("company_name");
      return data || [];
    },
    enabled: open && !isSingle,
  });

  // Calculate single client missing type
  const singleMissingType: NoticeMissingType = useMemo(() => {
    if (!client) return "MISSING_BOTH";
    return ShareholderNoticeService.getMissingType(client) || "MISSING_BOTH";
  }, [client]);

  // Pre-populate default subject when single client changes
  useEffect(() => {
    if (client) {
      const compName = client.company_name || "RBB Merchant Banking";
      setSingleSubject(ShareholderNoticeService.generateSubject(compName, singleMissingType));
      setSingleCustomNote("");
      setActiveTab("compose");
    }
  }, [client, singleMissingType]);

  // Batch candidates estimation query
  const { data: batchCandidates = [], isLoading: isLoadingCandidates } = useQuery({
    queryKey: ["notice-batch-candidates", selectedCompany, targetIssue],
    queryFn: async () => {
      let q = (supabase as any)
        .from("clients")
        .select(
          "id, full_name, boid, email, bank_account_no, pan_no, pan_or_citizenship, company:companies(company_name, company_code)",
        )
        .not("email", "is", null)
        .neq("email", "");

      if (selectedCompany && selectedCompany !== "all") {
        q = q.eq("company_id", selectedCompany);
      }

      const { data } = await q.limit(500);

      const filtered: Array<{
        id: string;
        name: string;
        boid: string;
        email: string;
        missingType: NoticeMissingType;
      }> = [];

      for (const c of data || []) {
        const email = (c.email || "").trim();
        if (!ShareholderNoticeService.hasValidEmail(email)) continue;

        const mType = ShareholderNoticeService.getMissingType({
          bank_account_no: c.bank_account_no,
          pan_no: c.pan_no,
          pan_or_citizenship: c.pan_or_citizenship,
        });

        if (!mType) continue;

        if (targetIssue === "ALL") {
          filtered.push({
            id: c.id,
            name: c.full_name || "Shareholder",
            boid: c.boid || "—",
            email,
            missingType: mType,
          });
        } else if (
          targetIssue === "MISSING_BANK" &&
          (mType === "MISSING_BANK" || mType === "MISSING_BOTH")
        ) {
          filtered.push({
            id: c.id,
            name: c.full_name || "Shareholder",
            boid: c.boid || "—",
            email,
            missingType: mType,
          });
        } else if (
          targetIssue === "MISSING_PAN" &&
          (mType === "MISSING_PAN" || mType === "MISSING_BOTH")
        ) {
          filtered.push({
            id: c.id,
            name: c.full_name || "Shareholder",
            boid: c.boid || "—",
            email,
            missingType: mType,
          });
        } else if (targetIssue === "MISSING_BOTH" && mType === "MISSING_BOTH") {
          filtered.push({
            id: c.id,
            name: c.full_name || "Shareholder",
            boid: c.boid || "—",
            email,
            missingType: mType,
          });
        }
      }

      return filtered;
    },
    enabled: open && !isSingle,
  });

  // Selected company object
  const companyObj = useMemo(() => {
    if (isSingle) return null;
    return companies.find((c) => c.id === selectedCompany) || null;
  }, [isSingle, companies, selectedCompany]);

  // Live preview HTML calculation
  const previewHtml = useMemo(() => {
    if (isSingle && client) {
      return ShareholderNoticeService.renderNoticeHtml({
        shareholderName: client.full_name || "Shareholder",
        boid: client.boid || "1301XXXXXXXXXXXX",
        email: client.email || "shareholder@example.com",
        companyName: client.company_name || "RBB Merchant Banking Limited",
        missingType: singleMissingType,
        customMessage: singleCustomNote.trim() || undefined,
      });
    }

    const sample = batchCandidates[0];
    const previewType: NoticeMissingType =
      targetIssue === "MISSING_BANK"
        ? "MISSING_BANK"
        : targetIssue === "MISSING_PAN"
          ? "MISSING_PAN"
          : "MISSING_BOTH";

    return ShareholderNoticeService.renderNoticeHtml({
      shareholderName: sample ? sample.name : "Sample Shareholder",
      boid: sample ? sample.boid : "1301090001191473",
      email: sample ? sample.email : "shareholder@example.com",
      companyName: companyObj?.company_name || "Consolidated Portfolio",
      missingType: previewType,
      customMessage: batchCustomNote.trim() || undefined,
    });
  }, [
    isSingle,
    client,
    singleMissingType,
    singleCustomNote,
    batchCandidates,
    targetIssue,
    companyObj,
    batchCustomNote,
  ]);

  // Handle single send
  const handleSendSingle = async () => {
    if (!client?.id) return;
    try {
      setIsSendingSingle(true);
      const res = await sendShareholderNoticeServerFn({
        data: {
          clientId: client.id,
          customSubject: singleSubject.trim() || undefined,
          customMessage: singleCustomNote.trim() || undefined,
          missingTypeOverride: singleMissingType,
        },
      });

      toast.success(res.message);
      onNoticeSent?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to send notice email.");
    } finally {
      setIsSendingSingle(false);
    }
  };

  // Handle batch send
  const handleSendBatch = async () => {
    if (batchCandidates.length === 0) {
      toast.error("No eligible shareholders with registered email found for this criteria.");
      return;
    }

    try {
      setIsSendingBatch(true);
      setBatchResult(null);

      const res = await sendShareholderBatchNoticesServerFn({
        data: {
          companyId: selectedCompany === "all" ? null : selectedCompany,
          targetIssue,
          limit: 100,
          customSubject: batchSubject.trim() || undefined,
          customMessage: batchCustomNote.trim() || undefined,
        },
      });

      setBatchResult(res);
      if (res.sentCount > 0) {
        toast.success(
          `Batch campaign finished: ${res.sentCount} notices sent successfully (${res.failedCount} failed).`,
        );
        onNoticeSent?.();
      } else {
        toast.error(`Batch campaign failed: 0 sent, ${res.failedCount} failed.`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to execute batch email campaign.");
    } finally {
      setIsSendingBatch(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-5 pb-3 border-b bg-muted/20">
          <div className="flex items-center gap-2 text-primary">
            <Mail className="h-5 w-5" />
            <DialogTitle className="text-base font-bold">
              {isSingle
                ? "Send Shareholder Detail Update Notice (KYC & Bank)"
                : "Shareholder Compliance Email Campaign (Missing Details)"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {isSingle
              ? `Send an official RTA notification to ${client?.full_name} requesting missing bank details or PAN number.`
              : "Dispatch official compliance notices to shareholders with missing bank accounts or PAN numbers who have registered email addresses."}
          </DialogDescription>
        </DialogHeader>

        {/* Tabs for Compose vs Live Preview */}
        <div className="flex-1 overflow-y-auto p-5">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as any)}
            className="w-full space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <TabsList className="h-8">
                <TabsTrigger value="compose" className="text-xs gap-1.5 py-1">
                  <Settings2 className="h-3.5 w-3.5" /> Compose & Criteria
                </TabsTrigger>
                <TabsTrigger value="preview" className="text-xs gap-1.5 py-1">
                  <Eye className="h-3.5 w-3.5" /> Live HTML Preview
                </TabsTrigger>
              </TabsList>

              {isSingle && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono">
                    {client?.boid || "No BOID"}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  >
                    {singleMissingType === "MISSING_BANK"
                      ? "Missing Bank Account"
                      : singleMissingType === "MISSING_PAN"
                        ? "Missing PAN"
                        : "Missing Bank & PAN"}
                  </Badge>
                </div>
              )}
            </div>

            {/* TAB: COMPOSE */}
            <TabsContent value="compose" className="space-y-4 m-0">
              {isSingle ? (
                /* SINGLE SHAREHOLDER COMPOSE */
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-muted/30 border rounded-lg text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">
                        Recipient Name:
                      </span>
                      <strong className="text-foreground">{client?.full_name}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">
                        Registered Email:
                      </span>
                      <span className="font-mono font-semibold text-primary">
                        {client?.email || "No Email"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">
                        Company / Scheme:
                      </span>
                      <span>{client?.company_name || "General Portfolio"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Phone:</span>
                      <span>{client?.phone || "—"}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Email Subject Line</Label>
                    <Input
                      value={singleSubject}
                      onChange={(e) => setSingleSubject(e.target.value)}
                      placeholder="Enter subject line..."
                      className="text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Custom Note from RTS Department (Optional)
                    </Label>
                    <Textarea
                      value={singleCustomNote}
                      onChange={(e) => setSingleCustomNote(e.target.value)}
                      placeholder="e.g. Please update before the upcoming dividend book closure on 15 Kartik 2083..."
                      rows={3}
                      className="text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      This custom note will be highlighted in green inside the official email.
                    </p>
                  </div>
                </div>
              ) : (
                /* BATCH CAMPAIGN COMPOSE */
                <div className="space-y-4">
                  {/* Campaign Scope Card */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Target Entity / Company</Label>
                      <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue placeholder="All Companies" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Companies / Schemes</SelectItem>
                          {companies.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.company_code} — {c.company_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Missing Detail Criteria</Label>
                      <Select value={targetIssue} onValueChange={(v) => setTargetIssue(v as any)}>
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Missing Compliance Items</SelectItem>
                          <SelectItem value="MISSING_BANK">Missing Bank Account Only</SelectItem>
                          <SelectItem value="MISSING_PAN">Missing PAN Number Only</SelectItem>
                          <SelectItem value="MISSING_BOTH">Missing Both Bank & PAN</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Cohort Estimation Card */}
                  <div className="p-3.5 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Users className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">
                          {isLoadingCandidates
                            ? "Analyzing registry cohort..."
                            : `${batchCandidates.length.toLocaleString()} Shareholders with Registered Email`}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Eligible to receive this KYC update notice (Max 100 per campaign batch)
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      Batch Limit: 100
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Custom Operational Note (Optional)
                    </Label>
                    <Textarea
                      value={batchCustomNote}
                      onChange={(e) => setBatchCustomNote(e.target.value)}
                      placeholder="e.g. In order to receive cash dividend distribution on time, please submit your bank details..."
                      rows={2}
                      className="text-xs"
                    />
                  </div>

                  {/* Batch Execution Results if finished */}
                  {batchResult && (
                    <div className="p-3 bg-muted/40 border rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold">Campaign Delivery Summary:</span>
                        <div className="flex gap-2">
                          <span className="text-emerald-600 font-semibold">
                            ✓ {batchResult.sentCount} Sent
                          </span>
                          {batchResult.failedCount > 0 && (
                            <span className="text-rose-600 font-semibold">
                              ✕ {batchResult.failedCount} Failed
                            </span>
                          )}
                        </div>
                      </div>

                      {batchResult.summary.length > 0 && (
                        <div className="max-h-36 overflow-y-auto space-y-1 text-[11px]">
                          {batchResult.summary.slice(0, 15).map((s, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between py-1 border-b last:border-b-0"
                            >
                              <span className="truncate max-w-[200px]">
                                {s.name} ({s.email})
                              </span>
                              <Badge
                                variant={s.status === "SENT" ? "outline" : "destructive"}
                                className={`text-[10px] py-0 ${s.status === "SENT" ? "text-emerald-600 border-emerald-300" : ""}`}
                              >
                                {s.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* TAB: PREVIEW */}
            <TabsContent value="preview" className="m-0 space-y-2">
              <div className="p-2 bg-muted/30 border rounded text-xs flex items-center justify-between">
                <span className="text-muted-foreground font-medium">
                  Subject:{" "}
                  <strong className="text-foreground">
                    {isSingle
                      ? singleSubject ||
                        ShareholderNoticeService.generateSubject(
                          client?.company_name || "",
                          singleMissingType,
                        )
                      : ShareholderNoticeService.generateSubject(
                          companyObj?.company_name || "",
                          "MISSING_BOTH",
                        )}
                  </strong>
                </span>
                <span className="text-[10px] text-muted-foreground">HTML Email Preview</span>
              </div>

              <div className="border rounded-lg overflow-hidden bg-white shadow-sm max-h-[380px] overflow-y-auto">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 border-t bg-muted/10 flex items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSendingSingle || isSendingBatch}
            className="text-xs cursor-pointer"
          >
            Cancel
          </Button>

          {isSingle ? (
            <Button
              size="sm"
              onClick={handleSendSingle}
              disabled={isSendingSingle || !client?.email}
              className="text-xs gap-1.5 cursor-pointer bg-primary hover:bg-primary/90"
            >
              {isSendingSingle ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isSendingSingle ? "Dispatching..." : "Send Notice Email"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSendBatch}
              disabled={isSendingBatch || isLoadingCandidates || batchCandidates.length === 0}
              className="text-xs gap-1.5 cursor-pointer bg-primary hover:bg-primary/90"
            >
              {isSendingBatch ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isSendingBatch
                ? "Processing Campaign..."
                : `Send Batch Notices (${batchCandidates.length.toLocaleString()})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
