import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { SettingsService, SystemSettings } from '@/lib/services/settings.service';
import {
  TAX_CATEGORY_LABEL,
  TAX_CLASSIFICATION_LABEL,
  invalidateTaxRuleCache,
  loadTaxRules,
  updateTaxRule,
} from '@/lib/services/tax-rules.service';
import { toast } from 'sonner';
import { Loader2, Save, Send } from 'lucide-react';

function TaxRulesEditor() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({
    queryKey: ["tax-rules"],
    queryFn: () => loadTaxRules(true),
  });
  const [edits, setEdits] = useState<Record<string, { ratePct: string; is_active: boolean }>>({});

  const dirtyCount = Object.keys(edits).length;

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
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
          Every payable resolves its rate automatically as: <strong>Payable Type + Investor Category = Tax
          Rate</strong>. Import and the database trigger both use these rules, so changing a rate here is the
          only place needed — no calculation logic changes. Rates are in % (e.g. 6 = 6% TDS).
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
                      {TAX_CLASSIFICATION_LABEL[rule.payee_classification] ?? rule.payee_classification}
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
                          setEdits((prev) => ({ ...prev, [rule.id]: { ...edit, ratePct: e.target.value } }))
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
            {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Tax Rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsRoute,
});

function SettingsRoute() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => SettingsService.getSettings(),
  });

  const [form, setForm] = useState<Partial<SystemSettings>>({});
  const [testEmail, setTestEmail] = useState('');

  const merged: SystemSettings = { ...(settings || {} as SystemSettings), ...form };

  const update = (key: keyof SystemSettings, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const { mutate: saveSettings, isPending } = useMutation({
    mutationFn: () => SettingsService.saveSettings(merged),
    onSuccess: () => {
      toast.success('Settings saved successfully.');
      setForm({});
      qc.invalidateQueries({ queryKey: ['system-settings'] });
    },
    onError: () => toast.error('Failed to save settings.'),
  });

  const { mutate: sendTest, isPending: sendingTest } = useMutation({
    mutationFn: () => SettingsService.sendTestEmail(testEmail.trim()),
    onSuccess: () => toast.success('Test email sent successfully.'),
    onError: (err) => toast.error(`Failed to send test email: ${(err as Error).message}`),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading settings...</div>;

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="System Settings"
          description="Configure global application preferences, taxes, and workflows."
        />
        <Button onClick={() => saveSettings()} disabled={isPending} className="hover-lift">
          {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
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
            <p className="text-xs font-medium uppercase text-muted-foreground">Equity Dividend TDS</p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {merged.dividend_tds_natural ?? 5}% / {merged.dividend_tds_legal ?? 5}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Public (5%) / Institution (5%)</p>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Debenture Interest TDS</p>
            <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {merged.interest_tds_natural ?? 6}% / {merged.interest_tds_legal ?? 15}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Public (6%) / Institution (15%)</p>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Tax Rules Engine</p>
            <p className="text-xl font-bold text-violet-600 dark:text-violet-400 mt-1">Active</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Authoritative Nepal TDS Rules</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-5 max-w-[820px]">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tax-rules">Tax Rules (TDS)</TabsTrigger>
          <TabsTrigger value="banking-gateway">Banking (ConnectIPS)</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Regional Formatting & Calendar</CardTitle>
              <CardDescription>Configure how dates, calendars, and numbers are displayed across the system.</CardDescription>
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
                  onCheckedChange={v => update('enable_nepali_dates', v)}
                />
              </div>
            </CardContent>
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
                    Configure credentials provided by Nepal Clearing House Ltd. (NCHL) for direct one-click batch disbursements.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Gateway Active:</span>
                  <Switch
                    checked={merged.connectips_enabled}
                    onCheckedChange={v => update('connectips_enabled', v)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 max-w-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Gateway Environment</Label>
                  <select
                    value={merged.connectips_mode || 'SANDBOX'}
                    onChange={e => {
                      const mode = e.target.value as 'SANDBOX' | 'PRODUCTION';
                      update('connectips_mode', mode);
                      if (mode === 'PRODUCTION' && merged.connectips_base_url.includes('uat')) {
                        update('connectips_base_url', 'https://login.connectips.com:7443');
                      } else if (mode === 'SANDBOX') {
                        update('connectips_base_url', 'https://uat.connectips.com:7443');
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
                    value={merged.connectips_base_url || ''}
                    onChange={e => update('connectips_base_url', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Merchant ID</Label>
                  <Input
                    placeholder="e.g., M101 / NECO_MERCHANT"
                    value={merged.connectips_merchant_id || ''}
                    onChange={e => update('connectips_merchant_id', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>App ID</Label>
                  <Input
                    placeholder="e.g., APP_RTARTS"
                    value={merged.connectips_app_id || ''}
                    onChange={e => update('connectips_app_id', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>App Name / Initiator ID</Label>
                  <Input
                    placeholder="RTARTS System"
                    value={merged.connectips_app_name || ''}
                    onChange={e => update('connectips_app_name', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Bearer Token / Secret Key</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Enter Secret Key / Bearer Token"
                    value={merged.connectips_token || ''}
                    onChange={e => update('connectips_token', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Certificate Password / Private Key Passphrase</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter Certificate Password"
                  value={merged.connectips_cert_pass || ''}
                  onChange={e => update('connectips_cert_pass', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Used on the backend server for cryptographic SHA-256 RSA signing of disbursement payloads.
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3.5 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">💡 How to activate direct disbursement:</p>
                <p>1. When your bank/NCHL provides you with your Merchant ID, App ID, and Token, paste them into these fields.</p>
                <p>2. Click <strong>Test Connection Handshake</strong> to verify credential authentication.</p>
                <p>3. Once verified, you can click <strong>"Disburse via Direct ConnectIPS API"</strong> inside any Approved payment batch.</p>
              </div>

              <div className="pt-2 border-t flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const res = await (await import('@/lib/services/connectips.service')).ConnectIPSService.testConnection(merged);
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
                  {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
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
              <CardDescription>Configure how many approval stages are required before actions are committed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Require Maker-Checker (2-Level)</Label>
                  <p className="text-xs text-muted-foreground mt-1">A checker must review before approving.</p>
                </div>
                <Switch
                  checked={merged.require_maker_checker}
                  onCheckedChange={v => update('require_maker_checker', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Require Final Approver (3-Level)</Label>
                  <p className="text-xs text-muted-foreground mt-1">An additional approver is required after checker.</p>
                </div>
                <Switch
                  checked={merged.require_final_approver}
                  onCheckedChange={v => update('require_final_approver', v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Email (SMTP) Configuration</CardTitle>
              <CardDescription>Configure outgoing email settings for notifications and reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SMTP Host</Label>
                  <Input
                    placeholder="smtp.example.com"
                    value={merged.smtp_host || ''}
                    onChange={e => update('smtp_host', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>SMTP Port</Label>
                  <Input
                    type="number"
                    value={merged.smtp_port || 587}
                    onChange={e => update('smtp_port', parseInt(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>SMTP Username</Label>
                <Input
                  placeholder="user@example.com"
                  value={merged.smtp_user || ''}
                  onChange={e => update('smtp_user', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>From Email Address</Label>
                <Input
                  placeholder="noreply@company.com"
                  value={merged.smtp_from || ''}
                  onChange={e => update('smtp_from', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>SMTP Password / App Password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter SMTP password"
                  value={merged.smtp_pass || ''}
                  onChange={e => update('smtp_pass', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stored securely and never displayed again. Leave blank to keep the existing password.
                </p>
              </div>
              <div className="pt-2 mt-2 border-t space-y-3">
                <div className="space-y-2">
                  <Label>Send Test Email To</Label>
                  <Input
                    type="email"
                    placeholder="recipient@example.com"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => sendTest()}
                  disabled={!testEmail.trim() || sendingTest}
                >
                  {sendingTest ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Send Test Email
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
