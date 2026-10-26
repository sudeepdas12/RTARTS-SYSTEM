export async function exportToExcel<T extends Record<string, unknown>>(
  rows: T[],
  filename: string,
  sheetName = "Sheet1",
) {
  if (!rows || rows.length === 0) return;
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-calculate column widths to prevent cramped columns
  const colWidths = Object.keys(rows[0] || {}).map((key) => {
    let maxLen = key.length;
    for (const row of rows) {
      const val = String((row as any)[key] ?? "");
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(Math.max(maxLen + 3, 10), 50) };
  });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function exportMultiSheetExcel(
  sheets: { name: string; rows: Record<string, unknown>[] }[],
  filename: string,
) {
  if (!sheets || sheets.length === 0) return;
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    if (!sheet.rows || sheet.rows.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(sheet.rows);

    const colWidths = Object.keys(sheet.rows[0] || {}).map((key) => {
      let maxLen = key.length;
      for (const row of sheet.rows) {
        const val = String((row as any)[key] ?? "");
        if (val.length > maxLen) maxLen = val.length;
      }
      return { wch: Math.min(Math.max(maxLen + 3, 10), 50) };
    });
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }

  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function importFromExcel<T = Record<string, unknown>>(file: File): Promise<T[]> {
  const buf = await file.arrayBuffer();
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: null });
}
