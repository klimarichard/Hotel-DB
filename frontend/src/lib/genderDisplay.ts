/**
 * Display helpers for gendered Czech strings.
 *
 * Values in the database store the combined form (e.g. "svobodný/á",
 * "ženatý/vdaná") so both genders are preserved regardless of who enters
 * the data. On display we show only the variant matching the employee's
 * gender.
 *
 * Split rule:
 *   - Split on "/".
 *   - Male = the part before the slash.
 *   - Female = the part after the slash. If that part is 1–2 characters
 *     it is treated as a suffix replacing the last character of the male
 *     form ("svobodný/á" → "svobodná"). Otherwise it is a full word
 *     ("ženatý/vdaná" → "vdaná").
 */

export function displayGendered(
  value: string | null | undefined,
  gender: "m" | "f" | null | undefined
): string {
  if (!value) return "";
  const slash = value.indexOf("/");
  if (slash === -1) return value;

  const male = value.slice(0, slash);
  const femalePart = value.slice(slash + 1);

  if (gender === "m") return male;
  if (gender === "f") {
    if (femalePart.length <= 2) {
      return male.slice(0, -femalePart.length) + femalePart;
    }
    return femalePart;
  }

  return value; // unknown gender — keep combined form
}
