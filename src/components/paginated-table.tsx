import * as React from 'react';
import { useReactTable, getCoreRowModel, getPaginationRowModel, ColumnDef, flexRender } from '@tanstack/react-table';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface PaginatedTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  pageSize?: number;
}

export function PaginatedTable<T extends object>({ columns, data, pageSize = 10 }: PaginatedTableProps<T>) {
  const [size, setSize] = React.useState(pageSize);
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: size } },
    onPaginationChange: (updater) => {
      const newState = typeof updater === 'function' ? updater(table.getState().pagination) : updater;
      setSize(newState.pageSize);
    },
  });

  return (
    <div className="space-y-4">
      <Table className="w-full">
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead key={header.id} className={(header.column.columnDef.meta as { className?: string } | undefined)?.className ?? ''}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map(row => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map(cell => (
                <TableCell key={cell.id} className={(cell.column.columnDef.meta as { className?: string } | undefined)?.className ?? ''}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {table.getRowModel().rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                No data available.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Select value={size.toString()} onValueChange={v => {
            const newSize = Number(v);
            setSize(newSize);
            table.setPageSize(newSize);
          }}>
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 10, 20, 50, 100].map(s => (
                <SelectItem key={s} value={s.toString()}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
