/**
 * RBAC permission catalog (frontend mirror).
 *
 * KEYS must stay in sync with functions/src/auth/permissions.ts (the backend is the
 * real gate; this drives the in-app permission matrix UI and the `can()` helper).
 * The two packages can't share code, so this is a manual mirror — labels may differ,
 * keys must not.
 *
 * Phase 1: additive. The effective permission set arrives from GET /auth/me and is
 * exposed via useAuth → `can(permission)` once Phase 3 wires it in.
 */

export const PERMISSION_CATALOG = [
  {
    group: "Stránky / navigace",
    items: [
      { key: "nav.dashboard.view", label: "Zobrazit Přehled" },
      { key: "nav.shifts.view", label: "Zobrazit Směny" },
      { key: "nav.vacation.view", label: "Zobrazit Dovolenou" },
      { key: "nav.employees.view", label: "Zobrazit Zaměstnance" },
      { key: "nav.payroll.view", label: "Zobrazit Mzdy" },
      { key: "nav.alerts.view", label: "Zobrazit Upozornění" },
      { key: "nav.contractTemplates.view", label: "Zobrazit Šablony smluv" },
      { key: "nav.audit.view", label: "Zobrazit Log změn" },
      { key: "nav.settings.view", label: "Zobrazit Nastavení" },
      { key: "nav.profile.view", label: "Zobrazit Můj profil" },
    ],
  },
  {
    group: "Zaměstnanci",
    items: [
      { key: "employees.view.all", label: "Zobrazit všechny zaměstnance" },
      { key: "employees.view.nonManagement", label: "Zobrazit zaměstnance (kromě vedení)" },
      { key: "employees.create", label: "Vytvořit zaměstnance" },
      { key: "employees.edit", label: "Upravit zaměstnance" },
      { key: "employees.delete", label: "Smazat zaměstnance" },
      { key: "employees.export", label: "Exportovat seznam (CSV)" },
      { key: "employees.export.sensitive", label: "Export včetně citlivých údajů" },
    ],
  },
  {
    group: "Citlivé údaje",
    items: [
      { key: "sensitive.reveal", label: "Odhalit citlivé údaje (cizí)" },
      { key: "sensitive.reveal.self", label: "Odhalit vlastní citlivé údaje" },
    ],
  },
  {
    group: "Pracovní poměr",
    items: [
      { key: "employment.view", label: "Zobrazit historii pracovního poměru" },
      { key: "employment.manage", label: "Spravovat poměr (Nástup/Dodatek/Ukončení)" },
    ],
  },
  {
    group: "Smlouvy",
    items: [
      { key: "contracts.view", label: "Zobrazit / stáhnout smlouvy" },
      { key: "contracts.generate", label: "Generovat smlouvu" },
      { key: "contracts.edit", label: "Upravit smlouvu" },
      { key: "contracts.delete", label: "Smazat smlouvu" },
      { key: "contracts.sign", label: "Označit/nahrát podepsanou" },
      { key: "contractTemplates.view", label: "Zobrazit šablony" },
      { key: "contractTemplates.manage", label: "Spravovat šablony" },
    ],
  },
  {
    group: "Další dokumenty",
    items: [
      { key: "documents.view", label: "Zobrazit další dokumenty" },
      { key: "documents.upload", label: "Nahrát dokument" },
      { key: "documents.delete", label: "Smazat dokument" },
    ],
  },
  {
    group: "Benefity / Multisport",
    items: [
      { key: "benefits.view", label: "Zobrazit benefity" },
      { key: "benefits.edit", label: "Upravit benefity / Multisport" },
    ],
  },
  {
    group: "Mzdy",
    items: [
      { key: "payroll.view", label: "Zobrazit mzdy" },
      { key: "payroll.create", label: "Vytvořit mzdové období" },
      { key: "payroll.edit", label: "Upravit mzdy (odemčené)" },
      { key: "payroll.recalculate", label: "Přepočítat (měkce)" },
      { key: "payroll.recalculate.hard", label: "Tvrdý přepočet (zahodit úpravy)" },
      { key: "payroll.period.delete", label: "Smazat mzdové období" },
      { key: "payroll.lock", label: "Zamknout / odemknout období" },
      { key: "payroll.export", label: "Export mezd (PDF/CSV)" },
      { key: "payroll.notes.manage", label: "Spravovat poznámky ke mzdám" },
    ],
  },
  {
    group: "Směny",
    items: [
      { key: "shifts.view.all", label: "Zobrazit celý plán směn" },
      { key: "shifts.view.self", label: "Zobrazit vlastní směny" },
      { key: "shifts.plan.create", label: "Vytvořit plán" },
      { key: "shifts.plan.edit", label: "Upravit plán (termíny, metadata)" },
      { key: "shifts.plan.delete", label: "Smazat plán" },
      { key: "shifts.plan.transition", label: "Přechody plánu (otevřít/zavřít/publikovat)" },
      { key: "shifts.plan.revert", label: "Vrátit plán zpět" },
      { key: "shifts.cells.edit", label: "Vyplňovat libovolné buňky" },
      { key: "shifts.cells.editOwnX", label: "Zadávat vlastní X (volno)" },
      { key: "shifts.planEmployees.manage", label: "Spravovat zaměstnance v plánu" },
      { key: "shifts.mod.manage", label: "Spravovat MOD" },
      { key: "shifts.xAllowance.manage", label: "Nastavit limit X" },
      { key: "shifts.freeShift.manage", label: "Spravovat volné směny (DPA dny)" },
      { key: "shifts.freeShift.claim", label: "Zažádat o volnou směnu" },
      { key: "shifts.changeRequest.submit", label: "Podat žádost o změnu směny" },
      { key: "shifts.changeRequest.review", label: "Schvalovat žádosti o změnu směny" },
      { key: "shifts.override.submit", label: "Podat žádost o výjimku" },
      { key: "shifts.override.review", label: "Schvalovat výjimky" },
      { key: "shifts.export", label: "Export plánu (PDF/CSV)" },
      { key: "shifts.counterTable.view", label: "Zobrazit tabulku obsazenosti" },
    ],
  },
  {
    group: "Dovolená",
    items: [
      { key: "vacation.request.self", label: "Podat/upravit vlastní žádost" },
      { key: "vacation.view.all", label: "Zobrazit všechny žádosti" },
      { key: "vacation.view.approvedUpcoming", label: "Zobrazit schválené dovolené kolegů" },
      { key: "vacation.review", label: "Schvalovat dovolenou" },
    ],
  },
  {
    group: "Upozornění",
    items: [
      { key: "alerts.view", label: "Zobrazit upozornění" },
      { key: "alerts.read", label: "Označit upozornění jako přečtené" },
    ],
  },
  {
    group: "Žádosti o úpravu údajů",
    items: [
      { key: "changeRequests.review", label: "Schvalovat úpravy údajů" },
    ],
  },
  {
    group: "Log změn",
    items: [{ key: "audit.view", label: "Zobrazit log změn" }],
  },
  {
    group: "Přehled",
    items: [
      { key: "dashboard.view", label: "Zobrazit vlastní přehled" },
      { key: "dashboard.tasks.view", label: "Zobrazit úkoly ke schválení" },
      { key: "dashboard.stats.view", label: "Zobrazit statistiky personálu" },
    ],
  },
  {
    group: "Číselníky a nastavení",
    items: [
      { key: "masterData.view", label: "Číst číselníky (firmy/oddělení/pozice/vzdělání)" },
      { key: "settings.companies.manage", label: "Spravovat společnosti" },
      { key: "settings.departments.manage", label: "Spravovat oddělení" },
      { key: "settings.jobPositions.manage", label: "Spravovat pracovní pozice" },
      { key: "settings.educationLevels.manage", label: "Spravovat vzdělání" },
      { key: "settings.payroll.manage", label: "Spravovat mzdová nastavení" },
      { key: "settings.menuOrder.manage", label: "Spravovat pořadí menu" },
    ],
  },
  {
    group: "Uživatelé a oprávnění",
    items: [
      { key: "users.view", label: "Zobrazit uživatele" },
      { key: "users.manage", label: "Spravovat uživatele (vytvořit/upravit/deaktivovat)" },
      { key: "users.setType", label: "Přiřadit typ uživatele" },
      { key: "users.permissions.manage", label: "Spravovat individuální oprávnění uživatele" },
      { key: "userTypes.manage", label: "Spravovat typy uživatelů" },
    ],
  },
  {
    group: "Systém",
    items: [
      { key: "system.admin", label: "Superadmin (vše)" },
      { key: "system.timeOverride", label: "Testovací hodiny (mimo produkci)" },
      { key: "system.triggers", label: "Ruční spuštění naplánovaných úloh" },
    ],
  },
  {
    group: "Vlastní profil",
    items: [
      { key: "self.profile.view", label: "Zobrazit vlastní profil" },
      { key: "self.profile.requestEdit", label: "Navrhnout úpravu vlastního profilu" },
    ],
  },
] as const;

type CatalogItem = (typeof PERMISSION_CATALOG)[number]["items"][number];
export type Permission = CatalogItem["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_CATALOG.flatMap((g) =>
  g.items.map((i) => i.key)
);

/** Membership check honouring the system.admin superuser key. */
export function hasPermission(set: ReadonlySet<string>, perm: Permission): boolean {
  return set.has("system.admin") || set.has(perm);
}
