import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { employeeDisplayName } from "@/lib/employeeName";
import Button from "@/components/Button";
import AuditEventCard from "@/components/AuditEventCard";
import type { UserProfile } from "@/lib/api";
import { ACTIONS, ACTION_LABELS, collectionLabel } from "@/lib/audit/labels";
import { type AuditEntry, bucketByDate, eventTitle, groupEntries } from "@/lib/audit/grouping";
import styles from "./AuditLogPage.module.css";

interface EmployeeMini {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
}

export default function AuditLogPage() {
  const { can, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();

  // Filter state mirrors the URL so deep-links from EmployeeDetailPage work.
  const employeeId = params.get("employeeId") ?? "";
  const userId = params.get("userId") ?? "";
  const collectionFilter = params.get("collection") ?? "";
  const actionFilter = params.get("action") ?? "";
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lookup tables for nicer display + filter dropdowns
  const [employees, setEmployees] = useState<EmployeeMini[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [collections, setCollections] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<EmployeeMini[]>("/employees?status=active"),
      api.get<EmployeeMini[]>("/employees?status=terminated"),
    ])
      .then(([active, terminated]) => {
        const all = [...active, ...terminated].sort((a, b) =>
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
      .get<string[]>("/audit/meta/collections")
      .then(setCollections)
      .catch(() => undefined);
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

  const buildQuery = (cursor?: string) => {
    const q = new URLSearchParams();
    if (employeeId) q.set("employeeId", employeeId);
    if (userId) q.set("userId", userId);
    if (collectionFilter) q.set("collection", collectionFilter);
    if (actionFilter) q.set("action", actionFilter);
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
  }, [employeeId, userId, collectionFilter, actionFilter, fromDate, toDate]);

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

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true });
  }

  const hasAnyFilter =
    !!employeeId || !!userId || !!collectionFilter || !!actionFilter || !!fromDate || !!toDate;

  // Group flat per-field entries into events, then bucket by day. Re-runs over
  // the full accumulated list so groups re-form correctly across pagination.
  const events = useMemo(() => groupEntries(entries), [entries]);
  const buckets = useMemo(() => bucketByDate(events), [events]);

  // Wait for this component's own useAuth instance to finish loading before
  // gating — useAuth is a per-component hook (no shared context), so on first
  // render permissions are still empty. Without this, the page would redirect
  // to "/" before /auth/me resolves, bouncing every user (incl. admin) to
  // Přehled even though the route guard already passed. Mirrors PayrollPage /
  // SettingsPage.
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

      <div className={styles.filters}>
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

        <label className={styles.field}>
          <span className={styles.label}>Autor změny</span>
          <select
            value={userId}
            onChange={(e) => setFilter("userId", e.target.value)}
            className={styles.select}
          >
            <option value="">Všichni</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.name || u.email} ({u.role})
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Oblast</span>
          <select
            value={collectionFilter}
            onChange={(e) => setFilter("collection", e.target.value)}
            className={styles.select}
          >
            <option value="">Všechny</option>
            {collections.map((c) => (
              <option key={c} value={c}>
                {collectionLabel(c)}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Akce</span>
          <select
            value={actionFilter}
            onChange={(e) => setFilter("action", e.target.value)}
            className={styles.select}
          >
            <option value="">Všechny</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>

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

      {error && <div className={styles.errorState}>{error}</div>}

      {buckets.length === 0 && !loading ? (
        <div className={styles.emptyState}>Žádné záznamy.</div>
      ) : (
        buckets.map((bucket) => (
          <section key={bucket.label} className={styles.dateBucket}>
            <h2 className={styles.dateHeader}>{bucket.label}</h2>
            <div className={styles.eventList}>
              {bucket.events.map((ev) => {
                const empName = ev.employeeId ? employeeNameMap.get(ev.employeeId) : undefined;
                const t = eventTitle(ev, empName);
                return (
                  <AuditEventCard
                    key={ev.id}
                    event={ev}
                    authorName={userNameMap.get(ev.userId) ?? ev.userEmail ?? ev.userId}
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
