const LEGAL_SUFFIXES = [
  "incorporated",
  "corporation",
  "limited",
  "company limited",
  "private limited",
  "public limited company",
  "sendirian berhad",
  "perseroan terbatas",
  "pte ltd",
  "sdn bhd",
  "co ltd",
  "corp",
  "inc",
  "l l c",
  "llc",
  "llp",
  "ltd",
  "plc",
  "gmbh",
  "sarl",
  "srl",
  "spa",
  "sas",
  "pte",
  "bhd",
  "tbk",
] as const;

const COUNTRY_ALIASES = new Map<string, string>([
  ["united arab emirates", "AE"],
  ["uae", "AE"],
  ["indonesia", "ID"],
  ["united states", "US"],
  ["united states of america", "US"],
  ["usa", "US"],
  ["united kingdom", "GB"],
  ["uk", "GB"],
  ["great britain", "GB"],
  ["china", "CN"],
  ["saudi arabia", "SA"],
  ["india", "IN"],
  ["singapore", "SG"],
  ["malaysia", "MY"],
  ["thailand", "TH"],
  ["vietnam", "VN"],
]);

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value.normalize("NFKC")).toLocaleLowerCase("en");
}

export function normalizeCompanyName(value: string): string {
  let normalized = normalizeSearchText(value)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  let removedSuffix = true;

  while (removedSuffix && normalized) {
    removedSuffix = false;

    for (const suffix of LEGAL_SUFFIXES) {
      if (normalized === suffix) {
        continue;
      }

      if (normalized.endsWith(` ${suffix}`)) {
        normalized = normalized.slice(0, -(suffix.length + 1)).trim();
        removedSuffix = true;
        break;
      }
    }
  }

  return normalized;
}

export function normalizeCountryCode(value: string): string | undefined {
  const normalized = normalizeSearchText(value);

  if (/^[a-z]{2}$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  return COUNTRY_ALIASES.get(normalized);
}

export function normalizeWebsiteUrl(value: string): string | undefined {
  const trimmed = normalizeWhitespace(value);

  if (!trimmed) {
    return undefined;
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    url.protocol = "https:";
    url.hostname = url.hostname.toLocaleLowerCase("en");
    url.hash = "";

    if (url.pathname === "/") {
      url.pathname = "";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function extractCanonicalDomain(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedUrl = normalizeWebsiteUrl(value);

  if (!normalizedUrl) {
    return undefined;
  }

  const hostname = new URL(normalizedUrl).hostname.toLocaleLowerCase("en");
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

export function normalizeSourceUrl(value: string): string | undefined {
  const normalizedUrl = normalizeWebsiteUrl(value);

  if (!normalizedUrl) {
    return undefined;
  }

  const url = new URL(normalizedUrl);
  const trackingKeys = [...url.searchParams.keys()].filter((key) =>
    key.toLocaleLowerCase("en").startsWith("utm_") || ["gclid", "fbclid"].includes(key.toLocaleLowerCase("en")),
  );

  for (const key of trackingKeys) {
    url.searchParams.delete(key);
  }

  return url.toString().replace(/\/$/, "");
}

export function normalizeEmail(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase("en");
}

export function normalizePhone(value: string): string | undefined {
  const trimmed = normalizeWhitespace(value);
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) {
    return undefined;
  }

  return `${hasLeadingPlus ? "+" : ""}${digits}`;
}
