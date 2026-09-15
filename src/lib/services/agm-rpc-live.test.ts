import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { PaymentService } from "./payment.service";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("Real Supabase RPCs & Transactional Rollback Integration Tests", () => {
  let companyId: string;
  let runId: string;

  beforeAll(async () => {
    runId = Math.random().toString(36).substring(2, 7).toUpperCase();

    const { data: comp, error: compErr } = await client
      .from("companies")
      .insert({
        company_name: `AGM Real Test Bank ${runId} Ltd`,
        company_code: `AGM${runId}`,
        company_type: "Commercial Bank",
        fiscal_year: "2080/81",
        isin: `NP${runId}AGM01`,
      })
      .select("id")
      .single();

    if (compErr || !comp) throw new Error(`Failed to create test company: ${compErr?.message}`);
    companyId = comp.id;
  });

  afterAll(async () => {
    if (companyId) {
      await client.from("agm_broker_claims").delete().eq("company_id", companyId);
      await client.from("agm_broker_pools").delete().eq("company_id", companyId);
      await client.from("agm_yearly_snapshots").delete().eq("company_id", companyId);
      await client.from("agm_import_staging").delete().eq("company_id", companyId);
      await client.from("agm_fiscal_year_meta").delete().eq("company_id", companyId);
      await client.from("agm_historical_shareholders").delete().eq("company_id", companyId);
      await client.from("payment_batches").delete().eq("company_id", companyId);
      await client.from("companies").delete().eq("id", companyId);
    }
  });

  it("verifies commit_agm_fiscal_year_import populates shareholder_id and sets is_locked = true", async () => {
    const batchId = crypto.randomUUID();
    const boid = `13010100${runId}01`;

    // 1. Stage a test shareholder and snapshot in agm_import_staging
    const { error: stageErr } = await client.from("agm_import_staging").insert({
      batch_id: batchId,
      company_id: companyId,
      fiscal_year: "2080/81",
      boid,
      shareholder_row: {
        shareholder_name: `Test Holder ${runId}`,
        holder_type: "PUBLIC",
        initial_kitta_2075: 1000,
        current_kitta_2081: 1100,
        total_bonus_shares: 100,
        total_cash_dividend: 500,
        total_tax_withheld: 30,
      },
      snapshot_row: {
        base_kitta: 1000,
        previous_fraction: 0,
        gross_bonus_entitlement: 100,
        issued_whole_bonus: 100,
        carried_new_fraction: 0,
        gross_cash_dividend: 500,
        bonus_tax_withheld: 5,
        cash_tax_withheld: 25,
        net_cash_payable: 470,
        post_event_kitta: 1100,
      },
    });
    expect(stageErr).toBeNull();

    // 2. Call commit_agm_fiscal_year_import RPC
    const { data: rpcRes, error: rpcErr } = await client.rpc("commit_agm_fiscal_year_import", {
      p_company_id: companyId,
      p_fiscal_year: "2080/81",
      p_batch_id: batchId,
      p_event_name: "25th AGM Cash & Bonus Dividend",
      p_report: { source: "Integration Test" },
    });

    expect(rpcErr).toBeNull();
    expect(rpcRes?.success).toBe(true);
    expect(rpcRes?.isLocked).toBe(true);
    expect(rpcRes?.snapshotsSaved).toBeGreaterThanOrEqual(1);

    // 3. Verify metadata row has is_locked = true
    const { data: meta, error: metaErr } = await client
      .from("agm_fiscal_year_meta")
      .select("*")
      .eq("company_id", companyId)
      .eq("fiscal_year", "2080/81")
      .single();

    expect(metaErr).toBeNull();
    expect(meta.is_locked).toBe(true);

    // 4. Verify snapshot row has non-null shareholder_id matching historical shareholder
    const { data: snapshot, error: snapErr } = await client
      .from("agm_yearly_snapshots")
      .select("id, shareholder_id, boid, post_event_kitta")
      .eq("company_id", companyId)
      .eq("boid", boid)
      .single();

    expect(snapErr).toBeNull();
    expect(snapshot!.shareholder_id).not.toBeNull();
    expect(Number(snapshot!.post_event_kitta)).toBe(1100);

    const { data: shMaster } = await client
      .from("agm_historical_shareholders")
      .select("id, boid")
      .eq("id", snapshot!.shareholder_id!)
      .single();

    expect(shMaster?.boid).toBe(boid);
  });

  it("verifies apply_agm_statutory_corrections enforces invariants and accepts matching totals", async () => {
    const boid = `13010100${runId}99`;

    // 1. Attempt statutory correction with mismatched math (master bonus != sum of snapshot bonuses)
    const invalidCorrection = [
      {
        shareholder_row: {
          boid,
          current_kitta_2081: 1000,
          total_bonus_shares: 500, // Master says 500
          total_cash_dividend: 100,
          total_tax_withheld: 10,
        },
        snapshots: [
          {
            fiscal_year: "2080/81",
            issued_whole_bonus: 200, // Snapshot says 200 (mismatch!)
            gross_cash_dividend: 100,
            bonus_tax_withheld: 5,
            cash_tax_withheld: 5,
            post_event_kitta: 1000,
          },
        ],
      },
    ];

    const { error: invalidErr } = await client.rpc("apply_agm_statutory_corrections", {
      p_company_id: companyId,
      p_corrections: invalidCorrection,
    });

    expect(invalidErr).not.toBeNull();
    expect(invalidErr?.message).toContain("Invariant violated");

    // 2. Insert valid master shareholder and apply valid matching correction
    const { error: insErr } = await client.from("agm_historical_shareholders").insert({
      company_id: companyId,
      boid,
      shareholder_name: `Reconciled Holder ${runId}`,
      holder_type: "PUBLIC",
      current_kitta_2081: 1000,
      total_bonus_shares: 200,
      total_cash_dividend: 100,
      total_tax_withheld: 10,
    });
    expect(insErr).toBeNull();

    const validCorrection = [
      {
        shareholder_row: {
          boid,
          current_kitta_2081: 1200,
          total_bonus_shares: 200,
          total_cash_dividend: 100,
          total_tax_withheld: 10,
        },
        snapshots: [
          {
            fiscal_year: "2080/81",
            issued_whole_bonus: 200,
            gross_cash_dividend: 100,
            bonus_tax_withheld: 5,
            cash_tax_withheld: 5,
            post_event_kitta: 1200,
          },
        ],
      },
    ];

    const { data: validRes, error: validErr } = await client.rpc(
      "apply_agm_statutory_corrections",
      {
        p_company_id: companyId,
        p_corrections: validCorrection,
      },
    );

    expect(validErr).toBeNull();
    expect(validRes?.success).toBe(true);
    expect(validRes?.shareholdersCorrected).toBe(1);
    expect(validRes?.snapshotsCorrected).toBe(1);
  });

  it("verifies claim_agm_broker_pool manages pool claims and blocks double claiming", async () => {
    const poolBoid = `POOL${runId}`;

    // 1. Insert a test pool
    const { data: pool, error: poolErr } = await client
      .from("agm_broker_pools")
      .insert({
        company_id: companyId,
        fiscal_year: "2080/81",
        broker_code: `BRK${runId}`,
        broker_name: `Test Broker ${runId}`,
        pool_boid: poolBoid,
        unclaimed_kitta: 5000,
        unclaimed_cash: 250,
        claimed_kitta: 0,
        claimed_cash: 0,
        active_balance_kitta: 5000,
        active_balance_cash: 250,
      })
      .select("id")
      .single();

    expect(poolErr).toBeNull();

    // 2. Claim part of the pool
    const { data: claimRes, error: claimErr } = await client.rpc("claim_agm_broker_pool", {
      p_company_id: companyId,
      p_seq_no: Math.floor(Math.random() * 1000000) + 1000,
      p_broker_code: `BRK${runId}`,
      p_broker_name: `Test Broker ${runId}`,
      p_pool_boid: poolBoid,
      p_claimant_boid: `13010100${runId}55`,
      p_claimant_name: `Claimant ${runId}`,
      p_fiscal_year: "2080/81",
      p_claimed_kitta: 1000,
      p_claimed_cash: 50,
      p_contract_note_no: `CN-${runId}`,
      p_trade_date_bs: "2080-05-15",
    });

    expect(claimErr).toBeNull();
    expect(claimRes?.success).toBe(true);
    expect(claimRes?.remainingKitta).toBe(4000);

    // 3. Verify updated active balance in table
    const { data: updatedPool } = await client
      .from("agm_broker_pools")
      .select("active_balance_kitta")
      .eq("id", pool!.id)
      .single();

    expect(Number(updatedPool!.active_balance_kitta)).toBe(4000);
  });

  it("verifies transactional batch rollback cleans up draft batch when line item insertion fails", async () => {
    const invalidLineItems: any[] = [
      {
        company_id: companyId,
        client_id: "00000000-0000-0000-0000-000000000000", // Non-existent foreign key to trigger failure
        payable_type: "dividend",
        payable_id: "00000000-0000-0000-0000-000000000000",
        gross_amount: 1000,
        tax_amount: 50,
        net_amount: 950,
        paid_amount: 950,
        payment_method: "ConnectIPS",
        payment_date: null,
        payment_reference: null,
        bank_name: "Test Bank",
        bank_account_no: "1234567890",
        neft_ref: null,
        connectips_ref: null,
        rtgs_ref: null,
        cheque_no: null,
        status: "Pending",
        remarks: null,
      },
    ];

    const testBatchName = `Failing Batch ${runId}`;

    await expect(
      PaymentService.createBatchWithLineItems(
        {
          batch_name: testBatchName,
          company_id: companyId,
          fiscal_year: "2080/81",
          payable_type: "dividend",
          payment_method: "ConnectIPS",
        },
        invalidLineItems,
      ),
    ).rejects.toThrow();

    // Verify the draft batch was rolled back (deleted) from database
    const { data: batches } = await client
      .from("payment_batches")
      .select("id, batch_name")
      .eq("company_id", companyId)
      .eq("batch_name", testBatchName);

    expect(batches).toEqual([]);
  });

  it("verifies accept_agm_drn_record accepts DRN and links folio idempotently", async () => {
    const folioNo = `FOL-${runId}-001`;

    const { data: drnRes, error: drnErr } = await client.rpc("accept_agm_drn_record", {
      p_company_id: companyId,
      p_folio_no: folioNo,
      p_holder_name: `DRN Holder ${runId}`,
      p_total_kitta: 500,
      p_drn_no: `DRN-${runId}`,
      p_drn_date: "2080-05-20",
      p_target_boid: `13010100${runId}77`,
      p_status: "ACCEPTED",
    });

    expect(drnErr).toBeNull();
    expect(drnRes?.success).toBe(true);
    expect(drnRes?.folioNo).toBe(folioNo);

    // Verify DRN record persisted in table
    const { data: rec, error: recErr } = await client
      .from("agm_drn_records")
      .select("folio_no, status, total_kitta")
      .eq("company_id", companyId)
      .eq("folio_no", folioNo)
      .single();

    expect(recErr).toBeNull();
    expect(rec!.status).toBe("ACCEPTED");
    expect(Number(rec!.total_kitta)).toBe(500);
  });

  it("verifies promote_agm_clients_and_payables promotes clients and payables to production tables", async () => {
    const testBoid = `13010100${runId}88`;

    const clientsPayload = [
      {
        boid: testBoid,
        name: `Promoted Client ${runId}`,
        father_name: "Father",
        grandfather_name: "Grandfather",
        citizenship_no: "123/456",
        pan_no: "123456789",
        address: "Kathmandu",
        contact_number: "9841000000",
        bank_name: "Nabil Bank",
        bank_account_number: "0011223344",
        holder_type: "Public",
        total_kitta: 1000,
        fraction_kitta: 0,
      },
    ];

    const payablesPayload = [
      {
        boid: testBoid,
        fiscal_year: "2080/81",
        shares_held: 1000,
        fraction_shares: 0,
        gross_dividend: 500,
        tax_amount: 25,
        net_payable: 475,
        remarks: "fraction remainder payout",
      },
    ];

    const { data: promRes, error: promErr } = await client.rpc("promote_agm_clients_and_payables", {
      p_company_id: companyId,
      p_clients: clientsPayload,
      p_payables: payablesPayload,
    });

    expect(promErr).toBeNull();
    expect(promRes?.success).toBe(true);
    expect(promRes?.clientsUpserted).toBe(1);
    expect(promRes?.payablesInserted).toBe(1);

    // Verify client in public.clients table
    const { data: clientRow, error: clientFetchErr } = await client
      .from("clients")
      .select("boid, full_name, status")
      .eq("company_id", companyId)
      .eq("boid", testBoid)
      .single();

    expect(clientFetchErr).toBeNull();
    expect(clientRow!.full_name).toBe(`Promoted Client ${runId}`);
    expect(clientRow!.status).toBe("Active");
  });

  it("verifies correction rollback leaves zero records when invariant is violated", async () => {
    const failedBoid = `13010100${runId}F1`;

    const invalidPayload = [
      {
        shareholder_row: {
          boid: failedBoid,
          current_kitta_2081: 1000,
          total_bonus_shares: 999, // Invariant mismatch
          total_cash_dividend: 100,
          total_tax_withheld: 10,
        },
        snapshots: [
          {
            fiscal_year: "2080/81",
            issued_whole_bonus: 100, // Does not equal 999
            gross_cash_dividend: 100,
            bonus_tax_withheld: 5,
            cash_tax_withheld: 5,
            post_event_kitta: 1000,
          },
        ],
      },
    ];

    const { error: failedErr } = await client.rpc("apply_agm_statutory_corrections", {
      p_company_id: companyId,
      p_corrections: invalidPayload,
    });

    expect(failedErr).not.toBeNull();

    // Verify atomic rollback: no shareholder row or snapshot was persisted
    const { data: shCheck } = await client
      .from("agm_historical_shareholders")
      .select("id")
      .eq("boid", failedBoid)
      .maybeSingle();

    expect(shCheck).toBeNull();

    const { data: snapCheck } = await client
      .from("agm_yearly_snapshots")
      .select("id")
      .eq("boid", failedBoid)
      .maybeSingle();

    expect(snapCheck).toBeNull();
  });

  it("verifies promotion rollback leaves zero clients when payables insertion fails", async () => {
    const rolledBackBoid = `13010100${runId}RB`;

    const clientsPayload = [
      {
        boid: rolledBackBoid,
        name: `RolledBack Client ${runId}`,
        holder_type: "Public",
        total_kitta: 500,
      },
    ];

    const invalidPayablesPayload = [
      {
        boid: rolledBackBoid,
        fiscal_year: "2080/81",
        gross_dividend: "NOT_A_NUMERIC_VALUE_CAUSING_CAST_ERROR",
      },
    ];

    const { error: promErr } = await client.rpc("promote_agm_clients_and_payables", {
      p_company_id: companyId,
      p_clients: clientsPayload,
      p_payables: invalidPayablesPayload,
    });

    expect(promErr).not.toBeNull();

    // Verify rollback: client was NOT persisted in clients table
    const { data: clientCheck } = await client
      .from("clients")
      .select("id")
      .eq("boid", rolledBackBoid)
      .maybeSingle();

    expect(clientCheck).toBeNull();
  });

  it("verifies multi-tenant company isolation across AGM records and snapshots", async () => {
    // Create Company B
    const { data: compB, error: compBErr } = await client
      .from("companies")
      .insert({
        company_name: `Isolation Bank B ${runId} Ltd`,
        company_code: `ISOB${runId}`,
        company_type: "Commercial Bank",
        fiscal_year: "2080/81",
        isin: `NP${runId}ISOB2`,
      })
      .select("id")
      .single();

    expect(compBErr).toBeNull();
    const companyIdB = compB!.id;

    try {
      const boidA = `13010100${runId}AA`;
      const boidB = `13010100${runId}BB`;

      // Insert for Company A
      await client.from("agm_historical_shareholders").insert({
        company_id: companyId,
        boid: boidA,
        shareholder_name: `Company A Holder ${runId}`,
        holder_type: "PUBLIC",
        current_kitta_2081: 500,
      });

      // Insert for Company B
      await client.from("agm_historical_shareholders").insert({
        company_id: companyIdB,
        boid: boidB,
        shareholder_name: `Company B Holder ${runId}`,
        holder_type: "PUBLIC",
        current_kitta_2081: 800,
      });

      // Query Company A
      const { data: rowsA } = await client
        .from("agm_historical_shareholders")
        .select("boid")
        .eq("company_id", companyId);

      const boidsInA = (rowsA || []).map((r) => r.boid);
      expect(boidsInA).toContain(boidA);
      expect(boidsInA).not.toContain(boidB);

      // Query Company B
      const { data: rowsB } = await client
        .from("agm_historical_shareholders")
        .select("boid")
        .eq("company_id", companyIdB);

      const boidsInB = (rowsB || []).map((r) => r.boid);
      expect(boidsInB).toContain(boidB);
      expect(boidsInB).not.toContain(boidA);
    } finally {
      await client.from("agm_historical_shareholders").delete().eq("company_id", companyIdB);
      await client.from("companies").delete().eq("id", companyIdB);
    }
  });

  it("verifies RLS denial prevents anonymous/unauthorized access to sensitive financial records", async () => {
    const anonClient = createClient(
      SUPABASE_URL,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_PUBLISHABLE_KEY ||
        "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // 1. Audit logs must deny access or return 0 rows to unauthenticated caller
    const { data: auditRows, error: auditErr } = await anonClient
      .from("audit_logs")
      .select("id")
      .limit(5);

    if (auditErr) {
      expect(auditErr).toBeDefined();
    } else {
      expect(auditRows?.length ?? 0).toBe(0);
    }

    // 2. AGM staging must deny access or return 0 rows to unauthenticated caller
    const { data: stagingRows, error: stagingErr } = await anonClient
      .from("agm_import_staging")
      .select("id")
      .limit(5);

    if (stagingErr) {
      expect(stagingErr).toBeDefined();
    } else {
      expect(stagingRows?.length ?? 0).toBe(0);
    }

    // 3. Payment batches must deny anonymous insertions
    const { error: insertErr } = await anonClient.from("payment_batches").insert({
      company_id: companyId,
      batch_name: "Illegal Anonymous Batch",
      payable_type: "dividend",
      total_amount: 1000,
      total_records: 1,
      status: "draft",
    });

    expect(insertErr).not.toBeNull();
  });
});
