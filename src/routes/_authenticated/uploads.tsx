import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/uploads")({
  component: UploadsPage,
});

type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  action_time: string;
};

function UploadsPage() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["uploads-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, user_id, action, table_name, record_id, action_time")
        .eq("action", "INSERT")
        .order("action_time", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  // Group INSERTs within the same minute by user + table as a "batch upload".
  const batches = useMemo(() => {
    const map = new Map<string, { key: string; user_id: string | null; table_name: string; when: string; count: number }>();
    for (const r of rows) {
      const minute = r.action_time.slice(0, 16);
      const key = `${r.user_id ?? ""}|${r.table_name}|${minute}`;
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { key, user_id: r.user_id, table_name: r.table_name, when: r.action_time, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => (a.when < b.when ? 1 : -1));
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Uploads History"
          description="Bulk insert activity grouped by user, table, and minute — derived from the audit log."
        />
        <Button asChild>
          <Link to="/upload">
            <Upload className="w-4 h-4 mr-2" />
            Upload New File
          </Link>
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>When</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead>Type</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && batches.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No upload activity yet</TableCell></TableRow>}
            {batches.map((b) => (
              <TableRow key={b.key}>
                <TableCell>{new Date(b.when).toLocaleString()}</TableCell>
                <TableCell>{b.table_name}</TableCell>
                <TableCell className="font-mono text-xs">{b.user_id?.slice(0, 8) ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{b.count}</TableCell>
                <TableCell>
                  {b.count >= 5 ? <Badge>Bulk import</Badge> : <Badge variant="secondary">Manual</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
