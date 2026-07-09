/**
 * Value formatters for the audit log. Turns raw stored old/new values into
 * readable Czech strings (dates, Ano/Ne, enums, numbers), respecting the
 * UTC-shift rule (never `new Date("YYYY-MM-DD")`).
 */

/** Enum value → Czech label, keyed by field leaf name. */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  gender: { M: "Muž", F: "Žena", m: "Muž", f: "Žena", male: "Muž", female: "Žena" },
  maritalStatus: {
    single: "Svobodný/á",
    married: "Ženatý / vdaná",
    divorced: "Rozvedený/á",
    widowed: "Ovdovělý/á",
  },
  status: {
    active: "Aktivní",
    terminated: "Ukončený",
    inactive: "Neaktivní",
    pending: "Čeká na vyřízení",
    approved: "Schváleno",
    rejected: "Zamítnuto",
    created: "Vytvořeno",
    opened: "Otevřeno",
    closed: "Uzavřeno",
    published: "Publikováno",
  },
  type: {
    nástup: "Nástup",
    "změna smlouvy": "Dodatek",
    ukončení: "Ukončení",
  },
  // Systém transition summaries store the before/after state under from/to –
  // covers both plan lifecycle states and employee lifecycle statuses.
  from: {
    created: "Vytvořený",
    opened: "Otevřený",
    closed: "Uzavřený",
    published: "Publikovaný",
    active: "Aktivní",
    terminated: "Ukončený",
    "before-start": "Před nástupem",
  },
  to: {
    created: "Vytvořený",
    opened: "Otevřený",
    closed: "Uzavřený",
    published: "Publikovaný",
    active: "Aktivní",
    terminated: "Ukončený",
    "before-start": "Před nástupem",
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Czech labels for common NESTED object keys, so an object-valued field renders
 * readably (never JSON). Covers vacation pendingEdit, Systém from/to, Dodatek
 * changes[], Multisport periods/companions, etc.
 */
const NESTED_KEY_LABELS: Record<string, string> = {
  startDate: "od",
  endDate: "do",
  from: "z",
  to: "na",
  reason: "důvod",
  value: "hodnota",
  changeKind: "typ změny",
  name: "jméno",
  price: "cena",
  date: "datum",
  code: "kód",
  hotel: "hotel",
};

function nestedKeyLabel(key: string): string {
  if (NESTED_KEY_LABELS[key]) return NESTED_KEY_LABELS[key];
  // Generic prettifier (no external import to avoid a cycle with labels.ts).
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
}

/** "YYYY-MM-DD" (optionally with time) → "DD.MM.YYYY", split-based (no UTC shift). */
function formatIsoDate(value: string): string {
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y}`;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * Format a single audit value for display.
 * @param fieldLeaf the leaf field name (drives enum + boolean wording)
 */
export function formatAuditValue(value: unknown, fieldLeaf?: string): string {
  if (isNullish(value)) return "–";

  if (typeof value === "boolean") return value ? "Ano" : "Ne";

  if (typeof value === "string") {
    // Firestore sentinel labels written by the backend, e.g. "[serverTimestamp]"
    if (value.startsWith("[") && value.endsWith("]")) return value;
    const enumMap = fieldLeaf ? ENUM_LABELS[fieldLeaf] : undefined;
    if (enumMap && enumMap[value]) return enumMap[value];
    if (ISO_DATE.test(value)) return formatIsoDate(value);
    return value.length > 200 ? value.slice(0, 197) + "…" : value;
  }

  if (typeof value === "number") {
    return value.toLocaleString("cs-CZ");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "–";
    return value.map((v) => formatAuditValue(v, fieldLeaf)).join(", ");
  }

  if (typeof value === "object") {
    // Firestore Timestamp shape
    const ts = value as { _seconds?: number; seconds?: number };
    const seconds = ts._seconds ?? ts.seconds;
    if (typeof seconds === "number") {
      const date = new Date(seconds * 1000);
      return date.toLocaleString("cs-CZ", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }
    // NEVER render JSON in the change log. Render a plain object as a readable
    // "label: value" list (recursively formatted), skipping empty values.
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => !isNullish(v)
    );
    if (entries.length === 0) return "–";
    return entries
      .map(([k, v]) => `${nestedKeyLabel(k)}: ${formatAuditValue(v)}`)
      .join(", ");
  }

  return String(value);
}
