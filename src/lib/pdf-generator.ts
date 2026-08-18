import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfReportOptions {
  title: string;
  subtitle?: string;
  companyName?: string;
  companyAddress?: string;
  watermark?: 'DRAFT' | 'CONFIDENTIAL' | 'FINAL' | null;
  generatedBy?: string;
}

export interface PdfColumn {
  header: string;
  dataKey: string;
  width?: number;
}

export const PdfGenerator = {
  /**
   * Generates a professional PDF report with header, footer, watermark, and data table.
   */
  generate(
    options: PdfReportOptions,
    columns: PdfColumn[],
    data: Record<string, unknown>[]
  ): void {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const now = new Date();

    // ── Header ──────────────────────────────────────────────
    doc.setFillColor(15, 23, 42); // dark navy
    doc.rect(0, 0, pageWidth, 22, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(options.companyName || 'RTARTS System', 14, 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(options.companyAddress || '', 14, 16);

    // Title on right
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(options.title, pageWidth - 14, 10, { align: 'right' });

    if (options.subtitle) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(options.subtitle, pageWidth - 14, 16, { align: 'right' });
    }

    doc.setTextColor(0, 0, 0);

    // ── Generation info ──────────────────────────────────────
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(
      `Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}  |  By: ${options.generatedBy || 'System'}  |  Records: ${data.length}`,
      14, 28
    );
    doc.setTextColor(0, 0, 0);

    // ── Data Table ───────────────────────────────────────────
    autoTable(doc, {
      startY: 32,
      columns: columns.map(c => ({ header: c.header, dataKey: c.dataKey })),
      body: data.map((row) => columns.map((column) => String(row[column.dataKey] ?? ''))),
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [30, 64, 175], // blue-700
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [241, 245, 249], // slate-100
      },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        const currentPage = hookData.pageNumber;

        // ── Watermark ────────────────────────────────────────
        if (options.watermark) {
          doc.saveGraphicsState();
          doc.setGState(new (doc as any).GState({ opacity: 0.07 }));
          doc.setFontSize(60);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(options.watermark, pageWidth / 2, pageHeight / 2, {
            align: 'center',
            angle: 45,
          });
          doc.restoreGraphicsState();
        }

        // ── Footer ───────────────────────────────────────────
        doc.setFillColor(241, 245, 249);
        doc.rect(0, pageHeight - 10, pageWidth, 10, 'F');
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        doc.text('RTARTS — Registrar to Shares & Transfer Agent System', 14, pageHeight - 4);
        doc.text(`Page ${currentPage} of ${pageCount}`, pageWidth - 14, pageHeight - 4, { align: 'right' });
      },
    });

    // ── Save / Download ──────────────────────────────────────
    const safeTitle = options.title.replace(/\s+/g, '_').toLowerCase();
    doc.save(`${safeTitle}_${now.toISOString().split('T')[0]}.pdf`);
  },
};
