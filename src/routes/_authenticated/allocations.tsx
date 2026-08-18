import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/xlsx-utils";

export const Route = createFileRoute("/_authenticated/allocations")({
  component: AllocationsPage,
});

type Row = {
  id: string;
  company_id: string | null;
  fiscal_year: string;
  allocated_amount: number;
  utilized_amount: number;
  notes: string | null;
};

function AllocationsPage() {
  const qc = useQueryClient();
  const { hasAny } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ company_id: "", fiscal_year: "", allocated_amount: "", utilized_amount: "", notes: "" });

  const { data: rows = [] } = useQuery({
    queryKey: ["iaf_allocations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("iaf_allocations").select("*").order("fiscal_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("id, company_name, company_code").order("company_name");
      return (data ?? []) as { id: string; company_name: string; company_code: string }[];
    },
  });
  const { data: fys = [] } = useQuery({
    queryKey: ["fiscal_years-min"],
    queryFn: async () => {
      const { data } = await supabase.from("fiscal_years").select("fiscal_year").order("fiscal_year", { ascending: false });
      return (data ?? []) as { fiscal_year: string }[];
    },
  });

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c.company_name])), [companies]);

  const totals = useMemo(() => ({
    allocated: rows.reduce((s, r) => s + Number(r.allocated_amount || 0), 0),
    utilized: rows.reduce((s, r) => s + Number(r.utilized_amount || 0), 0),
  }), [rows]);

  const openNew = () => {
    setEditing(null);
    setForm({ company_id: "", fiscal_year: "", allocated_amount: "", utilized_amount: "", notes: "" });
    setOpen(true);
  };
  const openEdit = (r: Row) => {
    setEditing(r);
    setForm({
      company_id: r.company_id ?? "",
      fiscal_year: r.fiscal_year,
      allocated_amount: String(r.allocated_amount ?? ""),
      utilized_amount: String(r.utilized_amount ?? ""),
      notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        company_id: form.company_id || null,
        fiscal_year: form.fiscal_year,
        allocated_amount: Number(form.allocated_amount || 0),
        utilized_amount: Number(form.utilized_amount || 0),
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("iaf_allocations").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("iaf_allocations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["iaf_allocations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("iaf_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["iaf_allocations"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="IAF Allocations"
        description="Investor Awareness Fund allocations & utilization per company & fiscal year."
        actions={canWrite && (
          <>
            <Button variant="outline" onClick={() => exportToExcel(rows.map((r) => ({
              company: companyMap[r.company_id ?? ""] ?? "",
              fiscal_year: r.fiscal_year, allocated: r.allocated_amount, utilized: r.utilized_amount,
              balance: Number(r.allocated_amount) - Number(r.utilized_amount), notes: r.notes,
            })), "iaf_allocations")}>
              <Download className="mr-2 h-4 w-4" />Export
            </Button>
            <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />New Allocation</Button>
          </>
        )}
      />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Allocated</div><div className="text-2xl font-semibold">{totals.allocated.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Utilized</div><div className="text-2xl font-semibold">{totals.utilized.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Balance</div><div className="text-2xl font-semibold text-emerald-600">{(totals.allocated - totals.utilized).toLocaleString()}</div></CardContent></Card>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Company</TableHead><TableHead>FY</TableHead><TableHead>Allocated</TableHead>
            <TableHead>Utilized</TableHead><TableHead>Balance</TableHead><TableHead>Notes</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No allocations yet</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{companyMap[r.company_id ?? ""] ?? "—"}</TableCell>
                <TableCell>{r.fiscal_year}</TableCell>
                <TableCell>{Number(r.allocated_amount).toLocaleString()}</TableCell>
                <TableCell>{Number(r.utilized_amount).toLocaleString()}</TableCell>
                <TableCell>{(Number(r.allocated_amount) - Number(r.utilized_amount)).toLocaleString()}</TableCell>
                <TableCell className="max-w-xs truncate">{r.notes}</TableCell>
                <TableCell className="text-right">
                  {canWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Allocation</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Company</Label>
              <Select value={form.company_id} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fiscal Year</Label>
              {fys.length > 0 ? (
                <Select value={form.fiscal_year} onValueChange={(v) => setForm({ ...form, fiscal_year: v })}>
                  <SelectTrigger><SelectValue placeholder="Select FY" /></SelectTrigger>
                  <SelectContent>{fys.map((f) => <SelectItem key={f.fiscal_year} value={f.fiscal_year}>{f.fiscal_year}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="2081/82"
                  value={form.fiscal_year}
                  inputMode="numeric"
                  onChange={(e) => {
                    const nextValue = e.target.value.replace(/[^0-9/]/g, '').slice(0, 9);
                    setForm({ ...form, fiscal_year: nextValue });
                  }}
                />
              )}
            </div>
            <div><Label>Allocated Amount</Label><Input type="number" step="0.01" value={form.allocated_amount} onChange={(e) => setForm({ ...form, allocated_amount: e.target.value })} /></div>
            <div><Label>Utilized Amount</Label><Input type="number" step="0.01" value={form.utilized_amount} onChange={(e) => setForm({ ...form, utilized_amount: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.fiscal_year}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
