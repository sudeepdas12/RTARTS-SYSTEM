/**
 * Nepal Commercial Banks (Class 'A' BFIs) & Account Number Validator
 *
 * Implements standard routing and account validation rules for NCHL / ConnectIPS
 * and CBS interfaces across Nepali financial institutions.
 */

export interface NepaliBfiInfo {
  code: string;
  shortName: string;
  fullName: string;
  aliases?: string[];
  expectedAccountLengths: number[];
  isNumericOnly: boolean;
}

export const NEPAL_CLASS_A_BANKS: NepaliBfiInfo[] = [
  {
    code: "RBB",
    shortName: "RBB",
    fullName: "Rastriya Banijya Bank Limited",
    aliases: ["RASTRIYA BANIJYA BANK", "RASTRIYA BANIJYA", "RBBL"],
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "NABIL",
    shortName: "NABIL",
    fullName: "Nabil Bank Limited",
    expectedAccountLengths: [14],
    isNumericOnly: true,
  },
  {
    code: "NICA",
    shortName: "NIC ASIA",
    fullName: "NIC Asia Bank Limited",
    expectedAccountLengths: [14, 16],
    isNumericOnly: false, // Some corporate accounts have alphanumeric prefixes
  },
  {
    code: "GBIME",
    shortName: "GLOBAL IME",
    fullName: "Global IME Bank Limited",
    expectedAccountLengths: [14, 16],
    isNumericOnly: true,
  },
  {
    code: "NIMB",
    shortName: "NIMB",
    fullName: "Nepal Investment Mega Bank Limited",
    expectedAccountLengths: [14, 16],
    isNumericOnly: true,
  },
  {
    code: "SCB",
    shortName: "SCB",
    fullName: "Standard Chartered Bank Nepal Limited",
    expectedAccountLengths: [14],
    isNumericOnly: true,
  },
  {
    code: "HBL",
    shortName: "HIMALAYAN",
    fullName: "Himalayan Bank Limited",
    expectedAccountLengths: [14, 16],
    isNumericOnly: true,
  },
  {
    code: "SBI",
    shortName: "NEPAL SBI",
    fullName: "Nepal SBI Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "EBL",
    shortName: "EVEREST",
    fullName: "Everest Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "PRVU",
    shortName: "PRABHU",
    fullName: "Prabhu Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "LSL",
    shortName: "LAXMI SUNRISE",
    fullName: "Laxmi Sunrise Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "CZBIL",
    shortName: "CITIZENS",
    fullName: "Citizens Bank International Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "PCBL",
    shortName: "PRIME",
    fullName: "Prime Commercial Bank Limited",
    expectedAccountLengths: [14, 16],
    isNumericOnly: true,
  },
  {
    code: "NMB",
    shortName: "NMB",
    fullName: "NMB Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "SANIMA",
    shortName: "SANIMA",
    fullName: "Sanima Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "MBL",
    shortName: "MACHHAPUCHCHHRE",
    fullName: "Machhapuchchhre Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "KBL",
    shortName: "KUMARI",
    fullName: "Kumari Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "NBL",
    shortName: "NEPAL BANK",
    fullName: "Nepal Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
  {
    code: "ADBL",
    shortName: "ADBL",
    fullName: "Agricultural Development Bank Limited",
    expectedAccountLengths: [16],
    isNumericOnly: true,
  },
];

export interface BankValidationResult {
  isValid: boolean;
  warning?: string;
  matchedBank?: NepaliBfiInfo;
  sanitizedAccountNo: string;
}

/**
 * Validates a bank account number against known Nepali commercial bank rules.
 * Flags discrepancies before exporting ConnectIPS / NCHL payment files.
 */
export function validateNepaliBankAccount(
  bankName?: string | null,
  accountNo?: string | null,
): BankValidationResult {
  const sanitizedAcc = (accountNo || "").trim().replace(/\s+/g, "");

  if (!sanitizedAcc) {
    return {
      isValid: false,
      warning: "Account number is missing",
      sanitizedAccountNo: "",
    };
  }

  // Reject clearly invalid placeholder accounts
  if (/^(0+|1+|9+|x+|test|none|null|na)$/i.test(sanitizedAcc)) {
    return {
      isValid: false,
      warning: "Account number appears to be a placeholder or dummy value",
      sanitizedAccountNo: sanitizedAcc,
    };
  }

  // Match known bank by name, abbreviation, or alias
  const cleanBankName = (bankName || "").toUpperCase().trim();
  const matchedBank = NEPAL_CLASS_A_BANKS.find(
    (b) =>
      cleanBankName === b.code ||
      cleanBankName.includes(b.code) ||
      cleanBankName.includes(b.shortName) ||
      b.shortName.includes(cleanBankName) ||
      cleanBankName.includes(b.fullName.toUpperCase()) ||
      b.fullName.toUpperCase().includes(cleanBankName) ||
      (b.aliases &&
        b.aliases.some(
          (a) => cleanBankName.includes(a.toUpperCase()) || a.toUpperCase().includes(cleanBankName),
        )),
  );

  if (matchedBank) {
    // Check numeric constraint
    if (matchedBank.isNumericOnly && !/^\d+$/.test(sanitizedAcc)) {
      return {
        isValid: false,
        warning: `${matchedBank.fullName} accounts must contain only digits`,
        matchedBank,
        sanitizedAccountNo: sanitizedAcc,
      };
    }

    // Check account length
    if (!matchedBank.expectedAccountLengths.includes(sanitizedAcc.length)) {
      const expected = matchedBank.expectedAccountLengths.join(" or ");
      return {
        isValid: false,
        warning: `${matchedBank.fullName} accounts are typically ${expected} digits (found ${sanitizedAcc.length})`,
        matchedBank,
        sanitizedAccountNo: sanitizedAcc,
      };
    }
  }

  // Generic sanity check: Nepali bank accounts are generally between 10 and 24 characters
  if (sanitizedAcc.length < 9 || sanitizedAcc.length > 25) {
    return {
      isValid: false,
      warning: `Unusual account length (${sanitizedAcc.length} chars). Standard Nepali accounts are 12–20 chars.`,
      sanitizedAccountNo: sanitizedAcc,
    };
  }

  return {
    isValid: true,
    matchedBank,
    sanitizedAccountNo: sanitizedAcc,
  };
}
