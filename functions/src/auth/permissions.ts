/**
 * RBAC permission catalog + resolver (single source of truth, backend side).
 *
 * Permissions are a FIXED vocabulary defined in code (each maps to a capability the
 * code actually enforces). Roles ("user types") are configurable DATA that bundle
 * these keys; a user has a role type plus optional per-user grants/revokes.
 *
 * This file (Phase 1) defines the catalog, the built-in role→permission mappings
 * that reproduce today's behaviour exactly, and the resolver/middleware. It is
 * ADDITIVE — endpoints still use requireRole until the Phase 2 cutover wires
 * requirePermission in.
 *
 * Keep the catalog KEYS in sync with frontend/src/lib/permissions/catalog.ts
 * (the two packages cannot share code; labels may differ, keys must not).
 */
import { Response, NextFunction } from "express";
import { AuthRequest, UserRole } from "../middleware/auth";

// ─── Catalog ──────────────────────────────────────────────────────────────────
// Grouped for the in-app permission matrix; granularity is preserved.

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
      { key: "alerts.refresh", label: "Ručně obnovit upozornění" },
    ],
  },
  {
    group: "Žádosti o úpravu údajů",
    items: [
      { key: "changeRequests.submit.self", label: "Navrhnout úpravu vlastních údajů" },
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

// ─── Built-in role → permission mappings ────────────────────────────────────────
// Reproduce today's end-to-end behaviour. `admin` = ["system.admin"] which the
// resolver expands to ALL_PERMISSIONS (also covers any future permission keys).
//
// NOTE: a few endpoints today allow a role at the API level that the UI never
// exposes (e.g. hr could publish a plan via direct API). The Phase 2 cutover will
// align the backend to these intended (UI-matching) sets — review before cutover.

const BASE_SELF: Permission[] = [
  "nav.dashboard.view",
  "nav.profile.view",
  "dashboard.view",
  "self.profile.view",
  "self.profile.requestEdit",
  "changeRequests.submit.self",
  "sensitive.reveal.self",
  "vacation.request.self",
];

export const BUILTIN_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ["system.admin"],

  director: [
    ...BASE_SELF,
    "nav.shifts.view", "nav.vacation.view", "nav.employees.view", "nav.payroll.view",
    "nav.alerts.view", "nav.contractTemplates.view", "nav.audit.view",
    "employees.view.all", "employees.create", "employees.edit", "employees.delete",
    "employees.export", "employees.export.sensitive",
    "sensitive.reveal",
    "employment.view", "employment.manage",
    "contracts.view", "contracts.generate", "contracts.edit", "contracts.delete", "contracts.sign",
    "contractTemplates.view", "contractTemplates.manage",
    "documents.view", "documents.upload", "documents.delete",
    "benefits.view", "benefits.edit",
    "payroll.view", "payroll.create", "payroll.edit", "payroll.recalculate",
    "payroll.export", "payroll.notes.manage",
    "shifts.view.all", "shifts.plan.create", "shifts.plan.edit", "shifts.plan.delete",
    "shifts.plan.transition", "shifts.cells.edit", "shifts.planEmployees.manage",
    "shifts.mod.manage", "shifts.xAllowance.manage", "shifts.freeShift.manage",
    "shifts.changeRequest.review", "shifts.override.review", "shifts.export", "shifts.counterTable.view",
    "vacation.view.all", "vacation.review",
    "alerts.view", "alerts.read",
    "changeRequests.review",
    "audit.view",
    "dashboard.tasks.view", "dashboard.stats.view",
    "masterData.view",
    "settings.companies.manage", "settings.departments.manage",
    "settings.jobPositions.manage",
  ],

  // FOM — shift oversight; today's UI lets FOM fill shifts + manage plan staffing.
  manager: [
    ...BASE_SELF,
    "nav.shifts.view", "nav.vacation.view",
    "shifts.view.all", "shifts.cells.edit", "shifts.planEmployees.manage",
    "shifts.changeRequest.submit", "shifts.override.submit",
    "vacation.view.approvedUpcoming",
  ],

  employee: [
    ...BASE_SELF,
    "nav.shifts.view", "nav.vacation.view",
    "shifts.view.self", "shifts.cells.editOwnX",
    "shifts.freeShift.claim", "shifts.changeRequest.submit",
    "vacation.view.approvedUpcoming",
  ],

  // Read-only finance viewer: sees everyone (incl. reveal/export), no edits.
  accountant: [
    ...BASE_SELF.filter((p) => p !== "vacation.request.self"),
    "nav.employees.view",
    "employees.view.all", "employees.export", "employees.export.sensitive",
    "sensitive.reveal",
    "employment.view",
    "contracts.view",
    "documents.view",
    "benefits.view",
    "dashboard.stats.view",
    "masterData.view",
  ],

  // Personalista — people manager minus management-linked records (row-level scope).
  hr: [
    ...BASE_SELF,
    "nav.shifts.view", "nav.vacation.view", "nav.employees.view",
    "employees.view.nonManagement", "employees.create", "employees.edit", "employees.delete",
    "employees.export", "employees.export.sensitive",
    "sensitive.reveal",
    "employment.view", "employment.manage",
    "contracts.view", "contracts.generate", "contracts.edit", "contracts.delete", "contracts.sign",
    "documents.view", "documents.upload", "documents.delete",
    "benefits.view", "benefits.edit",
    "shifts.view.all", "shifts.plan.create", "shifts.plan.transition", "shifts.planEmployees.manage",
    "vacation.view.all",
    "masterData.view",
  ],
};

// ─── Resolver + middleware ──────────────────────────────────────────────────────

const ALL_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * Effective permission set for a built-in role plus optional per-user overrides.
 * `system.admin` expands to every permission (and any added later). Phase 4 will
 * feed real overrides from the user's claim; for now extra/revoked default empty.
 */
export function resolvePermissions(
  role: UserRole | undefined,
  extra: string[] = [],
  revoked: string[] = []
): Set<string> {
  if (!role) return new Set();
  const base = BUILTIN_ROLE_PERMISSIONS[role] ?? [];
  const set = new Set<string>(base);
  for (const p of extra) set.add(p);
  if (set.has("system.admin")) return new Set(ALL_SET);
  for (const p of revoked) set.delete(p);
  return set;
}

export function hasPermission(set: Set<string>, perm: Permission): boolean {
  return set.has("system.admin") || set.has(perm);
}

/**
 * Express middleware — passes if the caller has ANY of the listed permissions.
 * Call requireAuth first. (Phase 2 wires this in place of requireRole.)
 */
export function requirePermission(...perms: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const set = resolvePermissions(req.role);
    const ok = set.has("system.admin") || perms.some((p) => set.has(p));
    if (!ok) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
