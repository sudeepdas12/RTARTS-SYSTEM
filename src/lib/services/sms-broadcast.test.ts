import { describe, it, expect } from "vitest";
import { SmsBroadcastService } from "./sms-broadcast.service";

describe("SmsBroadcastService — Nepal SMS Gateway Formatting & Templates", () => {
  it("sanitizes valid Nepal mobile numbers (98XXXXXXXX, 97XXXXXXXX)", () => {
    expect(SmsBroadcastService.sanitizeNepalPhone("9841234567").isValid).toBe(true);
    expect(SmsBroadcastService.sanitizeNepalPhone("9779851000000").isValid).toBe(true);
    expect(SmsBroadcastService.sanitizeNepalPhone("12345").isValid).toBe(false);
    expect(SmsBroadcastService.sanitizeNepalPhone(null).isValid).toBe(false);
  });

  it("substitutes dynamic tokens correctly in template text", () => {
    const rendered = SmsBroadcastService.renderTemplate(
      "Dear {{name}}, NPR {{amount}} credited for {{company}} FY {{fy}}.",
      {
        name: "Ram Sharma",
        boid: "1301010000000001",
        amount: 25000,
        company: "Supermai Hydropower",
        fy: "2081/82",
      },
    );

    expect(rendered).toBe("Dear Ram Sharma, NPR 25,000.00 credited for Supermai Hydropower FY 2081/82.");
  });
});
