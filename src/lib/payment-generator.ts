function numberToWords(num: number): string {
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertSection(n: number): string {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      str += ones[n] + ' ';
    }
    return str.trim();
  }

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const remainder = Math.floor(num);
  const paisa = Math.round((num - remainder) * 100);

  let result = '';
  if (crore > 0) result += convertSection(crore) + ' Crore ';
  if (lakh > 0) result += convertSection(lakh) + ' Lakh ';
  if (thousand > 0) result += convertSection(thousand) + ' Thousand ';
  if (remainder > 0) result += convertSection(remainder) + ' ';

  result = result.trim() + ' Rupees';
  if (paisa > 0) {
    result += ' and ' + convertSection(paisa) + ' Paisa';
  }
  return result + ' Only';
}

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
    fileContent += `S.N,Account_Name,Account_Number,Bank_Name,Amount,Remarks\n`;

    payments.forEach((p, index) => {
      const name = p.clients?.full_name || p.clients?.name || p.shareholderName || 'Unknown';
      const accountNo = p.bank_account_no || p.bankAccountNo || '';
      const bankName = p.bank_name || p.bankName || '';
      const amount = p.net_amount || p.netAmount || p.excelAmount || p.net_payable || 0;
      fileContent += `${index + 1},"${name.replace(/"/g, '""')}","${accountNo}","${bankName.replace(/"/g, '""')}",${Number(amount).toFixed(2)},RTARTS_Payment\n`;
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
      const payableType = (p.payable_type || 'dividend').toUpperCase();
      const pType = payableType.includes('INTEREST') ? 'INTEREST' : payableType.includes('MUTUAL') ? 'MUTUAL_FUND' : 'DIVIDEND';
      fileContent += `${index + 1},"${accountNo}","${name.replace(/"/g, '""')}",${Number(amount).toFixed(2)},${pType},RTARTS Payment\n`;
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
      const inWords = numberToWords(amount);
      fileContent += `${chequeNo},"${name.replace(/"/g, '""')}","${inWords}",${amount.toFixed(2)},"${bankName.replace(/"/g, '""')}","${accountNo}"\n`;
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
      fileContent += `${index + 1},"${name.replace(/"/g, '""')}",${Number(amount).toFixed(2)},CASH_DISBURSEMENT\n`;
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
    a.download = `payment_${method}_${batchName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  }
};