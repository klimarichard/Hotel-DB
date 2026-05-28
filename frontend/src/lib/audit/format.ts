/**
 * Value formatters for the audit log. Turns raw stored old/new values into
 * readable Czech strings (dates, Ano/Ne, enums, numbers), respecting the
 * UTC-shift rule (never `new Date("YYYY-MM-DD")`).
 */

/** Enum value → Czech label, keyed by field leaf name. */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  gender: { M: "Muž", F: "Žena", male: "Muž", female: "Žena" },
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
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

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
  if (isNullish(value)) return "—";

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
    if (value.length === 0) return "—";
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
    try {
      const json = JSON.stringify(value);
      return json.length > 200 ? json.slice(0, 197) + "…" : json;
    } catch {
      return "(objekt)";
    }
  }

  return String(value);
}
