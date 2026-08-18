import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Download, Eye, ShieldAlert, Trash2 } from "lucide-react";
import { exportToExcel } from "@/lib/xlsx-utils";
import { AuditService } from '@/lib/services/audit.service';
import { toast } from 'sonner';

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_value: unknown;
  new_value: unknown;
  action_time: string;
};

function AuditPage() {
  const { hasAny } = useAuth();
  const canView = hasAny(["admin", "auditor"]);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [table, setTable] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["audit_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("action_time", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    enabled: canView,
  });

  const tables = useMemo(() => Array.from(new Set(rows.map((r) => r.table_name))), [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => {
      if (table !== "all" && r.table_name !== table) return false;
      if (action !== "all" && r.action !== action) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          r.table_name.toLowerCase().includes(s) ||
          r.action.toLowerCase().includes(s) ||
          (r.record_id ?? "").toLowerCase().includes(s) ||
          (r.user_id ?? "").toLowerCase().includes(s)
        );
      }
      return true;
    }),
    [rows, q, table, action],
  );

  const onExport = () => exportToExcel(
    filtered.map((r) => ({
      time: r.action_time,
      user_id: r.user_id,
      action: r.action,
      table: r.table_name,
      record_id: r.record_id,
      old_value: JSON.stringify(r.old_value ?? ""),
      new_value: JSON.stringify(r.new_value ?? ""),
    })),
    "audit_logs",
  );

  if (!canView) {
    return (
      <div>
        <PageHeader title="Audit Log" description="Restricted access." />
        <Card><CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <ShieldAlert className="h-5 w-5" /> Only admins and auditors can view the audit log.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Immutable history of every write across the system."
        actions={
          <div className="flex gap-2">
            <Button onClick={onExport}><Download className="mr-2 h-4 w-4" />Export</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search table, action, record id, user…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={table} onValueChange={setTable}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Table" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tables</SelectItem>
            {tables.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="INSERT">INSERT</SelectItem>
            <SelectItem value="UPDATE">UPDATE</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>User</TableHead>
            <TableHead className="text-right"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No audit entries</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{new Date(r.action_time).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={r.action === "DELETE" ? "destructive" : r.action === "INSERT" ? "default" : "secondary"}>{r.action}</Badge>
                </TableCell>
                <TableCell>{r.table_name}</TableCell>
                <TableCell className="font-mono text-xs">{r.record_id?.slice(0, 8)}…</TableCell>
                <TableCell className="font-mono text-xs">{r.user_id?.slice(0, 8) ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setDetail(r)}><Eye className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Audit Entry</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Time:</span> {new Date(detail.action_time).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Action:</span> {detail.action}</div>
                <div><span className="text-muted-foreground">Table:</span> {detail.table_name}</div>
                <div><span className="text-muted-foreground">Record:</span> <span className="font-mono">{detail.record_id}</span></div>
                <div className="col-span-2"><span className="text-muted-foreground">User:</span> <span className="font-mono">{detail.user_id ?? "—"}</span></div>
              </div>
              <div>
                <div className="mb-1 font-medium">Old value</div>
                <pre className="max-h-48 overflow-auto rounded border bg-muted/40 p-2 text-xs">{JSON.stringify(detail.old_value, null, 2)}</pre>
              </div>
              <div>
                <div className="mb-1 font-medium">New value</div>
                <pre className="max-h-48 overflow-auto rounded border bg-muted/40 p-2 text-xs">{JSON.stringify(detail.new_value, null, 2)}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
