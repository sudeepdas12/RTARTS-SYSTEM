import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllRows, streamAllRows } from "./database";
import { PaymentService } from "./payment.service";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe("Query Pagination and Safety Limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("database.ts fetchAllRows safety threshold (no silent truncation)", () => {
    it("throws explicit error when dataset exceeds maxRows (200,000)", async () => {
      // Simulate a query that returns 1000 rows on every batch
      const queryFn = vi.fn().mockImplementation((from: number, to: number) => {
        const rows = Array.from({ length: 1000 }, (_, i) => ({ id: from + i }));
        return Promise.resolve({ data: rows, error: null });
      });

      // Set maxRows to 2000 for fast unit test of threshold behavior
      await expect(fetchAllRows(queryFn, 1000, 2000)).rejects.toThrow(
        /Query safety threshold exceeded: Dataset contains more than 2,000 records/,
      );
    });

    it("succeeds when dataset is within maxRows limit", async () => {
      let callCount = 0;
      const queryFn = vi.fn().mockImplementation((from: number, to: number) => {
        callCount++;
        // Return 1000 rows on first call, 500 on second call (signals end of data)
        const length = callCount === 1 ? 1000 : 500;
        const rows = Array.from({ length }, (_, i) => ({ id: from + i }));
        return Promise.resolve({ data: rows, error: null });
      });

      const results = await fetchAllRows(queryFn, 1000, 200000);
      expect(results).toHaveLength(1500);
      expect(callCount).toBe(2);
    });
  });

  describe("database.ts streamAllRows safety threshold", () => {
    it("throws explicit error when streamed dataset exceeds maxRows", async () => {
      const queryFn = vi.fn().mockImplementation((from: number, to: number) => {
        const rows = Array.from({ length: 1000 }, (_, i) => ({ id: from + i }));
        return Promise.resolve({ data: rows, error: null });
      });

      const iterator = streamAllRows(queryFn, 1000, 2000);
      await expect(async () => {
        for await (const _ of iterator) {
          // iterate
        }
      }).rejects.toThrow(/Query safety threshold exceeded/);
    });
  });

  describe("PaymentService.getLineItems and getAllLineItemsForExport", () => {
    it("calls getAllLineItemsForExport without limit cap when limit is omitted", async () => {
      const spy = vi
        .spyOn(PaymentService, "getAllLineItemsForExport")
        .mockResolvedValueOnce([
          { id: "item-1", amount: 100 } as any,
          { id: "item-2", amount: 200 } as any,
        ]);

      const items = await PaymentService.getLineItems("batch-123");
      expect(spy).toHaveBeenCalledWith("batch-123");
      expect(items).toHaveLength(2);

      spy.mockRestore();
    });

    it("applies range limit for UI preview when limit is explicitly provided", async () => {
      const mockQueryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [{ id: "item-preview-1" }, { id: "item-preview-2" }],
          error: null,
        }),
      };
      (supabase.from as any).mockReturnValue(mockQueryChain);

      const items = await PaymentService.getLineItems("a0000000-0000-0000-0000-000000000001", 10);
      expect(mockQueryChain.range).toHaveBeenCalledWith(0, 9);
      expect(items).toHaveLength(2);
    });
  });
});
