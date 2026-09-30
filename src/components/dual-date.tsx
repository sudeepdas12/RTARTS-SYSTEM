import React from "react";
import { adDateToBsString, formatNepaliDate } from "@/lib/nepali-calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface DualDateProps {
  date: Date | string | null | undefined;
  className?: string;
  showBsInline?: boolean;
}

/**
 * Renders a Gregorian date with a corresponding Bikram Sambat (B.S.) date.
 * Hovering displays the full Devanagari date.
 */
export const DualDate: React.FC<DualDateProps> = ({
  date,
  className = "",
  showBsInline = false,
}) => {
  if (!date) return <span className="text-muted-foreground">—</span>;

  const rawDateStr = typeof date === "string" ? date : date.toISOString().split("T")[0];
  const bsDate = adDateToBsString(date);
  const devanagariDate = formatNepaliDate(date);

  if (!bsDate) {
    return <span className={className}>{rawDateStr}</span>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1.5 cursor-help ${className}`}>
            <span className="font-mono text-xs">{rawDateStr}</span>
            {showBsInline ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-medium">
                {bsDate} BS
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground font-mono">({bsDate})</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs space-y-0.5">
          <div className="font-semibold text-foreground">{devanagariDate}</div>
          <div className="text-muted-foreground text-[11px] font-mono">
            AD: {rawDateStr} | BS: {bsDate}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
