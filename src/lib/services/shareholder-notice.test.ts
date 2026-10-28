import { describe, it, expect } from "vitest";
import {
  ShareholderNoticeService,
  type ShareholderNoticeClient,
} from "./shareholder-notice.service";

describe("ShareholderNoticeService", () => {
  describe("Email Validation", () => {
    it("identifies valid email addresses", () => {
      expect(ShareholderNoticeService.hasValidEmail("investor@example.com")).toBe(true);
      expect(ShareholderNoticeService.hasValidEmail("user.name+tag@rbbmbl.com.np")).toBe(true);
    });

    it("rejects null, empty, and invalid email addresses", () => {
      expect(ShareholderNoticeService.hasValidEmail(null)).toBe(false);
      expect(ShareholderNoticeService.hasValidEmail(undefined)).toBe(false);
      expect(ShareholderNoticeService.hasValidEmail("")).toBe(false);
      expect(ShareholderNoticeService.hasValidEmail("   ")).toBe(false);
      expect(ShareholderNoticeService.hasValidEmail("not-an-email")).toBe(false);
      expect(ShareholderNoticeService.hasValidEmail("@no-user.com")).toBe(false);
      expect(ShareholderNoticeService.hasValidEmail("user@no-tld")).toBe(false);
    });
  });

  describe("Missing Bank Details Detection", () => {
    it("flags clients with missing or empty bank accounts", () => {
      expect(ShareholderNoticeService.isMissingBank({})).toBe(true);
      expect(ShareholderNoticeService.isMissingBank({ bank_account_no: null })).toBe(true);
      expect(ShareholderNoticeService.isMissingBank({ bank_account_no: "" })).toBe(true);
      expect(ShareholderNoticeService.isMissingBank({ bank_account_no: "   " })).toBe(true);
    });

    it("accepts valid bank account numbers", () => {
      expect(ShareholderNoticeService.isMissingBank({ bank_account_no: "014011090005440" })).toBe(
        false,
      );
    });
  });

  describe("Missing PAN Detection", () => {
    it("flags clients without a valid 9-digit PAN", () => {
      expect(ShareholderNoticeService.isMissingPan({})).toBe(true);
      expect(ShareholderNoticeService.isMissingPan({ pan_no: null })).toBe(true);
      expect(ShareholderNoticeService.isMissingPan({ pan_no: "" })).toBe(true);
      // Citizenship numbers or wrong lengths
      expect(
        ShareholderNoticeService.isMissingPan({
          pan_no: "105103-1-040/904762009",
        }),
      ).toBe(true);
      expect(ShareholderNoticeService.isMissingPan({ pan_no: "12345" })).toBe(true);
    });

    it("recognizes valid 9-digit PAN in pan_no or pan_or_citizenship", () => {
      expect(ShareholderNoticeService.isMissingPan({ pan_no: "108094183" })).toBe(false);
      expect(
        ShareholderNoticeService.isMissingPan({
          pan_no: null,
          pan_or_citizenship: "108094183",
        }),
      ).toBe(false);
    });
  });

  describe("Notice Type Resolution", () => {
    it("resolves MISSING_BOTH when both bank and PAN are absent", () => {
      const client: ShareholderNoticeClient = {
        full_name: "Ram Bahadur",
        bank_account_no: null,
        pan_no: null,
      };
      expect(ShareholderNoticeService.getMissingType(client)).toBe("MISSING_BOTH");
    });

    it("resolves MISSING_BANK when only bank is absent", () => {
      const client: ShareholderNoticeClient = {
        full_name: "Sita Sharma",
        bank_account_no: null,
        pan_no: "108094183",
      };
      expect(ShareholderNoticeService.getMissingType(client)).toBe("MISSING_BANK");
    });

    it("resolves MISSING_PAN when only PAN is absent", () => {
      const client: ShareholderNoticeClient = {
        full_name: "Gita Thapa",
        bank_account_no: "014011090005440",
        pan_no: null,
      };
      expect(ShareholderNoticeService.getMissingType(client)).toBe("MISSING_PAN");
    });

    it("returns null when all compliance details are present", () => {
      const client: ShareholderNoticeClient = {
        full_name: "Hari Prasad",
        bank_account_no: "014011090005440",
        pan_no: "108094183",
      };
      expect(ShareholderNoticeService.getMissingType(client)).toBeNull();
    });
  });

  describe("Email Template Generation", () => {
    it("generates professional HTML email containing all required tokens and RTA branding", () => {
      const html = ShareholderNoticeService.renderNoticeHtml({
        shareholderName: "MUNA RAUT",
        boid: "1301300000097151",
        email: "muna@example.com",
        companyName: "NECO INSURANCE 2083.04.29",
        missingType: "MISSING_BANK",
        customMessage: "Please submit before upcoming dividend book closure.",
      });

      expect(html).toContain("RBB MERCHANT BANKING LIMITED");
      expect(html).toContain("MUNA RAUT");
      expect(html).toContain("1301300000097151");
      expect(html).toContain("NECO INSURANCE 2083.04.29");
      expect(html).toContain("Bank Account Details Required");
      expect(html).toContain("Please submit before upcoming dividend book closure.");
      expect(html).toContain("rta@rbbmbl.com.np");
    });

    it("generates clean plaintext fallback version", () => {
      const text = ShareholderNoticeService.renderNoticeText({
        shareholderName: "NIRJALA MALI",
        boid: "1301700000025333",
        email: "mailnezuko13@gmail.com",
        companyName: "NECO INSURANCE",
        missingType: "MISSING_PAN",
      });

      expect(text).toContain("NIRJALA MALI");
      expect(text).toContain("1301700000025333");
      expect(text).toContain("PAN Number Required for Tax (TDS) Credit");
      expect(text).toContain("Depository Participant");
    });

    it("generates appropriate subject lines based on missing type", () => {
      const subBank = ShareholderNoticeService.generateSubject("NECO", "MISSING_BANK");
      expect(subBank).toContain("Update Your Registered Bank Account");
      expect(subBank).toContain("NECO");

      const subPan = ShareholderNoticeService.generateSubject("RBBD8.5", "MISSING_PAN");
      expect(subPan).toContain("Update Your PAN Number");
      expect(subPan).toContain("RBBD8.5");

      const subBoth = ShareholderNoticeService.generateSubject("RMF2", "MISSING_BOTH");
      expect(subBoth).toContain("Update Bank Details & PAN Number");
    });
  });
});
