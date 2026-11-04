import React, { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Building2,
  User,
  ArrowRight,
  Info,
  Scale,
  Database,
  Eye,
  EyeOff,
  Loader2,
  History,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PayeeClassification } from "@/lib/classification-review.functions";
import { smartClassify } from "@/lib/services/smart-classifier";
import {
  loadTaxRules,
  getTaxRateFromRules,
  TaxRule,
  TaxClassification,
  TAX_CLASSIFICATION_LABEL,
} from "@/lib/services/tax-rules.service";

export interface ClassificationEvidence {
  matched_rules?: string[];
  extraction_signals?: Record<string, string | number | boolean>;
  boid?: string | null;
  pan_or_citizenship?: string | null;
  father_name?: string | null;
  grandfather_name?: string | null;
  holder_type?: string | null;
  [key: string]: unknown;
}

export interface ExplainabilityClient {
  id: string;
  company_id?: string | null;
  full_name: string;
  boid?: string | null;
  pan_or_citizenship?: string | null;
  pan_no?: string | null;
  citizenship_no?: string | null;
  father_name?: string | null;
  grandfather_name?: string | null;
  holder_type?: string | null;
  payee_classification?: PayeeClassification | "UNCLASSIFIED" | null;
  persisted_payee_classification?: PayeeClassification | "UNCLASSIFIED" | null;
  payee_segment?: string | null;
  classification_source?: string | null;
  classification_rule_version?: string | null;
  classified_at?: string | null;
  classification_evidence?: ClassificationEvidence | null;
  updated_at?: string | null;
}

export interface ClassificationExplainabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ExplainabilityClient | null;
  taxRules?: TaxRule[];
  onConfirmClassification?: (
    id: string,
    classification: PayeeClassification,
    segment?: string,
    ruleVersion?: string,
    evidence?: Record<string, unknown>,
  ) => void;
  isPending?: boolean;
}

const SENSITIVE_EVIDENCE_KEYS = new Set([
  "pan",
  "pan_no",
  "citizenship",
  "citizenship_no",
  "pan_or_citizenship",
  "boid",
  "father_name",
  "grandfather_name",
  "lineage",
  "bank_account_no",
  "account_no",
  "phone",
  "mobile",
  "address",
  "dob",
  "date_of_birth",
]);

function maskSensitiveEvidence(key: string, val: unknown): string {
  if (val == null) return "—";
  const str = String(val).trim();
  const lowerKey = key.toLowerCase();
  const isSensitive =
    SENSITIVE_EVIDENCE_KEYS.has(lowerKey) ||
    lowerKey.includes("boid") ||
    lowerKey.includes("pan") ||
    lowerKey.includes("citizenship") ||
    lowerKey.includes("father") ||
    lowerKey.includes("lineage") ||
    lowerKey.includes("account");

  if (!isSensitive) return str;
  if (str.length <= 4) return "••••";
  return `${str.slice(0, 2)}••••••${str.slice(-2)}`;
}

function fmtCurrency(val: number): string {
  return (
    "NPR " +
    Number(val || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function maskBoid(boid?: string | null): string {
  if (!boid) return "—";
  const str = String(boid).trim();
  if (str.length <= 8) return str;
  return `${str.slice(0, 5)}••••••${str.slice(-3)}`;
}

function maskPanOrCitizenship(val?: string | null): string {
  if (!val) return "—";
  const str = String(val).trim();
  if (str.length <= 4) return "••••";
  return `${str.slice(0, 2)}••••••${str.slice(-2)}`;
}

export function ClassificationExplainabilityDialog({
  open,
  onOpenChange,
  client,
  taxRules: initialTaxRules,
  onConfirmClassification,
  isPending,
}: ClassificationExplainabilityDialogProps) {
  const { user, hasAny } = useAuth();
  const canRevealSensitive = hasAny(["admin", "supervisor", "approver", "auditor"]);

  const [sampleGross, setSampleGross] = useState<number>(10000);
  const [grossInputError, setGrossInputError] = useState<string | null>(null);
  const [dbTaxRules, setDbTaxRules] = useState<TaxRule[]>(initialTaxRules || []);
  const [revealSensitive, setRevealSensitive] = useState<boolean>(false);
  const [isLoadingRules, setIsLoadingRules] = useState<boolean>(!initialTaxRules?.length);
  const [rulesError, setRulesError] = useState<string | null>(null);

  // Security Invariant: Reset reveal state whenever client or dialog open state changes
  useEffect(() => {
    setRevealSensitive(false);
  }, [client?.id, open]);

  const handleToggleReveal = async () => {
    if (!canRevealSensitive || !client) return;
    const next = !revealSensitive;
    if (next) {
      try {
        await (supabase as any).rpc("record_sensitive_reveal_audit", {
          p_client_id: client.id,
          p_company_id: client.company_id || null,
          p_purpose: "classification_explainability_inspection",
        });
      } catch (auditErr) {
        console.warn("Durable audit event logging failed:", auditErr);
      }
    }
    setRevealSensitive(next);
  };

  const handleGrossChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      setSampleGross(0);
      setGrossInputError(null);
      return;
    }
    const val = Number(raw);
    if (!Number.isFinite(val) || isNaN(val) || val < 0) {
      setGrossInputError("Please enter a valid finite non-negative number.");
      return;
    }
    if (val > 1_000_000_000) {
      setGrossInputError("Amount exceeds maximum simulation threshold (NPR 1,000,000,000).");
      return;
    }
    setGrossInputError(null);
    setSampleGross(val);
  };

  useEffect(() => {
    if (!initialTaxRules || initialTaxRules.length === 0) {
      setIsLoadingRules(true);
      setRulesError(null);
      loadTaxRules()
        .then((rules) => {
          setDbTaxRules(rules);
          setIsLoadingRules(false);
        })
        .catch((err) => {
          console.warn("Could not load tax rules for explainability:", err);
          setRulesError(
            "Could not load authoritative database tax rules. Please verify database connectivity.",
          );
          setIsLoadingRules(false);
        });
    } else {
      setDbTaxRules(initialTaxRules);
      setIsLoadingRules(false);
    }
  }, [initialTaxRules]);

  const explanation = useMemo(() => {
    if (!client) {
      return {
        reason: "",
        reasonsList: [] as string[],
        ruleTitle: "",
        taxRatePct: 0,
        beforeRatePct: 0,
        targetClassification: "UNCLASSIFIED" as PayeeClassification,
        confidence: 0,
        sourceMatchedCategory: "PUBLIC",
        ruleSource: "Database Default",
        hasAuthoritativeRule: false,
        isSettledServerDecision: false,
        classificationSource: "Not recorded",
        ruleVersion: "Not recorded",
        classifiedAt: "Not recorded",
        effectiveFrom: "Not recorded",
        serverEvidence: null as ClassificationEvidence | null,
      };
    }

    // Server-authoritative check: verify if a valid classification is persisted
    const persistedClass = client.payee_classification || client.persisted_payee_classification;
    const isSettledServerDecision = Boolean(persistedClass && persistedClass !== "UNCLASSIFIED");

    const targetClass = isSettledServerDecision
      ? (persistedClass as TaxClassification)
      : ("UNCLASSIFIED" as unknown as TaxClassification);

    // Resolve rate exclusively from database active rules - fail closed without silent hardcoded fallback
    const matchingRule = isSettledServerDecision
      ? dbTaxRules.find(
          (r) =>
            r.payable_category === "DIVIDEND" &&
            r.payee_classification === targetClass &&
            r.is_active,
        )
      : null;

    const hasAuthoritativeRule = matchingRule != null;
    const resolvedRate = matchingRule != null ? Number(matchingRule.tax_rate) : null;
    const taxRatePct = resolvedRate != null ? Math.round(resolvedRate * 10000) / 100 : 0;

    // Comparison rate derived from database active rule metadata, or zero if unclassified
    const beforeRate =
      matchingRule?.comparison_rate != null
        ? Math.round(Number(matchingRule.comparison_rate) * 10000) / 100
        : isSettledServerDecision && targetClass === "NATURAL_PERSON"
          ? 15
          : 0;

    // Statutory rule title derived directly from database tax-rules record
    const ruleTitle = isSettledServerDecision
      ? matchingRule?.statutory_citation ||
        (targetClass === "TAX_EXEMPT"
          ? "Section 10 Statutory Tax Exemption (0% Withholding)"
          : targetClass === "COMPANY_INSTITUTION"
            ? "Section 88 Corporate Dividend Withholding (15% Legal Person Rate)"
            : targetClass === "NATURAL_PERSON"
              ? "Section 88 Resident Individual Dividend Final Withholding (5% Rate)"
              : `Nepal Income Tax Act 2058 - ${TAX_CLASSIFICATION_LABEL[targetClass] || targetClass}`)
      : "Pending Authoritative Server Classification Decision";

    const effectiveFrom = matchingRule?.effective_from || "Not recorded";
    const classificationSource =
      client.classification_source ||
      (isSettledServerDecision ? "persisted_core_ledger" : "Not recorded");
    const ruleVersion = client.classification_rule_version || "Not recorded";
    const classifiedAt = client.classified_at
      ? new Date(client.classified_at).toLocaleString()
      : "Not recorded";
    const serverEvidence = client.classification_evidence || null;

    const reasonsList: string[] = [];
    if (isSettledServerDecision) {
      reasonsList.push(`Persisted Server Classification: ${persistedClass}`);
    } else {
      reasonsList.push(
        "Awaiting authoritative server classification. Record is currently UNCLASSIFIED.",
      );
    }
    if (client.pan_or_citizenship || client.pan_no || client.citizenship_no) {
      const rawId = client.pan_or_citizenship || client.pan_no || client.citizenship_no;
      reasonsList.push(
        `Identifier Verified: ${revealSensitive ? rawId : maskPanOrCitizenship(rawId)}`,
      );
    }
    if (client.father_name || client.grandfather_name) {
      reasonsList.push(
        revealSensitive
          ? `Family Lineage Confirmed: Father (${client.father_name || "—"}), Grandfather (${client.grandfather_name || "—"})`
          : "Family Lineage Verified (Multi-generational registry records confirmed)",
      );
    }
    if (serverEvidence && typeof serverEvidence === "object") {
      Object.entries(serverEvidence).forEach(([k, v]) => {
        const masked = revealSensitive ? String(v) : maskSensitiveEvidence(k, v);
        reasonsList.push(`Server Signal (${k}): ${masked}`);
      });
    }

    const ruleSource = hasAuthoritativeRule
      ? `Active Database Rule: ${matchingRule?.id || "payable_tax_rules"} (${matchingRule ? `${matchingRule.payable_category} / ${matchingRule.payee_classification}` : ""}) [Effective: ${effectiveFrom}]`
      : isSettledServerDecision
        ? `Missing Database Rule for Category DIVIDEND and ${targetClass}`
        : "No authoritative rule resolved (pending server decision)";

    return {
      reason: reasonsList.join(" • "),
      reasonsList,
      ruleTitle,
      taxRatePct,
      beforeRatePct: beforeRate,
      targetClassification: targetClass as PayeeClassification,
      confidence: isSettledServerDecision ? 100 : 0,
      sourceMatchedCategory: client.payee_segment || "PUBLIC",
      ruleSource,
      hasAuthoritativeRule,
      isSettledServerDecision,
      classificationSource,
      ruleVersion,
      classifiedAt,
      effectiveFrom,
      serverEvidence,
    };
  }, [client, dbTaxRules, revealSensitive]);

  if (!client) return null;

  // Safe gross calculation strictly finite non-negative <= 1,000,000,000
  const safeGross =
    Number.isFinite(sampleGross) && sampleGross >= 0 ? Math.min(sampleGross, 1_000_000_000) : 0;
  const taxBefore = (safeGross * explanation.beforeRatePct) / 100;
  const netBefore = safeGross - taxBefore;
  const taxAfter = (safeGross * explanation.taxRatePct) / 100;
  const netAfter = safeGross - taxAfter;
  const netDifference = netAfter - netBefore;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Tax Classification & Explainability Inspector
            </DialogTitle>
            <Badge variant="outline" className="font-mono text-xs">
              Confidence: {explanation.confidence}%
            </Badge>
          </div>
          <DialogDescription>
            Authoritative statutory audit trail, extraction signals, and database tax rule
            resolution.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {rulesError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{rulesError}</span>
            </div>
          )}

          {!explanation.hasAuthoritativeRule && !isLoadingRules && !rulesError && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-lg flex items-center gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                No active tax rule found in database for classification{" "}
                {explanation.targetClassification}. Classification cannot be applied until an active
                tax rule is configured.
              </span>
            </div>
          )}

          {isLoadingRules && (
            <div className="p-3 bg-muted/50 rounded-lg flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Loading authoritative database tax rules...</span>
            </div>
          )}

          {/* Client Identity & Extracted Tokens with Privacy Masking */}
          <div className="bg-muted/40 p-3 rounded-lg border text-xs space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-muted">
              <span className="font-semibold text-muted-foreground uppercase text-[11px]">
                Shareholder Identity & Verification Signals
              </span>
              {canRevealSensitive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  onClick={handleToggleReveal}
                >
                  {revealSensitive ? (
                    <>
                      <EyeOff className="h-3 w-3" />
                      <span>Hide Identifiers</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      <span>Reveal Identifiers</span>
                    </>
                  )}
                </Button>
              ) : (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  <span>Masked (Supervisor/Admin required)</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-muted-foreground block text-[11px]">Shareholder Name:</span>
                <span className="font-semibold text-sm">{client.full_name || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">BOID:</span>
                <span className="font-mono font-medium">
                  {revealSensitive ? client.boid || "—" : maskBoid(client.boid)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">PAN / Citizenship:</span>
                <span className="font-mono">
                  {revealSensitive
                    ? client.pan_or_citizenship || client.pan_no || client.citizenship_no || "—"
                    : maskPanOrCitizenship(
                        client.pan_or_citizenship || client.pan_no || client.citizenship_no,
                      )}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">
                  Holder / Demat Type:
                </span>
                <span>{client.holder_type || "Public"}</span>
              </div>
            </div>

            {/* Server Audit Trail & Persisted Decision Provenance */}
            <div className="grid grid-cols-3 gap-2 p-2 mt-2 bg-muted/30 border rounded text-[11px] text-muted-foreground">
              <div>
                <span className="block font-medium text-foreground">Decision Source</span>
                <span className="font-mono">{explanation.classificationSource}</span>
              </div>
              <div>
                <span className="block font-medium text-foreground">Rule Version</span>
                <span className="font-mono">{explanation.ruleVersion}</span>
              </div>
              <div>
                <span className="block font-medium text-foreground">Decision Timestamp</span>
                <span className="font-mono truncate block" title={explanation.classifiedAt}>
                  {explanation.classifiedAt}
                </span>
              </div>
            </div>
          </div>

          {/* Classification Rationale */}
          <Card className="border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-2">
                  <Scale className="h-4 w-4 text-primary" />
                  Statutory Rule Rationale
                </span>
                <Badge variant={explanation.taxRatePct === 0 ? "secondary" : "default"}>
                  {explanation.hasAuthoritativeRule
                    ? `${explanation.taxRatePct}% TDS`
                    : "Unresolved"}
                </Badge>
              </div>

              <div className="text-xs bg-muted/30 p-2.5 rounded border border-muted-foreground/20 space-y-1.5">
                <div className="font-semibold text-primary">{explanation.ruleTitle}</div>
                <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                  <Database className="h-3 w-3" />
                  Source: {explanation.ruleSource}
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase">
                  Signals & Evidence Considered:
                </span>
                <ul className="text-xs space-y-1 pl-4 list-disc text-muted-foreground">
                  {explanation.reasonsList.map((reason: string, idx: number) => (
                    <li key={idx} className="leading-relaxed">
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Before vs After Financial Simulation */}
          <Card className="border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-2 text-xs">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Before & After Financial Impact
                </span>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="sample-gross" className="text-xs text-muted-foreground">
                      Simulation Gross:
                    </Label>
                    <Input
                      id="sample-gross"
                      type="number"
                      value={sampleGross}
                      onChange={handleGrossChange}
                      className="h-7 w-28 text-right font-mono text-xs"
                    />
                  </div>
                  {grossInputError && (
                    <span className="text-[10px] text-destructive font-medium">
                      {grossInputError}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="border rounded p-2.5 bg-muted/20">
                  <div className="text-muted-foreground font-medium mb-1">
                    Without Verification ({explanation.beforeRatePct}% TDS)
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Tax Deducted:</span>
                    <span className="font-mono text-red-600">{fmtCurrency(taxBefore)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Net Payout:</span>
                    <span className="font-mono font-semibold">{fmtCurrency(netBefore)}</span>
                  </div>
                </div>

                <div className="border rounded p-2.5 bg-emerald-500/10 border-emerald-500/30">
                  <div className="text-emerald-700 dark:text-emerald-300 font-medium mb-1">
                    With Verified Rule ({explanation.taxRatePct}% TDS)
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Tax Deducted:</span>
                    <span className="font-mono text-amber-600">{fmtCurrency(taxAfter)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Net Payout:</span>
                    <span className="font-mono font-semibold text-emerald-600">
                      {fmtCurrency(netAfter)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground flex items-center justify-between pt-1 border-t">
                <span>Net Shareholder Variance:</span>
                <span
                  className={`font-mono font-semibold ${
                    netDifference >= 0 ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {netDifference >= 0 ? "+" : ""}
                  {fmtCurrency(netDifference)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Close
          </Button>
          {onConfirmClassification && (
            <Button
              onClick={() => {
                onConfirmClassification(
                  client.id,
                  explanation.targetClassification,
                  explanation.sourceMatchedCategory,
                  explanation.ruleVersion !== "Not recorded" ? explanation.ruleVersion : undefined,
                  explanation.serverEvidence || undefined,
                );
                onOpenChange(false);
              }}
              disabled={
                isPending ||
                isLoadingRules ||
                !explanation.isSettledServerDecision ||
                !explanation.hasAuthoritativeRule ||
                !!rulesError
              }
              className="gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              {explanation.isSettledServerDecision
                ? `Apply ${explanation.targetClassification} (${explanation.taxRatePct}%)`
                : "Pending Server Decision"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
