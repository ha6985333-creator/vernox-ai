import { describe, it, expect } from "vitest";
import {
  normalizePlan,
  hasFeature,
  featuresForPlan,
  isValidPlan,
  PLAN_KEYS,
  type GatedFeature,
} from "./tiers.js";

// These tests lock in the tier-gating contract. They are intentionally
// exhaustive: a future refactor that accidentally ungates a paid feature for
// Pro tenants, or gates one that should be free, will break one of these.

describe("normalizePlan", () => {
  it("passes through the three current tier keys", () => {
    expect(normalizePlan("pro")).toBe("pro");
    expect(normalizePlan("business")).toBe("business");
    expect(normalizePlan("enterprise")).toBe("enterprise");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizePlan("  BUSINESS ")).toBe("business");
    expect(normalizePlan("Enterprise")).toBe("enterprise");
    expect(normalizePlan("PRO")).toBe("pro");
  });

  it("maps the legacy 'starter' plan to pro (lowest paid tier)", () => {
    expect(normalizePlan("starter")).toBe("pro");
    expect(normalizePlan("STARTER")).toBe("pro");
  });

  it("maps unknown / empty / null / undefined to pro", () => {
    expect(normalizePlan("gold")).toBe("pro");
    expect(normalizePlan("")).toBe("pro");
    expect(normalizePlan("   ")).toBe("pro");
    expect(normalizePlan(null)).toBe("pro");
    expect(normalizePlan(undefined)).toBe("pro");
  });
});

describe("isValidPlan", () => {
  it("accepts only exact current tier keys", () => {
    for (const key of PLAN_KEYS) {
      expect(isValidPlan(key)).toBe(true);
    }
    expect(isValidPlan("starter")).toBe(false);
    expect(isValidPlan("Business")).toBe(false);
    expect(isValidPlan("")).toBe(false);
  });
});

describe("hasFeature", () => {
  const GATED: GatedFeature[] = [
    "lead_scoring",
    "slack_notifications",
    "industry_specific_ai",
  ];

  it("denies every gated feature to Pro (and its legacy/unknown aliases)", () => {
    for (const feature of GATED) {
      expect(hasFeature("pro", feature)).toBe(false);
      expect(hasFeature("starter", feature)).toBe(false);
      expect(hasFeature("unknown", feature)).toBe(false);
      expect(hasFeature(null, feature)).toBe(false);
      expect(hasFeature(undefined, feature)).toBe(false);
    }
  });

  it("grants every gated feature to Business and Enterprise", () => {
    for (const feature of GATED) {
      expect(hasFeature("business", feature)).toBe(true);
      expect(hasFeature("enterprise", feature)).toBe(true);
    }
  });
});

describe("featuresForPlan", () => {
  it("returns all features off for Pro", () => {
    expect(featuresForPlan("pro")).toEqual({
      leadScoring: false,
      slackNotifications: false,
      industrySpecificAI: false,
    });
  });

  it("treats legacy 'starter' and unknown/empty plans exactly like Pro", () => {
    const pro = featuresForPlan("pro");
    expect(featuresForPlan("starter")).toEqual(pro);
    expect(featuresForPlan("gold")).toEqual(pro);
    expect(featuresForPlan("")).toEqual(pro);
    expect(featuresForPlan(null)).toEqual(pro);
    expect(featuresForPlan(undefined)).toEqual(pro);
  });

  it("returns all features on for Business", () => {
    expect(featuresForPlan("business")).toEqual({
      leadScoring: true,
      slackNotifications: true,
      industrySpecificAI: true,
    });
  });

  it("returns all features on for Enterprise", () => {
    expect(featuresForPlan("enterprise")).toEqual({
      leadScoring: true,
      slackNotifications: true,
      industrySpecificAI: true,
    });
  });
});
