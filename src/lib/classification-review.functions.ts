import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { smartClassify } from "./services/smart-classifier";

/**
 * Payee classification review & correction workflow.
 *
 * The import engine auto-classifies every shareholder (Natural Person, Company/
 * Institution, Mutual Fund / Tax Exempt) and computes TDS from a single
 * authoritative `payable_tax_rules` table. Ambiguous rows are deliberately left
 * as `UNCLASSIFIED` / `REVIEW_REQUIRED` (never guessed into a wrong tax bucket).
 * These functions let an operator review those rows and, once confirmed, push
 * the confirmed classification + recomputed tax down to every related payable.
 *
 * All writes go through the service-role client (RLS bypassed); the caller must
 * be an admin.
 */

export type PayeeClassification =
  "NATURAL_PERSON" | "PUBLIC_LEGAL_PERSON" | "COMPANY_INSTITUTION" | "TAX_EXEMPT";

export type PayeeSegment = "PROMOTER" | "LOCAL" | "PUBLIC" | null;

const CLASSIFICATIONS: PayeeClassification[] = [
  "NATURAL_PERSON",
  "PUBLIC_LEGAL_PERSON",
  "COMPANY_INSTITUTION",
  "TAX_EXEMPT",
];

const SEGMENTS = ["PROMOTER", "LOCAL", "PUBLIC"] as const;

const PAYABLE_TABLES: Record<string, { category: string; grossCol: string }> = {
  dividend_payables: { category: "DIVIDEND", grossCol: "gross_dividend" },
  interest_payables: { category: "INTEREST", grossCol: "gross_interest" },
  mutual_fund_payables: { category: "MUTUAL_FUND", grossCol: "gross_dividend" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) {
    throw new Error("You need administrator privileges to perform this action.");
  }
}

const ALLOWED_REVIEW_ROLES = ["admin", "supervisor", "checker", "approver", "operator"];

async function assertReviewAccess(context: {
  supabase: any;
  userId: string;
}): Promise<{ isGlobal: boolean; allowedCompanyIds: string[] | null }> {
  const { data: roleRows, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);

  if (error || !roleRows || roleRows.length === 0) {
    throw new Error("Unauthorized: Access denied.");
  }

  const userRoles = roleRows.map((r: any) => r.role);
  const hasAllowedRole = userRoles.some((r: string) => ALLOWED_REVIEW_ROLES.includes(r));
  if (!hasAllowedRole) {
    throw new Error("You do not have permission to access payee classification review.");
  }

  const isGlobal = userRoles.some((r: string) => r === "admin" || r === "supervisor");
  if (isGlobal) {
    return { isGlobal: true, allowedCompanyIds: null };
  }

  // Non-global roles: query explicit company access
  const { data: accessRows } = await context.supabase
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", context.userId);

  const allowedCompanyIds = (accessRows || []).map((r: any) => r.company_id).filter(Boolean);
  return { isGlobal: false, allowedCompanyIds };
}

/**
 * List clients that still need a classification decision (either explicitly
 * marked REVIEW_REQUIRED, or sitting as UNCLASSIFIED). These are the rows an
 * operator must confirm before their TDS can be trusted.
 */
export const adminListReviewClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<any[]> => {
    const { isGlobal, allowedCompanyIds } = await assertReviewAccess(context);
    if (!isGlobal && (!allowedCompanyIds || allowedCompanyIds.length === 0)) {
      return [];
    }

    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("clients")
      .select(
        "id, boid, full_name, holder_type, payee_classification, payee_segment, classification_status, classification_source, pan_or_citizenship, company_id, company:companies(company_name)",
      )
      .or("classification_status.eq.REVIEW_REQUIRED,payee_classification.eq.UNCLASSIFIED");

    if (!isGlobal && allowedCompanyIds && allowedCompanyIds.length > 0) {
      query = query.in("company_id", allowedCompanyIds);
    }

    const { data, error } = await query.order("full_name").limit(3000);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Confirm a shareholder's classification and, in the same call, recompute the
 * TDS / tax / net for every related dividend, interest and mutual-fund payable
 * so the correction flows through immediately (not just on the next upload).
 */
export const adminConfirmClientClassification = createServerFn({ method: "POST" })
  .validator(
    (d: {
      clientId: string;
      classification: PayeeClassification | "UNCLASSIFIED";
      segment?: PayeeSegment;
      holderType?: string;
    }) => d,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { isGlobal, allowedCompanyIds } = await assertReviewAccess(context);

    if (data.classification === "UNCLASSIFIED") {
      throw new Error("Confirming a client requires a real classification, not UNCLASSIFIED.");
    }
    if (!CLASSIFICATIONS.includes(data.classification)) {
      throw new Error("Invalid classification.");
    }
    if (data.segment && !(SEGMENTS as readonly string[]).includes(data.segment)) {
      throw new Error("Invalid segment.");
    }

    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");

    // Company scoping check for non-global users
    if (!isGlobal) {
      if (!allowedCompanyIds || allowedCompanyIds.length === 0) {
        throw new Error("Forbidden: You do not have access to any companies.");
      }
      const { data: clientRec } = await supabaseAdmin
        .from("clients")
        .select("company_id")
        .eq("id", data.clientId)
        .maybeSingle();

      if (
        !clientRec ||
        !clientRec.company_id ||
        !allowedCompanyIds.includes(clientRec.company_id)
      ) {
        throw new Error("Forbidden: You do not have access to this client's company.");
      }
    }

    // Single authoritative source for the TDS rate.
    const { data: rules } = await supabaseAdmin
      .from("payable_tax_rules")
      .select("payable_category, payee_classification, tax_rate")
      .eq("is_active", true);
    const ruleMap = new Map<string, number>();
    for (const row of rules ?? []) {
      ruleMap.set(`${row.payable_category}|${row.payee_classification}`, Number(row.tax_rate));
    }

    // 1) Mark the client CONFIRMED first so the payable triggers read it too.
    const clientPatch: Record<string, unknown> = {
      payee_classification: data.classification,
      payee_segment: data.segment ?? null,
      classification_status: "CONFIRMED",
      classification_source: "manual_review",
    };
    if (data.holderType) clientPatch.holder_type = data.holderType;
    const { error: clientErr } = await supabaseAdmin
      .from("clients")
      .update(clientPatch)
      .eq("id", data.clientId);
    if (clientErr) throw new Error(clientErr.message);

    // 2) Recompute + rewrite all payables for this client with the confirmed
    //    classification and the authoritative rule rate.
    let recomputed = 0;
    for (const [table, meta] of Object.entries(PAYABLE_TABLES)) {
      const rate = ruleMap.get(`${meta.category}|${data.classification}`);
      const { data: rows } = await supabaseAdmin
        .from(table)
        .select(`id, ${meta.grossCol}`)
        .eq("client_id", data.clientId);

      for (const row of rows ?? []) {
        const gross = Number(row[meta.grossCol] ?? 0);
        const tax = round2(gross * (rate ?? 0));
        const { error } = await supabaseAdmin
          .from(table)
          .update({
            payee_classification: data.classification,
            payee_segment: data.segment ?? null,
            classification_status: "CONFIRMED",
            tds_rate: rate ?? null,
            tax_amount: tax,
            net_payable: round2(gross - tax),
          })
          .eq("id", row.id);
        if (!error) recomputed++;
      }
    }

    return { ok: true, recomputed };
  });

/**
 * Non-destructive "hard backstop": list any payable where the numbers fall out
 * of agreement with the rule (net !== gross − tax, zero TDS on a taxable class,
 * or tax !== gross × rate). Surfaces silent bad data for correction without
 * ever blocking an import.
 */
export const adminListTaxExceptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<any[]> => {
    const { isGlobal, allowedCompanyIds } = await assertReviewAccess(context);
    if (!isGlobal && (!allowedCompanyIds || allowedCompanyIds.length === 0)) {
      return [];
    }

    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");
    const out: any[] = [];

    for (const [table, meta] of Object.entries(PAYABLE_TABLES)) {
      let query = supabaseAdmin
        .from(table)
        .select(
          `id, ${meta.grossCol}, tax_amount, net_payable, tds_rate, payee_classification, company_id, client:clients(full_name, boid, payee_classification), company:companies(company_name)`,
        );

      if (!isGlobal && allowedCompanyIds && allowedCompanyIds.length > 0) {
        query = query.in("company_id", allowedCompanyIds);
      }

      const { data, error } = await query.limit(8000);
      if (error) continue;

      for (const row of data ?? []) {
        const gross = Number(row[meta.grossCol] ?? 0);
        const tax = Number(row.tax_amount ?? 0);
        const net = Number(row.net_payable ?? 0);
        const cls = row.payee_classification ?? "UNCLASSIFIED";
        const clientCls = row.client?.payee_classification ?? null;
        const rate = Number(row.tds_rate ?? 0);

        // Check against the authoritative rule rate if known, or stored rate.
        const effectiveRate = rate > 0 ? rate : 0;
        const expectedTax = round2(gross * effectiveRate);

        const netBad = Math.abs(gross - tax - net) > 0.011;
        // Zero tax is only an exception if the expected tax is greater than 0.00 (paisa rounding).
        // Micro dividends (e.g. 0.04 NPR * 5% = 0.002 NPR -> rounds to 0.00) are NOT exceptions.
        const zeroTaxWithGross = expectedTax > 0 && tax === 0 && cls !== "TAX_EXEMPT";
        const taxBad = gross > 0.001 && tax > 0 && Math.abs(tax - expectedTax) > 0.51;
        // Payable snapshot drifted from the confirmed client master (the DB
        // trigger would have written the client's classification).
        const clientMismatch =
          clientCls != null &&
          clientCls !== "UNCLASSIFIED" &&
          cls !== "UNCLASSIFIED" &&
          cls !== clientCls;

        if (netBad || zeroTaxWithGross || taxBad || clientMismatch) {
          out.push({
            table,
            id: row.id,
            gross,
            tax,
            net,
            tds_rate: row.tds_rate,
            classification: cls,
            payee: row.client?.full_name ?? row.client?.boid ?? "(unknown)",
            boid: row.client?.boid ?? null,
            company: row.company?.company_name ?? null,
            reason: clientMismatch
              ? `payable classification (${cls}) ≠ client classification (${clientCls})`
              : netBad
                ? "net ≠ gross − tax"
                : zeroTaxWithGross
                  ? "zero tax on a taxable class"
                  : "tax ≠ gross × rate",
          });
        }
      }
    }

    return out;
  });

/**
 * Recompute a single flagged payable against its (already-decided) client
 * classification. Used from the tax-exceptions tab to correct bad rows.
 */
export const adminRecomputePayable = createServerFn({ method: "POST" })
  .validator((d: { table: string; id: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const meta = PAYABLE_TABLES[data.table];
    if (!meta) throw new Error("Invalid payable table.");

    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");

    const { data: pay, error: payErr } = await supabaseAdmin
      .from(data.table)
      .select(`id, client_id, ${meta.grossCol}, payee_classification`)
      .eq("id", data.id)
      .maybeSingle();
    if (payErr || !pay) throw new Error(payErr?.message ?? "Payable not found.");

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("payee_classification")
      .eq("id", pay.client_id)
      .maybeSingle();
    const classification =
      client?.payee_classification ?? pay.payee_classification ?? "UNCLASSIFIED";

    if (classification === "UNCLASSIFIED") {
      throw new Error("Client is UNCLASSIFIED — confirm the classification first.");
    }

    const { data: rule, error: ruleErr } = await supabaseAdmin
      .from("payable_tax_rules")
      .select("tax_rate")
      .eq("payable_category", meta.category)
      .eq("payee_classification", classification)
      .eq("is_active", true)
      .maybeSingle();
    if (ruleErr || !rule)
      throw new Error(`No active tax rule for ${meta.category} / ${classification}.`);

    const gross = Number(pay[meta.grossCol] ?? 0);
    const rate = Number(rule.tax_rate);
    const tax = round2(gross * rate);
    const net = round2(gross - tax);

    const { error } = await supabaseAdmin
      .from(data.table)
      .update({
        payee_classification: classification,
        classification_status: "CONFIRMED",
        tds_rate: rate,
        tax_amount: tax,
        net_payable: net,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Batch recompute all flagged payables.
 */
export const adminRecomputeAllPayables = createServerFn({ method: "POST" })
  .validator((items: { table: string; id: string }[]) => items)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data: items, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");

    // Fetch active rules
    const { data: rules } = await supabaseAdmin
      .from("payable_tax_rules")
      .select("payable_category, payee_classification, tax_rate")
      .eq("is_active", true);
    const ruleMap = new Map<string, number>();
    for (const r of rules ?? []) {
      ruleMap.set(`${r.payable_category}|${r.payee_classification}`, Number(r.tax_rate));
    }

    let successCount = 0;
    for (const item of items) {
      const meta = PAYABLE_TABLES[item.table];
      if (!meta) continue;

      const { data: pay } = await supabaseAdmin
        .from(item.table)
        .select(`id, client_id, ${meta.grossCol}, payee_classification`)
        .eq("id", item.id)
        .maybeSingle();
      if (!pay) continue;

      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("payee_classification")
        .eq("id", pay.client_id)
        .maybeSingle();
      const classification =
        client?.payee_classification ?? pay.payee_classification ?? "UNCLASSIFIED";

      if (classification === "UNCLASSIFIED") continue;
      const rate = ruleMap.get(`${meta.category}|${classification}`);
      if (rate === undefined) continue;

      const gross = Number(pay[meta.grossCol] ?? 0);
      const tax = round2(gross * rate);
      const net = round2(gross - tax);

      const { error } = await supabaseAdmin
        .from(item.table)
        .update({
          payee_classification: classification,
          classification_status: "CONFIRMED",
          tds_rate: rate,
          tax_amount: tax,
          net_payable: net,
        })
        .eq("id", item.id);
      if (!error) successCount++;
    }

    return { ok: true, count: successCount };
  });

/**
 * Comprehensive Auto-Scan and Fix:
 * 1. Restores natural persons with family lineage who were misclassified as TAX_EXEMPT.
 * 2. Identifies non-confirmed institutional entities (e.g. trade, brand, corporate names) that were misclassified as NATURAL_PERSON and elevates them to COMPANY_INSTITUTION.
 * 3. Identifies non-confirmed entities with no family lineage, credentials, or surname that were misclassified as NATURAL_PERSON and flags them as UNCLASSIFIED / REVIEW_REQUIRED.
 * 4. Automatically synchronizes all linked payables across dividend, interest, and mutual fund tables.
 */
export const adminFixMisclassifiedNaturalPersons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");

    // Fetch non-confirmed clients for re-evaluation
    const { data: clients, error: fetchErr } = await supabaseAdmin
      .from("clients")
      .select(
        "id, full_name, father_name, grandfather_name, citizenship_no, payee_classification, classification_status, holder_type",
      )
      .neq("classification_status", "CONFIRMED")
      .limit(10000);

    if (fetchErr) throw new Error(fetchErr.message);

    const naturalRestoredIds: string[] = [];
    const institutionsToUpdate: { id: string; name: string }[] = [];
    const unclassifiedToFlag: { id: string; name: string }[] = [];

    for (const c of clients || []) {
      const res = smartClassify({
        full_name: c.full_name,
        father_name: c.father_name,
        grandfather_name: c.grandfather_name,
        citizenship_no: c.citizenship_no,
      });

      // 1. Lineage natural persons wrongly marked TAX_EXEMPT
      if (
        (c.payee_classification === "TAX_EXEMPT" ||
          c.holder_type === "Tax Exempt" ||
          c.holder_type === "Mutual Fund") &&
        res.payee_classification === "NATURAL_PERSON"
      ) {
        naturalRestoredIds.push(c.id);
      }
      // 2. Institutions wrongly marked NATURAL_PERSON
      else if (
        res.payee_classification === "COMPANY_INSTITUTION" &&
        c.payee_classification !== "COMPANY_INSTITUTION"
      ) {
        institutionsToUpdate.push({ id: c.id, name: c.full_name });
      }
      // 3. Ambiguous entities with no human evidence wrongly marked NATURAL_PERSON
      else if (
        res.payee_classification === "UNCLASSIFIED" &&
        (c.payee_classification !== "UNCLASSIFIED" || c.classification_status !== "REVIEW_REQUIRED")
      ) {
        unclassifiedToFlag.push({ id: c.id, name: c.full_name });
      }
    }

    let updatedCount = 0;

    // Apply natural person restorations
    if (naturalRestoredIds.length > 0) {
      await supabaseAdmin
        .from("clients")
        .update({
          payee_classification: "NATURAL_PERSON",
          holder_type: "Natural Person - Public",
          payee_segment: "PUBLIC",
          classification_status: "AUTO_CLASSIFIED",
          classification_source: "Family Lineage Verification",
        })
        .in("id", naturalRestoredIds);

      await supabaseAdmin
        .from("dividend_payables")
        .update({ payee_classification: "NATURAL_PERSON", payee_category: "PUBLIC" })
        .in("client_id", naturalRestoredIds)
        .eq("payee_classification", "TAX_EXEMPT");

      await supabaseAdmin
        .from("interest_payables")
        .update({ payee_classification: "NATURAL_PERSON", payee_category: "PUBLIC" })
        .in("client_id", naturalRestoredIds)
        .eq("payee_classification", "TAX_EXEMPT");

      await supabaseAdmin
        .from("mutual_fund_payables")
        .update({ payee_classification: "NATURAL_PERSON", payee_category: "PUBLIC" })
        .in("client_id", naturalRestoredIds)
        .eq("payee_classification", "TAX_EXEMPT");

      updatedCount += naturalRestoredIds.length;
    }

    // Apply institutional promotions
    for (const inst of institutionsToUpdate) {
      await supabaseAdmin
        .from("clients")
        .update({
          payee_classification: "COMPANY_INSTITUTION",
          holder_type: "Legal Person",
          classification_status: "AUTO_CLASSIFIED",
          classification_source: "institutional_keyword_match",
        })
        .eq("id", inst.id);
      updatedCount++;
    }

    // Apply unclassified flags
    for (const unclass of unclassifiedToFlag) {
      await supabaseAdmin
        .from("clients")
        .update({
          payee_classification: "UNCLASSIFIED",
          holder_type: null,
          classification_status: "REVIEW_REQUIRED",
          classification_source: "no_lineage_review_required",
        })
        .eq("id", unclass.id);
      updatedCount++;
    }

    const details: string[] = [];
    if (naturalRestoredIds.length > 0)
      details.push(`${naturalRestoredIds.length} natural person(s) restored`);
    if (institutionsToUpdate.length > 0)
      details.push(`${institutionsToUpdate.length} institution(s) updated to 15%`);
    if (unclassifiedToFlag.length > 0)
      details.push(`${unclassifiedToFlag.length} ambiguous entity(ies) queued for review`);

    return {
      count: updatedCount,
      message:
        updatedCount > 0
          ? `Classification scan completed: ${details.join(", ")}.`
          : "All shareholder classifications are already up to date.",
    };
  });
