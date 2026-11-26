import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const isLiveDb = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

const adminClient = isLiveDb
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as any);

describe.skipIf(!isLiveDb)("Multi-Channel Reconciliation Workbench & BRS (Live DB)", () => {
  const runTag = `MRW_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  let companyId: string;
  let makerUserId: string;
  let checkerUserId: string;
  let makerClient: any;
  let checkerClient: any;
  let clientAId: string;
  let clientBId: string;
  let divPayableId: string;
  let intPayableId: string;
  let divNetAmount: number;
  let intNetAmount: number;
  let totalSettledAmount: number;
  let firstApprovalId: string;
  let nonPayableTxnId: string;

  beforeAll(async () => {
    const { data: comp, error: cErr } = await adminClient
      .from("companies")
      .insert({
        company_name: `Manual Recon Co ${runTag}`,
        company_code: `MRC_${runTag}`,
        company_type: "Hydropower",
        fiscal_year: "2082/83",
      })
      .select("id")
      .single();
    if (cErr) throw cErr;
    companyId = comp.id;

    // Maker (reconciliation_officer + access to companyId)
    const makerEmail = `recon-maker-${runTag.toLowerCase()}@example.com`;
    const { data: mUser, error: mErr } = await adminClient.auth.admin.createUser({
      email: makerEmail,
      password: "Password123!",
      email_confirm: true,
    });
    if (mErr) throw mErr;
    makerUserId = mUser.user.id;
    await adminClient
      .from("user_roles")
      .upsert(
        { user_id: makerUserId, role: "reconciliation_officer" },
        { onConflict: "user_id,role" },
      );
    await adminClient
      .from("user_company_access")
      .upsert(
        { user_id: makerUserId, company_id: companyId },
        { onConflict: "user_id,company_id" },
      );

    makerClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await makerClient.auth.signInWithPassword({ email: makerEmail, password: "Password123!" });

    // Checker (supervisor + access to companyId)
    const checkerEmail = `recon-checker-${runTag.toLowerCase()}@example.com`;
    const { data: cUser, error: chkErr } = await adminClient.auth.admin.createUser({
      email: checkerEmail,
      password: "Password123!",
      email_confirm: true,
    });
    if (chkErr) throw chkErr;
    checkerUserId = cUser.user.id;
    await adminClient
      .from("user_roles")
      .upsert({ user_id: checkerUserId, role: "supervisor" }, { onConflict: "user_id,role" });
    await adminClient
      .from("user_company_access")
      .upsert(
        { user_id: checkerUserId, company_id: companyId },
        { onConflict: "user_id,company_id" },
      );

    checkerClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await checkerClient.auth.signInWithPassword({ email: checkerEmail, password: "Password123!" });

    // Two classified clients
    const { data: ca, error: caErr } = await adminClient
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `SITA DEVI ${runTag}`,
        client_code: `CA_${runTag}`,
        boid: `13019100${Math.floor(10000000 + Math.random() * 80000000)}`,
        holder_type: "Natural Person - Public",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
        bank_name: "Global IME Bank",
        bank_account_no: "042000111222",
      })
      .select("id")
      .single();
    if (caErr) throw caErr;
    clientAId = ca.id;

    const { data: cb, error: cbErr } = await adminClient
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `HARI KRISHNA ${runTag}`,
        client_code: `CB_${runTag}`,
        boid: `13019200${Math.floor(10000000 + Math.random() * 80000000)}`,
        holder_type: "Natural Person - Public",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
        bank_name: "Nabil Bank",
        bank_account_no: "011000333444",
      })
      .select("id")
      .single();
    if (cbErr) throw cbErr;
    clientBId = cb.id;

    const { data: divRow, error: divErr } = await adminClient
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: clientAId,
        fiscal_year: "2082/83",
        shares_held: 1000,
        dividend_rate: 10,
        gross_dividend: 10000,
        tax_amount: 500,
        bonus_tax: 0,
        net_payable: 9500,
        remaining_amount: 9500,
        tds_rate: 0.05,
        payment_status: "Pending",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
      })
      .select("id, net_payable")
      .single();
    if (divErr) throw divErr;
    divPayableId = divRow.id;
    divNetAmount = Number(divRow.net_payable);

    const { data: intRow, error: intErr } = await adminClient
      .from("interest_payables")
      .insert({
        company_id: companyId,
        client_id: clientBId,
        fiscal_year: "2082/83",
        shares_held: 100,
        kitta: 100,
        interest_rate_value: 8.5,
        due_date: "2026-11-10",
        days_count: 182,
        gross_interest: 4250,
        tax_amount: 0,
        net_payable: 4250,
        remaining_amount: 4250,
        tds_rate: 0,
        payment_status: "Pending",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
      })
      .select("id, net_payable")
      .single();
    if (intErr) throw intErr;
    intPayableId = intRow.id;
    intNetAmount = Number(intRow.net_payable);
    totalSettledAmount = Number((divNetAmount + intNetAmount).toFixed(2));
  });

  afterAll(async () => {
    if (!adminClient || !companyId) return;
    await adminClient.from("reconciliation_period_locks").delete().eq("company_id", companyId);
    await adminClient.from("reconciliation_results").delete().eq("company_id", companyId);
    await adminClient.from("reconciliation_runs").delete().eq("company_id", companyId);
    await adminClient.from("payments").delete().eq("company_id", companyId);
    await adminClient.from("payment_batches").delete().eq("company_id", companyId);
    await adminClient.from("bank_statement_transactions").delete().eq("company_id", companyId);
    await adminClient.from("bank_statement_imports").delete().eq("company_id", companyId);
    if (firstApprovalId) {
      await adminClient.from("pending_approvals").delete().eq("id", firstApprovalId);
    }
    await adminClient
      .from("pending_approvals")
      .delete()
      .in("requested_by", [makerUserId, checkerUserId].filter(Boolean));
    await adminClient.from("dividend_payables").delete().eq("company_id", companyId);
    await adminClient.from("interest_payables").delete().eq("company_id", companyId);
    await adminClient.from("clients").delete().eq("company_id", companyId);
    await adminClient.from("user_company_access").delete().eq("company_id", companyId);
    await adminClient.from("companies").delete().eq("id", companyId);
    if (makerUserId) {
      await adminClient.from("user_roles").delete().eq("user_id", makerUserId);
      await adminClient.auth.admin.deleteUser(makerUserId).catch(() => {});
    }
    if (checkerUserId) {
      await adminClient.from("user_roles").delete().eq("user_id", checkerUserId);
      await adminClient.auth.admin.deleteUser(checkerUserId).catch(() => {});
    }
  });

  it("M1: Maker submits manual 1↔N RTGS voucher queued in pending_approvals", async () => {
    const { data, error } = await makerClient.rpc("submit_manual_bank_entry_atomic", {
      p_entry: {
        company_id: companyId,
        transaction_date: "2026-11-10",
        debit_amount: totalSettledAmount,
        credit_amount: 0,
        reference: `RTGS-${runTag}-001`,
        description: "Offline RTGS payout for dividend + debenture interest",
        bank_name: "Global IME Bank",
        account_no: "042000111222",
        reason_code: "RTGS_OFFLINE",
        notes: "Confirmed via CBS advice #8812",
        allocations: [
          { payable_id: divPayableId, payable_type: "dividend", amount: divNetAmount },
          { payable_id: intPayableId, payable_type: "interest", amount: intNetAmount },
        ],
      },
    });
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.status).toBe("pending_approval");
    firstApprovalId = data.approval_id;
  });

  it("M2: enforces Maker <> Checker self-approval block even for supervisor self-submissions", async () => {
    // Submitter (even with supervisor role) CANNOT decide their own request
    const { data: ownSub, error: subErr } = await checkerClient.rpc(
      "submit_manual_bank_entry_atomic",
      {
        p_entry: {
          company_id: companyId,
          transaction_date: "2026-11-11",
          debit_amount: 150,
          credit_amount: 0,
          reference: `FEE-${runTag}-002`,
          description: "Bank NCHL RTGS Commission",
          reason_code: "BANK_CHARGE",
          notes: "Bank charge voucher",
        },
      },
    );
    expect(subErr).toBeNull();
    nonPayableTxnId = ownSub.transaction_id;

    const { error: selfDecideErr } = await checkerClient.rpc(
      "decide_manual_reconciliation_atomic",
      {
        p_approval_id: ownSub.approval_id,
        p_decision: "Approved",
        p_review_notes: "Self-approval attempt",
      },
    );
    expect(selfDecideErr).not.toBeNull();

    // Clean up self-submitted ledger-only entry by having admin reject it via service_role or distinct supervisor?
    // Even better: approve ownSub as admin via service_role RPC acting on distinct system approver? Wait: service_role needs p_actor_id <> requested_by!
    // Look how we test rejection/ledger-only later cleanly by having checker reject or approve with a different actor or clearing in M4.
    const { data: adminProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", "admin@rbbmbl.com.np")
      .single();

    const { error: adminApproveOwnErr } = await adminClient.rpc(
      "decide_manual_reconciliation_atomic",
      {
        p_approval_id: ownSub.approval_id,
        p_decision: "Approved",
        p_review_notes: "Approved into unreconciled ledger by distinct admin",
        p_actor_id: adminProfile.id,
      },
    );
    expect(adminApproveOwnErr).toBeNull();
  });

  it("M3: Checker approves Maker's 1↔N manual voucher, settles both payables, and keeps 0 ledger invariant violations", async () => {
    const { data, error } = await checkerClient.rpc("decide_manual_reconciliation_atomic", {
      p_approval_id: firstApprovalId,
      p_decision: "Approved",
      p_review_notes: "Verified CBS UTR advice & cheque counterfoil",
    });
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.mode).toBe("settled");
    expect(data?.settled_count).toBe(2);
    expect(Number(data?.settled_amount)).toBe(totalSettledAmount);

    // Check payable balances updated
    const { data: divAfter } = await adminClient
      .from("dividend_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("id", divPayableId)
      .single();
    expect(divAfter?.payment_status).toBe("Paid");
    expect(Number(divAfter?.paid_amount)).toBe(divNetAmount);

    const { data: intAfter } = await adminClient
      .from("interest_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("id", intPayableId)
      .single();
    expect(intAfter?.payment_status).toBe("Paid");
    expect(Number(intAfter?.paid_amount)).toBe(intNetAmount);

    // Verify 0 ledger invariant violations!
    const { data: auditRes, error: auditErr } = await adminClient.rpc(
      "run_ledger_invariant_audit",
      { p_company_id: companyId },
    );
    expect(auditErr).toBeNull();
    expect(auditRes?.passed).toBe(true);
    expect(Number(auditRes?.total_violations ?? -1)).toBe(0);
  });

  it("M4: Maker classifies bank fee as non-payable, BRS shows variance, Checker approves & Period Lock succeeds", async () => {
    // Confirm BRS currently shows unreconciled variance = 150 (from FEE-002 ledger entry)
    const { data: brsBefore, error: brsErr1 } = await makerClient.rpc(
      "get_bank_reconciliation_statement",
      {
        p_company_id: companyId,
        p_period_start: "2026-11-01",
        p_period_end: "2026-11-30",
      },
    );
    expect(brsErr1).toBeNull();
    expect(Number(brsBefore?.reconciled_bank_debits)).toBe(totalSettledAmount);
    expect(Number(brsBefore?.unreconciled_variance)).toBe(150);

    // Period lock MUST fail while unreconciled variance > 0
    const { error: lockFailVar } = await checkerClient.rpc("lock_reconciliation_period_atomic", {
      p_lock_info: {
        company_id: companyId,
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        maker_id: makerUserId,
        approval_notes: "Attempt early lock with variance",
      },
    });
    expect(lockFailVar).not.toBeNull();

    // Classify the NPR 150 bank charge as non-payable BANK_CHARGE
    const { data: classReq, error: classErr } = await makerClient.rpc(
      "submit_manual_match_request_atomic",
      {
        p_request: {
          company_id: companyId,
          mode: "classify_non_payable",
          transaction_ids: [nonPayableTxnId],
          reason_code: "BANK_CHARGE",
          notes: "Monthly CBS/RTGS settlement charge",
        },
      },
    );
    expect(classErr).toBeNull();
    expect(classReq?.success).toBe(true);

    // Checker approves non-payable classification
    const { data: classApp, error: classAppErr } = await checkerClient.rpc(
      "decide_manual_reconciliation_atomic",
      {
        p_approval_id: classReq.approval_id,
        p_decision: "Approved",
        p_review_notes: "Verified CBS fee tariff",
      },
    );
    expect(classAppErr).toBeNull();
    expect(classApp?.mode).toBe("non_payable");

    // BRS variance should now be 0
    const { data: brsClean } = await checkerClient.rpc("get_bank_reconciliation_statement", {
      p_company_id: companyId,
      p_period_start: "2026-11-01",
      p_period_end: "2026-11-30",
    });
    expect(Number(brsClean?.unreconciled_variance)).toBe(0);
    expect(Number(brsClean?.non_payable_bank_debits)).toBe(150);

    // Self-certification (maker_id == auth.uid()) must fail
    const { error: selfLockErr } = await checkerClient.rpc("lock_reconciliation_period_atomic", {
      p_lock_info: {
        company_id: companyId,
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        maker_id: checkerUserId,
        approval_notes: "Self lock attempt",
      },
    });
    expect(selfLockErr).not.toBeNull();

    // Valid Maker-Checker period lock succeeds
    const { data: lockOk, error: lockOkErr } = await checkerClient.rpc(
      "lock_reconciliation_period_atomic",
      {
        p_lock_info: {
          company_id: companyId,
          fiscal_year: "2082/83",
          period_start: "2026-11-01",
          period_end: "2026-11-30",
          maker_id: makerUserId,
          approval_notes: "November 2026 BRS reconciled to zero variance",
        },
      },
    );
    expect(lockOkErr).toBeNull();
    expect(lockOk?.success).toBe(true);
    expect(lockOk?.brs?.is_period_locked).toBe(true);

    // Backdated manual entry inside locked window MUST be rejected
    const { error: lockedPostErr } = await makerClient.rpc("submit_manual_bank_entry_atomic", {
      p_entry: {
        company_id: companyId,
        transaction_date: "2026-11-15",
        debit_amount: 500,
        credit_amount: 0,
        reference: `BACKDATED-${runTag}`,
        description: "Backdated entry during locked period",
        reason_code: "COUNTER_PAYOUT",
      },
    });
    expect(lockedPostErr).not.toBeNull();
  });
});
