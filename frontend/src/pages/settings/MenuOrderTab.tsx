import { useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import { api } from "@/lib/api";
import {
  ALL_ROLES,
  ROLE_LABELS,
  MENU_ITEMS,
  resolveOrderForRole,
  type MenuOrderMap,
} from "@/lib/menuItems";
import type { UserRole } from "@/hooks/useAuth";
import styles from "./MenuOrderTab.module.css";

const labelById = new Map(MENU_ITEMS.map((m) => [m.id, m.label] as const));

export default function MenuOrderTab() {
  const [drafts, setDrafts] = useState<Record<UserRole, string[]>>({
    admin: [],
    director: [],
    manager: [],
    employee: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Capture the originally-saved map so we can detect "dirty" rows and
  // disable Uložit when nothing has changed.
  const [original, setOriginal] = useState<Record<UserRole, string[]>>({
    admin: [],
    director: [],
    manager: [],
    employee: [],
  });

  useEffect(() => {
    setLoading(true);
    api
      .get<MenuOrderMap>("/settings/menu-order")
      .then((map) => {
        const next: Record<UserRole, string[]> = {
          admin: [],
          director: [],
          manager: [],
          employee: [],
        };
        for (const role of ALL_ROLES) {
          // resolveOrderForRole produces the same view Layout renders, so
          // the editor reflects exactly what each role sees today.
          next[role] = resolveOrderForRole(role, map[role] ?? null).map((m) => m.id);
        }
        setDrafts(next);
        setOriginal(next);
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = useMemo(
    () =>
      ALL_ROLES.some(
        (role) =>
          drafts[role].length !== original[role].length ||
          drafts[role].some((id, i) => id !== original[role][i])
      ),
    [drafts, original]
  );

  function move(role: UserRole, idx: number, dir: -1 | 1) {
    setDrafts((prev) => {
      const list = prev[role].slice();
      const target = idx + dir;
      if (target < 0 || target >= list.length) return prev;
      [list[idx], list[target]] = [list[target], list[idx]];
      return { ...prev, [role]: list };
    });
  }

  function copyFrom(target: UserRole, source: UserRole) {
    setDrafts((prev) => {
      // Take source's order, drop ids the target role can't access, then
      // append any target-only items the source list lacks.
      const filtered = resolveOrderForRole(target, prev[source]).map((m) => m.id);
      return { ...prev, [target]: filtered };
    });
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.put("/settings/menu-order", {
        admin: drafts.admin,
        director: drafts.director,
        manager: drafts.manager,
        employee: drafts.employee,
      });
      setOriginal({ ...drafts });
      setSaveMsg("Uloženo");
    } catch (e) {
      setSaveMsg(`Chyba: ${(e as Error).message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }

  if (loading) return <div className={styles.loading}>Načítám…</div>;

  return (
    <div>
      <p className={styles.intro}>
        Pořadí položek v menu pro jednotlivé role. Šipky ▲ ▼ posouvají položku v rámci role.
        Tlačítko „Kopírovat z…" převezme pořadí z jiné role (s respektováním oprávnění cílové role).
      </p>

      <div className={styles.grid}>
        {ALL_ROLES.map((role) => (
          <section key={role} className={styles.card}>
            <header className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>{ROLE_LABELS[role]}</h3>
              <div className={styles.copyRow}>
                <label className={styles.copyLabel}>Kopírovat z:</label>
                <select
                  className={styles.copySelect}
                  value=""
                  onChange={(e) => {
                    const src = e.target.value as UserRole | "";
                    if (!src) return;
                    copyFrom(role, src);
                    e.target.value = "";
                  }}
                >
                  <option value="">—</option>
                  {ALL_ROLES.filter((r) => r !== role).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            {drafts[role].length === 0 ? (
              <div className={styles.empty}>Žádné položky.</div>
            ) : (
              <ul className={styles.list}>
                {drafts[role].map((id, idx) => (
                  <li key={id} className={styles.row}>
                    <span className={styles.rowLabel}>{labelById.get(id) ?? id}</span>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.arrowBtn}
                        disabled={idx === 0}
                        onClick={() => move(role, idx, -1)}
                        aria-label="Posunout nahoru"
                        title="Posunout nahoru"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className={styles.arrowBtn}
                        disabled={idx === drafts[role].length - 1}
                        onClick={() => move(role, idx, 1)}
                        aria-label="Posunout dolů"
                        title="Posunout dolů"
                      >
                        ▼
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className={styles.footer}>
        {saveMsg && (
          <span className={saveMsg === "Uloženo" ? styles.saveOk : styles.saveErr}>{saveMsg}</span>
        )}
        <Button variant="primary" onClick={save} disabled={!isDirty || saving}>
          {saving ? "Ukládám…" : "Uložit"}
        </Button>
      </div>
    </div>
  );
}
