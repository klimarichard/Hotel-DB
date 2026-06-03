import { useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import { api, roleTypesApi, type RoleType } from "@/lib/api";
import { MENU_ITEMS, resolveOrderByPermission } from "@/lib/menuItems";
import styles from "./MenuOrderTab.module.css";

const labelById = new Map(MENU_ITEMS.map((m) => [m.id, m.label] as const));

/** Build a can()-style checker for a user type's permission set. */
const canForType = (t: RoleType) => (perm: string) =>
  t.permissions.includes("system.admin") || t.permissions.includes(perm);

export default function MenuOrderTab() {
  const [types, setTypes] = useState<RoleType[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [original, setOriginal] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      roleTypesApi.list(),
      api.get<Record<string, string[]>>("/settings/menu-order").catch(() => ({} as Record<string, string[]>)),
    ])
      .then(([typeList, saved]) => {
        setTypes(typeList);
        const next: Record<string, string[]> = {};
        for (const t of typeList) {
          // resolveOrderByPermission produces exactly the sidebar view for the
          // type, so the editor reflects what each type sees.
          next[t.id] = resolveOrderByPermission(canForType(t), saved[t.id] ?? null).map((m) => m.id);
        }
        setDrafts(next);
        setOriginal(next);
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = useMemo(
    () =>
      types.some(
        (t) =>
          (drafts[t.id]?.length ?? 0) !== (original[t.id]?.length ?? 0) ||
          (drafts[t.id] ?? []).some((id, i) => id !== original[t.id]?.[i])
      ),
    [drafts, original, types]
  );

  function move(typeId: string, idx: number, dir: -1 | 1) {
    setDrafts((prev) => {
      const list = (prev[typeId] ?? []).slice();
      const target = idx + dir;
      if (target < 0 || target >= list.length) return prev;
      [list[idx], list[target]] = [list[target], list[idx]];
      return { ...prev, [typeId]: list };
    });
  }

  function copyFrom(targetId: string, sourceId: string) {
    const targetType = types.find((t) => t.id === targetId);
    if (!targetType) return;
    setDrafts((prev) => {
      // Take source's order, drop ids the target type can't access.
      const filtered = resolveOrderByPermission(canForType(targetType), prev[sourceId] ?? []).map((m) => m.id);
      return { ...prev, [targetId]: filtered };
    });
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, string[]> = {};
      for (const t of types) payload[t.id] = drafts[t.id] ?? [];
      await api.put("/settings/menu-order", payload);
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
        Pořadí položek v menu pro jednotlivé typy uživatelů. Šipky ▲ ▼ posouvají položku v rámci typu.
        Tlačítko „Kopírovat z…" převezme pořadí z jiného typu (s respektováním jeho oprávnění).
      </p>

      <div className={styles.grid}>
        {types.map((t) => (
          <section key={t.id} className={styles.card}>
            <header className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>{t.name}</h3>
              <div className={styles.copyRow}>
                <label className={styles.copyLabel}>Kopírovat z:</label>
                <select
                  className={styles.copySelect}
                  value=""
                  onChange={(e) => {
                    const src = e.target.value;
                    if (!src) return;
                    copyFrom(t.id, src);
                    e.target.value = "";
                  }}
                >
                  <option value="">—</option>
                  {types.filter((x) => x.id !== t.id).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>
            </header>

            {(drafts[t.id]?.length ?? 0) === 0 ? (
              <div className={styles.empty}>Žádné položky.</div>
            ) : (
              <ul className={styles.list}>
                {(drafts[t.id] ?? []).map((id, idx) => (
                  <li key={id} className={styles.row}>
                    <span className={styles.rowLabel}>{labelById.get(id) ?? id}</span>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.arrowBtn}
                        disabled={idx === 0}
                        onClick={() => move(t.id, idx, -1)}
                        aria-label="Posunout nahoru"
                        title="Posunout nahoru"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className={styles.arrowBtn}
                        disabled={idx === (drafts[t.id]?.length ?? 0) - 1}
                        onClick={() => move(t.id, idx, 1)}
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
