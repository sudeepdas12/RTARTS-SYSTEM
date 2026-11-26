import { describe, expect, it } from "vitest";
import { BankParser, classifyReconciliationFile } from "./bank-parser";
import {
  detectStandardBankFormat,
  parseIso20022Xml,
  parseSwiftMt940,
} from "./bank-standard-parsers";
import { ReconciliationEngine } from "./reconciliation-engine";

const CAMT053_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-2026-11-01</Id>
      <FrToDt>
        <FrDtTm>2026-11-01T00:00:00</FrDtTm>
        <ToDtTm>2026-11-01T23:59:59</ToDtTm>
      </FrToDt>
      <Acct>
        <Id><Othr><Id>0420101000412</Id></Othr></Id>
        <Ccy>NPR</Ccy>
        <Nm>RBB Dividend Pool A/C</Nm>
        <Svcr><FinInstnId><Nm>Rastriya Banijya Bank</Nm></FinInstnId></Svcr>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="NPR">100000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-01</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="NPR">144950.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-01</Dt></Dt>
      </Bal>
      <Ntry>
        <NtryRef>NTRY-1</NtryRef>
        <Amt Ccy="NPR">50000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-11-01</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><InstrId>FUND-2026-01</InstrId></Refs>
            <RltdPties><Dbtr><Nm>Issuer Funding Transfer</Nm></Dbtr></RltdPties>
            <RmtInf><Ustrd>Dividend Pool Prefund</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>NTRY-2</NtryRef>
        <Amt Ccy="NPR">5000.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-11-01</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><InstrId>IPS-99102</InstrId><EndToEndId>E2E-99102</EndToEndId></Refs>
            <RltdPties>
              <Cdtr><Nm>Sita Sharma</Nm></Cdtr>
              <CdtrAcct><Id><Othr><Id>0110099887766</Id></Othr></Id></CdtrAcct>
            </RltdPties>
            <RmtInf><Ustrd>FY 2082/83 Dividend Payout</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>NTRY-3</NtryRef>
        <Amt Ccy="NPR">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-11-01</Dt></BookgDt>
        <BkTxCd><Domn><Fmly><SubFmlyCd>CHRG</SubFmlyCd></Fmly></Domn></BkTxCd>
        <AddtlNtryInf>NCHL ConnectIPS Batch Processing Charge</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const PAIN002_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">
  <CstmrPmtStsRpt>
    <OrgnlGrpInfAndSts>
      <OrgnlMsgId>BATCH-IPS-2026-11</OrgnlMsgId>
      <GrpSts>PART</GrpSts>
    </OrgnlGrpInfAndSts>
    <OrgnlPmtInfAndSts>
      <OrgnlPmtInfId>BATCH-IPS-2026-11</OrgnlPmtInfId>
      <TxInfAndSts>
        <OrgnlInstrId>INS-OK-1</OrgnlInstrId>
        <OrgnlEndToEndId>REF-OK-1</OrgnlEndToEndId>
        <TxSts>ACSC</TxSts>
        <OrgnlTxRef>
          <Amt><InstdAmt Ccy="NPR">2400.00</InstdAmt></Amt>
          <ReqdExctnDt><Dt>2026-11-02</Dt></ReqdExctnDt>
          <Cdtr><Nm>Hari Adhikari</Nm></Cdtr>
          <CdtrAcct><Id><Othr><Id>0220011223344</Id></Othr></Id></CdtrAcct>
        </OrgnlTxRef>
      </TxInfAndSts>
      <TxInfAndSts>
        <OrgnlInstrId>INS-BAD-2</OrgnlInstrId>
        <OrgnlEndToEndId>REF-BAD-2</OrgnlEndToEndId>
        <TxSts>RJCT</TxSts>
        <StsRsnInf><Rsn><Cd>AC04</Cd></Rsn><AddtlInf>Closed account</AddtlInf></StsRsnInf>
        <OrgnlTxRef>
          <Amt><InstdAmt Ccy="NPR">1500.00</InstdAmt></Amt>
          <ReqdExctnDt><Dt>2026-11-02</Dt></ReqdExctnDt>
          <Cdtr><Nm>Gita Karki</Nm></Cdtr>
          <CdtrAcct><Id><Othr><Id>999888777</Id></Othr></Id></CdtrAcct>
        </OrgnlTxRef>
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;

const MT940_SAMPLE = `:20:STMT20261105
:25:RBB/0420101000412
:28C:00123/001
:60F:C261101NPR50000,00
:61:2611011101C25000,00NTRFFUND-01//CBS88101
:86:/REMI/Pool Top-Up Deposit/ORDP/RBB Capital
:61:2611011101D4750,00NTRFIPS-4401//BANKREF4401
:86:?20Dividend FY82/83?310110099887766?32Ram Bahadur Thapa
:61:2611011101D25,00NCOMCHG-01//FEE9901
:86:Bank RTGS Commission Charge
:62F:C261101NPR70225,00
-}`;

describe("Standard Bank Formats (ISO 20022 XML & SWIFT MT940)", () => {
  it("detects ISO 20022 XML and SWIFT MT940 deterministically", () => {
    expect(detectStandardBankFormat(CAMT053_SAMPLE, "stmt.xml")).toBe("iso20022");
    expect(detectStandardBankFormat(PAIN002_SAMPLE, "status.xml")).toBe("iso20022");
    expect(detectStandardBankFormat(MT940_SAMPLE, "stmt.mt940")).toBe("mt940");
  });

  it("parses ISO 20022 camt.053 with opening/closing balances, payouts, and bank charges", () => {
    const { transactions, metadata } = parseIso20022Xml(CAMT053_SAMPLE, "rbb_camt053.xml");
    expect(transactions).toHaveLength(3);

    expect(metadata.accountNo).toBe("0420101000412");
    expect(metadata.bankName).toBe("Rastriya Banijya Bank");
    expect(metadata.openingBalance).toBe(100000);
    expect(metadata.closingBalance).toBe(144950);
    expect(metadata.isBalanced).toBe(true);

    expect(transactions[0].credit).toBe(50000);
    expect(transactions[0].category).toBe("FUNDING_DEPOSIT");

    expect(transactions[1].debit).toBe(5000);
    expect(transactions[1].instructionId).toBe("IPS-99102");
    expect(transactions[1].beneficiaryName).toBe("Sita Sharma");
    expect(transactions[1].accountNo).toBe("0110099887766");
    expect(transactions[1].category).toBe("PAYOUT_DEBIT");

    expect(transactions[2].debit).toBe(50);
    expect(transactions[2].category).toBe("BANK_CHARGES");
  });

  it("parses ISO 20022 pain.002 status report with ACSC and RJCT codes", () => {
    const { transactions } = parseIso20022Xml(PAIN002_SAMPLE, "connectips_pain002.xml");
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      status: "ACSC",
      debit: 2400,
      instructionId: "INS-OK-1",
      batchId: "BATCH-IPS-2026-11",
      category: "PAYOUT_DEBIT",
    });
    expect(transactions[1]).toMatchObject({
      status: "RJCT",
      debit: 1500,
      instructionId: "INS-BAD-2",
      category: "REJECT_RETURN",
    });
    expect(transactions[1].description).toContain("AC04");
  });

  it("parses SWIFT MT940 statements and reconciles running balance", () => {
    const { transactions, metadata } = parseSwiftMt940(MT940_SAMPLE, "rbb_20261101.mt940");
    expect(transactions).toHaveLength(3);
    expect(metadata.accountNo).toBe("0420101000412");
    expect(metadata.currency).toBe("NPR");
    expect(metadata.openingBalance).toBe(50000);
    expect(metadata.closingBalance).toBe(70225);
    expect(metadata.isBalanced).toBe(true);

    expect(transactions[0]).toMatchObject({
      date: "2026-11-01",
      credit: 25000,
      debit: 0,
      instructionId: "FUND-01",
      referenceId: "CBS88101",
      category: "FUNDING_DEPOSIT",
    });

    expect(transactions[1]).toMatchObject({
      debit: 4750,
      accountNo: "0110099887766",
      beneficiaryName: "Ram Bahadur Thapa",
      instructionId: "IPS-4401",
      referenceId: "BANKREF4401",
      category: "PAYOUT_DEBIT",
    });

    expect(transactions[2]).toMatchObject({
      debit: 25,
      category: "BANK_CHARGES",
    });
  });

  it("integrates with BankParser & classifyReconciliationFile", async () => {
    const xmlFile = new File([CAMT053_SAMPLE], "statement_camt053.xml", { type: "text/xml" });
    const mtFile = new File([MT940_SAMPLE], "statement.mt940", { type: "text/plain" });

    expect(await classifyReconciliationFile(xmlFile)).toBe("bank_statement");
    expect(await classifyReconciliationFile(mtFile)).toBe("bank_statement");

    const parsedXml = await BankParser.parseBankStatementWithMetadata(xmlFile);
    expect(parsedXml.transactions).toHaveLength(3);
    expect(parsedXml.metadata.isBalanced).toBe(true);

    const parsedMt = await BankParser.parseBankStatementWithMetadata(mtFile);
    expect(parsedMt.transactions).toHaveLength(3);
    expect(parsedMt.metadata.isBalanced).toBe(true);
  });
});

describe("1↔N Consolidated Batch Matching in ReconciliationEngine", () => {
  it("expands a lump-sum bank batch debit into child payment/payable matches when enabled", async () => {
    const mockDb = {
      from(table: string) {
        const filters: Record<string, any> = {};
        const builder: any = {
          select() {
            return builder;
          },
          eq(col: string, val: any) {
            filters[col] = val;
            return builder;
          },
          in() {
            return builder;
          },
          or() {
            return builder;
          },
          order() {
            return builder;
          },
          range(from: number) {
            filters._from = from;
            return builder;
          },
          then(resolve: any) {
            if (filters._from > 0) {
              return resolve({ data: [], error: null });
            }
            if (table === "payments") {
              return resolve({
                data: [
                  {
                    id: "pay-1",
                    company_id: "comp-1",
                    client_id: "cli-1",
                    batch_id: "batch-1",
                    payable_type: "dividend",
                    payable_id: "div-1",
                    net_amount: 1200,
                    paid_amount: 1200,
                    status: "Processing",
                    payment_reference: "REF-1",
                    connectips_ref: "INS-1",
                    clients: { id: "cli-1", boid: "1301010000000001", full_name: "Alice" },
                  },
                  {
                    id: "pay-2",
                    company_id: "comp-1",
                    client_id: "cli-2",
                    batch_id: "batch-1",
                    payable_type: "dividend",
                    payable_id: "div-2",
                    net_amount: 1800,
                    paid_amount: 1800,
                    status: "Processing",
                    payment_reference: "REF-2",
                    connectips_ref: "INS-2",
                    clients: { id: "cli-2", boid: "1301010000000002", full_name: "Bob" },
                  },
                ],
                error: null,
              });
            }
            if (table === "dividend_payables") {
              return resolve({
                data: [
                  {
                    id: "div-1",
                    company_id: "comp-1",
                    client_id: "cli-1",
                    net_payable: 1200,
                    payment_status: "Pending",
                    fiscal_year: "2082/83",
                    clients: { id: "cli-1", boid: "1301010000000001", full_name: "Alice" },
                  },
                  {
                    id: "div-2",
                    company_id: "comp-1",
                    client_id: "cli-2",
                    net_payable: 1800,
                    payment_status: "Pending",
                    fiscal_year: "2082/83",
                    clients: { id: "cli-2", boid: "1301010000000002", full_name: "Bob" },
                  },
                ],
                error: null,
              });
            }
            if (table === "payment_batches") {
              return resolve({
                data: [
                  {
                    id: "batch-1",
                    company_id: "comp-1",
                    batch_name: "DIV-BATCH-OCT",
                    total_amount: 3000,
                    total_payments: 2,
                    payable_type: "dividend",
                    status: "Processing",
                    cds_batch_ref: "CDS-990",
                  },
                ],
                error: null,
              });
            }
            return resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };

    const expandedReport = await ReconciliationEngine.analyzeBankStatement(
      [
        {
          id: "stmt-batch-1",
          date: "2026-11-05",
          description: "IPS DR BATCH DIV-BATCH-OCT",
          debit: 3000,
          credit: 0,
          balance: 10000,
          batchId: "CDS-990",
          category: "PAYOUT_DEBIT",
        },
      ],
      {
        companyIds: ["comp-1"],
        client: mockDb,
        expandConsolidatedBatches: true,
      },
    );

    expect(expandedReport.matches).toHaveLength(2);
    expect(expandedReport.matches.map((m) => m.matchMethod)).toEqual([
      "batch_consolidation",
      "batch_consolidation",
    ]);
    expect(expandedReport.matches.map((m) => m.payableId)).toEqual(["div-1", "div-2"]);
    expect(expandedReport.matches.map((m) => m.paymentId)).toEqual(["pay-1", "pay-2"]);
    expect(expandedReport.grandTotal.matchedRecords).toBe(2);
  });
});
