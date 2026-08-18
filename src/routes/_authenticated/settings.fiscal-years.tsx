import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/fiscal-years")({
  component: FYPage,
});

type Row = { id: string; fiscal_year: string; start_date: string; end_date: string; is_active: boolean };

function FYPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ fiscal_year: "", start_date: "", end_date: "", is_active: false });

  const { data: rows = [] } = useQuery({
    queryKey: ["fiscal_years"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_years").select("*").order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const openNew = () => { setEditing(null); setForm({ fiscal_year: "", start_date: "", end_date: "", is_active: false }); setOpen(true); };
  const openEdit = (r: Row) => { setEditing(r); setForm({ fiscal_year: r.fiscal_year, start_date: r.start_date, end_date: r.end_date, is_active: r.is_active }); setOpen(true); };

  const save = useMutation({
    mutationFn: async () => {
      // If activating this fiscal year, deactivate all others first
      if (form.is_active) {
        const { error: deactivateError } = await supabase
          .from("fiscal_years")
          .update({ is_active: false })
          .neq("id", editing?.id || "00000000-0000-0000-0000-000000000000");
        
        if (deactivateError) {
          console.warn('Failed to deactivate other fiscal years:', deactivateError);
          // Continue anyway - the current one should still be activated
        }
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
      toast.success("Saved"); 
      setOpen(false); 
      qc.invalidateQueries({ queryKey: ["fiscal_years"] });
      // Also invalidate the active fiscal year cache
      qc.invalidateQueries({ queryKey: ["active_fiscal_year"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fiscal_years").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["fiscal_years"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Fiscal Year Settings"
        description="Define fiscal year windows used across payables and reports."
        actions={isAdmin && <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />New Fiscal Year</Button>}
      />

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fiscal Year</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No fiscal years defined</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.fiscal_year}</TableCell>
                <TableCell>{r.start_date}</TableCell>
                <TableCell>{r.end_date}</TableCell>
                <TableCell>{r.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell className="text-right">
                  {isAdmin && (
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
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Fiscal Year</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Fiscal Year</Label>
              <Input
                placeholder="2081/82"
                value={form.fiscal_year}
                inputMode="numeric"
                onChange={(e) => {
                  const nextValue = e.target.value.replace(/[^0-9/]/g, '').slice(0, 9);
                  setForm({ ...form, fiscal_year: nextValue });
                }}
              />
            </div>
            <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            <div className="flex items-center justify-between rounded-lg border-2 border-muted-foreground/20 bg-muted/30 p-4">
              <div>
                <div className="font-medium text-base">Active</div>
                <div className="text-xs text-muted-foreground mt-0.5">Only one fiscal year can be active at a time</div>
              </div>
              <Switch 
                checked={form.is_active} 
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                className="scale-110"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.fiscal_year || !form.start_date || !form.end_date}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
