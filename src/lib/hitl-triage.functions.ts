import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { redactSensitiveText } from "@/lib/services/hitl-triage-agent.service";

const TriageItemSchema = z.object({
  id: z.string().max(120),
  label: z.string().max(160),
  suggestedDecision: z.string().max(80),
  summary: z.string().max(320),
});

const HitlAdvisoryInputSchema = z.object({
  workflow: z.enum(["classification_queue", "mapping_review", "reconciliation_exceptions"]),
  contextTitle: z.string().max(160),
  items: z.array(TriageItemSchema).max(25),
});

export type HitlAdvisoryInput = z.infer<typeof HitlAdvisoryInputSchema>;

export interface HitlAdvisoryResponse {
  mode: "deterministic" | "llm_enriched";
  providerLabel: string;
  advisorSummary: string;
  itemRationales: Record<string, string>;
}

function buildDeterministicSummary(input: HitlAdvisoryInput): string {
  return `Deterministic HITL Triage evaluated ${input.items.length} redacted item(s) for ${input.contextTitle}. All financial rates, TDS math, and ledger mutations remain gated behind explicit Operator/Checker confirmation.`;
}

/**
 * Authenticated, zero-secret-leakage server advisory RPC.
 * Uses GEMINI_API_KEY or OPENAI_API_KEY strictly on the server if configured;
 * otherwise returns cleanly in offline deterministic mode without erroring.
 */
export const runHitlAiAdvisory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((payload: HitlAdvisoryInput): HitlAdvisoryInput =>
    HitlAdvisoryInputSchema.parse(payload),
  )
  .handler(async ({ data }): Promise<HitlAdvisoryResponse> => {
    const sanitizedItems = data.items.map((item: z.infer<typeof TriageItemSchema>) => ({
      id: item.id,
      label: redactSensitiveText(item.label),
      suggestedDecision: redactSensitiveText(item.suggestedDecision),
      summary: redactSensitiveText(item.summary),
    }));

    const sanitizedPayload: HitlAdvisoryInput = {
      ...data,
      contextTitle: redactSensitiveText(data.contextTitle),
      items: sanitizedItems,
    };

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();

    if (!geminiKey && !openaiKey) {
      return {
        mode: "deterministic",
        providerLabel: "Built-in Deterministic Rule Engine (External LLM key not configured)",
        advisorSummary: buildDeterministicSummary(sanitizedPayload),
        itemRationales: {},
      };
    }

    const promptText = [
      "You are an audit advisory copilot for a Nepal RTARTS financial registry & disbursement system.",
      "STRICT SAFETY BOUNDARY: Advisory only. Never instruct bypassing Maker/Checker approval, never compute new TDS rates or alter amounts.",
      `Workflow: ${sanitizedPayload.workflow}`,
      `Context: ${sanitizedPayload.contextTitle}`,
      `Redacted Items JSON: ${JSON.stringify(sanitizedItems)}`,
      'Return valid JSON only: { "advisorSummary": "1-2 concise sentences", "itemRationales": { "<id>": "short 1-sentence reason" } }',
    ].join("\n");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      if (geminiKey) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
            }),
            signal: controller.signal,
          },
        );
        clearTimeout(timeout);
        if (res.ok) {
          const json = (await res.json()) as any;
          const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof rawText === "string") {
            const parsed = JSON.parse(rawText);
            return {
              mode: "llm_enriched",
              providerLabel: "Gemini Advisory (Redacted Metadata Only)",
              advisorSummary: String(
                parsed?.advisorSummary || buildDeterministicSummary(sanitizedPayload),
              ),
              itemRationales:
                parsed?.itemRationales && typeof parsed.itemRationales === "object"
                  ? parsed.itemRationales
                  : {},
            };
          }
        }
      } else if (openaiKey) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: promptText }],
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const json = (await res.json()) as any;
          const rawText = json?.choices?.[0]?.message?.content;
          if (typeof rawText === "string") {
            const parsed = JSON.parse(rawText);
            return {
              mode: "llm_enriched",
              providerLabel: "OpenAI Advisory (Redacted Metadata Only)",
              advisorSummary: String(
                parsed?.advisorSummary || buildDeterministicSummary(sanitizedPayload),
              ),
              itemRationales:
                parsed?.itemRationales && typeof parsed.itemRationales === "object"
                  ? parsed.itemRationales
                  : {},
            };
          }
        }
      }
    } catch {
      // Fallback cleanly to deterministic guidance without breaking operator flow.
    }

    return {
      mode: "deterministic",
      providerLabel: "Deterministic Fallback (Advisory Service Unavailable)",
      advisorSummary: buildDeterministicSummary(sanitizedPayload),
      itemRationales: {},
    };
  });
