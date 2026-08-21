import { ExcelExporter } from '@/lib/excel-exporter';
import { PdfGenerator, PdfColumn } from '@/lib/pdf-generator';

export const ExportService = {
  /**
   * Exports data to Excel format.
   */
  async exportToExcel(data: any[], fileName: string, sheetName = 'Data'): Promise<void> {
    if (!data || data.length === 0) {
      console.warn('No data provided to exportToExcel');
      return;
    }
    ExcelExporter.exportToExcel(data, fileName, sheetName);
  },

  /**
   * Exports data to PDF format.
   */
  async exportToPDF(
    data: Record<string, unknown>[],
    fileName: string,
    title?: string
  ): Promise<void> {
    if (!data || data.length === 0) {
      console.warn('No data provided to exportToPDF');
      return;
    }

    const sample = data[0];
    const columns: PdfColumn[] = Object.keys(sample).map(key => ({
      header: key.replace(/_/g, ' ').toUpperCase(),
      dataKey: key,
    }));

    PdfGenerator.generate(
      {
        title: title || fileName.replace(/_/g, ' '),
        companyName: 'RTARTS System',
      },
      columns,
      data
    );
  }
};
