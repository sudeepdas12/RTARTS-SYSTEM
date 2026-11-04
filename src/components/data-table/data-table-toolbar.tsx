import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Filter, Download, FileSpreadsheet, Loader2, X } from "lucide-react";

export interface FilterOption {
  label: string;
  value: string;
}

export interface DataTableToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  statusOptions?: FilterOption[];
  selectedStatuses?: string[];
  onStatusChange?: (statuses: string[]) => void;
  onExportExcel?: () => void | Promise<void>;
  onExportPdf?: () => void | Promise<void>;
  isExporting?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  extraActions?: React.ReactNode;
}

export function DataTableToolbar({
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Filter records...",
  statusOptions = [],
  selectedStatuses = [],
  onStatusChange,
  onExportExcel,
  onExportPdf,
  isExporting = false,
  isLoading = false,
  isError = false,
  extraActions,
}: DataTableToolbarProps) {
  const isFiltered = searchValue.length > 0 || selectedStatuses.length > 0;
  const isDisabled = isLoading || isError;

  const handleStatusToggle = (value: string) => {
    if (isDisabled || !onStatusChange) return;
    if (selectedStatuses.includes(value)) {
      onStatusChange(selectedStatuses.filter((s) => s !== value));
    } else {
      onStatusChange([...selectedStatuses, value]);
    }
  };

  const handleResetFilters = () => {
    if (isDisabled) return;
    if (onSearchChange) onSearchChange("");
    if (onStatusChange) onStatusChange([]);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      {/* Screen-reader live region for export and loading announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {isExporting
          ? "Export in progress. Please wait."
          : isLoading
            ? "Loading records..."
            : isError
              ? "Failed to load records."
              : ""}
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        <Input
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          disabled={isDisabled}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="h-8 w-[160px] lg:w-[260px]"
        />

        {statusOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-dashed"
                disabled={isDisabled}
                aria-label="Filter records by status"
                title="Filter records by status"
              >
                <Filter className="mr-2 h-4 w-4" aria-hidden="true" />
                Status
                {selectedStatuses.length > 0 && (
                  <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {selectedStatuses.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[180px]">
              <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {statusOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={selectedStatuses.includes(opt.value)}
                  onCheckedChange={() => handleStatusToggle(opt.value)}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            disabled={isDisabled}
            className="h-8 px-2 lg:px-3 text-muted-foreground hover:text-foreground"
            aria-label="Reset active filters"
            title="Reset filters"
          >
            Reset
            <X className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {extraActions}
        {onExportExcel && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExportExcel}
            disabled={isExporting || isDisabled}
            className="h-8"
            aria-label="Export records to Excel spreadsheet"
            title="Export records to Excel"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Export Excel
          </Button>
        )}
        {onExportPdf && (
          <Button
            variant="default"
            size="sm"
            onClick={onExportPdf}
            disabled={isExporting || isDisabled}
            className="h-8"
            aria-label="Export records to PDF document"
            title="Export records to PDF"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Export PDF
          </Button>
        )}
      </div>
    </div>
  );
}
