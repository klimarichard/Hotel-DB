/**
 * RBAC permission catalog (frontend mirror) — HIERARCHICAL structure.
 *
 * KEYS must stay in sync with functions/src/auth/permissions.ts (the backend is the
 * real gate; this drives the in-app permission matrix UI and the `can()` helper).
 * The two packages can't share code, so this is a manual mirror — labels may differ,
 * keys must not. (scripts/_verify-perm-mapping.js asserts the key sets are equal.)
 *
 * Structure source of truth: PERMISSIONS_LIST.md (repo root). Each app page is a
 * SECTION; sections may have SUBSECTIONS. Every item carries a `level`:
 *   0 = the section master ("-!", always a nav.X.view key — gates the whole section)
 *   1..4 = "-".."----" nesting. A level-N item is only grantable in the UI once its
 *   parent (nearest preceding level-(N-1) item within the same subsection; the master
 *   for level 1) is granted. `exclusiveGroup` marks mutually-exclusive siblings.
 *
 * The hierarchy is a FRONTEND affordance only — the backend stores/validates a flat
 * permission array and never sees this tree. See lib/permissions/hierarchy.ts for the
 * dependency-resolution logic and components/permissions/PermissionMatrix.tsx for rendering.
 */

export interface PermItem {
  readonly key: string;
  readonly label: string;
  readonly level: number; // 0 = master, 1..4 = nesting depth
  readonly exclusiveGroup?: string; // mutually-exclusive within this (pre-resolved-unique) group id
  readonly spaceBefore?: boolean; // blank line in the spec → visual gap above the row
}
export interface PermSubsection {
  readonly title?: string; // undefined = items sit directly under the section (H2)
  readonly items: readonly PermItem[];
}
export interface PermSection {
  readonly title: string;
  readonly subsections: readonly PermSubsection[];
}

export const PERMISSION_SECTIONS = [
  {
    title: "Přehled",
    subsections: [
      {
        items: [
          { key: "nav.dashboard.view", label: "Zobrazit Přehled", level: 0 },
          { key: "dashboard.staffing.view", label: "Zobrazit sekce Dnes/Zítra", level: 1 },
          { key: "dashboard.view", label: "Zobrazit svoje nejbližší směny", level: 1 },
          { key: "dashboard.tasks.view", label: "Zobrazit nevyřízená upozornění", level: 1 },
          { key: "dashboard.stats.view", label: "Zobrazit statistiky zaměstnanců", level: 1 },
        ],
      },
    ],
  },
  {
    title: "Směny",
    subsections: [
      {
        items: [
          { key: "nav.shifts.view", label: "Zobrazit Směny", level: 0 },
          { key: "shifts.view.self", label: "Zobrazit tabulku směn", level: 1, exclusiveGroup: "shifts.view" },
          { key: "shifts.cells.editOwnX", label: "Zadávat X", level: 2 },
          { key: "shifts.override.submit", label: "Zažádat o výjimku X", level: 2 },
          { key: "shifts.changeRequest.submit", label: "Zažádat o změnu směny", level: 2 },
          { key: "shifts.freeShift.claim", label: "Zažádat o volnou směnu", level: 2 },
          { key: "shifts.view.all", label: "Zobrazit tabulku směn (všechny stavy)", level: 1, exclusiveGroup: "shifts.view", spaceBefore: true },
          { key: "shifts.cells.edit", label: "Vyplňovat libovolné buňky", level: 2 },
          { key: "shifts.mod.manage", label: "Spravovat MOD", level: 3 },
          { key: "shifts.planEmployees.manage", label: "Spravovat zaměstnance v plánu", level: 2 },
          { key: "shifts.xAllowance.manage", label: "Nastavit limit X", level: 2 },
          { key: "shifts.override.review", label: "Schvalovat výjimky", level: 2 },
          { key: "shifts.changeRequest.review", label: "Schvalovat žádosti o změnu směny", level: 2 },
          { key: "shifts.freeShift.manage", label: "Spravovat volné směny (DPA dny)", level: 2 },
          { key: "shifts.counterTable.view", label: "Zobrazit tabulku obsazenosti", level: 2 },
          { key: "shifts.plan.edit", label: "Upravit plán (termíny, metadata)", level: 2 },
          { key: "shifts.plan.transition", label: "Přechody stavů plánu (otevřít/zavřít/publikovat)", level: 3 },
          { key: "shifts.plan.revert", label: "Vrátit plán do předchozího stavu", level: 4 },
          { key: "shifts.plan.create", label: "Vytvořit plán", level: 3 },
          { key: "shifts.plan.delete", label: "Smazat plán", level: 3 },
          { key: "shifts.export", label: "Export plánu směn (PDF/CSV)", level: 1, spaceBefore: true },
        ],
      },
    ],
  },
  {
    title: "Dovolená",
    subsections: [
      {
        items: [
          { key: "nav.vacation.view", label: "Zobrazit Dovolenou", level: 0 },
          { key: "vacation.request.self", label: "Podat/upravit vlastní žádost", level: 1 },
          { key: "vacation.view.approvedUpcoming", label: "Zobrazit schválené dovolené kolegů", level: 1, exclusiveGroup: "vacation.view" },
          { key: "vacation.view.all", label: "Zobrazit všechny žádosti", level: 1, exclusiveGroup: "vacation.view" },
          { key: "vacation.review", label: "Schvalovat dovolenou", level: 2 },
        ],
      },
    ],
  },
  {
    title: "Zaměstnanci",
    subsections: [
      {
        items: [{ key: "nav.employees.view", label: "Zobrazit Zaměstnance", level: 0 }],
      },
      {
        title: "Seznam zaměstnanců",
        items: [
          { key: "employees.view.all", label: "Zobrazit všechny zaměstnance", level: 1, exclusiveGroup: "employees.view" },
          { key: "employees.view.nonManagement", label: "Zobrazit zaměstnance (kromě vedení)", level: 1, exclusiveGroup: "employees.view" },
          { key: "benefits.view", label: "Zobrazit benefity", level: 1 },
          { key: "benefits.edit", label: "Upravit benefity / Multisport", level: 2 },
          { key: "employees.edit", label: "Upravit zaměstnance", level: 1 },
          { key: "employees.create", label: "Vytvořit zaměstnance", level: 2 },
          { key: "employees.delete", label: "Smazat zaměstnance", level: 2 },
          { key: "sensitive.reveal", label: "Odhalit skryté údaje", level: 1, spaceBefore: true },
          { key: "employees.export", label: "Exportovat seznam (CSV)", level: 1, spaceBefore: true },
          { key: "employees.export.sensitive", label: "Export včetně citlivých údajů", level: 2 },
        ],
      },
      {
        title: "Historie pracovního poměru",
        items: [
          { key: "employment.view", label: "Zobrazit historii pracovního poměru", level: 1 },
          { key: "employment.manage", label: "Spravovat historii (Nástup/Dodatek/Ukončení)", level: 2 },
        ],
      },
      {
        title: "Smlouvy",
        items: [
          { key: "contracts.view", label: "Zobrazit/stáhnout smlouvy", level: 1 },
          { key: "contracts.generate", label: "Generovat smlouvu", level: 2 },
          { key: "contracts.edit", label: "Upravit smlouvu", level: 2 },
          { key: "contracts.delete", label: "Smazat smlouvu", level: 2 },
          { key: "contracts.sign", label: "Nahrát podepsanou smlouvu", level: 2 },
        ],
      },
      {
        title: "Další dokumenty",
        items: [
          { key: "documents.view", label: "Zobrazit další dokumenty", level: 1 },
          { key: "documents.upload", label: "Nahrát dokument", level: 2 },
          { key: "documents.delete", label: "Smazat dokument", level: 2 },
        ],
      },
    ],
  },
  {
    title: "Mzdy",
    subsections: [
      {
        items: [
          { key: "nav.payroll.view", label: "Zobrazit Mzdy", level: 0 },
          { key: "payroll.edit", label: "Upravit mzdy (odemčené)", level: 1 },
          { key: "payroll.notes.manage", label: "Spravovat poznámky ke mzdám", level: 2 },
          { key: "payroll.lock", label: "Zamknout/odemknout období", level: 1 },
          { key: "payroll.recalculate", label: "Přepočítat mzdy (zachovává ruční úpravy)", level: 1 },
          { key: "payroll.recalculate.hard", label: "Tvrdý přepočet (zahodit veškeré úpravy)", level: 2 },
          { key: "payroll.create", label: "Vytvořit mzdové období", level: 1, spaceBefore: true },
          { key: "payroll.period.delete", label: "Smazat mzdové období", level: 1 },
          { key: "payroll.export", label: "Export mezd (PDF/CSV)", level: 1, spaceBefore: true },
        ],
      },
    ],
  },
  {
    title: "Upozornění",
    subsections: [
      {
        items: [
          { key: "nav.alerts.view", label: "Zobrazit Upozornění", level: 0 },
          { key: "alerts.read", label: "Označit upozornění jako přečtené", level: 1 },
          { key: "changeRequests.review", label: "Schvalovat úpravy údajů", level: 1 },
        ],
      },
    ],
  },
  {
    title: "Šablony smluv",
    subsections: [
      {
        items: [
          { key: "nav.contractTemplates.view", label: "Zobrazit Šablony smluv", level: 0 },
          { key: "contractTemplates.manage", label: "Spravovat šablony", level: 1 },
        ],
      },
    ],
  },
  {
    title: "Log změn",
    subsections: [
      {
        items: [
          { key: "nav.audit.view", label: "Zobrazit Log změn", level: 0 },
        ],
      },
    ],
  },
  {
    title: "Můj profil",
    subsections: [
      {
        items: [
          { key: "nav.profile.view", label: "Zobrazit Můj profil", level: 0 },
          { key: "sensitive.reveal.self", label: "Odhalit vlastní citlivé údaje", level: 1 },
          { key: "self.profile.requestEdit", label: "Navrhnout úpravu vlastního profilu", level: 1 },
        ],
      },
    ],
  },
  {
    title: "Nastavení",
    subsections: [
      {
        items: [
          { key: "nav.settings.view", label: "Zobrazit Nastavení", level: 0 },
        ],
      },
      {
        title: "Uživatelé a oprávnění",
        items: [
          { key: "users.view", label: "Zobrazit uživatele", level: 1 },
          { key: "users.manage", label: "Spravovat uživatele (vytvořit/upravit/deaktivovat)", level: 2 },
          { key: "users.linkEmployee", label: "Propojit zaměstnance s účtem", level: 3 },
          { key: "users.setType", label: "Přiřadit typ uživatele", level: 3 },
          { key: "users.permissions.manage", label: "Spravovat individuální oprávnění uživatele", level: 4 },
          { key: "userTypes.manage", label: "Spravovat typy uživatelů", level: 1 },
        ],
      },
      {
        title: "Ostatní nastavení",
        items: [
          { key: "settings.companies.manage", label: "Spravovat společnosti", level: 1 },
          { key: "settings.departments.manage", label: "Spravovat oddělení", level: 1 },
          { key: "settings.jobPositions.manage", label: "Spravovat pracovní pozice", level: 1 },
          { key: "settings.educationLevels.manage", label: "Spravovat úrovně vzdělání", level: 1 },
          { key: "settings.payroll.manage", label: "Spravovat mzdová nastavení", level: 1 },
          { key: "settings.menuOrder.manage", label: "Spravovat pořadí menu", level: 1 },
        ],
      },
    ],
  },
  {
    title: "Systém",
    subsections: [
      {
        items: [
          // Umbrella master — inert server-side (no requirePermission checks it);
          // it only gates the three system rights below in the matrix hierarchy.
          { key: "system.access", label: "Přístup k systémovým funkcím", level: 0 },
          { key: "system.admin", label: "Superadmin (vše)", level: 1 },
          { key: "system.triggers", label: "Ruční spuštění naplánovaných úloh", level: 1 },
          { key: "system.timeOverride", label: "Testovací hodiny (mimo produkci)", level: 1 },
        ],
      },
    ],
  },
] as const;

type _CatalogItem =
  (typeof PERMISSION_SECTIONS)[number]["subsections"][number]["items"][number];
/** Literal union of every permission key — preserves typo-safety in `can("…")`. */
export type Permission = _CatalogItem["key"];

/** Flat list of every permission key, in catalog order. */
export const ALL_PERMISSIONS: Permission[] = PERMISSION_SECTIONS.flatMap((s) =>
  s.subsections.flatMap((ss) => ss.items.map((i) => i.key))
);

/**
 * Flat `{ group, items }` view of the catalog — group = section (page) title.
 * Back-compat for consumers that just want permission→group labelling and don't
 * need the hierarchy (e.g. the Nápověda HelpPage groups help by page section).
 */
export const PERMISSION_CATALOG: ReadonlyArray<{
  group: string;
  items: ReadonlyArray<{ key: string; label: string }>;
}> = PERMISSION_SECTIONS.map((s) => ({
  group: s.title,
  items: s.subsections.flatMap((ss) => ss.items.map((i) => ({ key: i.key, label: i.label }))),
}));

/** Membership check honouring the system.admin superuser key. */
export function hasPermission(set: ReadonlySet<string>, perm: Permission): boolean {
  return set.has("system.admin") || set.has(perm);
}

/**
 * Permissions that may never be granted through the in-app RBAC editors. Mirrors
 * the backend NON_GRANTABLE_PERMISSIONS — the server strips these regardless; this
 * keeps the UI from offering a toggle that can't take effect. `system.admin` is
 * shown (disabled) in its section but conferred only by the protected `admin` type.
 */
export const NON_GRANTABLE_PERMISSIONS: ReadonlySet<string> = new Set(["system.admin"]);
