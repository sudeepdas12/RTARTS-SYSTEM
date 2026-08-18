export const PaymentGenerator = {
  /**
   * Generates a standard NEFT/RTGS txt or csv format string.
   * NEFT format: Date, Beneficiary Name, Account Number, Bank Name, Amount, Remarks
   */
  generateNEFT(payments: any[], batchName: string): string {
    const today = new Date().toISOString().split('T')[0];
    let fileContent = `BatchName: ${batchName}\n`;
    fileContent += `Date: ${today}\n`;
    fileContent += `Total_Payments: ${payments.length}\n`;
    // Changed Bank_Code to Bank_Name
    fileContent += `S.N,Account_Name,Account_Number,Bank_Name,Amount,Remarks\n`;

    payments.forEach((p, index) => {
      const name = p.clients?.full_name || p.clients?.name || p.shareholderName || 'Unknown';
      const accountNo = p.bank_account_no || p.bankAccountNo || '';
      const bankName = p.bank_name || p.bankName || '';
      const amount = p.net_amount || p.netAmount || p.excelAmount || p.net_payable || 0;
      fileContent += `${index + 1},${name},${accountNo},${bankName},${Number(amount).toFixed(2)},RTARTS_Payment\n`;
    });

    return fileContent;
  },

  /**
   * Generates ConnectIPS specific CSV format for bulk batch upload.
   * ConnectIPS format: batch header + beneficiary rows
   */
  generateConnectIPS(payments: any[], batchName: string): string {
    const today = new Date().toISOString().split('T')[0];
    let fileContent = `CONNECT_IPS_BATCH,${batchName},${today},${payments.length}\n`;
    fileContent += `BENEFICIARY_ID,ACCOUNT_NUMBER,BENEFICIARY_NAME,AMOUNT,PAYMENT_TYPE,NARRATION\n`;

    payments.forEach((p, index) => {
      const name = p.clients?.full_name || p.clients?.name || p.shareholderName || 'Unknown';
      const accountNo = p.bank_account_no || p.bankAccountNo || '';
      const amount = p.net_amount || p.netAmount || p.excelAmount || p.net_payable || 0;
      fileContent += `${index + 1},${accountNo},${name},${Number(amount).toFixed(2)},DIVIDEND,RTARTS Payment\n`;
    });

    return fileContent;
  },

  /**
   * Generates Cheque listing format - a payable listing for cheque printing.
   * Format: Cheque No, Date, Payee Name, Amount in Words, Amount, Bank, Account
   */
  generateCheque(payments: any[], batchName: string): string {
    const today = new Date().toISOString().split('T')[0];
    let fileContent = `CHEQUE_BATCH,${batchName},${today}\n`;
    fileContent += `CHEQUE_NO,PAYEE_NAME,AMOUNT_IN_WORDS,AMOUNT,BANK_NAME,ACCOUNT_NO\n`;

    payments.forEach((p, index) => {
      const name = p.clients?.full_name || p.clients?.name || p.shareholderName || 'Unknown';
      const accountNo = p.bank_account_no || p.bankAccountNo || '';
      const bankName = p.bank_name || p.bankName || '';
      const amount = Number(p.net_amount || p.netAmount || p.excelAmount || p.net_payable || 0);
      const chequeNo = `CHQ-${String(index + 1).padStart(6, '0')}`;
      // Output empty string for AMOUNT_IN_WORDS since we don't have a converter yet
      fileContent += `${chequeNo},${name},,${amount.toFixed(2)},${bankName},${accountNo}\n`;
    });

    return fileContent;
  },

  /**
   * Generates Cash payment listing format.
   */
  generateCash(payments: any[], batchName: string): string {
    const today = new Date().toISOString().split('T')[0];
    let fileContent = `BatchName: ${batchName}\n`;
    fileContent += `Date: ${today}\n`;
    fileContent += `Total_Payments: ${payments.length}\n`;
    fileContent += `S.N,Payee_Name,Amount,Remarks\n`;

    payments.forEach((p, index) => {
      const name = p.clients?.full_name || p.clients?.name || p.shareholderName || 'Unknown';
      const amount = p.net_amount || p.netAmount || p.excelAmount || p.net_payable || 0;
      fileContent += `${index + 1},${name},${Number(amount).toFixed(2)},CASH_DISBURSEMENT\n`;
    });

    return fileContent;
  },

  /**
   * Downloads the payment file as a blob.
   */
  downloadPaymentFile(content: string, method: string, batchName: string): void {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment_${method}_${batchName}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  }
};