import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SettingsService, SystemSettings } from "@/lib/services/settings.service";
import {
  TAX_CATEGORY_LABEL,
  TAX_CLASSIFICATION_LABEL,
  invalidateTaxRuleCache,
  loadTaxRules,
  updateTaxRule,
} from "@/lib/services/tax-rules.service";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  Loader2,
  Lock,
  Save,
  Send,
  Database,
  HardDrive,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";

function TaxRulesEditor() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data: rules, isLoading } = useQuery({
    queryKey: ["tax-rules"],
    queryFn: () => loadTaxRules(true),
  });
  const [edits, setEdits] = useState<Record<string, { ratePct: string; is_active: boolean }>>({});

  const dirtyCount = Object.keys(edits).length;

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error("Unauthorized: Only administrators can update tax rules.");
      for (const [id, edit] of Object.entries(edits)) {
        await updateTaxRule(id, {
          tax_rate: Math.max(0, Math.min(100, Number(edit.ratePct) || 0)) / 100,
          is_active: edit.is_active,
        });
      }
    },
    onSuccess: () => {
      toast.success("Tax rules saved.");
      setEdits({});
      invalidateTaxRuleCache();
      qc.invalidateQueries({ queryKey: ["tax-rules"] });
      qc.invalidateQueries({ queryKey: ["system-settings"] });
    },
    onError: (err) => toast.error((err as Error)?.message ?? "Failed to save tax rules."),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading tax rules…</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax / TDS Rules (Centralized)</CardTitle>
        <CardDescription>
          Every payable resolves its rate automatically as:{" "}
          <strong>Payable Type + Investor Category = Tax Rate</strong>. Import and the database
          trigger both use these rules, so changing a rate here is the only place needed — no
          calculation logic changes. Rates are in % (e.g. 6 = 6% TDS).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payable Type</TableHead>
                <TableHead>Investor Category</TableHead>
                <TableHead className="text-right w-44">TDS Rate (%)</TableHead>
                <TableHead className="w-24">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules ?? []).map((rule) => {
                const edit = edits[rule.id] ?? {
                  ratePct: String(Math.round(Number(rule.tax_rate) * 10000) / 100),
                  is_active: rule.is_active,
                };
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">
                      {TAX_CATEGORY_LABEL[rule.payable_category] ?? rule.payable_category}
                    </TableCell>
                    <TableCell>
                      {TAX_CLASSIFICATION_LABEL[rule.payee_classification] ??
                        rule.payee_classification}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        className="ml-auto w-24 h-8 text-right"
                        value={edit.ratePct}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [rule.id]: { ...edit, ratePct: e.target.value },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={edit.is_active}
                        onCheckedChange={(v) =>
                          setEdits((prev) => ({ ...prev, [rule.id]: { ...edit, is_active: v } }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          <p className="text-xs text-muted-foreground">
            {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
          </p>
          <Button onClick={() => save()} disabled={isPending || dirtyCount === 0}>
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Tax Rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const qc = useQueryClient();
  const { isAdmin, loading: authLoading } = useAuth();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["system-settings"],
    queryFn: () => SettingsService.getSettings(),
    enabled: !!isAdmin,
  });

  const [form, setForm] = useState<Partial<SystemSettings>>({});
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);

  const merged: SystemSettings = { ...(settings || ({} as SystemSettings)), ...form };

  const update = (key: keyof SystemSettings, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const { mutate: saveSettings, isPending } = useMutation({
    mutationFn: () => {
      if (!isAdmin)
        throw new Error("Unauthorized: Only administrators can modify system settings.");
      const payload: SystemSettings = { ...(settings || ({} as SystemSettings)), ...form };
      // Omit masked placeholder values so the backend preserves existing stored credentials
      if (!form.connectips_token || form.connectips_token === "••••••••••••") {
        delete (payload as any).connectips_token;
      }
      if (!form.connectips_cert_pass || form.connectips_cert_pass === "••••••••••••") {
        delete (payload as any).connectips_cert_pass;
      }
      if (!form.smtp_pass || form.smtp_pass === "••••••••••••") {
        delete (payload as any).smtp_pass;
      }
      if (!form.sms_api_key || form.sms_api_key === "••••••••••••") {
        delete (payload as any).sms_api_key;
      }
      return SettingsService.saveSettings(payload);
    },
    onSuccess: () => {
      toast.success("Settings saved successfully.");
      setForm({});
      qc.invalidateQueries({ queryKey: ["system-settings"] });
    },
    onError: () => toast.error("Failed to save settings."),
  });

  const { mutate: sendTest, isPending: sendingTest } = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error("Unauthorized: Only administrators can test email settings.");
      return SettingsService.sendTestEmail(testEmail.trim(), merged);
    },
    onSuccess: (res) => toast.success(res?.message || "Test email sent successfully."),
    onError: (err) => toast.error(`Failed to send test email: ${(err as Error).message}`),
  });

  const { mutate: sendSms, isPending: sendingSms } = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error("Unauthorized: Only administrators can test SMS settings.");
      return SettingsService.sendTestSms(testPhone.trim(), merged);
    },
    onSuccess: (res) => toast.success(res?.message || "Test SMS sent successfully."),
    onError: (err) => toast.error(`Failed to send test SMS: ${(err as Error).message}`),
  });

  if (!authLoading && !isAdmin) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-14 w-14 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Administrator Access Required</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
          System settings, payment gateway credentials, and global tax configuration require the{" "}
          <span className="font-semibold text-foreground">admin</span> role.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    );
  }

  if (isLoading || authLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading settings...</div>;

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="System Settings"
          description="Configure global application preferences, taxes, and workflows."
        />
        <Button onClick={() => saveSettings()} disabled={isPending} className="hover-lift">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save All Changes
        </Button>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Calendar Mode</p>
            <p className="text-xl font-bold mt-1 text-primary">
              {merged.enable_nepali_dates ? "B.S. (Bikram Sambat)" : "A.D. (Gregorian)"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Date display system</p>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Equity Dividend TDS
            </p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {merged.dividend_tds_natural ?? 5}% / {merged.dividend_tds_legal ?? 5}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Public (5%) / Institution (5%)
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Debenture Interest TDS
            </p>
            <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {merged.interest_tds_natural ?? 6}% / {merged.interest_tds_legal ?? 15}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Public (6%) / Institution (15%)
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Tax Rules Engine</p>
            <p className="text-xl font-bold text-violet-600 dark:text-violet-400 mt-1">Active</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Authoritative Nepal TDS Rules
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-6 max-w-[960px]">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tax-rules">Tax Rules (TDS)</TabsTrigger>
          <TabsTrigger value="banking-gateway">Banking (ConnectIPS)</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="sms">SMS</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Regional Formatting & Calendar</CardTitle>
              <CardDescription>
                Configure how dates, calendars, and numbers are displayed across the system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Nepali Dates (BS Calendar)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Display dates in Bikram Sambat (B.S.) across reports and summaries
                  </p>
                </div>
                <Switch
                  checked={merged.enable_nepali_dates}
                  onCheckedChange={(v) => update("enable_nepali_dates", v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6 border-primary/20 bg-muted/20">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    Database Backup & Disaster Recovery
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Export immediate Excel/JSON snapshots or manage automated compressed physical
                    backups on the host D: drive.
                  </CardDescription>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant="default"
                  className="gap-1.5 self-start sm:self-auto text-xs"
                >
                  <Link to="/backup">
                    <HardDrive className="h-3.5 w-3.5 mr-1" />
                    Open Backup Center
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
          </Card>
        </TabsContent>

        <TabsContent value="tax-rules" className="mt-6">
          <TaxRulesEditor />
        </TabsContent>

        <TabsContent value="banking-gateway" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>NCHL ConnectIPS Direct Banking Gateway</CardTitle>
                  <CardDescription>
                    Configure credentials provided by Nepal Clearing House Ltd. (NCHL) for direct
                    one-click batch disbursements.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Gateway Active:</span>
                  <Switch
                    checked={merged.connectips_enabled}
                    onCheckedChange={(v) => update("connectips_enabled", v)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 max-w-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Gateway Environment</Label>
                  <select
                    value={merged.connectips_mode || "SANDBOX"}
                    onChange={(e) => {
                      const mode = e.target.value as "SANDBOX" | "PRODUCTION";
                      update("connectips_mode", mode);
                      if (mode === "PRODUCTION" && merged.connectips_base_url.includes("uat")) {
                        update("connectips_base_url", "https://login.connectips.com:7443");
                      } else if (mode === "SANDBOX") {
                        update("connectips_base_url", "https://uat.connectips.com:7443");
                      }
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    <option value="SANDBOX">Sandbox / UAT (Testing)</option>
                    <option value="PRODUCTION">Production (Live Banking)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Gateway Base URL</Label>
                  <Input
                    placeholder="https://uat.connectips.com:7443"
                    value={merged.connectips_base_url || ""}
                    onChange={(e) => update("connectips_base_url", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Merchant ID</Label>
                  <Input
                    placeholder="e.g., M101 / NECO_MERCHANT"
                    value={merged.connectips_merchant_id || ""}
                    onChange={(e) => update("connectips_merchant_id", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>App ID</Label>
                  <Input
                    placeholder="e.g., APP_RTARTS"
                    value={merged.connectips_app_id || ""}
                    onChange={(e) => update("connectips_app_id", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>App Name / Initiator ID</Label>
                  <Input
                    placeholder="RTARTS System"
                    value={merged.connectips_app_name || ""}
                    onChange={(e) => update("connectips_app_name", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Bearer Token / Secret Key</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      settings?.connectips_token
                        ? "•••••••••••• (Configured — enter new to change)"
                        : "Enter Secret Key / Bearer Token"
                    }
                    value={
                      form.connectips_token ?? (settings?.connectips_token ? "••••••••••••" : "")
                    }
                    onChange={(e) => update("connectips_token", e.target.value)}
                    onFocus={(e) => {
                      if (form.connectips_token === undefined && settings?.connectips_token) {
                        update("connectips_token", "");
                      }
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Certificate Password / Private Key Passphrase</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    settings?.connectips_cert_pass
                      ? "•••••••••••• (Configured — enter new to change)"
                      : "Enter Certificate Password"
                  }
                  value={
                    form.connectips_cert_pass ??
                    (settings?.connectips_cert_pass ? "••••••••••••" : "")
                  }
                  onChange={(e) => update("connectips_cert_pass", e.target.value)}
                  onFocus={(e) => {
                    if (form.connectips_cert_pass === undefined && settings?.connectips_cert_pass) {
                      update("connectips_cert_pass", "");
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Used on the backend server for cryptographic SHA-256 RSA signing of disbursement
                  payloads.
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3.5 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">
                  💡 How to activate direct disbursement:
                </p>
                <p>
                  1. When your bank/NCHL provides you with your Merchant ID, App ID, and Token,
                  paste them into these fields.
                </p>
                <p>
                  2. Click <strong>Test Connection Handshake</strong> to verify credential
                  authentication.
                </p>
                <p>
                  3. Once verified, you can click{" "}
                  <strong>"Disburse via Direct ConnectIPS API"</strong> inside any Approved payment
                  batch.
                </p>
              </div>

              <div className="pt-2 border-t flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const res = await (
                      await import("@/lib/services/connectips.service")
                    ).ConnectIPSService.testConnection(merged);
                    if (res.success) {
                      toast.success(res.message);
                    } else {
                      toast.error(res.message);
                    }
                  }}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Test Connection Handshake
                </Button>
                <Button onClick={() => saveSettings()} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Gateway Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Approval Workflow Levels</CardTitle>
              <CardDescription>
                Configure how many approval stages are required before actions are committed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Require Maker-Checker (2-Level)</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    A checker must review before approving.
                  </p>
                </div>
                <Switch
                  checked={merged.require_maker_checker}
                  onCheckedChange={(v) => update("require_maker_checker", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Require Final Approver (3-Level)</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    An additional approver is required after checker.
                  </p>
                </div>
                <Switch
                  checked={merged.require_final_approver}
                  onCheckedChange={(v) => update("require_final_approver", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Configuration</CardTitle>
              <CardDescription>
                Configure outgoing SMTP email settings for system notifications, shareholder
                statements, and reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SMTP Host</Label>
                  <Input
                    placeholder="smtp.example.com"
                    value={merged.smtp_host || ""}
                    onChange={(e) => update("smtp_host", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>SMTP Port</Label>
                  <Input
                    type="number"
                    value={merged.smtp_port || 587}
                    onChange={(e) => update("smtp_port", parseInt(e.target.value) || 587)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>SMTP Username</Label>
                <Input
                  placeholder="user@example.com"
                  value={merged.smtp_user || ""}
                  onChange={(e) => update("smtp_user", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>From Email Address</Label>
                <Input
                  placeholder="noreply@company.com"
                  value={merged.smtp_from || ""}
                  onChange={(e) => update("smtp_from", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>SMTP Password / App Password</Label>
                  {settings?.smtp_pass_configured && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="h-3 w-3" /> Saved &amp; Active
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showSmtpPass ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={
                      settings?.smtp_pass_configured ? "••••••••••••" : "Enter SMTP password"
                    }
                    value={form.smtp_pass ?? (settings?.smtp_pass_configured ? "••••••••••••" : "")}
                    onChange={(e) => update("smtp_pass", e.target.value)}
                    onFocus={() => {
                      if (form.smtp_pass === undefined && settings?.smtp_pass_configured) {
                        update("smtp_pass", "");
                      }
                    }}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSmtpPass(!showSmtpPass)}
                    tabIndex={-1}
                  >
                    {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings?.smtp_pass_configured
                    ? "Password is saved and active in the database. Click into the box if you want to change it."
                    : "Stored securely and never displayed in plaintext."}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="button"
                  onClick={() => saveSettings()}
                  disabled={isPending}
                  className="hover-lift"
                >
                  {isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Email Settings
                </Button>
              </div>

              <div className="pt-4 mt-2 border-t space-y-3">
                <div className="space-y-1">
                  <Label>Send Test Email</Label>
                  <p className="text-xs text-muted-foreground">
                    Verify outgoing email connection and delivery before saving or with current
                    settings.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="recipient@example.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => sendTest()}
                    disabled={!testEmail.trim() || sendingTest}
                  >
                    {sendingTest ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Test Email
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sms" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>SMS Gateway Configuration</CardTitle>
                  <CardDescription>
                    Configure outgoing SMS gateway credentials (Sparrow SMS, Aakash SMS, SMS To
                    Nepal, or Custom Webhook) for dispatching shareholder payment alerts and AGM
                    notices.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Gateway Active:</span>
                  <Switch
                    checked={Boolean(merged.sms_enabled)}
                    onCheckedChange={(v) => update("sms_enabled", v)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 max-w-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SMS Provider</Label>
                  <select
                    value={merged.sms_provider || "sparrow"}
                    onChange={(e) => {
                      const provider = e.target.value as
                        "sparrow" | "aakash" | "smstonepal" | "custom";
                      update("sms_provider", provider);
                      if (provider === "sparrow") {
                        update("sms_gateway_url", "https://api.sparrowsms.com/v2/sms/");
                      } else if (provider === "aakash") {
                        update("sms_gateway_url", "https://sms.aakashsms.com/v3/sms/");
                      } else if (provider === "smstonepal") {
                        update("sms_gateway_url", "https://smstonepal.com/api/v1/sms/");
                      }
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    <option value="sparrow">Sparrow SMS (api.sparrowsms.com)</option>
                    <option value="aakash">Aakash SMS (sms.aakashsms.com)</option>
                    <option value="smstonepal">SMS To Nepal (smstonepal.com)</option>
                    <option value="custom">Custom HTTP Webhook / Gateway</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Approved Sender ID</Label>
                  <Input
                    placeholder="e.g., RBBMBL or SpwSMS"
                    value={merged.sms_sender_id || ""}
                    onChange={(e) => update("sms_sender_id", e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Sender identity registered with Nepal telecom operators (NTC/Ncell).
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Gateway Endpoint URL</Label>
                <Input
                  placeholder="https://api.sparrowsms.com/v2/sms/"
                  value={merged.sms_gateway_url || ""}
                  onChange={(e) => update("sms_gateway_url", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>API Key / Authentication Token</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    settings?.sms_api_key_configured
                      ? "•••••••••••• (Configured — enter new to change)"
                      : "Enter SMS gateway API key or token"
                  }
                  value={form.sms_api_key ?? ""}
                  onChange={(e) => update("sms_api_key", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {settings?.sms_api_key_configured
                    ? "API key is configured and stored securely. Leave blank to keep existing key."
                    : "Stored securely in system settings. Never displayed in plaintext."}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="button"
                  onClick={() => saveSettings()}
                  disabled={isPending}
                  className="hover-lift"
                >
                  {isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save SMS Settings
                </Button>
              </div>

              <div className="pt-4 mt-2 border-t space-y-3">
                <div className="space-y-1">
                  <Label>Send Test SMS</Label>
                  <p className="text-xs text-muted-foreground">
                    Verify outgoing SMS delivery to a 10-digit Nepali mobile number (98XXXXXXXX /
                    97XXXXXXXX).
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="tel"
                    placeholder="98XXXXXXXX"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="max-w-xs"
                    maxLength={10}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => sendSms()}
                    disabled={!testPhone.trim() || sendingSms}
                  >
                    {sendingSms ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Test SMS
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
