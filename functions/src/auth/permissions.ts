/**
 * RBAC permission catalog + resolver (single source of truth, backend side).
 *
 * Permissions are a FIXED vocabulary defined in code (each maps to a capability the
 * code actually enforces). Roles ("user types") are configurable DATA that bundle
 * these keys; a user has a role type plus optional per-user grants/revokes.
 *
 * This file defines the catalog, the built-in role→permission mappings (the
 * fallback used when a roleTypes doc is missing/unavailable), and the resolver +
 * requirePermission middleware. Every endpoint is gated by requirePermission,
 * checked against the effective set requireAuth resolves onto req.permissions.
 *
 * Keep the catalog KEYS in sync with frontend/src/lib/permissions/catalog.ts
 * (the two packages cannot share code; labels may differ, keys must not).
 */
import * as admin from "firebase-admin";
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
      { key: "employees.export.questionnaire", label: "Export osobního dotazníku (PDF)" },
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
      { key: "documents.export.taxDeclaration", label: "Generovat prohlášení k dani (PDF)" },
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
    // plan.delete + counterTable are admin-only in the UI today; revert is too.
    "shifts.view.all", "shifts.plan.create", "shifts.plan.edit",
    "shifts.plan.transition", "shifts.cells.edit", "shifts.planEmployees.manage",
    "shifts.mod.manage", "shifts.xAllowance.manage", "shifts.freeShift.manage",
    "shifts.changeRequest.review", "shifts.override.review", "shifts.export",
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
  // No Můj profil / self-service in the UI today (route excludes accountant), so
  // it deliberately does NOT use BASE_SELF.
  accountant: [
    "nav.dashboard.view", "dashboard.view", "dashboard.stats.view",
    "nav.employees.view",
    "employees.view.all", "employees.export", "employees.export.sensitive",
    "sensitive.reveal",
    "employment.view",
    "contracts.view",
    "documents.view",
    "benefits.view",
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
    // hr sees the shift plan read-only in the UI (no edit/create/publish controls).
    "shifts.view.all",
    "vacation.view.approvedUpcoming",
    "masterData.view",
  ],
};

// ─── Resolver + middleware ──────────────────────────────────────────────────────

const ALL_SET = new Set<string>(ALL_PERMISSIONS);

/** Apply per-user overrides on top of a base permission list. system.admin
 *  expands to every permission (and revokes can't strip it). */
function applyOverrides(base: readonly string[], extra: string[], revoked: string[]): Set<string> {
  const set = new Set<string>(base);
  for (const p of extra) set.add(p);
  if (set.has("system.admin")) return new Set(ALL_SET);
  for (const p of revoked) set.delete(p);
  return set;
}

/**
 * Effective permission set for a BUILT-IN role plus optional per-user overrides.
 * Pure/synchronous — used as the fallback when the configurable roleTypes
 * collection is unavailable, and by the verification scripts.
 */
export function resolvePermissions(
  role: UserRole | undefined,
  extra: string[] = [],
  revoked: string[] = []
): Set<string> {
  if (!role) return new Set();
  return applyOverrides(BUILTIN_ROLE_PERMISSIONS[role] ?? [], extra, revoked);
}

// ─── Configurable roleTypes (Phase 4) ────────────────────────────────────────
// Roles are now editable DATA in roleTypes/{id} = { name, permissions[], system }.
// The resolver reads them through a per-instance cache (cheap: a handful of
// docs) and ALWAYS falls back to BUILTIN_ROLE_PERMISSIONS when a doc is missing
// or Firestore is unreachable — so a seeding gap or outage can never lock anyone
// out, and behaviour stays identical to the built-in mapping until an admin
// edits a type.

export const ROLE_TYPES_COLLECTION = "roleTypes";
const ROLE_TYPE_CACHE_TTL_MS = 60_000;

export interface RoleTypeData {
  permissions: string[];
  /** Whether holders count as "management" for employee-record scoping. */
  management: boolean;
}

/** Built-in management classification — the fallback when a roleTypes doc is
 *  missing (unseeded / Firestore down). Matches the legacy role-based query. */
const BUILTIN_MANAGEMENT: Record<UserRole, boolean> = {
  admin: true, director: true, manager: true, employee: false, accountant: false, hr: false,
};

let roleTypeCache: { at: number; map: Map<string, RoleTypeData> } | null = null;

async function loadRoleTypes(): Promise<Map<string, RoleTypeData> | null> {
  if (roleTypeCache && Date.now() - roleTypeCache.at < ROLE_TYPE_CACHE_TTL_MS) {
    return roleTypeCache.map;
  }
  try {
    const snap = await admin.firestore().collection(ROLE_TYPES_COLLECTION).get();
    const map = new Map<string, RoleTypeData>();
    for (const d of snap.docs) {
      const data = d.data() as { permissions?: unknown; management?: unknown };
      if (Array.isArray(data.permissions)) {
        map.set(d.id, {
          permissions: data.permissions.filter((p): p is string => typeof p === "string"),
          management: data.management === true,
        });
      }
    }
    roleTypeCache = { at: Date.now(), map };
    return map;
  } catch (e) {
    console.error("[rbac] roleTypes load failed; falling back to built-in roles:", e);
    return roleTypeCache?.map ?? null; // stale-but-usable, or null → builtin fallback
  }
}

/** Clear the in-memory roleTypes cache (used by tests + after an admin edit). */
export function clearRoleTypeCache(): void {
  roleTypeCache = null;
}

/**
 * The set of user-type ids that count as "management" for employee-record
 * scoping (whose linked employees are hidden from non-management viewers like
 * personalista). Reads the per-type `management` flag; falls back to the
 * built-in classification when the collection is unseeded/unavailable, and
 * back-fills any built-in management role missing as a doc (partial-seed safety).
 */
export async function getManagementTypeIds(): Promise<Set<string>> {
  const builtinMgmt = (Object.entries(BUILTIN_MANAGEMENT) as [UserRole, boolean][])
    .filter(([, isMgmt]) => isMgmt)
    .map(([id]) => id);
  const map = await loadRoleTypes();
  if (!map || map.size === 0) {
    return new Set<string>(builtinMgmt);
  }
  const ids = new Set<string>();
  for (const [id, t] of map) if (t.management) ids.add(id);
  // Back-fill built-in management roles not present as docs (partial-seed safety).
  for (const r of builtinMgmt) if (!map.has(r)) ids.add(r);
  return ids;
}

export interface EffectivePermissionInput {
  /** Legacy role claim — drives the builtin fallback + default roleType id. */
  role?: UserRole;
  /** Configurable user-type id (defaults to `role` for legacy accounts). */
  roleType?: string;
  /** Per-user granted permissions (on top of the type). */
  extra?: string[];
  /** Per-user revoked permissions (cannot strip system.admin). */
  revoked?: string[];
}

/**
 * Effective permission set from the configurable roleTypes + per-user overrides.
 * Resolution order for the base list: roleTypes/{roleType||role} doc → built-in
 * mapping for the legacy role → built-in mapping for the id → empty. Then apply
 * grants/revokes. This is the runtime gate; requireAuth resolves it once per
 * request and attaches it to req.permissions.
 */
export async function resolveEffectivePermissions(input: EffectivePermissionInput): Promise<Set<string>> {
  const { role, roleType, extra = [], revoked = [] } = input;
  const id = roleType ?? role;
  if (!id) return new Set();
  const map = await loadRoleTypes();
  const base =
    map?.get(id)?.permissions ??
    (role ? BUILTIN_ROLE_PERMISSIONS[role] : undefined) ??
    BUILTIN_ROLE_PERMISSIONS[id as UserRole] ??
    [];
  return applyOverrides(base, extra, revoked);
}

export function hasPermission(set: Set<string>, perm: Permission): boolean {
  return set.has("system.admin") || set.has(perm);
}

/**
 * Express middleware — passes if the caller has ANY of the listed permissions.
 * Reads the effective set resolved by requireAuth (req.permissions); call
 * requireAuth first.
 */
export function requirePermission(...perms: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const set = req.permissions ?? new Set<string>();
    const ok = set.has("system.admin") || perms.some((p) => set.has(p));
    if (!ok) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
