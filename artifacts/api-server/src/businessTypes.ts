// ─────────────────────────────────────────────────────────────
//  BUSINESS TYPE REGISTRY
//  Each tenant picks a business type; the chat widget uses it to
//  ask qualifying questions tailored to that industry and to build
//  the right kind of booking (appointment / reservation / consult).
// ─────────────────────────────────────────────────────────────

export interface BusinessType {
  value: string;
  label: string; // shown in the admin dropdown
  article: string; // "a" | "an" for the prompt sentence
  descriptor: string; // slots into: for {article} {descriptor} called {name}
  bookingNoun: "appointment" | "reservation" | "consultation";
  qualifyingQuestions: string;
  collectAddress: boolean; // true when a technician visits the customer
  addressLabel: string;
  issueLabel: string; // what to capture in the booking "issue" field
}

export const BUSINESS_TYPES: BusinessType[] = [
  {
    value: "general",
    label: "General / Other",
    article: "a",
    descriptor: "business",
    bookingNoun: "appointment",
    qualifyingQuestions: "what they need help with, their preferred timeframe, and any relevant details",
    collectAddress: true,
    addressLabel: "Address (where service is needed, or your location)",
    issueLabel: "brief description of what they need",
  },
  {
    value: "plumber",
    label: "Plumber",
    article: "a",
    descriptor: "plumbing company",
    bookingNoun: "appointment",
    qualifyingQuestions: "the type of plumbing problem, how urgent it is, and whether it's an emergency",
    collectAddress: true,
    addressLabel: "Service address (where the plumber needs to go)",
    issueLabel: "brief description of the plumbing issue",
  },
  {
    value: "electrician",
    label: "Electrician",
    article: "an",
    descriptor: "electrical services company",
    bookingNoun: "appointment",
    qualifyingQuestions: "the type of electrical issue, whether it's a safety hazard, and how urgent it is",
    collectAddress: true,
    addressLabel: "Service address (where the electrician needs to go)",
    issueLabel: "brief description of the electrical issue",
  },
  {
    value: "hvac",
    label: "Heating & Cooling (HVAC)",
    article: "a",
    descriptor: "heating and cooling company",
    bookingNoun: "appointment",
    qualifyingQuestions: "whether it's heating or cooling, the symptoms, the system type if known, and how urgent it is",
    collectAddress: true,
    addressLabel: "Service address (where the technician needs to go)",
    issueLabel: "brief description of the heating/cooling issue",
  },
  {
    value: "roofing",
    label: "Roofing",
    article: "a",
    descriptor: "roofing company",
    bookingNoun: "appointment",
    qualifyingQuestions: "the roof type, the problem (leak, damage, replacement), and whether there is active water entry",
    collectAddress: true,
    addressLabel: "Property address (where the roof work is needed)",
    issueLabel: "brief description of the roofing issue",
  },
  {
    value: "landscaping",
    label: "Landscaping / Lawn Care",
    article: "a",
    descriptor: "landscaping and lawn care company",
    bookingNoun: "appointment",
    qualifyingQuestions: "the services needed (mowing, design, cleanup), property size, and how often they need service",
    collectAddress: true,
    addressLabel: "Property address (where the work is needed)",
    issueLabel: "brief description of the landscaping work needed",
  },
  {
    value: "cleaning",
    label: "Cleaning Service",
    article: "a",
    descriptor: "cleaning company",
    bookingNoun: "appointment",
    qualifyingQuestions: "the type of cleaning (home, office, deep clean), the size of the space, and how often they need it",
    collectAddress: true,
    addressLabel: "Address (where the cleaning is needed)",
    issueLabel: "brief description of the cleaning needed",
  },
  {
    value: "pest_control",
    label: "Pest Control",
    article: "a",
    descriptor: "pest control company",
    bookingNoun: "appointment",
    qualifyingQuestions: "the type of pest, where it's being seen, and how severe the problem is",
    collectAddress: true,
    addressLabel: "Service address (where treatment is needed)",
    issueLabel: "brief description of the pest problem",
  },
  {
    value: "auto_repair",
    label: "Auto Repair / Mechanic",
    article: "an",
    descriptor: "auto repair shop",
    bookingNoun: "appointment",
    qualifyingQuestions: "the vehicle make, model and year, and a description of the problem or service needed",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "vehicle details and the problem or service needed",
  },
  {
    value: "dentist",
    label: "Dental Practice",
    article: "a",
    descriptor: "dental practice",
    bookingNoun: "appointment",
    qualifyingQuestions: "the reason for the visit (checkup, cleaning, pain, cosmetic), whether they are a new or existing patient, and any pain level",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "reason for the dental visit",
  },
  {
    value: "doctor",
    label: "Medical Clinic",
    article: "a",
    descriptor: "medical clinic",
    bookingNoun: "appointment",
    qualifyingQuestions: "the reason for the visit, whether they are a new or existing patient, and how soon they need to be seen (do NOT ask for detailed medical history)",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "general reason for the visit",
  },
  {
    value: "veterinary",
    label: "Veterinary Clinic",
    article: "a",
    descriptor: "veterinary clinic",
    bookingNoun: "appointment",
    qualifyingQuestions: "the type and name of the pet, the reason for the visit, and how urgent it is",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "pet type and reason for the visit",
  },
  {
    value: "salon",
    label: "Hair & Beauty Salon",
    article: "a",
    descriptor: "hair and beauty salon",
    bookingNoun: "appointment",
    qualifyingQuestions: "the service they want (cut, color, styling, etc.), any preferred stylist, and rough timing",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "service(s) requested",
  },
  {
    value: "barber",
    label: "Barbershop",
    article: "a",
    descriptor: "barbershop",
    bookingNoun: "appointment",
    qualifyingQuestions: "the service they want (cut, beard, shave), any preferred barber, and rough timing",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "service(s) requested",
  },
  {
    value: "spa",
    label: "Spa & Wellness",
    article: "a",
    descriptor: "spa and wellness center",
    bookingNoun: "appointment",
    qualifyingQuestions: "the treatment they're interested in, whether it's for one person or more, and preferred timing",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "treatment(s) requested",
  },
  {
    value: "fitness",
    label: "Gym / Fitness Studio",
    article: "a",
    descriptor: "gym and fitness studio",
    bookingNoun: "appointment",
    qualifyingQuestions: "their fitness goals, whether they want a class, personal training or a tour, and their experience level",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "fitness goals and session/class of interest",
  },
  {
    value: "restaurant",
    label: "Restaurant",
    article: "a",
    descriptor: "restaurant",
    bookingNoun: "reservation",
    qualifyingQuestions: "the party size, the preferred date and time, and any special occasion or dietary requirements",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "party size and any special requests",
  },
  {
    value: "law_firm",
    label: "Law Firm",
    article: "a",
    descriptor: "law firm",
    bookingNoun: "consultation",
    qualifyingQuestions: "the general area of law they need help with and the urgency (do NOT ask for confidential case details)",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "general nature of the legal matter",
  },
  {
    value: "accountant",
    label: "Accounting Firm",
    article: "an",
    descriptor: "accounting firm",
    bookingNoun: "consultation",
    qualifyingQuestions: "the services they need (tax, bookkeeping, payroll, advisory) and whether they are an individual or a business",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "accounting services needed",
  },
  {
    value: "real_estate",
    label: "Real Estate Agency",
    article: "a",
    descriptor: "real estate agency",
    bookingNoun: "appointment",
    qualifyingQuestions: "whether they are buying, selling or renting, the area they're interested in, and their budget or timeline",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "buying/selling/renting plus area and budget",
  },
  {
    value: "consultant",
    label: "Consulting / Agency",
    article: "a",
    descriptor: "consulting agency",
    bookingNoun: "consultation",
    qualifyingQuestions: "what they need help with, the scope or size of the project, and their timeline",
    collectAddress: false,
    addressLabel: "",
    issueLabel: "what they need help with",
  },
];

export const DEFAULT_BUSINESS_TYPE: BusinessType =
  BUSINESS_TYPES.find((t) => t.value === "general")!;

export function getBusinessType(value?: string | null): BusinessType {
  if (!value) return DEFAULT_BUSINESS_TYPE;
  return BUSINESS_TYPES.find((t) => t.value === value) ?? DEFAULT_BUSINESS_TYPE;
}

export function isValidBusinessType(value: string): boolean {
  return BUSINESS_TYPES.some((t) => t.value === value);
}

function bookingPhrase(noun: BusinessType["bookingNoun"]): string {
  if (noun === "reservation") return "a reservation";
  if (noun === "consultation") return "a consultation";
  return "an appointment";
}

export interface PromptContext {
  /** The exact services this business offers. The bot only offers these. */
  services?: string[] | null;
  /** Short free-text description of the business, added as extra context. */
  description?: string | null;
}

export function getSystemPrompt(
  businessTypeValue?: string | null,
  businessName?: string | null,
  ctx: PromptContext = {},
): string {
  const t = getBusinessType(businessTypeValue);
  const name = (businessName && businessName.trim()) || `our ${t.descriptor}`;
  const addressLine = t.collectAddress ? `\n       - ${t.addressLabel}` : "";
  const addressNote = t.collectAddress
    ? ""
    : `\n- This business does NOT need a service address — always set "address" to "" in the booking JSON and never ask for one.`;

  const services = (ctx.services ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const descriptionLine =
    ctx.description && ctx.description.trim()
      ? `\nAbout the business: ${ctx.description.trim()}`
      : "";
  const servicesSection = services.length
    ? `

SERVICES WE OFFER (this is the COMPLETE list — we offer nothing else):
${services.map((s) => `  - ${s}`).join("\n")}
- Only ever offer, recommend, or book these services. Do NOT invent or imply any service not on this list.
- If the customer asks for something not on the list, politely say it isn't offered and suggest the closest service(s) above instead. For example: "We don't offer that, but we do offer ${services.slice(0, 3).join(", ")} — would one of those work?"`
    : "";

  return `
You are a friendly and professional AI assistant for ${t.article} ${t.descriptor} called ${name}.${descriptionLine}

Your goals in order:
  1. Warmly greet the visitor and learn about their needs.
  2. Ask relevant qualifying questions: ${t.qualifyingQuestions}.${servicesSection}
  3. Book ${bookingPhrase(t.bookingNoun)} by collecting ALL the details below — ask for any that are missing:
       - Full name${addressLine}
       - Preferred date AND time
       - Phone number
       - Email address

DATE & TIME RULES:
- When the customer gives a date or time, repeat it back exactly as you heard it, then confirm: "So that's [DAY] at [TIME] — is that right?"
- If the customer gives a vague date like "next Thursday" or "sometime this week", ask: "What time would work best — morning, afternoon, or evening?"
- If the customer gives only a time with no date, ask: "And which day did you have in mind?"
- Always confirm the full date AND time before finalising the ${t.bookingNoun}.
- Our system automatically checks our live calendar when you finalise. If the chosen time is already taken, the customer is shown the next open times — so never tell the customer a specific time is "guaranteed" or "confirmed" before you finalise.

BOOKING FORMAT — CRITICAL:
When you have collected ALL required details AND the customer has confirmed them, output EXACTLY this on its own line with nothing after it:

BOOKING_COMPLETE::{"name":"<FULL NAME>","email":"<EMAIL>","phone":"<PHONE>","address":"<ADDRESS OR EMPTY STRING>","datetime":"<ISO 8601 FORMAT e.g. 2025-07-15T14:00:00>","issue":"<${t.issueLabel}>"}

BOOKING FORMAT RULES:
- Use ISO 8601 datetime (YYYY-MM-DDTHH:MM:SS) — never natural language in the JSON.
- Do NOT add any text, explanation, or JSON after the BOOKING_COMPLETE:: line.
- Do NOT wrap the JSON in code blocks or backticks.
- Only output BOOKING_COMPLETE:: once per conversation.${addressNote}

General guidelines:
- Keep replies concise and conversational — no long walls of text.
- Ask one or two questions at a time; don't overwhelm the user.
- Be empathetic and supportive, never pushy.
- If the visitor is not ready to book, offer to capture their contact info for a follow-up call.
- If asked anything outside your scope, politely redirect to booking or contact.
`.trim();
}
