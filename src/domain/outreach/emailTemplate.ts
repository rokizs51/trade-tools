export type EmailTemplate = {
  subject: string;
  body: string;
};

export type TemplateValues = {
  company: string;
  country: string;
  commodity: string;
  buyerType: string;
  city?: string;
  contactName?: string;
  ourCompany?: string;
};

export type OutreachSummary = {
  sentCount: number;
  lastSentAt: string | null;
};

export const PLACEHOLDER_KEYS = [
  "company",
  "country",
  "city",
  "commodity",
  "buyer_type",
  "contact_name",
  "our_company",
] as const satisfies readonly string[];

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "{commodity} supply for {company} in {country}",
  body:
    "Hello {contact_name},\n\n" +
    "We are {our_company}, an exporter of {commodity}. Our research shows {company} " +
    "operates as a {buyer_type} in {city}, {country}.\n\n" +
    "Could we discuss a supply arrangement? I am glad to share specifications, MOQs, " +
    "and pricing at your convenience.\n\n" +
    "Best regards,\n{our_company}",
};

const PLACEHOLDER_SOURCE = "\\{\\s*([a-z_][a-z0-9_]*)\\s*\\}";

function placeholderRegex(): RegExp {
  return new RegExp(PLACEHOLDER_SOURCE, "g");
}

function isKnown(key: string): boolean {
  return (PLACEHOLDER_KEYS as readonly string[]).includes(key);
}

function resolve(key: string, values: TemplateValues): string | undefined {
  switch (key) {
    case "company":
      return values.company;
    case "country":
      return values.country;
    case "city":
      return values.city?.trim() ? values.city : values.country;
    case "commodity":
      return values.commodity;
    case "buyer_type":
      return values.buyerType;
    case "contact_name":
      return values.contactName?.trim() ? values.contactName : "Team";
    case "our_company":
      return values.ourCompany ?? "";
    default:
      return undefined;
  }
}

export function renderEmailTemplate(template: EmailTemplate, values: TemplateValues): EmailTemplate {
  const render = (input: string): string =>
    input.replace(placeholderRegex(), (match: string, key: string) => {
      const resolved = resolve(key, values);
      return resolved ?? match;
    });
  return { subject: render(template.subject), body: render(template.body) };
}

export function listUnknownPlaceholders(template: EmailTemplate): string[] {
  const found = new Set<string>();
  for (const text of [template.subject, template.body]) {
    for (const match of text.matchAll(placeholderRegex())) {
      const key = match[1];
      if (key && !isKnown(key)) found.add(key);
    }
  }
  return [...found];
}
