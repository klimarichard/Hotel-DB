/**
 * Display formatting for phone numbers.
 *
 * A Czech number (prefix "+420") is grouped as "+420 XXX XXX XXX" when it has
 * exactly nine national digits. Anything else – other country codes, partial or
 * non-standard numbers – is returned trimmed and unchanged (a custom display
 * format for other country codes is a separate, later task). Storage is never
 * touched; this is purely for rendering.
 */
export function formatPhoneDisplay(phone?: string | null): string {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+420")) {
    const digits = trimmed.slice(4).replace(/\s+/g, "");
    if (/^\d{9}$/.test(digits)) {
      return `+420 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
    }
  }
  return trimmed;
}

/**
 * Whether saving `phone` should prompt the user to choose a display format.
 * True only for a non-empty, non-+420 number that differs from `previous`
 * (its previously-stored value) – +420 numbers auto-format, and an unchanged
 * number shouldn't re-prompt. The chosen string is then stored verbatim.
 */
export function needsPhoneFormatPrompt(phone: string, previous: string): boolean {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.replace(/\s+/g, "").startsWith("+420")) return false;
  return trimmed !== (previous ?? "").trim();
}
