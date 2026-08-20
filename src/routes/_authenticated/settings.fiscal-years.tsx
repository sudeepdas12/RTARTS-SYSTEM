import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2, Calendar, CheckCircle2, Clock, CalendarDays, Search, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/fiscal-years")({
  component: FYPage,
});

type Row = { id: string; fiscal_year: string; start_date: string; end_date: string; is_active: boolean };

function FYPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ fiscal_year: "", start_date: "", end_date: "", is_active: false });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fiscal_years"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_years").select("*").order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const activeFY = useMemo(() => rows.find((r) => r.is_active), [rows]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const q = searchTerm.toLowerCase();
    return rows.filter((r) => r.fiscal_year.toLowerCase().includes(q));
  }, [rows, searchTerm]);

  const openNew = () => { setEditing(null); setForm({ fiscal_year: "", start_date: "", end_date: "", is_active: false }); setOpen(true); };
  const openEdit = (r: Row) => { setEditing(r); setForm({ fiscal_year: r.fiscal_year, start_date: r.start_date, end_date: r.end_date, is_active: r.is_active }); setOpen(true); };

  const setActiveFY = useMutation({
    mutationFn: async (targetId: string) => {
      // Deactivate all others
      await supabase.from("fiscal_years").update({ is_active: false }).neq("id", targetId);
      // Activate the selected one
      const { error } = await supabase.from("fiscal_years").update({ is_active: true }).eq("id", targetId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Active fiscal year updated");
      qc.invalidateQueries({ queryKey: ["fiscal_years"] });
      qc.invalidateQueries({ queryKey: ["active_fiscal_year"] });
    },
    onError: (e: Error) => toast.error(`Failed to activate: ${e.message}`),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (form.is_active) {
        await supabase
          .from("fiscal_years")
          .update({ is_active: false })
          .neq("id", editing?.id || "00000000-0000-0000-0000-000000000000");
      }
      
      const payload = { ...form };
      if (editing) {
        const { error } = await supabase.from("fiscal_years").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fiscal_years").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { 
      toast.success("Fiscal year saved successfully"); 
      setOpen(false); 
      qc.invalidateQueries({ queryKey: ["fiscal_years"] });
      qc.invalidateQueries({ queryKey: ["active_fiscal_year"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fiscal_years").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { 
      toast.success("Fiscal year deleted"); 
      qc.invalidateQueries({ queryKey: ["fiscal_years"] }); 
      qc.invalidateQueries({ queryKey: ["active_fiscal_year"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Fiscal Year Settings"
          description="Define fiscal year windows used across payables, tax deductions, and regulatory summaries."
          actions={
            isAdmin && (
              <Button onClick={openNew} size="sm" className="hover-lift">
                <Plus className="mr-2 h-4 w-4" />
                New Fiscal Year
              </Button>
            )
          }
        />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Active Fiscal Year</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                {activeFY ? activeFY.fiscal_year : "None Set"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Primary system period</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Active Period Range</p>
              <p className="text-sm font-semibold mt-1 font-mono">
                {activeFY ? `${activeFY.start_date} → ${activeFY.end_date}` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Start & End dates</p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <CalendarDays className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Total Defined Periods</p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{rows.length}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Historical & current years</p>
            </div>
            <div className="p-2.5 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Calendar className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search fiscal years (e.g. 2081)…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fiscal Year</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Loading fiscal years…
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No fiscal years found.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="font-semibold font-mono text-sm">{r.fiscal_year}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.start_date}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.end_date}</TableCell>
                  <TableCell>
                    {r.is_active ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 text-[11px]">
                        Active Period
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[11px]">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <div className="flex items-center justify-end gap-1">
                        {!r.is_active && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs mr-1 hover-lift"
                            onClick={() => setActiveFY.mutate(r.id)}
                            disabled={setActiveFY.isPending}
                          >
                            Set Active
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(r)} title="Edit">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => del.mutate(r.id)}
                          title="Delete"
                          disabled={r.is_active}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "New"} Fiscal Year</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Fiscal Year</Label>
              <Input
                placeholder="2081/82"
                value={form.fiscal_year}
                inputMode="numeric"
                onChange={(e) => {
                  const nextValue = e.target.value.replace(/[^0-9/]/g, "").slice(0, 9);
                  setForm({ ...form, fiscal_year: nextValue });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3 mt-2">
              <div>
                <div className="font-medium text-sm">Active Period</div>
                <div className="text-xs text-muted-foreground">
                  Setting this will make this the default fiscal year across the platform.
                </div>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={!form.fiscal_year || !form.start_date || !form.end_date || save.isPending}
            >
              {editing ? "Save Changes" : "Create Fiscal Year"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
