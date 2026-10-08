import { describe, expect, it } from "vitest";
import { checkListingPolicy } from "./policy-guard";

describe("policy guard", () => {
  it("blocks cockroach killer / insecticide", () => {
    expect(checkListingPolicy({ title: "Cockroach Killer Gel Bait 10pcs" }).ok).toBe(false);
  });
  it("blocks muffler delete exhaust", () => {
    expect(checkListingPolicy({ title: "Universal Muffler Delete Exhaust Pipe" }).ok).toBe(false);
  });
  it("allows a normal exhaust tip", () => {
    expect(checkListingPolicy({ title: "Stainless Steel Exhaust Tip 2.5 Inch" }).ok).toBe(true);
  });
  it("allows 'for Toyota' fitment but blocks bare brand", () => {
    expect(checkListingPolicy({ title: "Floor Mats for Toyota Camry" }).ok).toBe(true);
    expect(checkListingPolicy({ title: "Nike Running Shoes" }).ok).toBe(false);
  });
  it("removes 'Ban the sale of Amazon' from titles", () => {
    const r = checkListingPolicy({ title: "Ban The Sale Of Amazon Silk Dress" });
    expect(r.ok).toBe(true);
    expect(r.title).toBe("Silk Dress");
  });
});
