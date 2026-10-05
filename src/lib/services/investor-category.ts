/**
 * Investor category mapping (pure, side-effect free, fully unit-testable).
 *
 * The import engine (see `detectInvestorCategory`) can tell exactly what kind
 * of investor a row is — Natural Person, Legal Person / Company, Mutual Fund,
 * Tax Exempt or Foreign. Previously `mapToHolderType()` collapsed Mutual Funds,
 * Foreign investors and Legal Persons into a single "Institution" bucket,
 * which is stored in `clients.holder_type`. That loss of granularity is exactly
 * why a demographics report could not distinguish a Mutual Fund from a Legal
 * Person (especially for cash dividends & stock, where the TDS rate is identical
 * for both).
 *
 * This module restores the granularity:
 *  - `mapToHolderType()`           : raw detected category -> granular DB value
 *  - `getInvestorDemographicGroup()`: any stored holder_type -> report bucket
 *
 * Backward compatibility: the legacy enum values ('Public','Promoter',
 * 'Institution') are retained by the database migration, and
 * `getInvestorDemographicGroup()` maps them to their best-granular bucket so
 * older data still reports correctly.
 */

/** Granular values persisted in `clients.holder_type` (plus legacy values). */
export type HolderTypeValue =
  | "Natural Person - Public"
  | "Natural Person - Promoter"
  | "Natural Person - Local"
  | "Natural Person - Employee"
  | "Natural Person - Minor"
  | "Natural Person - Joint Holder"
  | "Legal Person"
  | "Legal Person - Promoter"
  | "Mutual Fund"
  | "Foreign"
  | "Tax Exempt"
  | "Public"
  | "Promoter"
  | "Local"
  | "Employee"
  | "Institution";

/** Coarse demographic bucket shown to the user in the report. */
export type DemographicGroup =
  "Natural Person" | "Legal Person" | "Mutual Fund" | "Tax Exempt" | "Foreign" | "Unknown";

/**
 * Map the raw detected investor category (the UPPER-CASE string returned by
 * `detectInvestorCategory`) to the granular `holder_type` value that is
 * persisted in the database.
 */
export function mapToHolderType(category: string): HolderTypeValue | null {
  const norm = String(category || "")
    .toUpperCase()
    .trim();
  switch (norm) {
    case "PROMOTER":
      return "Natural Person - Promoter";
    case "PUBLIC":
    case "INDIVIDUAL":
    case "NATURAL PERSON":
    case "NATURAL PERSON - PUBLIC":
      return "Natural Person - Public";
    case "LOCAL":
    case "NATURAL PERSON - LOCAL":
      return "Natural Person - Local";
    case "EMPLOYEE":
    case "STAFF":
    case "NATURAL PERSON - EMPLOYEE":
      return "Natural Person - Employee";
    case "INSTITUTION":
    case "COMPANY_INSTITUTION":
    case "CORPORATE":
    case "COMPANY":
    case "LEGAL PERSON":
    case "LEGAL PERSON - PROMOTER":
      return "Legal Person";
    case "MUTUAL_FUND":
    case "MUTUAL FUND":
      return "Mutual Fund";
    case "TAX_EXEMPT":
    case "TAX EXEMPT":
      return "Tax Exempt";
    case "FOREIGN":
      return "Foreign";
    default:
      return null;
  }
}

/**
 * Map any stored `holder_type` value (granular OR legacy) to a coarse
 * demographic group for reporting.
 */
export function getInvestorDemographicGroup(
  holderType: HolderTypeValue | string | null | undefined,
): DemographicGroup {
  if (!holderType) return "Unknown";
  const val = String(holderType).trim();

  switch (val) {
    case "Natural Person - Public":
    case "Natural Person - Promoter":
    case "Natural Person - Local":
    case "Natural Person - Employee":
    case "Natural Person - Minor":
    case "Natural Person - Joint Holder":
    case "Public":
    case "Promoter":
    case "Local":
    case "Employee":
      return "Natural Person";
    case "Legal Person":
    case "Legal Person - Promoter":
    case "Institution":
      return "Legal Person";
    case "Mutual Fund":
      return "Mutual Fund";
    case "Tax Exempt":
      return "Tax Exempt";
    case "Foreign":
      return "Foreign";
    default:
      if (val.startsWith("Natural Person")) return "Natural Person";
      if (val.startsWith("Legal Person")) return "Legal Person";
      return "Unknown";
  }
}

/** Human-friendly label used in the report summary / table columns. */
export function demographicGroupLabel(group: DemographicGroup): string {
  switch (group) {
    case "Natural Person":
      return "Natural Person";
    case "Legal Person":
      return "Legal Person / Company";
    case "Mutual Fund":
      return "Mutual Fund";
    case "Tax Exempt":
      return "Tax Exempt";
    case "Foreign":
      return "Foreign";
    default:
      return "Unknown";
  }
}
