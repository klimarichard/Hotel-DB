import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import Button from "@/components/Button";
import type { UserProfile } from "@/lib/api";
import styles from "./AuditLogPage.module.css";

interface AuditEntry {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  action: "create" | "update" | "delete" | "reveal" | "export";
  collection: string;
  resourceId?: string;
  subResourceId?: string;
  fieldPath?: string;
  oldValue?: unknown;
  newValue?: unknown;
  redacted?: boolean;
  summary?: Record<string, unknown>;
  employeeId?: string;
  extra?: Record<string, unknown>;
  timestamp?: { _seconds?: number; seconds?: number } | string | null;
}

interface EmployeeMini {
  id: string;
  firstName: string;
  lastName: string;
}

const ACTIONS: AuditEntry["action"][] = ["create", "update", "delete", "reveal", "export"];

const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  create: "Vytvoření",
  update: "Změna",
  delete: "Smazání",
  reveal: "Odhalení",
  export: "Export",
};

function tsToDate(ts: AuditEntry["timestamp"]): Date | null {
  if (!ts) return null;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  const seconds = ts._seconds ?? ts.seconds;
  if (typeof seconds === "number") return new Date(seconds * 1000);
  return null;
}

function formatTs(ts: AuditEntry["timestamp"]): string {
  const d = tsToDate(ts);
  if (!d) return "—";
  return d.toLocaleString("cs-CZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    try {
      const json = JSON.stringify(v);
      return json.length > 80 ? json.slice(0, 77) + "…" : json;
    } catch {
      return "[object]";
    }
  }
  return String(v);
}

export default function AuditLogPage() {
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      .then(setUsers)
      .catch(() => undefined);

    api
      .get<string[]>("/audit/meta/collections")
      .then(setCollections)
      .catch(() => undefined);
  }, []);

  const employeeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    employees.forEach((e) => m.set(e.id, `${e.lastName} ${e.firstName}`.trim()));
    return m;
  }, [employees]);

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
    setExpandedId(null);
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

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Auditní log</h1>
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
                {e.lastName} {e.firstName}
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
                {u.email} ({u.role})
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Kolekce</span>
          <select
            value={collectionFilter}
            onChange={(e) => setFilter("collection", e.target.value)}
            className={styles.select}
          >
            <option value="">Všechny</option>
            {collections.map((c) => (
              <option key={c} value={c}>
                {c}
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

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Čas</th>
            <th>Autor</th>
            <th>Akce</th>
            <th>Kolekce</th>
            <th>Záznam</th>
            <th>Pole</th>
            <th>Změna</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && !loading ? (
            <tr>
              <td colSpan={7} className={styles.empty}>
                Žádné záznamy.
              </td>
            </tr>
          ) : (
            entries.map((e) => {
              const expanded = expandedId === e.id;
              const empName = e.employeeId ? employeeNameMap.get(e.employeeId) : null;
              return (
                <Fragment key={e.id}>
                  <tr
                    className={styles.row}
                    onClick={() => setExpandedId(expanded ? null : e.id)}
                  >
                    <td className={styles.tsCell}>{formatTs(e.timestamp)}</td>
                    <td>
                      <div>{e.userEmail || e.userId}</div>
                      <div className={styles.role}>{e.userRole}</div>
                    </td>
                    <td>
                      <span className={`${styles.actionBadge} ${styles["action_" + e.action]}`}>
                        {ACTION_LABELS[e.action] ?? e.action}
                      </span>
                    </td>
                    <td>
                      <code className={styles.code}>{e.collection || "—"}</code>
                    </td>
                    <td>
                      {empName ? (
                        <Link
                          to={`/zamestnanci/${e.employeeId}`}
                          className={styles.empLink}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          {empName}
                        </Link>
                      ) : e.resourceId ? (
                        <code className={styles.code}>{e.resourceId}</code>
                      ) : (
                        "—"
                      )}
                      {e.subResourceId && (
                        <div className={styles.sub}>
                          <code className={styles.code}>{e.subResourceId}</code>
                        </div>
                      )}
                    </td>
                    <td>{e.fieldPath ? <code className={styles.code}>{e.fieldPath}</code> : "—"}</td>
                    <td>
                      {e.redacted ? (
                        <span className={styles.redacted}>citlivé pole změněno</span>
                      ) : e.action === "update" ? (
                        <span className={styles.diff}>
                          <span className={styles.oldVal}>{formatValue(e.oldValue)}</span>
                          <span className={styles.arrow}> → </span>
                          <span className={styles.newVal}>{formatValue(e.newValue)}</span>
                        </span>
                      ) : (
                        <span className={styles.dim}>—</span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className={styles.expandedRow}>
                      <td colSpan={7}>
                        <pre className={styles.json}>{JSON.stringify(e, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>

      <div className={styles.footer}>
        {loading && <span className={styles.dim}>Načítám...</span>}
        {!loading && nextCursor && (
          <Button variant="secondary" onClick={loadMore}>
            Načíst další
          </Button>
        )}
        {!loading && !nextCursor && entries.length > 0 && (
          <span className={styles.dim}>Konec záznamů.</span>
        )}
      </div>
    </div>
  );
}
