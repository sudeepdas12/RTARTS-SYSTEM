import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { DragDropZone } from "@/components/upload/drag-drop-zone";
import { ImportPreview } from "@/components/upload/import-preview";
import { ExcelParser, ParsedExcelData, DetectedSheetType } from "@/lib/excel-parser";
import { ChunkProcessor, ChunkProgress } from "@/lib/chunk-processor";
import { ImportService } from "@/lib/services/import.service";
import { UploadService } from "@/lib/services/upload.service";
import { ValidationEngine, ValidationError } from "@/lib/validation-engine";
import { ValidationReport } from "@/components/upload/validation-report";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  Layers,
  Upload,
  Info,
  FileSpreadsheet,
  TrendingUp,
  Users,
  Building2,
  ArrowRight,
} from "lucide-react";

// Validate Nepali fiscal year format: YYYY/YY or YYYY/YYYY (e.g. 2081/82 or 2081/2082)
function isValidFiscalYear(fy: string): boolean {
  return /^\d{4}\/\d{2}(\d{2})?$/.test(fy.trim());
}

// Normalize fiscal year to YYYY/YY short format
function normalizeFiscalYear(fy: string): string {
  const m = fy.trim().match(/^(\d{4})\/(\d{2})(\d{2})?$/);
  if (!m) return fy;
  const yr = m[1];
  const end = m[3] ? m[2] + m[3] : m[2]; // full or short end
  return `${yr}/${end.slice(-2)}`; // always store as YYYY/YY
}

export const Route = createFileRoute("/_authenticated/upload")({
  component: UploadRoute,
});

async function computeFileHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Default TDS rates per sheet type */
const fileTypeLabelMap: Record<string, string> = {
  debenture: "Debenture / Interest",
  dividend: "Dividend",
  mutual_fund: "Mutual Fund",
  bonus_share: "Bonus Share",
  cash_dividend: "Cash Dividend",
  right_share: "Right Share",
  raw_demat: "Raw Demat",
  unknown: "Unknown",
};

function getDefaultTdsRate(sheetType: DetectedSheetType, fileType: string): number {
  if (sheetType === "TAX_EXEMPTED") return 0.0; // Mutual/Retirement funds: 0%
  if (sheetType === "INSTITUTION") return 0.15; // Institutions: 15%
  if (sheetType === "PRIVATE") return 0.06; // Debenture private: 6%
  if (fileType === "debenture" || fileType === "interest") return 0.06; // Debenture interest default: 6%
  return 0.05; // Public / Promoter / Local: 5%
}

/** Validation error types that are recommended (soft) and must NOT block an upload.
 *  Shared by the pre-import validation and the actual import gate so both behave
 *  identically — "validation passed" means "no blocking errors".
 */
const SOFT_ERROR_TYPES = new Set(["missing_address", "invalid_precision", "invalid_bank_account"]);

/** Multi-sheet import progress */
interface AllSheetsProgress {
  currentSheet: string;
  currentSheetIndex: number;
  totalSheets: number;
  sheetProgress: ChunkProgress;
  overallTotal: number;
  overallProcessed: number;
  overallSuccess: number;
  overallErrors: number;
  status: "Processing" | "Completed" | "Failed";
}

function UploadRoute() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [allSheetsProgress, setAllSheetsProgress] = useState<AllSheetsProgress | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  // Per-sheet TDS rates (overrideable)
  const [sheetTdsRates, setSheetTdsRates] = useState<Record<number, string>>({});
  // Per-sheet Dividend rates (overrideable)
  const [sheetDividendRates, setSheetDividendRates] = useState<Record<number, string>>({});
  // Post-import summary
  const [importSummary, setImportSummary] = useState<{
    rows: number;
    clients: number;
    duration: number;
    sheetName: string;
  } | null>(null);
  // Company override (if user wants to assign to a specific company instead of auto-detect)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("auto");

  // Fiscal year & dividend metadata
  const [fiscalYear, setFiscalYear] = useState(() => {
    const now = new Date();
    const nepaliYear = now.getFullYear() + 56;
    return `${nepaliYear}/${nepaliYear + 1}`;
  });
  const [dividendRate, setDividendRate] = useState("");
  const [dividendType, setDividendType] = useState<"Cash" | "Stock" | "Bonus" | "Right" | "Debenture">("Cash");

  // Companies for the override dropdown
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-lookup"],
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .order("company_name");
      return data || [];
    },
  });

  // When parsedData is set, auto-populate per-sheet rates from detected defaults
  useEffect(() => {
    if (!parsedData) return;
    const tdsRates: Record<number, string> = {};
    const divRates: Record<number, string> = {};
    parsedData.sheets.forEach((sheet, idx) => {
      const rate = getDefaultTdsRate(sheet.sheetType, parsedData.fileType);
      tdsRates[idx] = String(Math.round(rate * 100));
      if (sheet.detectedDividendRate !== undefined) {
        divRates[idx] = String(sheet.detectedDividendRate);
      }
    });
    setSheetTdsRates(tdsRates);
    setSheetDividendRates(divRates);
  }, [parsedData]);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsParsing(true);
    setProgress(null);
    setAllSheetsProgress(null);
    setValidationErrors([]);
    try {
      const data = await ExcelParser.parseFile(selectedFile);
      setParsedData(data);
      const firstDataSheetIndex = data.sheets.findIndex((s) => s.sheetType !== "SUMMARY");
      setSelectedSheetIndex(firstDataSheetIndex >= 0 ? firstDataSheetIndex : 0);
      const dataSheets = data.sheets.filter((s) => s.sheetType !== "SUMMARY");

      if (data.detectedRate) {
        setDividendRate(String(data.detectedRate));
      }
      if (data.fileType === "debenture") {
        setDividendType("Debenture");
      }

      toast.success(
        `File parsed: ${data.sheets.length} sheet(s) detected (${dataSheets.length} data sheet(s)).`,
      );
    } catch (error) {
      toast.error("Failed to parse file");
      console.error(error);
    } finally {
      setIsParsing(false);
    }
  };

  const handleValidate = async () => {
    if (!parsedData || !parsedData.sheets[selectedSheetIndex] || !file) return;
    setIsValidating(true);
    try {
      const sheet = parsedData.sheets[selectedSheetIndex];
      if (sheet.sheetType === "SUMMARY") {
        toast.warning("Summary sheet is reference-only and cannot be validated.");
        return;
      }
      const fileHash = await computeFileHash(file);
      const sheetDivRate = sheetDividendRates[selectedSheetIndex];
      const rate = sheetDivRate ? Number(sheetDivRate) : dividendRate ? Number(dividendRate) : undefined;
      const errors = await ValidationEngine.validateBatch(
        sheet.rows, 
        sheet.mapping, 
        fileHash, 
        parsedData.fileType,
        {
          isRawInputFile: sheet.isRawInputFile,
          isPreCalculated: sheet.isPreCalculated,
          dividendRate: rate
        }
      );
      setValidationErrors(errors);
      // Apply the SAME severity gate as the actual import so the validator reports
      // what the importer will actually block on (no misleading "no errors found").
      const hardErrors = errors.filter((e) => !SOFT_ERROR_TYPES.has(e.type));
      const softCount = errors.length - hardErrors.length;
      if (hardErrors.length === 0) {
        toast.success(
          softCount > 0
            ? `No blocking errors found. ${softCount} recommended check(s) (address, precision, bank account) — can proceed.`
            : "Validation passed — no blocking errors found!",
        );
      } else {
        toast.error(
          `Validation found ${hardErrors.length} blocking error${hardErrors.length === 1 ? "" : "s"}. Fix these before importing.`,
        );
      }
    } catch (e) {
      toast.error("Validation check failed");
    } finally {
      setIsValidating(false);
    }
  };

  /** Build import options for a single sheet */
  function buildOptions(sheetIdx: number) {
    const sheetDivRate = sheetDividendRates[sheetIdx];
    const sheet = parsedData!.sheets[sheetIdx];
    // Clamp TDS rate to 0–50% to prevent invalid values
    const rawTds =
      sheetTdsRates[sheetIdx] !== undefined ? Number(sheetTdsRates[sheetIdx]) : undefined;
    const tdsRate = rawTds !== undefined ? Math.min(50, Math.max(0, rawTds)) / 100 : undefined;

    return {
      fiscalYear: fiscalYear ? normalizeFiscalYear(fiscalYear) : undefined,
      dividendRate: sheetDivRate
        ? Number(sheetDivRate)
        : dividendRate
          ? Number(dividendRate)
          : undefined,
      tdsRate,
      dividendType:
        parsedData!.fileType !== "debenture" && parsedData!.fileType !== "interest"
          ? dividendType
          : undefined,
      // Direct company UUID (bypasses name-based lookup and avoids accidental company creation)
      companyId: selectedCompanyId !== "auto" ? selectedCompanyId : undefined,
      companyName:
        selectedCompanyId !== "auto"
          ? (companies.find((c) => c.id === selectedCompanyId)?.company_name ??
            parsedData!.detectedCompanyName)
          : parsedData!.detectedCompanyName,
      fileHash: undefined as string | undefined,
      sheetType: sheet?.sheetName || sheet?.sheetType || undefined,
      fileName: file?.name,
      fileSize: file?.size,
      fileType: parsedData!.fileType,
      sheetName: sheet?.sheetName,
      totalRows: sheet?.rowCount,
      userId: undefined as string | undefined,
      isPreCalculated: sheet?.isPreCalculated,
      isRawInputFile: sheet?.isRawInputFile,
    };
  }

  const handleImport = async () => {
    if (!file || !parsedData || !parsedData.sheets[selectedSheetIndex]) return;

    const sheet = parsedData.sheets[selectedSheetIndex];
    if (sheet.sheetType === "SUMMARY") {
      toast.warning("Summary sheet is reference-only and will not be imported.");
      return;
    }

    // Fiscal year validation
    if (fiscalYear && !isValidFiscalYear(fiscalYear)) {
      toast.error(
        "Invalid fiscal year format. Use YYYY/YY (e.g. 2081/82) or YYYY/YYYY (e.g. 2081/2082).",
      );
      return;
    }

    const fileHash = await computeFileHash(file);
    setImportSummary(null);

    const sheetDivRate = sheetDividendRates[selectedSheetIndex];
    const rate = sheetDivRate ? Number(sheetDivRate) : dividendRate ? Number(dividendRate) : undefined;
    const validationErrorsForImport = await ValidationEngine.validateBatch(
      sheet.rows,
      sheet.mapping,
      fileHash,
      parsedData.fileType,
      {
        isRawInputFile: sheet.isRawInputFile,
        isPreCalculated: sheet.isPreCalculated,
        dividendRate: rate
      }
    );
    
    // Severity gating: only *blocking* validation errors stop the import.
    const hardErrors = validationErrorsForImport.filter(
      (e) => !SOFT_ERROR_TYPES.has(e.type),
    );

    const softErrorCount = validationErrorsForImport.length - hardErrors.length;
    if (softErrorCount > 0) {
      toast.warning(
        `Continuing upload — ${softErrorCount} recommended check${softErrorCount === 1 ? "" : "s"} skipped (address, precision, bank account).`,
      );
    }
    
    // Create Upload Record FIRST so we can log validation errors to it
    let uploadId: string = crypto.randomUUID();
    let userId: string | undefined;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
      const uploadRecord = await UploadService.createUploadRecord({
        file_name: file.name,
        file_size: file.size,
        file_type: parsedData.fileType,
        sheet_name: sheet.sheetName,
        target_table:
          parsedData.fileType === "debenture" || parsedData.fileType === "interest"
            ? "interest_payables"
            : parsedData.fileType === "mutual_fund"
              ? "mutual_fund_payables"
              : "dividend_payables",
        total_rows: sheet.rowCount,
        status: "Processing",
        file_hash: fileHash,
        user_id: userId,
      });
      uploadId = uploadRecord.id;
    } catch (e) {
      toast.error("Failed to create upload record");
      setIsImporting(false);
      return;
    }

    setValidationErrors(hardErrors);
    setIsImporting(true);

    // Filter out rows with hard errors
    const invalidRowIndices = new Set(hardErrors.map((e) => e.row - 1)); // row is 1-indexed
    const validRows = sheet.rows.filter((_, idx) => !invalidRowIndices.has(idx));
    
    // Log ALL validation errors to history
    if (validationErrorsForImport.length > 0) {
      const dbErrors = validationErrorsForImport.map(e => ({
        upload_id: uploadId,
        row_number: e.row,
        field_name: e.field,
        error_type: e.type,
        error_message: e.message,
        raw_data: e.rawData
      }));
      await UploadService.logUploadErrors(dbErrors);
    }

    setProgress({
      totalRows: sheet.rowCount,
      processedRows: 0,
      successRows: 0,
      errorRows: hardErrors.length,
      status: "Processing",
    });



    try {
      const duplicate = await ImportService.checkDuplicateFile(fileHash);
      if (duplicate) {
        setProgress({
          totalRows: sheet.rowCount,
          processedRows: sheet.rowCount,
          successRows: 0,
          errorRows: 0,
          status: "Completed",
        });
        try {
          await UploadService.updateUploadStatus(uploadId, "Completed", {
            success_rows: 0,
            error_rows: 0,
            error_message: "Duplicate file, no rows imported.",
          });
        } catch (statusErr) {
          console.warn("Could not update duplicate upload status:", statusErr);
        }
        await queryClient.invalidateQueries({ queryKey: ["upload-history"] });
        setIsImporting(false);
        return;
      }
    } catch (checkErr: any) {
      console.warn("Duplicate check failed, continuing:", checkErr);
    }

    await new Promise((r) => setTimeout(r, 50));

    try {
      let targetTable = "dividend_payables";
      if (parsedData.fileType === "debenture" || parsedData.fileType === "interest") {
        targetTable = "interest_payables";
      } else if (parsedData.fileType === "mutual_fund") {
        targetTable = "mutual_fund_payables";
      }

      const opts = buildOptions(selectedSheetIndex);
      opts.fileHash = fileHash;
      opts.userId = userId;

      const importStart = Date.now();
      const result = await ChunkProcessor.processInChunks(
        uploadId,
        validRows,
        targetTable,
        1000,
        (p) => setProgress(p),
        opts, // companyId is already embedded via buildOptions
      );
      const importDuration = Math.round((Date.now() - importStart) / 1000);
      setImportSummary({
        rows: result.successRows,
        clients: 0, // client count returned from Edge fn only; fallback shows 0
        duration: importDuration,
        sheetName: sheet.sheetName,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["companies"] }),
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
        queryClient.invalidateQueries({ queryKey: ["interest_payables"] }),
        queryClient.invalidateQueries({ queryKey: ["dividend_payables"] }),
        queryClient.invalidateQueries({ queryKey: ["mutual_fund_payables"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] }),
        queryClient.invalidateQueries({ queryKey: ["upload-history"] }),
      ]);

      if (result.successRows <= 0 && result.errorRows > 0) {
        throw new Error("Import completed without inserting any rows.");
      }

      toast.success(
        `Imported ${result.successRows.toLocaleString()} rows from "${sheet.sheetName}"`,
      );
    } catch (error: any) {
      const msg = error?.message || "Unknown error";
      toast.error(`Import failed: ${msg}`);
      console.error("Import error:", error);
      try {
        await UploadService.updateUploadStatus(uploadId, "Failed", {
          error_message: msg,
        });
      } catch (statusErr) {
        console.warn("Could not mark failed upload:", statusErr);
      }
      setProgress((prev) => (prev ? { ...prev, status: "Failed" } : null));
    } finally {
      setIsImporting(false);
    }
  };

  /** Import ALL non-summary sheets sequentially */
  const handleImportAllSheets = async () => {
    if (!file || !parsedData) return;

    const dataSheets = parsedData.sheets.filter((s) => s.sheetType !== "SUMMARY");
    if (dataSheets.length === 0) {
      toast.error("No data sheets to import.");
      return;
    }

    const fileHash = await computeFileHash(file);
    setValidationErrors([]);
    setIsImporting(true);
    setProgress(null);

    const overallTotal = dataSheets.reduce((sum, s) => sum + s.rowCount, 0);
    let overallProcessed = 0,
      overallSuccess = 0,
      overallErrors = 0;

    const targetTable =
      parsedData.fileType === "mutual_fund"
        ? "mutual_fund_payables"
        : parsedData.fileType === "debenture" || parsedData.fileType === "interest"
          ? "interest_payables"
          : "dividend_payables";

    // One shared client cache across all sheets so we don't re-insert clients
    const sharedContext: { companyId?: string; clientIdCache: Map<string, string> } = {
      clientIdCache: new Map(),
    };
    if (selectedCompanyId !== "auto") {
      sharedContext.companyId = selectedCompanyId;
    }

    for (let si = 0; si < dataSheets.length; si++) {
      const sheet = dataSheets[si];
      const sheetIdxInParsed = parsedData.sheets.indexOf(sheet);

      setAllSheetsProgress({
        currentSheet: sheet.sheetName,
        currentSheetIndex: si,
        totalSheets: dataSheets.length,
        sheetProgress: {
          totalRows: sheet.rowCount,
          processedRows: 0,
          successRows: 0,
          errorRows: 0,
          status: "Processing",
        },
        overallTotal,
        overallProcessed,
        overallSuccess,
        overallErrors,
        status: "Processing",
      });

      let uploadId: string = crypto.randomUUID();
      let userId: string | undefined;
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        userId = user?.id;
        const rec = await UploadService.createUploadRecord({
          file_name: file.name,
          file_size: file.size,
          file_type: parsedData.fileType,
          sheet_name: sheet.sheetName,
          target_table: targetTable,
          total_rows: sheet.rowCount,
          status: "Processing",
          file_hash: `${fileHash}-${sheet.sheetName}`,
          user_id: userId,
        });
        uploadId = rec.id;
      } catch {
        /* silent */
      }

      const sheetDivRate = sheetDividendRates[sheetIdxInParsed];
      const rate = sheetDivRate ? Number(sheetDivRate) : dividendRate ? Number(dividendRate) : undefined;
      const validationErrorsForSheet = await ValidationEngine.validateBatch(
        sheet.rows,
        sheet.mapping,
        `${fileHash}-${sheet.sheetName}`,
        parsedData.fileType,
        {
          isRawInputFile: sheet.isRawInputFile,
          isPreCalculated: sheet.isPreCalculated,
          dividendRate: rate
        }
      );
      const hardErrors = validationErrorsForSheet.filter(
        (e) => !SOFT_ERROR_TYPES.has(e.type),
      );

      // Log errors to upload_errors so the user can download them
      if (validationErrorsForSheet.length > 0) {
        const errorRowsToLog = validationErrorsForSheet.map((e) => ({
          upload_id: uploadId,
          row_number: e.row,
          field_name: e.field || "validation",
          error_type: e.type,
          error_message: e.message,
          raw_data: e.rawData,
        }));
        await UploadService.logUploadErrors(errorRowsToLog);
      }

      // Filter out rows with hard errors
      const invalidRowIndices = new Set(hardErrors.map((e) => e.row - 1));
      const validRows = sheet.rows.filter((_, idx) => !invalidRowIndices.has(idx));

      // Skip this sheet entirely if ALL rows failed validation
      if (validRows.length === 0 && sheet.rows.length > 0) {
        setValidationErrors(hardErrors);
        overallErrors += hardErrors.length;
        overallProcessed += sheet.rows.length;
        try {
          await UploadService.updateUploadStatus(uploadId, "Failed", {
            success_rows: 0,
            error_rows: hardErrors.length,
            error_message: `All rows failed validation: ${hardErrors.length} error(s) found.`,
          });
        } catch {}
        continue; // Move to the next sheet
      }

      const softErrorCount = validationErrorsForSheet.length - hardErrors.length;
      if (softErrorCount > 0) {
        toast.warning(`Sheet "${sheet.sheetName}": ${softErrorCount} recommended check(s) skipped.`);
      }

      const opts = buildOptions(sheetIdxInParsed);
      opts.fileHash = `${fileHash}-${sheet.sheetName}`;
      opts.userId = userId;

      try {
        const result = await ChunkProcessor.processInChunks(
          uploadId,
          validRows,
          targetTable,
          1000,
          (p) => {
            setAllSheetsProgress((prev) =>
              prev
                ? {
                    ...prev,
                    sheetProgress: p,
                    overallProcessed: overallProcessed + p.processedRows,
                    overallSuccess: overallSuccess + p.successRows,
                    overallErrors: overallErrors + p.errorRows,
                  }
                : null,
            );
          },
          opts,
        );

        if (result.successRows <= 0 && result.errorRows > 0) {
          throw new Error(`Sheet "${sheet.sheetName}" completed without inserting any rows.`);
        }
        overallProcessed += sheet.rowCount;
        overallSuccess += sheet.rowCount;
        toast.success(`Sheet "${sheet.sheetName}" imported (${sheet.rowCount} rows)`);
      } catch (err: any) {
        overallProcessed += sheet.rowCount;
        overallErrors += sheet.rowCount;
        toast.error(`Sheet "${sheet.sheetName}" failed: ${err?.message}`);
        // Mark the sheet's upload record as Failed so it doesn't stay stuck in "Processing"
        try {
          await UploadService.updateUploadStatus(uploadId, "Failed", {
            error_message: err?.message || "Unknown import error",
          });
        } catch (statusErr) {
          console.warn("Could not mark failed upload:", statusErr);
        }
      }
    }

    setAllSheetsProgress((prev) =>
      prev
        ? {
            ...prev,
            status: overallErrors === 0 ? "Completed" : "Failed",
            overallProcessed,
            overallSuccess,
            overallErrors,
          }
        : null,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["companies"] }),
      queryClient.invalidateQueries({ queryKey: ["clients"] }),
      queryClient.invalidateQueries({ queryKey: ["interest_payables"] }),
      queryClient.invalidateQueries({ queryKey: ["dividend_payables"] }),
      queryClient.invalidateQueries({ queryKey: ["mutual_fund_payables"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] }),
      queryClient.invalidateQueries({ queryKey: ["upload-history"] }),
    ]);
    setIsImporting(false);

    if (overallErrors === 0) {
      toast.success(
        `All ${dataSheets.length} sheets imported successfully (${overallSuccess.toLocaleString()} rows)!`,
      );
    } else {
      toast.warning(`Import completed with ${overallErrors} error rows.`);
    }
  };

  const reset = () => {
    setFile(null);
    setParsedData(null);
    setProgress(null);
    setAllSheetsProgress(null);
    setValidationErrors([]);
    setSelectedSheetIndex(0);
    setSheetTdsRates({});
    setSheetDividendRates({});
    setImportSummary(null);
  };

  const currentSheet = parsedData?.sheets[selectedSheetIndex];
  const dataSheets = parsedData?.sheets.filter((s) => s.sheetType !== "SUMMARY") || [];
  const isMutualFund = parsedData?.fileType === "mutual_fund";

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Upload Data"
        description="Import Excel files for Dividends, Debentures, and Mutual Funds. Reconciliation bank reports go to the Reconciliation section."
      />

      {!parsedData && !progress && !allSheetsProgress && (
        <>
          <DragDropZone onFileSelect={handleFileSelect} isLoading={isParsing} />

          {/* File Type Guide */}
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                What can I upload here?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Dividend Files
                  </div>
                  <p className="text-xs text-muted-foreground">
                    CDS dividend export Excel files. Multi-sheet files with PUBLIC, PROMOTER,
                    INSTITUTION sheets are fully supported.
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    → dividend_payables
                  </Badge>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Building2 className="h-3.5 w-3.5 text-blue-600" /> Debenture / Interest
                  </div>
                  <p className="text-xs text-muted-foreground">
                    RBB debenture, bond interest, or corporate debenture holder files with coupon
                    payment data.
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    → interest_payables
                  </Badge>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-purple-600" /> Mutual Fund
                  </div>
                  <p className="text-xs text-muted-foreground">
                    RMF / retirement fund dividend files with unit holder data and tax-exempt
                    investor rules.
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    → mutual_fund_payables
                  </Badge>
                </div>
              </div>
              <Separator className="my-3" />
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Bank RTS reconciliation reports</strong> (.xls batch files from the bank)
                  should be uploaded in the <strong>Reconciliation</strong> section, not here.
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {parsedData && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* File Header & Actions */}
          <div className="flex items-center justify-between bg-card p-4 border rounded-lg flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-semibold">{file?.name}</h3>
                <Badge variant="outline" className="capitalize font-mono">
                  {fileTypeLabelMap[parsedData.fileType] ?? parsedData.fileType}
                </Badge>
                {parsedData.detectedCompanyName && (
                  <Badge variant="secondary">{parsedData.detectedCompanyName}</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {parsedData.grandTotals.totalRows.toLocaleString()} total rows across{" "}
                {parsedData.sheets.length} sheet(s)
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {parsedData.sheets.length > 1 && (
                <Select
                  value={selectedSheetIndex.toString()}
                  onValueChange={(v) => setSelectedSheetIndex(parseInt(v))}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {parsedData.sheets.map((s, idx) =>
                      s.sheetType !== "SUMMARY" ? (
                        <SelectItem key={s.sheetName} value={idx.toString()}>
                          {s.sheetName} ({s.rowCount} rows)
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button variant="outline" onClick={handleValidate} disabled={isValidating}>
                {isValidating ? "Validating..." : "Validate Only"}
              </Button>
              <Button variant="outline" onClick={handleImport} disabled={isImporting}>
                <Upload className="mr-1.5 h-4 w-4" />
                {isImporting ? "Importing..." : `Import "${currentSheet?.sheetName}"`}
              </Button>
              {dataSheets.length > 1 && (
                <Button
                  onClick={handleImportAllSheets}
                  disabled={isImporting}
                  className="bg-primary"
                >
                  <Layers className="mr-1.5 h-4 w-4" />
                  {isImporting ? "Importing..." : `Import All ${dataSheets.length} Sheets`}
                </Button>
              )}
            </div>
          </div>

          {parsedData.fileType === "mutual_fund" && (
            <Card className="border-l-4 border-emerald-500 bg-emerald-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Mutual Fund Upload Section</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>
                  This file has been detected as a mutual fund / retirement fund upload. It will be
                  imported into a dedicated mutual fund payable table with tax-exempt investor rules
                  and institutional holder mapping.
                </p>
                <p>
                  The dedicated table keeps mutual fund entries separate from ordinary dividend
                  payables and makes reporting easier.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Company Assignment Override */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">Company Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Assign to Company</Label>
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-detect from file" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto-detect: {parsedData.detectedCompanyName || "from file name"}
                      </SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.company_code} — {c.company_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Select a company to assign this upload to, or use auto-detect.
                  </p>
                </div>
                <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-3">
                  <p className="font-medium text-foreground mb-1">Data Linking</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-xs">
                    <li>Clients created/matched by BOID — global across all companies</li>
                    <li>Payables linked to both the Client and Company</li>
                    <li>Dashboard, Reports &amp; Reconciliation auto-refresh on import</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {currentSheet?.isRawInputFile && (
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-md">
              <h4 className="font-medium text-blue-900 text-sm">Raw Data File Detected</h4>
              <p className="text-sm text-blue-800 mt-1">
                This sheet does not contain pre-calculated financial columns. Enter the rate below and the system will automatically calculate the gross, tax, and net payable amounts.
              </p>
            </div>
          )}

          {currentSheet?.isPreCalculated && (
            <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-md">
              <h4 className="font-medium text-emerald-900 text-sm">Pre-Calculated Values Detected</h4>
              <p className="text-sm text-emerald-800 mt-1">
                This sheet already contains calculated values. The system will verify them against the configured rates instead of overwriting them.
              </p>
            </div>
          )}

          {/* Fiscal Year & Dividend Metadata */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Fiscal Year &amp; {isMutualFund ? "Mutual Fund" : "Dividend"} Declaration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fiscal Year</Label>
                  <Input
                    placeholder="e.g. 2081/82"
                    value={fiscalYear}
                    inputMode="numeric"
                    className={
                      fiscalYear && !isValidFiscalYear(fiscalYear)
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                    onChange={(e) => {
                      const nextValue = e.target.value.replace(/[^0-9/]/g, "").slice(0, 9);
                      setFiscalYear(nextValue);
                    }}
                  />
                  {fiscalYear && !isValidFiscalYear(fiscalYear) && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Use format YYYY/YY (e.g. 2081/82)
                    </p>
                  )}
                  {fiscalYear && isValidFiscalYear(fiscalYear) && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Will be stored as{" "}
                      {normalizeFiscalYear(fiscalYear)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {isMutualFund ? "Fund Rate (%)" : "Dividend / Interest Rate (%)"}
                  </Label>
                  <Input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 5.631"
                    value={dividendRate}
                    onChange={(e) => setDividendRate(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to calculate gross if not in file
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {isMutualFund ? "Mutual Fund Category" : "Payable Type"}
                  </Label>
                  <Select value={dividendType} onValueChange={(v) => setDividendType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {parsedData?.fileType === "debenture" ? (
                        <SelectItem value="Debenture">Debenture Interest</SelectItem>
                      ) : (
                        <>
                          <SelectItem value="Cash">Cash Dividend</SelectItem>
                          <SelectItem value="Stock">Stock Dividend</SelectItem>
                          <SelectItem value="Bonus">Bonus Share</SelectItem>
                          <SelectItem value="Right">Right Share</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Active Sheet TDS Rate (%)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    placeholder="e.g. 5"
                    value={sheetTdsRates[selectedSheetIndex] ?? ""}
                    onChange={(e) => {
                      const val = Math.min(50, Math.max(0, Number(e.target.value)));
                      setSheetTdsRates((prev) => ({ ...prev, [selectedSheetIndex]: String(val) }));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-set by sheet type (max 50%); override if needed
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Active Sheet Div. Rate</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="e.g. 5.631"
                    value={sheetDividendRates[selectedSheetIndex] ?? ""}
                    onChange={(e) =>
                      setSheetDividendRates((prev) => ({
                        ...prev,
                        [selectedSheetIndex]: e.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">Overrides global rate</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Per-Sheet Rates Summary (only when multi-sheet file) */}
          {dataSheets.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Sheet-by-Sheet Rates Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {parsedData.sheets.map((sheet, idx) => {
                    const tdsRate = sheetTdsRates[idx] ?? "5";
                    const divRate = sheetDividendRates[idx] ?? "";
                    const isSummary = sheet.sheetType === "SUMMARY";
                    return (
                      <div
                        key={sheet.sheetName}
                        className={`space-y-2 p-3 border rounded-md ${isSummary ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium truncate" title={sheet.sheetName}>
                            {sheet.sheetName}
                          </span>
                          <Badge
                            variant={isSummary ? "secondary" : "outline"}
                            className="text-[10px] h-5"
                          >
                            {sheet.sheetType}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-muted-foreground mb-1 block">
                              TDS %
                            </Label>
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              max="50"
                              value={tdsRate}
                              disabled={isSummary}
                              onChange={(e) => {
                                const val = Math.min(50, Math.max(0, Number(e.target.value)));
                                setSheetTdsRates((prev) => ({ ...prev, [idx]: String(val) }));
                              }}
                              className="h-7 text-xs px-2"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground mb-1 block">
                              Div/Int %
                            </Label>
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={divRate}
                              placeholder={dividendRate || "Auto"}
                              disabled={isSummary}
                              onChange={(e) =>
                                setSheetDividendRates((prev) => ({
                                  ...prev,
                                  [idx]: e.target.value,
                                }))
                              }
                              className="h-7 text-xs px-2"
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {sheet.rowCount.toLocaleString()} rows
                        </p>
                      </div>
                    );
                  })}
                </div>
                <Alert className="mt-3">
                  <AlertDescription className="text-xs">
                    <strong>Smart TDS:</strong> Public/Promoter = 5% &bull; Institutions = 15%
                    &bull; Tax Exempt = 0% &bull; Debentures = 6%. <br />
                    <strong>Dividend/Interest Rate:</strong> Auto-detected from headers (like
                    "DIVIDEND 5.631"), falls back to the Global rate above, or you can override
                    per-sheet here. <br />
                    <strong>Reference sheets:</strong> any sheet detected as SUMMARY is shown only
                    for reference and is never validated or imported.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Current Sheet Metrics */}
          {currentSheet && (
            <Card className="bg-muted/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>
                    Active Sheet: <strong className="text-primary">{currentSheet.sheetName}</strong>
                  </span>
                  <div className="flex gap-2">
                    <Badge variant="secondary">Category: {currentSheet.sheetType}</Badge>
                    <Badge variant="outline" className="text-amber-600 border-amber-600">
                      TDS:{" "}
                      {sheetTdsRates[selectedSheetIndex] ??
                        Math.round(currentSheet.defaultTdsRate * 100)}
                      %
                    </Badge>
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      Rate:{" "}
                      {sheetDividendRates[selectedSheetIndex] ||
                        currentSheet.detectedDividendRate ||
                        dividendRate ||
                        "?"}
                      %
                    </Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Rows</p>
                  <p className="text-lg font-bold">{currentSheet.rowCount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Total Kitta</p>
                  <p className="text-lg font-bold">{currentSheet.totalKitta.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Gross Amount</p>
                  <p className="text-lg font-bold">
                    NPR{" "}
                    {currentSheet.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Net Amount</p>
                  <p className="text-lg font-bold text-primary">
                    NPR{" "}
                    {currentSheet.totalNet.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {validationErrors.length > 0 && <ValidationReport errors={validationErrors} />}
          <ImportPreview data={parsedData} selectedSheetIndex={selectedSheetIndex} />
        </div>
      )}

      {/* Post-import summary card */}
      {importSummary && !isImporting && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 p-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    Import Complete — "{importSummary.sheetName}"
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-500">
                    {importSummary.rows.toLocaleString()} rows imported in {importSummary.duration}s
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                className="border-emerald-300 dark:border-emerald-700"
              >
                Upload Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Single Sheet Progress */}
      {progress && !allSheetsProgress && (
        <div className="space-y-4 p-6 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold">
            Import Progress
            {parsedData?.sheets[selectedSheetIndex]?.sheetName && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                — {parsedData.sheets[selectedSheetIndex].sheetName}
              </span>
            )}
          </h3>
          <Progress value={(progress.processedRows / Math.max(progress.totalRows, 1)) * 100} />
          <div className="grid grid-cols-4 gap-4 text-center mt-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="font-medium">{progress.status}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Processed</p>
              <p className="font-medium">
                {progress.processedRows} / {progress.totalRows}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Success</p>
              <p className="font-medium text-green-600">{progress.successRows}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Errors</p>
              <p className="font-medium text-red-600">{progress.errorRows}</p>
            </div>
          </div>
          {progress.status !== "Processing" && (
            <div className="flex justify-end mt-4">
              <Button onClick={reset}>Upload Another File</Button>
            </div>
          )}
        </div>
      )}

      {/* All Sheets Progress */}
      {allSheetsProgress && (
        <div className="space-y-4 p-6 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Bulk Import Progress
            <Badge variant="outline">
              {allSheetsProgress.currentSheetIndex + 1} / {allSheetsProgress.totalSheets} sheets
            </Badge>
          </h3>

          <div>
            <div className="flex items-center justify-between mb-1 text-sm">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="font-medium">
                {allSheetsProgress.overallProcessed.toLocaleString()} /{" "}
                {allSheetsProgress.overallTotal.toLocaleString()} rows
              </span>
            </div>
            <Progress
              value={
                (allSheetsProgress.overallProcessed / Math.max(allSheetsProgress.overallTotal, 1)) *
                100
              }
              className="h-3"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1 text-sm">
              <span className="text-muted-foreground">
                Current Sheet: <strong>{allSheetsProgress.currentSheet}</strong>
              </span>
              <span>
                {allSheetsProgress.sheetProgress.processedRows} /{" "}
                {allSheetsProgress.sheetProgress.totalRows}
              </span>
            </div>
            <Progress
              value={
                (allSheetsProgress.sheetProgress.processedRows /
                  Math.max(allSheetsProgress.sheetProgress.totalRows, 1)) *
                100
              }
              className="h-2 bg-muted"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 text-center mt-2">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="font-medium">{allSheetsProgress.status}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Success Rows</p>
              <p className="font-medium text-green-600">
                {allSheetsProgress.overallSuccess.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Error Rows</p>
              <p className="font-medium text-red-600">
                {allSheetsProgress.overallErrors.toLocaleString()}
              </p>
            </div>
          </div>

          {allSheetsProgress.status !== "Processing" && (
            <div className="flex items-center justify-between mt-4">
              {allSheetsProgress.status === "Completed" ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">All sheets imported successfully!</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">
                    Completed with {allSheetsProgress.overallErrors} error rows.
                  </span>
                </div>
              )}
              <Button onClick={reset}>Upload Another File</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


