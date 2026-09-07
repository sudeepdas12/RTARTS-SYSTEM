import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, User, Building2, Printer } from "lucide-react";
import { ExcelExporter } from "@/lib/excel-exporter";
import { format } from "date-fns";
import { toast } from "sonner";

interface ShareholderStatementDialogProps {
  boid?: string | null;
  clientId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareholderStatementDialog({
  boid,
  clientId,
  open,
  onOpenChange,
}: ShareholderStatementDialogProps) {
  const [selectedCompany, setSelectedCompany] = useState<string>("all");

  const { data: clientInfo, isLoading: isClientLoading } = useQuery({
    queryKey: ["shareholder-info", boid, clientId],
    queryFn: async () => {
      if (!boid && !clientId) return null;
      let q = supabase.from("clients").select("*, company:companies(company_name, company_code)");
      if (boid) q = q.eq("boid", boid);
      else if (clientId) q = q.eq("id", clientId);
      const { data, error } = await q.maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: open && (!!boid || !!clientId),
  });

  const resolvedClientId = clientInfo?.id || clientId;
  const resolvedBoid = clientInfo?.boid || boid;

  const { data: statementRecords = [], isLoading: isStatementLoading } = useQuery({
    queryKey: ["shareholder-statement-ledger", resolvedClientId, resolvedBoid],
    queryFn: async () => {
      if (!resolvedClientId && !resolvedBoid) return [];

      // Find all client records belonging to this BOID (across all companies)
      let clientIds = [resolvedClientId].filter(Boolean) as string[];
      if (resolvedBoid) {
        const { data: sameBoidClients } = await (supabase as any)
          .from("clients")
          .select("id")
          .eq("boid", resolvedBoid);
        if (sameBoidClients?.length) {
          clientIds = Array.from(new Set([...clientIds, ...sameBoidClients.map((c: any) => c.id)]));
        }
      }

      if (clientIds.length === 0) return [];

      // 1. Fetch Payments to link actual payment references and dates
      const { data: paymentRows } = await (supabase as any)
        .from("payments")
        .select("*")
        .in("client_id", clientIds);

      const paymentMap = new Map<string, any>();
      for (const p of paymentRows || []) {
        if (p.payable_id) paymentMap.set(p.payable_id, p);
      }

      // 2. Fetch Interest Payables across all companies
      const { data: interestRows } = await (supabase as any)
        .from("interest_payables")
        .select("*, company:companies(company_name, company_code)")
        .in("client_id", clientIds);

      // 3. Fetch Dividend Payables across all companies
      const { data: dividendRows } = await (supabase as any)
        .from("dividend_payables")
        .select("*, company:companies(company_name, company_code)")
        .in("client_id", clientIds);

      // 4. Fetch Mutual Fund Payables across all schemes
      const { data: mutualFundRows } = await (supabase as any)
        .from("mutual_fund_payables")
        .select("*, company:companies(company_name, company_code)")
        .in("client_id", clientIds);

      const records: Array<{
        id: string;
        type: string;
        companyId: string | null;
        companyName: string;
        companyCode: string;
        fiscalYear: string;
        kitta: number;
        grossAmount: number;
        taxAmount: number;
        netAmount: number;
        status: string;
        paymentDate: string | null;
        paymentRef: string | null;
        bankDetails: string | null;
        remarks: string | null;
      }> = [];

      for (const r of interestRows || []) {
        const linkedPay = paymentMap.get(r.id);
        const derivedKitta =
          Number(r.shares_held || r.kitta || 0) ||
          Math.round(Number(r.gross_interest || 0) / (1000 * 0.085 * (183 / 365))) ||
          0;
        records.push({
          id: r.id,
          type: "Debenture Interest",
          companyId: r.company_id || null,
          companyCode: r.company?.company_code || "DEB",
          companyName: r.company?.company_name || "Debentures",
          fiscalYear: r.fiscal_year || "2082/83",
          kitta: derivedKitta,
          grossAmount: Number(r.gross_interest || 0),
          taxAmount: Number(r.tax_amount || 0),
          netAmount: Number(r.net_payable || 0),
          status: r.payment_status || (linkedPay ? "Paid" : "Pending"),
          paymentDate: r.payment_date || linkedPay?.payment_date || null,
          paymentRef:
            r.payment_reference ||
            linkedPay?.payment_reference ||
            linkedPay?.connectips_ref ||
            (r.payment_status === "Paid" ? "RECON-AUTO" : null),
          bankDetails: r.bank_account_no ? `${r.bank_name || ""} (${r.bank_account_no})` : null,
          remarks: r.remarks || null,
        });
      }

      for (const r of dividendRows || []) {
        const linkedPay = paymentMap.get(r.id);
        const hasBonus = Number(r.bonus_issued || r.bonus_actual || 0) > 0;
        let divType: string = r.dividend_type || (hasBonus ? "Bonus Share" : "Cash Dividend");
        if (divType === "Stock Dividend" && !hasBonus) {
          divType = "Cash Dividend";
        }
        records.push({
          id: r.id,
          type: divType,
          companyId: r.company_id || null,
          companyCode: r.company?.company_code || "EQ",
          companyName: r.company?.company_name || "Equities",
          fiscalYear: r.fiscal_year || "2081/82",
          kitta: Number(r.shares_held || r.after_bonus_kitta || 0),
          grossAmount: Number(r.gross_dividend || 0),
          taxAmount: Number(r.tax_amount || 0),
          netAmount: Number(r.net_payable || 0),
          status: r.payment_status || (linkedPay ? "Paid" : "Pending"),
          paymentDate: r.payment_date || linkedPay?.payment_date || null,
          paymentRef:
            r.payment_reference ||
            linkedPay?.payment_reference ||
            linkedPay?.connectips_ref ||
            null,
          bankDetails: r.bank_account_no ? `${r.bank_name || ""} (${r.bank_account_no})` : null,
          remarks: r.remarks || null,
        });
      }

      for (const r of mutualFundRows || []) {
        const linkedPay = paymentMap.get(r.id);
        records.push({
          id: r.id,
          type: "Mutual Fund",
          companyId: r.company_id || null,
          companyCode: r.company?.company_code || "MF",
          companyName: r.company?.company_name || "Mutual Funds",
          fiscalYear: r.fiscal_year || "2081/82",
          kitta: Number(r.shares_held || 0),
          grossAmount: Number(r.gross_dividend || 0),
          taxAmount: Number(r.tax_amount || 0),
          netAmount: Number(r.net_payable || 0),
          status: r.payment_status || (linkedPay ? "Paid" : "Pending"),
          paymentDate: r.payment_date || linkedPay?.payment_date || null,
          paymentRef:
            r.payment_reference ||
            linkedPay?.payment_reference ||
            linkedPay?.connectips_ref ||
            null,
          bankDetails: r.bank_account_no ? `${r.bank_name || ""} (${r.bank_account_no})` : null,
          remarks: r.remarks || null,
        });
      }

      // 5. Fetch Historical AGM Yearly Snapshots across all fiscal years (e.g. 2075/76 - 2081/82)
      if (resolvedBoid) {
        try {
          const { data: agmSnaps } = await (supabase as any)
            .from("agm_yearly_snapshots")
            .select("*")
            .eq("boid", resolvedBoid)
            .order("fiscal_year", { ascending: false });

          // Track which fiscal years already have an identical cash dividend row in dividendRows
          const existingDivFySet = new Set(
            (dividendRows || []).map(
              (d: any) => `${d.fiscal_year || ""}_${Number(d.gross_dividend || 0).toFixed(2)}`,
            ),
          );

          for (const s of agmSnaps || []) {
            const snapGross = Number(s.gross_cash_dividend || 0);
            const snapTax =
              Number(s.cash_tax_withheld || 0) + Number(s.bonus_tax_withheld || 0);
            const snapNet = Number(s.net_cash_payable || 0);
            const snapBonus = Number(s.issued_whole_bonus || 0);
            const snapKitta = Number(s.base_kitta || s.post_event_kitta || 0);

            // Avoid double-counting if an exact matching fiscal year and gross cash is in dividendRows
            const dupKey = `${s.fiscal_year || ""}_${snapGross.toFixed(2)}`;
            if (snapGross > 0 && existingDivFySet.has(dupKey)) {
              continue;
            }

            let distType = "Cash Dividend";
            if (snapBonus > 0 && snapGross > 0) {
              distType = "Bonus & Cash Dividend";
            } else if (snapBonus > 0) {
              distType = "Bonus Share";
            } else if (s.event_name && s.event_name.toLowerCase().includes("right")) {
              distType = "Right Issue";
            }

            let status = "Pending";
            if (snapNet > 0) {
              status = "Pending";
            } else if (snapBonus > 0) {
              status = `Bonus Allotted (${snapBonus.toLocaleString()} Kitta)`;
            } else if (snapKitta === 0 && Number(s.carried_new_fraction || 0) > 0) {
              status = `Fraction (${Number(s.carried_new_fraction).toFixed(4)} Kitta)`;
            } else {
              status = "Settled";
            }

            const companyObj = Array.isArray((clientInfo as any)?.company)
              ? (clientInfo as any).company[0]
              : (clientInfo as any)?.company;
            const compName = companyObj?.company_name || "NLG Insurance";
            const compCode = companyObj?.company_code || "NLG";
            const compId =
              (clientInfo as any)?.company_id || "48453aaa-2980-45a1-a47f-b7adcf3d086b";

            records.push({
              id: s.id,
              type: distType,
              companyId: compId,
              companyCode: compCode,
              companyName: compName,
              fiscalYear: s.fiscal_year || "Historical",
              kitta: snapKitta,
              grossAmount: snapGross,
              taxAmount: snapTax,
              netAmount: snapNet,
              status: status,
              paymentDate: null,
              paymentRef: s.event_name || null,
              bankDetails: clientInfo?.bank_account_no
                ? `${clientInfo?.bank_name || ""} (${clientInfo?.bank_account_no})`
                : null,
              remarks: [s.event_name, s.remarks].filter(Boolean).join(" — ") || null,
            });
          }
        } catch (agmErr) {
          console.warn("Could not fetch AGM historical snapshots for statement:", agmErr);
        }
      }

      // Sort chronologically (latest fiscal year first, then by date and company)
      records.sort((a, b) => {
        const fyComp = (b.fiscalYear || "").localeCompare(a.fiscalYear || "");
        if (fyComp !== 0) return fyComp;
        if (a.paymentDate && b.paymentDate) {
          const dateComp = b.paymentDate.localeCompare(a.paymentDate);
          if (dateComp !== 0) return dateComp;
        }
        return (a.companyName || "").localeCompare(b.companyName || "");
      });

      return records;
    },
    enabled: open && (!!resolvedClientId || !!resolvedBoid),
  });

  const distinctCompanies = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const r of statementRecords) {
      const key = r.companyName;
      if (key && !map.has(key)) {
        map.set(key, { code: r.companyCode, name: r.companyName });
      }
    }
    return Array.from(map.values());
  }, [statementRecords]);

  const filteredRecords = useMemo(() => {
    if (selectedCompany === "all") return statementRecords;
    return statementRecords.filter((r) => r.companyName === selectedCompany);
  }, [statementRecords, selectedCompany]);

  const totals = useMemo(() => {
    let gross = 0,
      tax = 0,
      net = 0,
      paid = 0,
      pending = 0;
    for (const r of filteredRecords) {
      gross += r.grossAmount;
      tax += r.taxAmount;
      net += r.netAmount;
      const statusLower = (r.status || "").toLowerCase();
      if (statusLower === "paid" || statusLower === "completed" || statusLower === "settled") {
        paid += r.netAmount;
      } else {
        pending += r.netAmount;
      }
    }
    return { gross, tax, net, paid, pending };
  }, [filteredRecords]);

  const latestHoldingKitta = useMemo(() => {
    if (!filteredRecords.length) return 0;
    const active = filteredRecords.find((r) => Number(r.kitta) > 0);
    return active ? Number(active.kitta) : 0;
  }, [filteredRecords]);

  const handleExport = () => {
    if (!statementRecords.length) return;
    ExcelExporter.exportModernStatement({
      fileName: `Statement_${resolvedBoid || clientInfo?.full_name || "Shareholder"}_${format(new Date(), "yyyyMMdd")}`,
      title: "Shareholder Payout & Distribution Statement",
      subtitle: `Official Historical Entitlement Ledger${selectedCompany !== "all" ? ` — ${selectedCompany}` : " — Consolidated Portfolio"}`,
      shareholder: {
        name: clientInfo?.full_name || "Shareholder",
        fatherName: clientInfo?.father_name || undefined,
        boid: resolvedBoid || "—",
        pan: clientInfo?.pan_no || clientInfo?.citizenship_no || clientInfo?.pan_or_citizenship || "—",
        holderType: clientInfo?.holder_type || "Natural Person - Public",
        bankName: clientInfo?.bank_name || "—",
        bankAccountNo: clientInfo?.bank_account_no || "—",
        phone: clientInfo?.phone || undefined,
      },
      summary: totals,
      records: filteredRecords,
    });
    toast.success("Executive-grade statement exported to Excel.");
  };

  const handlePrint = () => {
    // Dedicated, bulletproof iframe printer: eliminates blank pages and host app duplicates
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "none";
    document.body.appendChild(printFrame);

    const fmtNpr = (v: number) =>
      `NPR ${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateStr = format(new Date(), "dd MMM yyyy, HH:mm");

    const rowsHtml = filteredRecords
      .map(
        (r, i) => `
      <tr>
        <td style="text-align: center; font-family: monospace;">${i + 1}</td>
        <td style="font-weight: 600; font-family: monospace;">${r.fiscalYear}</td>
        <td>
          <div style="font-weight: 700; color: #0f2744;">${r.companyName}</div>
          ${r.companyCode ? `<div style="font-size: 8.5px; color: #64748b; font-family: monospace;">${r.companyCode}</div>` : ""}
        </td>
        <td>
          <span class="badge badge-type">${r.type}</span>
          ${r.remarks ? `<div style="font-size: 8px; color: #64748b; margin-top: 2px; max-width: 140px; word-break: break-word;">${r.remarks}</div>` : ""}
        </td>
        <td style="text-align: right; font-weight: 600; font-family: monospace;">${r.kitta > 0 ? r.kitta.toLocaleString() : "—"}</td>
        <td style="text-align: right; font-family: monospace;">${r.grossAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="text-align: right; color: #d97706; font-family: monospace;">${r.taxAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="text-align: right; font-weight: 700; font-family: monospace; color: #0f172a;">${r.netAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td><span class="badge ${r.status === "Paid" ? "badge-paid" : r.status === "Partial" ? "badge-partial" : "badge-pending"}">${r.status}</span></td>
        <td style="font-size: 9px; color: #475569;">
          ${r.paymentDate ? `<div>${format(new Date(r.paymentDate), "dd MMM yyyy")}</div>` : ""}
          ${r.paymentRef ? `<div style="font-family: monospace; font-size: 8px; color: #64748b;">${r.paymentRef}</div>` : ""}
          ${!r.paymentDate && !r.paymentRef ? "—" : ""}
        </td>
      </tr>
    `,
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Statement_${resolvedBoid || "Shareholder"}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 14mm 14mm 14mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 10.5px;
            line-height: 1.35;
          }
          .doc-header {
            border-bottom: 2px solid #0f2744;
            padding-bottom: 8px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .brand-title {
            font-size: 15px;
            font-weight: 800;
            color: #0f2744;
            letter-spacing: -0.01em;
            text-transform: uppercase;
          }
          .brand-subtitle {
            font-size: 12px;
            font-weight: 700;
            color: #1e293b;
            margin-top: 2px;
          }
          .brand-nepali {
            font-size: 10px;
            color: #64748b;
            margin-top: 1px;
          }
          .meta-stamp {
            text-align: right;
            font-size: 9px;
            color: #64748b;
          }
          .meta-stamp strong {
            display: block;
            color: #0f2744;
            font-size: 10px;
          }
          .shareholder-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 10px;
            display: grid;
            grid-template-columns: 1.2fr 1fr 1fr 1fr;
            gap: 8px;
          }
          .info-col label {
            display: block;
            font-size: 8.5px;
            text-transform: uppercase;
            color: #64748b;
            font-weight: 700;
            letter-spacing: 0.03em;
          }
          .info-col span {
            font-size: 11px;
            font-weight: 700;
            color: #0f172a;
          }
          .info-col .boid {
            font-family: monospace;
            color: #0284c7;
            font-size: 12px;
          }
          .metrics-strip {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 12px;
          }
          .metric-tile {
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 6px 10px;
            background: #ffffff;
          }
          .metric-tile.paid {
            border-color: #a7f3d0;
            background: #f0fdf4;
          }
          .metric-tile.pending {
            border-color: #fecdd3;
            background: #fff1f2;
          }
          .metric-tile-label {
            font-size: 8.5px;
            color: #64748b;
            font-weight: 700;
            text-transform: uppercase;
          }
          .metric-tile-val {
            font-size: 12.5px;
            font-weight: 800;
            font-family: monospace;
            margin-top: 2px;
          }
          .metric-tile-val.paid { color: #059669; }
          .metric-tile-val.pending { color: #e11d48; }
          .metric-tile-val.tax { color: #d97706; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 9.5px;
          }
          th {
            background: #f1f5f9;
            color: #1e293b;
            text-align: left;
            padding: 6px 8px;
            font-weight: 700;
            border-top: 1px solid #cbd5e1;
            border-bottom: 2px solid #64748b;
            white-space: nowrap;
          }
          td {
            padding: 5px 8px;
            border-bottom: 1px solid #e2e8f0;
            color: #1e293b;
          }
          tr:nth-child(even) td { background: #fafafa; }
          tr { page-break-inside: avoid; }
          thead { display: table-header-group; }
          tfoot tr td {
            background: #f1f5f9 !important;
            border-top: 2px solid #0f2744;
            border-bottom: 2px solid #0f2744;
            font-weight: 800;
            font-size: 10px;
          }
          .badge {
            display: inline-block;
            padding: 1.5px 5px;
            border-radius: 3px;
            font-size: 8.5px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .badge-type {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #334155;
          }
          .badge-paid { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
          .badge-pending { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
          .badge-partial { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }
          .disclaimer-block {
            margin-top: 24px;
            border-top: 1px dashed #cbd5e1;
            padding-top: 10px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            font-size: 8.5px;
            color: #64748b;
          }
          .sig-box {
            text-align: center;
            width: 150px;
            border-top: 1px solid #334155;
            padding-top: 4px;
            font-size: 9px;
            font-weight: 700;
            color: #1e293b;
            margin-top: 40px;
          }
        </style>
      </head>
      <body>
        <div class="doc-header">
          <div>
            <div class="brand-title">RTA / RTS System — Registrar & Transfer Agent</div>
            <div class="brand-subtitle">Shareholder Payout & Distribution Statement</div>
            <div class="brand-nepali">लाभांश तथा ब्याज भुक्तानी विवरण — एकीकृत लगानीकर्ता खाता</div>
            ${selectedCompany !== "all" ? `<div style="font-size: 9px; color: #0284c7; font-weight: 600; margin-top: 2px;">Filtered Entity: ${selectedCompany}</div>` : ""}
          </div>
          <div class="meta-stamp">
            <strong>CONFIDENTIAL & VERIFIED</strong>
            <div>Generated: ${dateStr}</div>
            <div>Total Transactions: ${filteredRecords.length}</div>
          </div>
        </div>

        <div class="shareholder-card">
          <div class="info-col">
            <label>Shareholder Name</label>
            <span>${clientInfo?.full_name || "—"}</span>
            ${clientInfo?.father_name ? `<div style="font-size: 8.5px; color: #64748b;">s/o ${clientInfo.father_name}</div>` : ""}
          </div>
          <div class="info-col">
            <label>BOID (16-Digit Demat)</label>
            <span class="boid">${resolvedBoid || "—"}</span>
            <div style="font-size: 8.5px; color: #64748b;">${clientInfo?.holder_type || "Natural Person - Public"}</div>
          </div>
          <div class="info-col">
            <label>PAN / Citizenship</label>
            <span>${clientInfo?.pan_no || clientInfo?.citizenship_no || clientInfo?.pan_or_citizenship || "—"}</span>
            ${clientInfo?.phone ? `<div style="font-size: 8.5px; color: #64748b;">Ph: ${clientInfo.phone}</div>` : ""}
          </div>
          <div class="info-col">
            <label>Registered Bank Account</label>
            <span style="font-size: 10px;">${clientInfo?.bank_name || "—"}</span>
            <div style="font-size: 9px; font-family: monospace; color: #475569;">${clientInfo?.bank_account_no || "—"}</div>
          </div>
        </div>

        <div class="metrics-strip">
          <div class="metric-tile">
            <div class="metric-tile-label">Total Gross Entitlements</div>
            <div class="metric-tile-val">${fmtNpr(totals.gross)}</div>
          </div>
          <div class="metric-tile">
            <div class="metric-tile-label">Total TDS Tax Withheld</div>
            <div class="metric-tile-val tax">${fmtNpr(totals.tax)}</div>
          </div>
          <div class="metric-tile paid">
            <div class="metric-tile-label" style="color: #059669;">Total Net Settled (Paid)</div>
            <div class="metric-tile-val paid">${fmtNpr(totals.paid)}</div>
          </div>
          <div class="metric-tile pending">
            <div class="metric-tile-label" style="color: #e11d48;">Total Pending (Due)</div>
            <div class="metric-tile-val pending">${fmtNpr(totals.pending)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 25px; text-align: center;">S.N.</th>
              <th style="width: 55px;">FY</th>
              <th>Company / Scheme</th>
              <th>Type</th>
              <th style="text-align: right;">Holding (Kitta)</th>
              <th style="text-align: right;">Gross (NPR)</th>
              <th style="text-align: right;">TDS (NPR)</th>
              <th style="text-align: right;">Net (NPR)</th>
              <th style="width: 55px;">Status</th>
              <th>Payment Ref / Date</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="text-align: right; text-transform: uppercase;">Active Holding / Entitlements</td>
              <td style="text-align: right; font-family: monospace;">${latestHoldingKitta > 0 ? latestHoldingKitta.toLocaleString() : "—"}</td>
              <td style="text-align: right; font-family: monospace;">${totals.gross.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right; font-family: monospace; color: #d97706;">${totals.tax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right; font-family: monospace; color: #0f172a;">${totals.net.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td colspan="2" style="font-size: 8.5px; color: #64748b;">${filteredRecords.length} total entries</td>
            </tr>
          </tfoot>
        </table>

        <div class="disclaimer-block">
          <div>
            <div>• This document is an authentic electronic record issued pursuant to the Nepal Companies Act & SEBON Directives.</div>
            <div>• For discrepancies in Demat or Bank accounts, please contact the Share Registrar desk with valid documentation.</div>
          </div>
          <div class="sig-box">
            Authorized Signatory<br>
            <span style="font-weight: normal; font-size: 8px; color: #64748b;">RTA / RTS Operations Department</span>
          </div>
        </div>
      </body>
      </html>
    `;

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();
      printFrame.contentWindow?.focus();
      setTimeout(() => {
        printFrame.contentWindow?.print();
        setTimeout(() => {
          if (document.body.contains(printFrame)) {
            document.body.removeChild(printFrame);
          }
        }, 3000);
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto print-statement-modal">
        <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <div>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <User className="w-5 h-5 text-primary print:hidden" />
              Shareholder Payout & Distribution Statement (लाभांश / ब्याज विवरण)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete historical transaction ledger across all fiscal years and schemes.
              {selectedCompany !== "all" && ` • Filter: ${selectedCompany}`}
            </DialogDescription>
          </div>
          <div className="hidden print:block text-right text-[10px] text-muted-foreground font-mono">
            <div>CONFIDENTIAL & PROPRIETARY</div>
            <div>Generated: {format(new Date(), "dd MMM yyyy, HH:mm")}</div>
          </div>
          {statementRecords.length > 0 && (
            <div className="flex items-center gap-2 no-print print:hidden">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs cursor-pointer no-print print:hidden"
                onClick={handlePrint}
              >
                <Printer className="w-3.5 h-3.5 mr-1.5" />
                Print
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs cursor-pointer no-print print:hidden"
                onClick={handleExport}
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export (Excel)
              </Button>
            </div>
          )}
        </DialogHeader>

        {/* Shareholder Metadata Header */}
        <div className="bg-muted/30 p-3.5 rounded-lg border text-xs grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <span className="text-muted-foreground block text-[11px]">Shareholder Name</span>
            <span className="font-bold text-foreground text-sm">
              {clientInfo?.full_name || "—"}
            </span>
            {clientInfo?.father_name && (
              <span className="text-[10px] text-muted-foreground block">
                s/o {clientInfo.father_name}
              </span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">BOID (Demat No.)</span>
            <span className="font-mono font-bold text-primary block">{resolvedBoid || "—"}</span>
            <span className="text-[10px] text-muted-foreground">
              {clientInfo?.holder_type || "Natural Person - Public"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Bank Account</span>
            <span className="font-medium text-foreground truncate block">
              {clientInfo?.bank_name || "—"}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {clientInfo?.bank_account_no || "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">PAN / Citizenship</span>
            <span className="font-mono font-bold text-foreground block">
              {clientInfo?.pan_no ||
                clientInfo?.citizenship_no ||
                clientInfo?.pan_or_citizenship ||
                "—"}
            </span>
            {clientInfo?.phone && (
              <span className="text-[10px] text-muted-foreground">Phone: {clientInfo.phone}</span>
            )}
          </div>
        </div>

        {/* Summary Metric Strips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Card className="p-2.5 bg-card">
            <span className="text-[11px] text-muted-foreground block">Total Gross Earnings</span>
            <span className="text-sm font-bold font-mono">
              NPR {totals.gross.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </Card>
          <Card className="p-2.5 bg-card">
            <span className="text-[11px] text-muted-foreground block">
              Total Tax (TDS) Withheld
            </span>
            <span className="text-sm font-bold font-mono text-amber-600">
              NPR {totals.tax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </Card>
          <Card className="p-2.5 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block">
              Total Net Paid (Settled)
            </span>
            <span className="text-sm font-bold font-mono text-emerald-600">
              NPR {totals.paid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </Card>
          <Card className="p-2.5 bg-rose-50/50 dark:bg-rose-950/20 border-rose-200">
            <span className="text-[11px] text-rose-700 dark:text-rose-400 block">
              Total Pending (Due)
            </span>
            <span className="text-sm font-bold font-mono text-rose-600">
              NPR {totals.pending.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </Card>
        </div>

        {/* Multi-Company Selector (if shareholder has investments in multiple companies) */}
        {distinctCompanies.length > 1 && (
          <div className="flex items-center justify-between bg-muted/40 p-2.5 rounded-lg border text-xs no-print print:hidden">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">Filter by Company / Scheme:</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {distinctCompanies.length} Companies in Portfolio
              </Badge>
            </div>
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger className="h-8 w-60 text-xs bg-background">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies / Schemes (Unified 360°)</SelectItem>
                {distinctCompanies.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.code ? `${c.code} — ` : ""}
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Historical Distribution Table */}
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 text-xs">
                <TableHead>Fiscal Year</TableHead>
                <TableHead>Scheme / Company</TableHead>
                <TableHead className="text-right">Holding (Kitta)</TableHead>
                <TableHead>Distribution Type</TableHead>
                <TableHead className="text-right">Gross (NPR)</TableHead>
                <TableHead className="text-right">TDS (NPR)</TableHead>
                <TableHead className="text-right">Net Payable</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Ref / Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isStatementLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-xs text-muted-foreground">
                    Loading historical statement...
                  </TableCell>
                </TableRow>
              ) : filteredRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-xs text-muted-foreground">
                    No distribution or payment records found for this shareholder.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRecords.map((r) => (
                  <TableRow key={r.id} className="text-xs hover:bg-muted/30">
                    <TableCell className="font-semibold font-mono">{r.fiscalYear}</TableCell>
                    <TableCell className="font-medium">
                      <div className="font-semibold">{r.companyName}</div>
                      {r.companyCode && (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.companyCode}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-primary">
                      {r.kitta > 0 ? r.kitta.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {r.type}
                      </Badge>
                      {r.remarks && (
                        <div
                          className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px] truncate"
                          title={r.remarks}
                        >
                          {r.remarks}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r.grossAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-amber-600">
                      {r.taxAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground">
                      {r.netAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "Paid"
                            ? "default"
                            : r.status === "Rejected"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[11px]">
                      {r.paymentDate && (
                        <div className="text-foreground font-medium">
                          {format(new Date(r.paymentDate), "dd MMM yyyy")}
                        </div>
                      )}
                      {r.paymentRef && (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.paymentRef}
                        </div>
                      )}
                      {!r.paymentDate && !r.paymentRef && "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {filteredRecords.length > 0 && (
              <TableFooter>
                <TableRow className="bg-muted/60 font-semibold text-xs border-t-2">
                  <TableCell colSpan={2} className="uppercase tracking-wider font-bold">
                    Grand Total ({filteredRecords.length} record{filteredRecords.length !== 1 ? "s" : ""})
                  </TableCell>
                  <TableCell
                    className="text-right font-mono font-bold text-primary"
                    title="Latest Active Holding Balance"
                  >
                    {latestHoldingKitta > 0 ? latestHoldingKitta.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono font-bold">
                    {totals.gross.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-amber-600">
                    {totals.tax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-foreground">
                    {totals.net.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell colSpan={2} className="text-right text-[11px] text-muted-foreground">
                    Settled: NPR {totals.paid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
