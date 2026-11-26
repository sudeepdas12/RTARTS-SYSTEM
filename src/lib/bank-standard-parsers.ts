import type { BankTransaction, StatementMetadata } from "./bank-parser";

export type StandardBankFormat = "iso20022" | "mt940";

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");

const parseXmlAttrs = (rawAttrs: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const key = match[1].includes(":") ? match[1].split(":")[1] : match[1];
    attrs[key] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attrs;
};

/** Lightweight dependency-free XML parser safe in both browser and Node environments. */
const parseXmlDocument = (xmlText: string): XmlNode | null => {
  const cleaned = xmlText
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const cdataPlaceholders: string[] = [];
  const withPlaceholders = cleaned.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => {
    const idx = cdataPlaceholders.length;
    cdataPlaceholders.push(inner);
    return `__CDATA_PLACEHOLDER_${idx}__`;
  });

  const restoreText = (raw: string): string =>
    decodeXmlEntities(
      raw.replace(/__CDATA_PLACEHOLDER_(\d+)__/g, (_, i) => cdataPlaceholders[Number(i)] ?? ""),
    ).trim();

  const root: XmlNode = { name: "__root__", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tokenRegex = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(withPlaceholders)) !== null) {
    const [fullTag, isClosing, rawName, rawAttrs, selfClosing] = match;
    const precedingText = withPlaceholders.slice(lastIndex, match.index);
    if (precedingText.trim() && stack.length > 0) {
      stack[stack.length - 1].text += restoreText(precedingText);
    }
    lastIndex = match.index + fullTag.length;

    const localName = rawName.includes(":") ? rawName.split(":")[1] : rawName;
    if (isClosing === "/") {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].name === localName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: XmlNode = {
      name: localName,
      attrs: parseXmlAttrs(rawAttrs || ""),
      children: [],
      text: "",
    };
    stack[stack.length - 1].children.push(node);
    if (selfClosing !== "/") {
      stack.push(node);
    }
  }

  return root.children[0] ?? null;
};

const findAll = (node: XmlNode | null | undefined, targetName: string): XmlNode[] => {
  if (!node) return [];
  const results: XmlNode[] = [];
  const walk = (curr: XmlNode) => {
    for (const child of curr.children) {
      if (child.name === targetName) {
        results.push(child);
      }
      walk(child);
    }
  };
  walk(node);
  return results;
};

const findDirectChild = (
  node: XmlNode | null | undefined,
  targetName: string,
): XmlNode | undefined => node?.children.find((c) => c.name === targetName);

const findFirstDescendant = (
  node: XmlNode | null | undefined,
  targetName: string,
): XmlNode | undefined => {
  if (!node) return undefined;
  for (const child of node.children) {
    if (child.name === targetName) return child;
    const deep = findFirstDescendant(child, targetName);
    if (deep) return deep;
  }
  return undefined;
};

const getPathNode = (node: XmlNode | null | undefined, path: string[]): XmlNode | undefined => {
  let current: XmlNode | undefined = node ?? undefined;
  for (const seg of path) {
    current = findDirectChild(current, seg);
    if (!current) return undefined;
  }
  return current;
};

const getPathText = (node: XmlNode | null | undefined, path: string[]): string =>
  getPathNode(node, path)?.text?.trim() ?? "";

const normalizeIsoDate = (raw: string | undefined): string => {
  if (!raw) return "";
  const match = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const parseNumeric = (raw: string | undefined): number => {
  if (!raw) return 0;
  const normalized = raw.replace(/\s+/g, "").replace(/,/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const parseSwiftYyMmDd = (yymmdd: string): string => {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  return `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
};

const parseSwiftAmount = (raw: string): number => {
  const cleaned = raw.trim().replace(/\s+/g, "");
  // SWIFT MT940 uses comma as decimal separator (e.g., "12345,67" or "12345,")
  const normalized =
    cleaned.includes(",") && !cleaned.includes(".")
      ? cleaned.replace(/,$/, ".00").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const classifyStandardCategory = (
  isCredit: boolean,
  isReturnOrReject: boolean,
  codeOrDesc: string,
): BankTransaction["category"] => {
  const upper = codeOrDesc.toUpperCase();
  if (
    isReturnOrReject ||
    upper.includes("RTRN") ||
    upper.includes("RJCT") ||
    upper.includes("RETURN")
  ) {
    return "REJECT_RETURN";
  }
  if (
    upper.includes("CHRG") ||
    upper.includes("NCOM") ||
    upper.includes("NCHG") ||
    upper.includes("COMMISSION") ||
    upper.includes("FEE") ||
    upper.includes("CHARGE")
  ) {
    return "BANK_CHARGES";
  }
  if (isCredit) return "FUNDING_DEPOSIT";
  return "PAYOUT_DEBIT";
};

/** Detects whether text content belongs to ISO 20022 XML or SWIFT MT940. */
export function detectStandardBankFormat(
  text: string,
  fileName?: string,
): StandardBankFormat | null {
  const head = text.slice(0, 4000);
  if (
    /<(?:\w+:)?Document\b/i.test(head) ||
    /camt\.05[34]|pain\.002/i.test(head) ||
    /<(?:\w+:)?(?:BkToCstmrStmt|BkToCstmrDbtCdtNtfctn|CstmrPmtStsRpt)\b/i.test(head)
  ) {
    return "iso20022";
  }

  const hasMt940Tags =
    /:20:/.test(head) && (/:60[FM]:/.test(head) || /:61:/.test(head) || /:25:/.test(head));
  if (hasMt940Tags) {
    return "mt940";
  }

  if (fileName && /\.(mt940|sta|940)$/i.test(fileName) && /:6[012][FM]?:/.test(text)) {
    return "mt940";
  }

  return null;
}

const finalizeMetadata = (
  base: Partial<StatementMetadata>,
  transactions: BankTransaction[],
): StatementMetadata => {
  const totalDebit = transactions.reduce((s, t) => s + (t.debit || 0), 0);
  const totalCredit = transactions.reduce((s, t) => s + (t.credit || 0), 0);
  const opening = base.openingBalance;
  const closing = base.closingBalance;
  const calculatedClosingBalance =
    opening !== undefined ? Number((opening + totalCredit - totalDebit).toFixed(2)) : undefined;
  const balanceDifference =
    closing !== undefined && calculatedClosingBalance !== undefined
      ? Number(Math.abs(calculatedClosingBalance - closing).toFixed(2))
      : 0;
  return {
    ...base,
    totalDebit: Number(totalDebit.toFixed(2)),
    totalCredit: Number(totalCredit.toFixed(2)),
    calculatedClosingBalance,
    balanceDifference,
    isBalanced:
      closing !== undefined && calculatedClosingBalance !== undefined
        ? balanceDifference <= 0.05
        : true,
  };
};

/** Parses ISO 20022 XML bank statements (`camt.053`, `camt.054`, `pain.002`). */
export function parseIso20022Xml(
  xmlText: string,
  fileName: string,
): { transactions: BankTransaction[]; metadata: StatementMetadata } {
  const doc = parseXmlDocument(xmlText);
  if (!doc) {
    throw new Error(`Invalid ISO 20022 XML document: ${fileName}`);
  }

  const transactions: BankTransaction[] = [];
  const meta: Partial<StatementMetadata> = { currency: "NPR" };

  const painRoot = doc.name === "CstmrPmtStsRpt" ? doc : findFirstDescendant(doc, "CstmrPmtStsRpt");

  if (painRoot) {
    const grpInf = findFirstDescendant(painRoot, "OrgnlGrpInfAndSts");
    const grpMsgId = getPathText(grpInf, ["OrgnlMsgId"]) || undefined;
    const grpSts = getPathText(grpInf, ["GrpSts"]);
    const pmtInfBlocks = findAll(painRoot, "OrgnlPmtInfAndSts");

    let rowIdx = 0;
    for (const pmtInf of pmtInfBlocks) {
      const pmtInfId = getPathText(pmtInf, ["OrgnlPmtInfId"]) || grpMsgId;
      const txList = findAll(pmtInf, "TxInfAndSts");

      for (const tx of txList) {
        rowIdx += 1;
        const instrId =
          getPathText(tx, ["OrgnlInstrId"]) || getPathText(tx, ["StsId"]) || undefined;
        const endToEndId = getPathText(tx, ["OrgnlEndToEndId"]) || undefined;
        const txSts = getPathText(tx, ["TxSts"]) || grpSts || "ACSC";
        const rsnCd = getPathText(tx, ["StsRsnInf", "Rsn", "Cd"]);
        const addtlInf = getPathText(tx, ["StsRsnInf", "AddtlInf"]);

        const txRef = findDirectChild(tx, "OrgnlTxRef");
        const amtNode = findFirstDescendant(txRef, "InstdAmt") || findFirstDescendant(txRef, "Amt");
        const amount = parseNumeric(amtNode?.text);
        if (amtNode?.attrs?.Ccy) meta.currency = amtNode.attrs.Ccy;

        const execDate = normalizeIsoDate(
          getPathText(txRef, ["ReqdExctnDt", "Dt"]) ||
            getPathText(txRef, ["ReqdExctnDt", "DtTm"]) ||
            getPathText(txRef, ["ReqdExctnDt"]) ||
            getPathText(txRef, ["IntrBkSttlmDt"]),
        );
        const beneficiaryName =
          getPathText(txRef, ["Cdtr", "Nm"]) ||
          getPathText(txRef, ["UltmtCdtr", "Nm"]) ||
          undefined;
        const accountNo =
          getPathText(txRef, ["CdtrAcct", "Id", "Othr", "Id"]) ||
          getPathText(txRef, ["CdtrAcct", "Id", "IBAN"]) ||
          undefined;
        const bankName =
          getPathText(txRef, ["CdtrAgt", "FinInstnId", "Nm"]) ||
          getPathText(txRef, ["DbtrAgt", "FinInstnId", "Nm"]) ||
          undefined;
        if (!meta.bankName && bankName) meta.bankName = bankName;

        const ustrd = getPathText(txRef, ["RmtInf", "Ustrd"]);
        const isReject = txSts === "RJCT";
        const descParts = [ustrd, beneficiaryName, rsnCd && `Reason: ${rsnCd}`, addtlInf].filter(
          Boolean,
        );

        transactions.push({
          id: `iso-pain-${rowIdx}`,
          date: execDate,
          description:
            descParts.join(" | ") || `ISO 20022 pain.002 ${instrId || endToEndId || rowIdx}`,
          debit: amount,
          credit: 0,
          balance: 0,
          bankName,
          accountNo,
          beneficiaryName,
          status: txSts,
          referenceId: endToEndId || instrId,
          instructionId: instrId || endToEndId,
          batchId: pmtInfId,
          fileName,
          category: isReject ? "REJECT_RETURN" : "PAYOUT_DEBIT",
        });
      }
    }

    return {
      transactions,
      metadata: finalizeMetadata(meta, transactions),
    };
  }

  // camt.053 (Stmt) or camt.054 (Ntfctn)
  const containers = [...findAll(doc, "Stmt"), ...findAll(doc, "Ntfctn")];
  if (containers.length === 0) {
    throw new Error(
      `Unsupported ISO 20022 XML payload (no Stmt, Ntfctn, or CstmrPmtStsRpt): ${fileName}`,
    );
  }

  let runningBalance = 0;
  let hasOpeningBalance = false;
  let rowIdx = 0;

  for (const container of containers) {
    const acct = findDirectChild(container, "Acct");
    const acctNo =
      getPathText(acct, ["Id", "Othr", "Id"]) || getPathText(acct, ["Id", "IBAN"]) || undefined;
    const acctCcy = getPathText(acct, ["Ccy"]) || undefined;
    const acctHolder = getPathText(acct, ["Nm"]) || getPathText(acct, ["Ownr", "Nm"]) || undefined;
    const acctBank = getPathText(acct, ["Svcr", "FinInstnId", "Nm"]) || undefined;

    if (!meta.accountNo && acctNo) meta.accountNo = acctNo;
    if (!meta.accountHolder && acctHolder) meta.accountHolder = acctHolder;
    if (!meta.bankName && acctBank) meta.bankName = acctBank;
    if (acctCcy) meta.currency = acctCcy;

    const frToDt = findDirectChild(container, "FrToDt");
    if (frToDt) {
      const fromDt = normalizeIsoDate(getPathText(frToDt, ["FrDtTm"]));
      const toDt = normalizeIsoDate(getPathText(frToDt, ["ToDtTm"]));
      if (fromDt && !meta.fromDate) meta.fromDate = fromDt;
      if (toDt) meta.toDate = toDt;
    }

    for (const bal of findAll(container, "Bal")) {
      const cd = getPathText(bal, ["Tp", "CdOrPrtry", "Cd"]);
      const rawAmt = parseNumeric(getPathText(bal, ["Amt"]));
      const ind = getPathText(bal, ["CdtDbtInd"]);
      const signed = ind === "DBIT" ? -rawAmt : rawAmt;
      const balDate = normalizeIsoDate(
        getPathText(bal, ["Dt", "Dt"]) || getPathText(bal, ["Dt", "DtTm"]),
      );

      if ((cd === "OPBD" || cd === "PRCD") && !hasOpeningBalance) {
        meta.openingBalance = signed;
        runningBalance = signed;
        hasOpeningBalance = true;
        if (balDate && !meta.fromDate) meta.fromDate = balDate;
      } else if (cd === "CLBD" || cd === "CLAV") {
        meta.closingBalance = signed;
        if (balDate) meta.toDate = balDate;
      }
    }

    const entries = findAll(container, "Ntry");
    for (const ntry of entries) {
      const amtNode = findDirectChild(ntry, "Amt");
      const entryAmt = parseNumeric(amtNode?.text);
      if (amtNode?.attrs?.Ccy) meta.currency = amtNode.attrs.Ccy;
      const entryInd = getPathText(ntry, ["CdtDbtInd"]).toUpperCase();
      const entryDate = normalizeIsoDate(
        getPathText(ntry, ["BookgDt", "Dt"]) ||
          getPathText(ntry, ["BookgDt", "DtTm"]) ||
          getPathText(ntry, ["ValDt", "Dt"]) ||
          getPathText(ntry, ["ValDt", "DtTm"]),
      );
      const entrySts = getPathText(ntry, ["Sts", "Cd"]) || getPathText(ntry, ["Sts"]) || "BOOK";
      const entryRef =
        getPathText(ntry, ["NtryRef"]) || getPathText(ntry, ["AcctSvcrRef"]) || undefined;
      const subFmlyCd = getPathText(ntry, ["BkTxCd", "Domn", "Fmly", "SubFmlyCd"]);
      const entryAddtl = getPathText(ntry, ["AddtlNtryInf"]);

      const txDtlsList = findAll(ntry, "TxDtls");
      const txDtlsWithOwnAmount = txDtlsList.filter((t) => {
        const directAmt = getPathText(t, ["Amt"]);
        const nestedAmt = getPathText(t, ["AmtDtls", "TxAmt", "Amt"]);
        return parseNumeric(directAmt || nestedAmt) > 0;
      });

      const itemsToEmit =
        txDtlsWithOwnAmount.length > 0
          ? txDtlsWithOwnAmount.map((tx) => ({
              tx,
              amt: parseNumeric(
                getPathText(tx, ["Amt"]) || getPathText(tx, ["AmtDtls", "TxAmt", "Amt"]),
              ),
              ind: getPathText(tx, ["CdtDbtInd"]).toUpperCase() || entryInd,
            }))
          : [{ tx: txDtlsList[0], amt: entryAmt, ind: entryInd }];

      for (const item of itemsToEmit) {
        rowIdx += 1;
        const tx = item.tx;
        const isCredit = item.ind === "CRDT";
        const debit = isCredit ? 0 : item.amt;
        const credit = isCredit ? item.amt : 0;
        runningBalance = Number((runningBalance + credit - debit).toFixed(2));

        const instrId = tx ? getPathText(tx, ["Refs", "InstrId"]) : "";
        const endToEndId = tx ? getPathText(tx, ["Refs", "EndToEndId"]) : "";
        const txId = tx ? getPathText(tx, ["Refs", "TxId"]) : "";
        const pmtInfId = tx ? getPathText(tx, ["Refs", "PmtInfId"]) : "";
        const acctSvcrRef = tx ? getPathText(tx, ["Refs", "AcctSvcrRef"]) : "";

        const counterpartyName = tx
          ? isCredit
            ? getPathText(tx, ["RltdPties", "Dbtr", "Nm"]) ||
              getPathText(tx, ["RltdPties", "UltmtDbtr", "Nm"])
            : getPathText(tx, ["RltdPties", "Cdtr", "Nm"]) ||
              getPathText(tx, ["RltdPties", "UltmtCdtr", "Nm"])
          : "";
        const counterpartyAcct = tx
          ? isCredit
            ? getPathText(tx, ["RltdPties", "DbtrAcct", "Id", "Othr", "Id"]) ||
              getPathText(tx, ["RltdPties", "DbtrAcct", "Id", "IBAN"])
            : getPathText(tx, ["RltdPties", "CdtrAcct", "Id", "Othr", "Id"]) ||
              getPathText(tx, ["RltdPties", "CdtrAcct", "Id", "IBAN"])
          : "";
        const ustrd = tx
          ? findAll(tx, "Ustrd")
              .map((u) => u.text)
              .filter(Boolean)
              .join(" ")
          : "";
        const addtlTx = tx ? getPathText(tx, ["AddtlTxInf"]) : "";

        const combinedDesc = [ustrd, addtlTx, entryAddtl, counterpartyName]
          .filter(Boolean)
          .join(" | ");
        const category = classifyStandardCategory(
          isCredit,
          entrySts === "RJCT" || subFmlyCd === "RTRN",
          `${subFmlyCd} ${combinedDesc}`,
        );

        transactions.push({
          id: `iso-${rowIdx}`,
          date: entryDate,
          description:
            combinedDesc || `${item.ind} ${subFmlyCd || "Ntry"} ${entryRef || ""}`.trim(),
          debit,
          credit,
          balance: hasOpeningBalance ? runningBalance : 0,
          bankName: acctBank,
          accountNo: counterpartyAcct || acctNo,
          accountHolder: acctHolder,
          beneficiaryName: counterpartyName || undefined,
          status: entrySts === "BOOK" ? undefined : entrySts,
          instructionId: instrId || endToEndId || undefined,
          referenceId: txId || acctSvcrRef || endToEndId || entryRef || undefined,
          batchId: pmtInfId || undefined,
          fileName,
          category,
        });
      }
    }
  }

  return {
    transactions,
    metadata: finalizeMetadata(meta, transactions),
  };
}

interface ParsedMt86Info {
  beneficiaryName?: string;
  accountNo?: string;
  description: string;
}

const parseMt86Narrative = (raw86: string): ParsedMt86Info => {
  const cleaned = raw86.replace(/\s+/g, " ").trim();
  if (!cleaned) return { description: "" };

  // Structured MT940 :86: with ?NN subfields (SEPA/German/CBS conventions)
  if (/\?\d{2}/.test(cleaned)) {
    const parts: Record<string, string> = {};
    const regex = /\?(\d{2})([^?]*)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(cleaned)) !== null) {
      parts[m[1]] = m[2].trim();
    }
    const narrative = [parts["20"], parts["21"], parts["22"], parts["23"]]
      .filter(Boolean)
      .join(" ");
    const name = parts["32"] || parts["33"] || undefined;
    const acct = parts["31"] || undefined;
    return {
      beneficiaryName: name,
      accountNo: acct,
      description: [narrative, name, acct].filter(Boolean).join(" | ") || cleaned,
    };
  }

  // Slash-delimited /REMI/ /BENM/ /ORDP/ narrative
  const benmMatch = cleaned.match(/\/(?:BENM|ORDP|NAME)\/([^/]+)/i);
  const acctMatch = cleaned.match(/\/(?:ACCT|IBAN|AC)\/([A-Za-z0-9-]+)/i);
  const remiMatch = cleaned.match(/\/REMI\/([^/]+)/i);
  return {
    beneficiaryName: benmMatch?.[1]?.trim(),
    accountNo: acctMatch?.[1]?.trim(),
    description: remiMatch ? `${remiMatch[1].trim()} | ${cleaned}` : cleaned,
  };
};

/** Parses SWIFT MT940 (`:20:`, `:25:`, `:60F:`, `:61:`, `:86:`, `:62F:`) customer statements. */
export function parseSwiftMt940(
  mtText: string,
  fileName: string,
): { transactions: BankTransaction[]; metadata: StatementMetadata } {
  const lines = mtText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const blocks: Array<{ tag: string; value: string }> = [];

  for (const line of lines) {
    const trimmedEnd = line.replace(/\s+$/, "");
    if (trimmedEnd === "-}" || trimmedEnd === "-") {
      blocks.push({ tag: "END", value: "" });
      continue;
    }
    const tagMatch = trimmedEnd.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagMatch) {
      blocks.push({ tag: tagMatch[1], value: tagMatch[2] });
    } else if (blocks.length > 0 && blocks[blocks.length - 1].tag !== "END") {
      blocks[blocks.length - 1].value = `${blocks[blocks.length - 1].value}\n${trimmedEnd}`.trim();
    }
  }

  const transactions: BankTransaction[] = [];
  const meta: Partial<StatementMetadata> = { currency: "NPR" };
  let runningBalance = 0;
  let hasOpening = false;
  let currentAcct = "";

  for (let i = 0; i < blocks.length; i++) {
    const { tag, value } = blocks[i];

    if (tag === "25") {
      const acctVal = value.trim();
      currentAcct = acctVal.includes("/") ? acctVal.split("/").pop() || acctVal : acctVal;
      if (!meta.accountNo) meta.accountNo = currentAcct;
      continue;
    }

    if (tag === "60F" || tag === "60M") {
      const m = value.trim().match(/^([CD])(\d{6})([A-Z]{3})([\d.,]+)$/);
      if (m) {
        const sign = m[1] === "D" ? -1 : 1;
        const dt = parseSwiftYyMmDd(m[2]);
        const ccy = m[3];
        const amt = sign * parseSwiftAmount(m[4]);
        meta.currency = ccy;
        if (!hasOpening) {
          meta.openingBalance = amt;
          runningBalance = amt;
          hasOpening = true;
          if (dt) meta.fromDate = dt;
        }
      }
      continue;
    }

    if (tag === "62F" || tag === "62M") {
      const m = value.trim().match(/^([CD])(\d{6})([A-Z]{3})([\d.,]+)$/);
      if (m) {
        const sign = m[1] === "D" ? -1 : 1;
        const dt = parseSwiftYyMmDd(m[2]);
        const amt = sign * parseSwiftAmount(m[4]);
        meta.closingBalance = amt;
        if (dt) meta.toDate = dt;
      }
      continue;
    }

    if (tag === "61") {
      const firstLine = value.split("\n")[0].trim();
      const extraLines = value.split("\n").slice(1).join(" ").trim();
      // :61: YYMMDD[MMDD](RC|RD|C|D)[FundsCode]Amount[Nxxx]CustomerRef[//BankRef]
      const m = firstLine.match(
        /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d.,]+)(N[A-Z0-9]{3})([^/\n]+)?(?:\/\/([^\n]+))?$/i,
      );
      if (!m) continue;

      const valueDate = parseSwiftYyMmDd(m[1]);
      const dcMark = m[3].toUpperCase();
      const amount = parseSwiftAmount(m[5]);
      const swiftCode = m[6].toUpperCase();
      const custRef = (m[7] || "").trim();
      const bankRef = (m[8] || "").trim();

      let raw86 = extraLines;
      if (i + 1 < blocks.length && blocks[i + 1].tag === "86") {
        raw86 = [extraLines, blocks[i + 1].value].filter(Boolean).join(" ");
        i += 1;
      }
      const info86 = parseMt86Narrative(raw86);

      const isCredit = dcMark === "C" || dcMark === "RD";
      const debit = isCredit ? 0 : amount;
      const credit = isCredit ? amount : 0;
      runningBalance = Number((runningBalance + credit - debit).toFixed(2));

      const isReturn = dcMark === "RD" || dcMark === "RC";
      const category = classifyStandardCategory(
        isCredit,
        isReturn,
        `${swiftCode} ${info86.description}`,
      );

      transactions.push({
        id: `mt940-${transactions.length + 1}`,
        date: valueDate,
        description: info86.description || `${dcMark} ${swiftCode} ${custRef}`.trim(),
        debit,
        credit,
        balance: hasOpening ? runningBalance : 0,
        accountNo: info86.accountNo || currentAcct || undefined,
        beneficiaryName: info86.beneficiaryName,
        instructionId: custRef && custRef.toUpperCase() !== "NONREF" ? custRef : undefined,
        referenceId:
          bankRef || (custRef && custRef.toUpperCase() !== "NONREF" ? custRef : undefined),
        status: isReturn ? "RJCT" : undefined,
        fileName,
        category,
      });
    }
  }

  if (transactions.length === 0 && !hasOpening) {
    throw new Error(`No valid SWIFT MT940 entries found in file: ${fileName}`);
  }

  return {
    transactions,
    metadata: finalizeMetadata(meta, transactions),
  };
}
