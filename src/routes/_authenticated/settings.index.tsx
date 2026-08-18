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
import { SettingsService, SystemSettings } from '@/lib/services/settings.service';
import { toast } from 'sonner';
import { Loader2, Save, Send } from 'lucide-react';

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

  if (isLoading) return <div className="p-6">Loading settings...</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="System Settings"
          description="Configure global application preferences, taxes, and workflows."
        />
        <Button onClick={() => saveSettings()} disabled={isPending}>
          {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save All Changes
        </Button>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-[600px]">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Regional Formatting</CardTitle>
              <CardDescription>Configure how dates and numbers are displayed across the system.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="flex items-center justify-between">
                <Label>Enable Nepali Dates (BS Calendar)</Label>
                <Switch
                  checked={merged.enable_nepali_dates}
                  onCheckedChange={v => update('enable_nepali_dates', v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financial" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Global Tax & Interest Rates</CardTitle>
              <CardDescription>These rates will be used as defaults for all new payables.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="space-y-2">
                <Label>Default Dividend TDS (%) — Natural Person</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={merged.dividend_tds_natural ?? 5}
                  onChange={e => update('dividend_tds_natural', Math.max(0, parseFloat(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-2">
                <Label>Default Dividend TDS (%) — Legal Person / Company</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={merged.dividend_tds_legal ?? 5}
                  onChange={e => update('dividend_tds_legal', Math.max(0, parseFloat(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-2 mt-6">
                <Label>Default Interest TDS (%) — Natural Person</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={merged.interest_tds_natural ?? 6}
                  onChange={e => update('interest_tds_natural', Math.max(0, parseFloat(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-2">
                <Label>Default Interest TDS (%) — Legal Person / Company</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={merged.interest_tds_legal ?? 15}
                  onChange={e => update('interest_tds_legal', Math.max(0, parseFloat(e.target.value) || 0))}
                />
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
