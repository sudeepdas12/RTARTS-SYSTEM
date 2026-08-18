import * as XLSX from 'xlsx';

export const ExcelExporter = {
  /**
   * Exports data to a formatted Excel file.
   */
  exportToExcel(data: any[], fileName: string, sheetName = 'Data') {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    
    // Write and trigger download
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  }
};
