import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { BankErrorProcessorService } from "../src/lib/services/bank-error-processor.service";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Load .env or export SUPABASE_SERVICE_ROLE_KEY before running verify_rta_flows.ts.",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function runVerification() {
  console.log("=== RTA FLOWS END-TO-END VERIFICATION ===");
  console.log(`Connecting to: ${SUPABASE_URL}`);

  // 1. Create or get test company "Neo Public Ltd"
  const { data: comp, error: compErr } = await supabase
    .from("companies")
    .select("id, company_name")
    .eq("company_code", "NEOPUB")
    .maybeSingle();

  let companyId = comp?.id;
  if (!companyId) {
    const { data: newComp, error: createCompErr } = await supabase
      .from("companies")
      .insert({
        company_name: "Neo Public Ltd",
        company_code: "NEOPUB",
        sector_type: "Public",
        fiscal_year: "2081/82",
      })
      .select("id")
      .single();
    if (createCompErr) throw new Error("Failed to create company: " + createCompErr.message);
    companyId = newComp.id;
  }
  console.log(`✓ Target Company verified: Neo Public Ltd (${companyId})`);

  // 2. Create Corporate Declaration
  const declarationCode = `DEC-NEO-TEST-${Date.now()}`;
  const { data: dec, error: decErr } = await supabase
    .from("corporate_declarations")
    .insert({
      company_id: companyId,
      declaration_code: declarationCode,
      declaration_type: "Dividend",
      sub_type: "Cash",
      fiscal_year: "2081/82",
      declaration_date: new Date().toISOString().split("T")[0],
      record_date: new Date().toISOString().split("T")[0],
      rate_per_share: 10.0,
      total_declared_amount: 57000.0,
      status: "Active",
    })
    .select("*")
    .single();

  if (decErr) throw new Error("Failed to create declaration: " + decErr.message);
  console.log(`✓ Declaration created: ${dec.declaration_code} (${dec.id})`);

  // Pre-cleanup any leftover test payables / clients
  const { data: existingClients } = await supabase
    .from("clients")
    .select("id")
    .in("client_code", ["CL-NEO-1", "CL-NEO-2", "CL-NEO-3"]);
  if (existingClients && existingClients.length > 0) {
    const ids = existingClients.map((c: any) => c.id);
    await supabase.from("dividend_payables").delete().in("client_id", ids);
    await supabase.from("clients").delete().in("id", ids);
  }

  // 3. Create test shareholders and payables
  const testBoids = ["1301020000009901", "1301020000009902", "1301020000009903"];
  const testPayables = [
    { gross: 10000, tax: 500, net: 9500, acc: "990100001", name: "Neo Shareholder Alpha" },
    { gross: 20000, tax: 1000, net: 19000, acc: "990200002", name: "Neo Shareholder Beta" },
    { gross: 30000, tax: 1500, net: 28500, acc: "990300003", name: "Neo Shareholder Gamma" },
  ];

  const payableIds: string[] = [];
  const clientIds: string[] = [];

  for (let i = 0; i < testPayables.length; i++) {
    const tp = testPayables[i];
    const boid = testBoids[i];

    // Upsert client
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .upsert(
        {
          company_id: companyId,
          boid,
          client_code: `CL-NEO-${i + 1}`,
          full_name: tp.name,
          bank_name: "Rastriya Banijya Bank",
          bank_account_no: tp.acc,
        },
        { onConflict: "company_id, boid" },
      )
      .select("id")
      .single();

    if (clientErr) throw clientErr;
    clientIds.push(client.id);

    // Insert dividend payable linked to declaration
    const { data: pay, error: payErr } = await supabase
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: client.id,
        declaration_id: dec.id,
        shares_held: tp.gross / 10,
        dividend_rate: 10.0,
        gross_dividend: tp.gross,
        tax_amount: tp.tax,
        net_payable: tp.net,
        paid_amount: 0,
        remaining_amount: tp.net,
        payment_status: "Pending",
        fiscal_year: "2081/82",
      })
      .select("id")
      .single();

    if (payErr) throw payErr;
    payableIds.push(pay.id);
  }
  console.log(`✓ Inserted 3 shareholder payables linked to Declaration (Total Net: NPR 57,000)`);

  // 4. Verify Declaration Summary RPC
  const { data: summary1, error: sumErr1 } = await supabase.rpc("get_declaration_summary", {
    p_declaration_id: dec.id,
  });
  if (sumErr1) throw sumErr1;

  console.log("Summary 1 (Initial State):", {
    declared: summary1.net_payable_amount,
    paid: summary1.paid_amount,
    remaining: summary1.remaining_amount,
    progress: `${summary1.progress_percent}%`,
    total_count: summary1.total_payables_count,
  });

  if (Number(summary1.net_payable_amount) !== 60000 || Number(summary1.paid_amount) !== 0) {
    throw new Error("Initial declaration summary mismatch!");
  }
  console.log("✓ Initial Declaration Summary verified: 100% outstanding (NPR 60,000)");

  // 5. Simulate paying Shareholder 1
  await supabase
    .from("dividend_payables")
    .update({
      payment_status: "Paid",
      paid_amount: 10000,
      remaining_amount: 0,
      payment_date: new Date().toISOString().split("T")[0],
    })
    .eq("id", payableIds[0]);

  const { data: summary2 } = await supabase.rpc("get_declaration_summary", {
    p_declaration_id: dec.id,
  });
  console.log("Summary 2 (After Shareholder 1 Paid):", {
    paid: summary2.paid_amount,
    remaining: summary2.remaining_amount,
    progress: `${summary2.progress_percent}%`,
  });

  if (Number(summary2.paid_amount) !== 10000 || Number(summary2.remaining_amount) !== 50000) {
    throw new Error("Post-payment declaration summary mismatch!");
  }
  console.log("✓ Payment ledger verified: NPR 10,000 paid, NPR 50,000 remaining");

  // 6. Simulate Bank Return/Error File Upload for Shareholder 2
  // Create an in-memory workbook with ConnectIPS return format
  const errorHeaders = ["Account No", "Amount", "Status", "Reject Remarks", "Beneficiary Name"];
  const errorData = [
    ["990200002", 20000, "RJCT", "Account Dormant or Closed", "Neo Shareholder Beta"],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([errorHeaders, ...errorData]);
  XLSX.utils.book_append_sheet(wb, ws, "Returns");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const errorFile = new File([buffer], "Bank_Rejection_Batch.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Call BankErrorProcessorService with authenticated/service client
  const errorResult = await BankErrorProcessorService.processAndApplyBankErrors(
    errorFile,
    companyId,
    supabase,
  );

  console.log("Bank Error Ingestion Result:", {
    totalRows: errorResult.totalRows,
    segregatedErrors: errorResult.segregatedErrorCount,
    matchedPayables: errorResult.matchedPayablesCount,
    totalRemainingAmount: errorResult.totalRemainingPayableAmount,
  });

  if (errorResult.matchedPayablesCount !== 1) {
    throw new Error(`Expected 1 matched payable, got ${errorResult.matchedPayablesCount}`);
  }
  console.log("✓ Bank Error File parsed, segregated, and mapped to Shareholder Beta");

  // Verify Shareholder Beta is marked with returned_status and remaining balance is preserved
  const { data: betaPayable } = await supabase
    .from("dividend_payables")
    .select("payment_status, returned_status, remaining_amount, paid_amount")
    .eq("id", payableIds[1])
    .single();

  console.log("Beta Payable Status:", betaPayable);
  if (
    !betaPayable.returned_status.includes("Account Dormant or Closed") ||
    Number(betaPayable.remaining_amount) !== 20000 ||
    betaPayable.payment_status !== "Pending"
  ) {
    throw new Error(
      "Shareholder Beta was not correctly flagged as Bank Rejected / Remaining Payable!",
    );
  }
  console.log(
    "✓ Shareholder Beta correctly marked: Bank Rejected & Remaining Outstanding = NPR 20,000",
  );

  // Verify final Declaration Summary reflecting the bank failure
  const { data: summary3 } = await supabase.rpc("get_declaration_summary", {
    p_declaration_id: dec.id,
  });
  console.log("Summary 3 (With Bank Errors):", {
    paid: summary3.paid_amount,
    remaining: summary3.remaining_amount,
    failed: summary3.failed_amount,
    failed_count: summary3.failed_count,
    paid_count: summary3.paid_count,
    unpaid_count: summary3.unpaid_count,
  });

  if (Number(summary3.failed_amount) !== 20000 || summary3.failed_count !== 1) {
    throw new Error("Declaration summary failed to aggregate bank return amount!");
  }
  console.log("✓ Declaration Summary perfectly accounts for Bank Error Returns (NPR 20,000)");

  // Cleanup test records
  await supabase.from("dividend_payables").delete().in("id", payableIds);
  await supabase.from("corporate_declarations").delete().eq("id", dec.id);
  await supabase.from("clients").delete().in("id", clientIds);
  console.log("✓ Test records cleaned up cleanly.");

  console.log("\n========================================================");
  console.log("🎉 ALL RTA FLOWS VERIFIED SUCCESSFULLY WITHOUT ERRORS!");
  console.log("========================================================");
}

runVerification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
