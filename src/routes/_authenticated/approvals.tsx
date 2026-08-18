import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RBACService, UserContext } from "@/lib/rbac-service";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Eye } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/approvals")({
  component: ApprovalsPage,
});

type Status = "Pending" | "Approved" | "Rejected";
type Row = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload: unknown;
  status: Status;
  review_notes: string | null;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function ApprovalsPage() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const [status, setStatus] = useState<Status | "all">("Pending");
  const [viewing, setViewing] = useState<Row | null>(null);
  const [notes, setNotes] = useState("");

  const currentUser: UserContext | null = user ? { id: user.id, roles: (roles as any) || ['read_only'] } : null;
  const canApprove = RBACService.canApprove(currentUser, 'approvals');

  const { data: rows = [] } = useQuery({
    queryKey: ["pending_approvals", status],
    queryFn: async () => {
      let q = supabase.from("pending_approvals").select("*").order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const counts = useMemo(() => {
    const c = { Pending: 0, Approved: 0, Rejected: 0 };
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "Approved" | "Rejected" }) => {
      const { error } = await supabase.from("pending_approvals").update({
        status: decision, review_notes: notes || null, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Decision recorded"); setViewing(null); setNotes(""); qc.invalidateQueries({ queryKey: ["pending_approvals"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Pending Approvals"
        description="Maker/checker workflow — authorized roles review changes requested by operators."
      />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pending</div><div className="text-2xl font-semibold text-amber-600">{counts.Pending}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Approved</div><div className="text-2xl font-semibold text-emerald-600">{counts.Approved}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Rejected</div><div className="text-2xl font-semibold text-destructive">{counts.Rejected}</div></CardContent></Card>
      </div>

      <div className="mb-4">
        <Select value={status} onValueChange={(v: Status | "all") => setStatus(v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Requested</TableHead><TableHead>Entity</TableHead><TableHead>Action</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No approvals</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell className="capitalize">{r.entity_type}</TableCell>
                <TableCell>{r.action}</TableCell>
                <TableCell>
                  {r.status === "Pending" && <Badge variant="secondary">Pending</Badge>}
                  {r.status === "Approved" && <Badge className="bg-emerald-600">Approved</Badge>}
                  {r.status === "Rejected" && <Badge variant="destructive">Rejected</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => { setViewing(r); setNotes(r.review_notes ?? ""); }}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Review Approval</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Entity:</span> {viewing.entity_type}</div>
                <div><span className="text-muted-foreground">Action:</span> {viewing.action}</div>
                <div><span className="text-muted-foreground">Requested:</span> {new Date(viewing.created_at).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Status:</span> {viewing.status}</div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Payload</div>
                <pre className="max-h-64 overflow-auto rounded border bg-muted/40 p-3 text-xs">{JSON.stringify(viewing.payload, null, 2)}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Review notes</div>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for the requester" disabled={viewing.status !== "Pending" || !canApprove} />
              </div>
            </div>
          )}
          <DialogFooter>
            {viewing?.status === "Pending" && canApprove ? (
              <>
                <Button variant="outline" onClick={() => decide.mutate({ id: viewing.id, decision: "Rejected" })}>
                  <XCircle className="mr-2 h-4 w-4" />Reject
                </Button>
                <Button onClick={() => decide.mutate({ id: viewing.id, decision: "Approved" })}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />Approve
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}