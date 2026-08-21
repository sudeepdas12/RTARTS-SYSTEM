import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  | "NATURAL_PERSON"
  | "PUBLIC_LEGAL_PERSON"
  | "COMPANY_INSTITUTION"
  | "TAX_EXEMPT";

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
    throw new Error("You need administrator privileges to manage payee classifications.");
  }
}

/**
 * List clients that still need a classification decision (either explicitly
 * marked REVIEW_REQUIRED, or sitting as UNCLASSIFIED). These are the rows an
 * operator must confirm before their TDS can be trusted.
 */
export const adminListReviewClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<any[]> => {
    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select(
        "id, boid, full_name, holder_type, payee_classification, payee_segment, classification_status, classification_source, pan_or_citizenship, company:companies(company_name)",
      )
      .or("classification_status.eq.REVIEW_REQUIRED,payee_classification.eq.UNCLASSIFIED")
      .order("full_name")
      .limit(3000);
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
    await assertAdmin(context);

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
  .handler(async (): Promise<any[]> => {
    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");
    const out: any[] = [];

    for (const [table, meta] of Object.entries(PAYABLE_TABLES)) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select(
          `id, ${meta.grossCol}, tax_amount, net_payable, tds_rate, payee_classification, client:clients(full_name, boid, payee_classification), company:companies(company_name)`,
        )
        .limit(8000);
      if (error) continue;

      for (const row of data ?? []) {
        const gross = Number(row[meta.grossCol] ?? 0);
        const tax = Number(row.tax_amount ?? 0);
        const net = Number(row.net_payable ?? 0);
        const cls = row.payee_classification ?? "UNCLASSIFIED";
        const clientCls = row.client?.payee_classification ?? null;
        const rate = Number(row.tds_rate ?? 0);

        const netBad = Math.abs(gross - tax - net) > 0.011;
        const zeroTaxWithGross = gross > 0.001 && tax === 0 && cls !== "TAX_EXEMPT";
        const taxBad = gross > 0.001 && tax > 0 && Math.abs(tax - round2(gross * rate)) > 0.51;
        // Payable snapshot drifted from the confirmed client master (the DB
        // trigger would have written the client's classification).
        const clientMismatch =
          clientCls != null && clientCls !== "UNCLASSIFIED" && cls !== "UNCLASSIFIED" && cls !== clientCls;

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
    const classification = client?.payee_classification ?? pay.payee_classification ?? "UNCLASSIFIED";

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
    if (ruleErr || !rule) throw new Error(`No active tax rule for ${meta.category} / ${classification}.`);

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
 * One-click fix for existing clients: Finds any natural person who has father/grandfather
 * lineage but was misclassified as TAX_EXEMPT, restores them to NATURAL_PERSON, and
 * updates their linked payables.
 */
export const adminFixMisclassifiedNaturalPersons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin }: any = await import("@/integrations/supabase/client.server");

    // 1. Fetch misclassified clients with family lineage
    const { data: clients, error: fetchErr } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, father_name, grandfather_name")
      .or("payee_classification.eq.TAX_EXEMPT,holder_type.eq.Tax Exempt,holder_type.eq.Mutual Fund")
      .or("father_name.neq.'',grandfather_name.neq.''");

    if (fetchErr) throw new Error(fetchErr.message);

    const eligible = (clients || []).filter((c: any) => {
      const hasFather = Boolean(c.father_name && String(c.father_name).trim());
      const hasGrandfather = Boolean(c.grandfather_name && String(c.grandfather_name).trim());
      const name = String(c.full_name || "").toUpperCase();
      const isRealFund = /(MUTUAL\s*FUND|\bMF\b|FOCUS\s*(40|30)|SELECT\s*30|SUPER\s*30|SAMRIDDHI|SAMUNNAT|PRAGATI|SAHABHAGITA|DHANABRIDDHI|SABAL|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|SANCHAYA\s*KOSH|NAGARIK\s*LAGANI|CITIZEN\s*INVESTMENT|\bCIT\b|\bEPF\b|\bSSF\b|SOCIAL\s*SECURITY\s*FUND|AWAKASH\s*KOSH|AWAKASH\s*FUND|KALYAN\s*KOSH|KOSH\s*BYAWASTHAPAN)/i.test(name);
      return (hasFather || hasGrandfather) && !isRealFund;
    });

    if (eligible.length === 0) {
      return { count: 0, message: "No misclassified individual shareholders found." };
    }

    const clientIds = eligible.map((c: any) => c.id);

    // 2. Update clients table
    const { error: updateClientErr } = await supabaseAdmin
      .from("clients")
      .update({
        payee_classification: "NATURAL_PERSON",
        holder_type: "Natural Person - Public",
        payee_segment: "PUBLIC",
        classification_status: "AUTO_CLASSIFIED",
        classification_source: "Family Lineage Verification",
      })
      .in("id", clientIds);

    if (updateClientErr) throw new Error(updateClientErr.message);

    // 3. Update linked dividend payables (5% TDS)
    await supabaseAdmin
      .from("dividend_payables")
      .update({
        payee_classification: "NATURAL_PERSON",
        payee_category: "PUBLIC",
      })
      .in("client_id", clientIds)
      .eq("payee_classification", "TAX_EXEMPT");

    // 4. Update linked interest payables (6% TDS)
    await supabaseAdmin
      .from("interest_payables")
      .update({
        payee_classification: "NATURAL_PERSON",
        payee_category: "PUBLIC",
      })
      .in("client_id", clientIds)
      .eq("payee_classification", "TAX_EXEMPT");

    return {
      count: eligible.length,
      message: `Successfully corrected ${eligible.length} individual shareholder(s) to Natural Person (Public).`,
    };
  });

