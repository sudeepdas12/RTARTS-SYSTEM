import { describe, it, expect } from "vitest";
import { fmtNpr, fmtNprCompact, fmtNprWords } from "./nepal-currency";

describe("Nepal Currency & Number Formatter", () => {
  describe("fmtNpr", () => {
    it("formats amounts using standard South Asian / Lakhs & Crores grouping", () => {
      expect(fmtNpr(1000)).toBe("1,000.00");
      expect(fmtNpr(100000)).toBe("1,00,000.00"); // 1 Lakh
      expect(fmtNpr(1000000)).toBe("10,00,000.00"); // 10 Lakhs
      expect(fmtNpr(10000000)).toBe("1,00,00,000.00"); // 1 Crore
      expect(fmtNpr(123456789.75)).toBe("12,34,56,789.75");
    });

    it("respects showPrefix and decimals options", () => {
      expect(fmtNpr(100000, { showPrefix: true })).toBe("NPR 1,00,000.00");
      expect(fmtNpr(100000, { decimals: 0 })).toBe("1,00,000");
    });

    it("handles null, undefined, empty, and NaN gracefully", () => {
      expect(fmtNpr(null)).toBe("—");
      expect(fmtNpr(undefined)).toBe("—");
      expect(fmtNpr("")).toBe("—");
      expect(fmtNpr("invalid")).toBe("—");
    });
  });

  describe("fmtNprCompact", () => {
    it("formats compact representations for Crore, Lakh, Thousand", () => {
      expect(fmtNprCompact(10000000)).toBe("1 Cr");
      expect(fmtNprCompact(25000000)).toBe("2.5 Cr");
      expect(fmtNprCompact(100000)).toBe("1 L");
      expect(fmtNprCompact(350000)).toBe("3.5 L");
      expect(fmtNprCompact(50000)).toBe("50 K");
      expect(fmtNprCompact(500)).toBe("500.00");
    });
  });

  describe("fmtNprWords", () => {
    it("converts simple numbers into words", () => {
      expect(fmtNprWords(100)).toBe("One Hundred Rupees Only");
      expect(fmtNprWords(500)).toBe("Five Hundred Rupees Only");
      expect(fmtNprWords(1250)).toBe("One Thousand Two Hundred and Fifty Rupees Only");
    });

    it("converts Lakhs and Crores into accurate banking words", () => {
      expect(fmtNprWords(100000)).toBe("One Lakh Rupees Only");
      expect(fmtNprWords(125500)).toBe("One Lakh Twenty Five Thousand Five Hundred Rupees Only");
      expect(fmtNprWords(10000000)).toBe("One Crore Rupees Only");
      expect(fmtNprWords(25000000)).toBe("Two Crore Fifty Lakh Rupees Only");
    });

    it("converts paisa decimals accurately", () => {
      expect(fmtNprWords(100.5)).toBe("One Hundred Rupees and Fifty Paisa Only");
      expect(fmtNprWords(0.75)).toBe("Seventy Five Paisa Only");
    });

    it("handles 0 and empty gracefully", () => {
      expect(fmtNprWords(0)).toBe("Zero Rupees Only");
      expect(fmtNprWords(null)).toBe("Zero Rupees Only");
    });
  });
});
