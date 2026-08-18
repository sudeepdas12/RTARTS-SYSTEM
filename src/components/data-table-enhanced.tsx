import { useState, useMemo, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  cellClassName?: string;
  headerClassName?: string;
}

interface EnhancedDataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchKeys?: string[];
  searchPlaceholder?: string;
  pageSize?: number;
  title?: string;
  filename?: string;
  exportEnabled?: boolean;
  searchEnabled?: boolean;
  paginationEnabled?: boolean;
  emptyMessage?: string;
  actionsColumn?: {
    header?: string;
    render: (row: T) => ReactNode;
  };
  onRowClick?: (row: T) => void;
}

export function EnhancedDataTable<T extends Record<string, any>>({
  columns,
  data,
  searchKeys = [],
  searchPlaceholder = "Search...",
  pageSize = 10,
  title,
  filename = "export",
  exportEnabled = true,
  searchEnabled = true,
  paginationEnabled = true,
  emptyMessage = "No records found",
  actionsColumn,
  onRowClick,
}: EnhancedDataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSizeOption, setPageSizeOption] = useState(pageSize);

  const filtered = useMemo(() => {
    if (!searchQuery || searchKeys.length === 0) return data;
    const q = searchQuery.toLowerCase();
    return data.filter(row =>
      searchKeys.some(key => {
        const val = row[key];
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, searchQuery, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSizeOption));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSizeOption, currentPage * pageSizeOption);

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("No data to export");
      return;
    }
    const headers = columns.map(c => c.header);
    const rows = filtered.map(row =>
      columns.map(c => {
        const val = row[c.key];
        return val != null ? String(val).replace(/,/g, ",") : "";
      })
    );
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} records exported`);
  };

  return (
    <div className="space-y-3">
      {(title || searchEnabled || exportEnabled) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          <div className="flex items-center gap-2">
            {searchEnabled && (
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  className="h-9 w-56 pl-8"
                />
              </div>
            )}
            {exportEnabled && (
              <Button variant="outline" size="sm" className="h-9" onClick={handleExport}>
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(col => (
                <TableHead key={col.key} className={col.headerClassName}>{col.header}</TableHead>
              ))}
              {actionsColumn && <TableHead className="text-right">{actionsColumn.header ?? "Actions"}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (actionsColumn ? 1 : 0)} className="py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((row, idx) => (
                <TableRow
                  key={idx}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map(col => (
                    <TableCell key={col.key} className={col.cellClassName}>
                      {col.render ? col.render(row) : (row[col.key] != null ? String(row[col.key]) : "-")}
                    </TableCell>
                  ))}
                  {actionsColumn && (
                    <TableCell className="text-right">{actionsColumn.render(row)}</TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {paginationEnabled && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Showing <strong>{pageItems.length}</strong> of <strong>{filtered.length}</strong> records
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={String(pageSizeOption)}
              onValueChange={(v) => { setPageSizeOption(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map(size => (
                  <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setPage(1)} disabled={currentPage === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}