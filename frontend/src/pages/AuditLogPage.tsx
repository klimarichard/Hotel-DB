import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { employeeDisplayName } from "@/lib/employeeName";
import Button from "@/components/Button";
import AuditEventCard from "@/components/AuditEventCard";
import { roleTypesApi, type UserProfile } from "@/lib/api";
import {
  type AuditCategory,
  type SettingsArea,
  CATEGORIES,
  CATEGORY_LABELS,
  SETTINGS_AREAS,
  SETTINGS_AREA_LABELS,
} from "@/lib/audit/labels";
import { type AuditEntry, bucketByDate, groupEntries } from "@/lib/audit/grouping";

interface NamedRec {
  id: string;
  name?: string;
  displayName?: string;
}
interface MonthRec {
  id: string;
  year: number;
  month: number;
}
import styles from "./AuditLogPage.module.css";

interface EmployeeMini {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
}

interface TemplateMini {
  id: string;
  displayName?: string;
  name?: string;
}

const MONTHS = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

// Which per-page sub-filters a selected set of categories reveals. With no
// category selected ("all pages"), only the broadly-useful employee filter
// shows; page-specific facets appear once their page is selected.
function subFilterVisibility(cats: Set<string>) {
  const any = (...c: AuditCategory[]) => c.some((x) => cats.has(x));
  return {
    employee: cats.size === 0 || any("smeny", "dovolena", "zamestnanci", "mzdy", "mujProfil"),
    year: any("smeny", "dovolena", "mzdy"),
    month: any("smeny", "mzdy"),
    template: cats.has("sablony"),
    settingsArea: cats.has("nastaveni"),
  };
}

export default function AuditLogPage() {
  const { can, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();

  // Filter state mirrors the URL so deep-links from EmployeeDetailPage work.
  // category + userId are multi-value (comma-separated); the rest are single.
  const categoryParam = params.get("category") ?? "";
  const userIdParam = params.get("userId") ?? "";
  const employeeId = params.get("employeeId") ?? "";
  const yearFilter = params.get("year") ?? "";
  const monthFilter = params.get("month") ?? "";
  const templateId = params.get("templateId") ?? "";
  const settingsArea = params.get("settingsArea") ?? "";
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";

  const categories = useMemo(() => categoryParam.split(",").filter(Boolean), [categoryParam]);
  const userIds = useMemo(() => userIdParam.split(",").filter(Boolean), [userIdParam]);
  const catSet = useMemo(() => new Set(categories), [categories]);
  const vis = useMemo(() => subFilterVisibility(catSet), [catSet]);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lookup tables for nicer display + filter dropdowns + record-title resolution
  const [employees, setEmployees] = useState<EmployeeMini[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [templates, setTemplates] = useState<TemplateMini[]>([]);
  // Entity-name lookups so a record's resourceId resolves to a human identifier
  // in the card title (the spec wants each record type to be identifiable).
  const [roleTypes, setRoleTypes] = useState<NamedRec[]>([]);
  const [companies, setCompanies] = useState<NamedRec[]>([]);
  const [departments, setDepartments] = useState<NamedRec[]>([]);
  const [positions, setPositions] = useState<NamedRec[]>([]);
  const [eduLevels, setEduLevels] = useState<NamedRec[]>([]);
  const [plans, setPlans] = useState<MonthRec[]>([]);
  const [periods, setPeriods] = useState<MonthRec[]>([]);

  useEffect(() => {
    // Load ALL statuses (incl. "before-start") so every audited employee
    // resolves to a name in the card title — a Před-nástupem employee's edits
    // were otherwise nameless.
    Promise.all([
      api.get<EmployeeMini[]>("/employees?status=active"),
      api.get<EmployeeMini[]>("/employees?status=before-start"),
      api.get<EmployeeMini[]>("/employees?status=terminated"),
    ])
      .then(([active, beforeStart, terminated]) => {
        const all = [...active, ...beforeStart, ...terminated].sort((a, b) =>
          (a.lastName ?? "").localeCompare(b.lastName ?? "", "cs")
        );
        setEmployees(all);
      })
      .catch(() => undefined);

    api
      .get<UserProfile[]>("/auth/users")
      .then((list) =>
        setUsers(
          [...list].sort((a, b) =>
            (a.name || a.email || "").localeCompare(b.name || b.email || "", "cs")
          )
        )
      )
      .catch(() => undefined);

    api
      .get<TemplateMini[]>("/contractTemplates")
      .then((list) =>
        setTemplates(
          [...list].sort((a, b) =>
            (a.displayName || a.name || "").localeCompare(b.displayName || b.name || "", "cs")
          )
        )
      )
      .catch(() => undefined);

    // Entity-name + month lookups for record-title resolution. Each is
    // best-effort (catch → empty) so a missing permission never breaks the log.
    roleTypesApi.list().then(setRoleTypes).catch(() => undefined);
    api.get<NamedRec[]>("/companies").then(setCompanies).catch(() => undefined);
    api.get<NamedRec[]>("/departments").then(setDepartments).catch(() => undefined);
    api.get<NamedRec[]>("/jobPositions").then(setPositions).catch(() => undefined);
    api.get<NamedRec[]>("/educationLevels").then(setEduLevels).catch(() => undefined);
    api.get<MonthRec[]>("/shifts/plans").then(setPlans).catch(() => undefined);
    api.get<MonthRec[]>("/payroll/periods").then(setPeriods).catch(() => undefined);
  }, []);

  const employeeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    employees.forEach((e) => m.set(e.id, employeeDisplayName(e)));
    return m;
  }, [employees]);

  const userNameMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.uid, u.name || u.email));
    return m;
  }, [users]);

  // Entity name by `${collectionRoot}:${id}` (collision-free across collections).
  const entityNameMap = useMemo(() => {
    const m = new Map<string, string>();
    const add = (root: string, recs: NamedRec[]) =>
      recs.forEach((r) => {
        const name = r.name || r.displayName;
        if (name) m.set(`${root}:${r.id}`, name);
      });
    add("roleTypes", roleTypes);
    add("companies", companies);
    add("departments", departments);
    add("jobPositions", positions);
    add("educationLevels", eduLevels);
    add("contractTemplates", templates);
    return m;
  }, [roleTypes, companies, departments, positions, eduLevels, templates]);

  // Month label ("Květen 2025") by `${collectionRoot}:${id}` for plans + periods.
  const monthMap = useMemo(() => {
    const m = new Map<string, string>();
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const add = (root: string, recs: MonthRec[]) =>
      recs.forEach((r) => {
        if (r.month >= 1 && r.month <= 12) m.set(`${root}:${r.id}`, `${cap(MONTHS[r.month - 1])} ${r.year}`);
      });
    add("shiftPlans", plans);
    add("payrollPeriods", periods);
    return m;
  }, [plans, periods]);

  // The human identifier shown after the "—" in the card header, resolved per
  // collection. Employee-scoped records (incl. shift cells + payroll entries)
  // show the name (+ month where the record is period-scoped); plan/period-level
  // records show the month; the rest show their entity name. Empty when there is
  // no meaningful identifier (e.g. a settings change — shown in the body).
  function recordTitle(ev: { collectionRoot: string; resourceId?: string; employeeId?: string }): {
    text: string;
    href?: string;
  } {
    const root = ev.collectionRoot;
    const rid = ev.resourceId ?? "";
    const month = monthMap.get(`${root}:${rid}`);
    if (ev.employeeId) {
      const name = employeeNameMap.get(ev.employeeId);
      const text = [name, month].filter(Boolean).join(", ");
      return { text, href: name ? `/zamestnanci/${ev.employeeId}` : undefined };
    }
    if (month) return { text: month };
    if (root === "users") return { text: userNameMap.get(rid) ?? "" };
    return { text: entityNameMap.get(`${root}:${rid}`) ?? "" };
  }

  // Recent years for the period filter (descending), client year is fine here.
  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y + 1, y, y - 1, y - 2];
  }, []);

  const buildQuery = (cursor?: string) => {
    const q = new URLSearchParams();
    if (categories.length) q.set("category", categories.join(","));
    if (userIds.length) q.set("userId", userIds.join(","));
    // Send page-specific facets only while their sub-filter is visible, so
    // deselecting a page drops its filter even if a stale value lingers in URL.
    if (vis.employee && employeeId) q.set("employeeId", employeeId);
    if (vis.year && yearFilter) q.set("year", yearFilter);
    if (vis.month && monthFilter) q.set("month", monthFilter);
    if (vis.template && templateId) q.set("templateId", templateId);
    if (vis.settingsArea && settingsArea) q.set("settingsArea", settingsArea);
    if (fromDate) q.set("from", new Date(fromDate + "T00:00:00").toISOString());
    if (toDate) q.set("to", new Date(toDate + "T23:59:59").toISOString());
    if (cursor) q.set("cursor", cursor);
    q.set("limit", "100");
    return q.toString();
  };

  // Reload when filters change
  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<{ entries: AuditEntry[]; nextCursor?: string }>(`/audit?${buildQuery()}`)
      .then((res) => {
        setEntries(res.entries);
        setNextCursor(res.nextCursor);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryParam,
    userIdParam,
    employeeId,
    yearFilter,
    monthFilter,
    templateId,
    settingsArea,
    fromDate,
    toDate,
  ]);

  function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    api
      .get<{ entries: AuditEntry[]; nextCursor?: string }>(`/audit?${buildQuery(nextCursor)}`)
      .then((res) => {
        setEntries((prev) => [...prev, ...res.entries]);
        setNextCursor(res.nextCursor);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  // Toggle a value in a comma-separated multi-value param (category / userId).
  function toggleMulti(key: string, value: string) {
    const cur = (params.get(key) ?? "").split(",").filter(Boolean);
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    const p = new URLSearchParams(params);
    if (next.length) p.set(key, next.join(","));
    else p.delete(key);
    setParams(p, { replace: true });
  }

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true });
  }

  const hasAnyFilter =
    categories.length > 0 ||
    userIds.length > 0 ||
    !!employeeId ||
    !!yearFilter ||
    !!monthFilter ||
    !!templateId ||
    !!settingsArea ||
    !!fromDate ||
    !!toDate;

  // Group flat per-field entries into events, then bucket by day. Re-runs over
  // the full accumulated list so groups re-form correctly across pagination.
  const events = useMemo(() => groupEntries(entries), [entries]);
  const buckets = useMemo(() => bucketByDate(events), [events]);

  // Wait for this component's own useAuth instance to finish loading before
  // gating — useAuth is a per-component hook (no shared context), so on first
  // render permissions are still empty. Mirrors PayrollPage / SettingsPage.
  if (authLoading) return null;
  if (!can("nav.audit.view")) return <Navigate to="/" replace />;

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Log změn</h1>
        {hasAnyFilter && (
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            Vymazat filtry
          </Button>
        )}
      </div>

      <div className={styles.filterPanel}>
        {/* Stránka (page category) — multi-select chips */}
        <div className={styles.filterGroup}>
          <span className={styles.groupLabel}>Stránka</span>
          <div className={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={catSet.has(c) ? styles.chipActive : styles.chip}
                onClick={() => toggleMulti("category", c)}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Autor změny (user) — multi-select chips */}
        {users.length > 0 && (
          <div className={styles.filterGroup}>
            <span className={styles.groupLabel}>Autor změny</span>
            <div className={styles.chipRow}>
              {users.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  className={userIds.includes(u.uid) ? styles.chipActive : styles.chip}
                  onClick={() => toggleMulti("userId", u.uid)}
                >
                  {u.name || u.email}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sub-filters revealed by the selected page(s) + the date range */}
        <div className={styles.subFilters}>
          {vis.employee && (
            <label className={styles.field}>
              <span className={styles.label}>Zaměstnanec</span>
              <select
                value={employeeId}
                onChange={(e) => setFilter("employeeId", e.target.value)}
                className={styles.select}
              >
                <option value="">Všichni</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {employeeDisplayName(e)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {vis.year && (
            <label className={styles.field}>
              <span className={styles.label}>Rok</span>
              <select
                value={yearFilter}
                onChange={(e) => setFilter("year", e.target.value)}
                className={styles.select}
              >
                <option value="">Všechny</option>
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          )}

          {vis.month && (
            <label className={styles.field}>
              <span className={styles.label}>Měsíc</span>
              <select
                value={monthFilter}
                onChange={(e) => setFilter("month", e.target.value)}
                className={styles.select}
              >
                <option value="">Všechny</option>
                {MONTHS.map((name, i) => (
                  <option key={i} value={String(i + 1)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {vis.template && (
            <label className={styles.field}>
              <span className={styles.label}>Šablona</span>
              <select
                value={templateId}
                onChange={(e) => setFilter("templateId", e.target.value)}
                className={styles.select}
              >
                <option value="">Všechny</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName || t.name || t.id}
                  </option>
                ))}
              </select>
            </label>
          )}

          {vis.settingsArea && (
            <label className={styles.field}>
              <span className={styles.label}>Oblast nastavení</span>
              <select
                value={settingsArea}
                onChange={(e) => setFilter("settingsArea", e.target.value)}
                className={styles.select}
              >
                <option value="">Všechny</option>
                {SETTINGS_AREAS.map((a) => (
                  <option key={a} value={a}>
                    {SETTINGS_AREA_LABELS[a as SettingsArea]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={styles.field}>
            <span className={styles.label}>Od</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFilter("from", e.target.value)}
              className={styles.dateInput}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Do</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setFilter("to", e.target.value)}
              className={styles.dateInput}
            />
          </label>
        </div>
      </div>

      {error && <div className={styles.errorState}>{error}</div>}

      {buckets.length === 0 && !loading ? (
        <div className={styles.emptyState}>Žádné záznamy.</div>
      ) : (
        buckets.map((bucket) => (
          <section key={bucket.label} className={styles.dateBucket}>
            <h2 className={styles.dateHeader}>{bucket.label}</h2>
            <div className={styles.eventList}>
              {bucket.events.map((ev) => {
                const t = recordTitle(ev);
                return (
                  <AuditEventCard
                    key={ev.id}
                    event={ev}
                    authorName={
                      ev.userId === "system"
                        ? "Systém"
                        : userNameMap.get(ev.userId) || ev.userEmail || ev.userId
                    }
                    title={t.text}
                    titleHref={t.href}
                  />
                );
              })}
            </div>
          </section>
        ))
      )}

      <div className={styles.footer}>
        {loading && <span className={styles.dim}>Načítám...</span>}
        {!loading && nextCursor && (
          <Button variant="secondary" onClick={loadMore}>
            Načíst další
          </Button>
        )}
        {!loading && !nextCursor && events.length > 0 && (
          <span className={styles.dim}>Konec záznamů.</span>
        )}
      </div>
    </div>
  );
}
