// ─────────────────────────────────────────────────────────────
//  PRICING TIER REGISTRY
//  Single source of truth for the 3 subscription tiers, their
//  prices, the marketing feature lists shown on the pricing page,
//  and — critically — which *existing, enforced* features each tier
//  unlocks. Mirrors the businessTypes.ts registry pattern.
//
//  Gating note: only features that actually exist and are enforced
//  today are gated here (lead scoring, Slack notifications,
//  industry-specific AI). Features advertised on the pricing page
//  that are not built yet (SMS/email sequences, multi-location, API
//  access, white-label, CRM sync) are marketing-only and are NOT
//  represented as gates — they simply don't do anything yet.
// ─────────────────────────────────────────────────────────────

export const PLAN_KEYS = ["pro", "business", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface Tier {
  key: PlanKey;
  label: string;
  price: number; // monthly USD
  priceText: string; // formatted, e.g. "$1,999"
  tagline: string;
  /** Whether this is the visually highlighted ("most popular") card. */
  featured: boolean;
  /** Display feature bullets for the pricing page (top → bottom). */
  features: string[];
}

const RANK: Record<PlanKey, number> = { pro: 1, business: 2, enterprise: 3 };

export const TIERS: Tier[] = [
  {
    key: "pro",
    label: "Pro",
    price: 899,
    priceText: "$899",
    tagline: "Everything a single location needs to capture and book leads 24/7.",
    featured: false,
    features: [
      "Full widget setup & onboarding",
      "Unlimited AI conversations",
      "Automatic appointment booking",
      "Google Calendar integration",
      "Lead nurturing dashboard",
      "Email booking notifications",
      "Embed on unlimited pages",
      "Dedicated support",
    ],
  },
  {
    key: "business",
    label: "Business",
    price: 1999,
    priceText: "$1,999",
    tagline: "For growing teams that want smarter routing and instant alerts.",
    featured: true,
    features: [
      "Everything in Pro",
      "Lead quality scoring",
      "Slack booking notifications",
      "Industry-specific AI tailoring",
      "SMS follow-up sequences",
      "Email nurture sequences",
      "Priority support",
    ],
  },
  {
    key: "enterprise",
    label: "Enterprise",
    price: 4999,
    priceText: "$4,999",
    tagline: "Multi-location operations with custom integrations and white-label.",
    featured: false,
    features: [
      "Everything in Business",
      "Multi-location support",
      "API access",
      "White-label widget",
      "CRM sync",
      "Custom integrations",
      "Dedicated account manager",
    ],
  },
];

/**
 * Normalize a stored/legacy plan value to a current tier key. Existing tenants
 * and the historical default were "starter"; any unknown/empty/legacy value
 * resolves to the lowest paid tier ("pro") so feature checks stay deterministic.
 */
export function normalizePlan(plan?: string | null): PlanKey {
  const p = (plan ?? "").toLowerCase().trim();
  if (p === "business") return "business";
  if (p === "enterprise") return "enterprise";
  return "pro";
}

export function getTier(plan?: string | null): Tier {
  const key = normalizePlan(plan);
  return TIERS.find((t) => t.key === key)!;
}

/** True only for an exact, current tier key (used to validate user input). */
export function isValidPlan(plan: string): plan is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(plan);
}

// Existing, enforced features that are gated by tier. Each maps to the minimum
// tier RANK required to use it. All three are Business+ (rank 2).
export type GatedFeature =
  | "lead_scoring"
  | "slack_notifications"
  | "industry_specific_ai"
  | "follow_up_sequences";

const FEATURE_MIN_RANK: Record<GatedFeature, number> = {
  lead_scoring: 2,
  slack_notifications: 2,
  industry_specific_ai: 2,
  follow_up_sequences: 2,
};

export function hasFeature(
  plan: string | null | undefined,
  feature: GatedFeature,
): boolean {
  return RANK[normalizePlan(plan)] >= FEATURE_MIN_RANK[feature];
}

export interface PlanFeatures {
  leadScoring: boolean;
  slackNotifications: boolean;
  industrySpecificAI: boolean;
  followUpSequences: boolean;
}

export function featuresForPlan(plan?: string | null): PlanFeatures {
  return {
    leadScoring: hasFeature(plan, "lead_scoring"),
    slackNotifications: hasFeature(plan, "slack_notifications"),
    industrySpecificAI: hasFeature(plan, "industry_specific_ai"),
    followUpSequences: hasFeature(plan, "follow_up_sequences"),
  };
}
