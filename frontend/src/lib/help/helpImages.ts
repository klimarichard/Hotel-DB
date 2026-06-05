/**
 * Optional screenshots for the Nápověda (Help) page sections.
 *
 * Drop an image into `frontend/src/assets/help/` named after the section's slug
 * (see SLUG_BY_GROUP below) — e.g. `smeny.png` for the "Směny" section — and it
 * appears automatically. No code change needed: Vite globs the folder at build
 * time. Sections with no matching file simply render without an image.
 *
 * Supported extensions: png, jpg, jpeg, webp, svg.
 */

// Eagerly resolve every file in src/assets/help/ to its bundled URL. Returns an
// empty object (no images) until screenshots are added — never breaks the build.
const files = import.meta.glob("../../assets/help/*.{png,jpg,jpeg,webp,svg}", {
  eager: true,
  as: "url",
}) as Record<string, string>;

// basename without extension → URL
const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const base = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  byName[base] = url;
}

/**
 * Permission-catalog group label → screenshot filename slug (no extension).
 * Keys must match the `group` strings in lib/permissions/catalog.ts.
 */
const SLUG_BY_GROUP: Record<string, string> = {
  "Stránky / navigace": "navigace",
  Přehled: "prehled",
  Směny: "smeny",
  Dovolená: "dovolena",
  "Vlastní profil": "muj-profil",
  "Žádosti o úpravu údajů": "zadosti-zmeny",
  Zaměstnanci: "zamestnanci",
  "Citlivé údaje": "citlive-udaje",
  "Pracovní poměr": "pracovni-pomer",
  Smlouvy: "smlouvy",
  "Další dokumenty": "dokumenty",
  "Benefity / Multisport": "benefity",
  Mzdy: "mzdy",
  Upozornění: "upozorneni",
  "Log změn": "log-zmen",
  "Číselníky a nastavení": "ciselniky-nastaveni",
  "Uživatelé a oprávnění": "uzivatele-opravneni",
  Systém: "system",
};

/** Bundled screenshot URL for a Help section, or undefined if none exists yet. */
export function getHelpImage(group: string): string | undefined {
  const slug = SLUG_BY_GROUP[group];
  return slug ? byName[slug] : undefined;
}
