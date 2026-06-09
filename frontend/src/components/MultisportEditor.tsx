import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { formatDateCZ } from "@/lib/dateFormat";
import Button from "./Button";
import IconButton from "./IconButton";
import ConfirmModal from "./ConfirmModal";
import styles from "./MultisportEditor.module.css";

interface Period {
  from: string;
  to: string | null;
}
interface Companion {
  id?: string;
  name: string;
  from: string;
  to: string | null;
  price: number;
}
interface BenefitsDoc {
  multisport?: boolean;
  multisportPeriods?: Period[];
  multisportCompanions?: Companion[];
  multisportFrom?: string | null;
  multisportTo?: string | null;
}

interface Props {
  employeeId: string;
}

interface PeriodRow {
  _k: string;
  from: string;
  to: string;
}
interface CompanionRow {
  _k: string;
  id?: string;
  name: string;
  from: string;
  to: string;
  price: string;
}

const uid = () => Math.random().toString(36).slice(2);

/** Read stored periods, with a fallback for legacy single-window benefits docs. */
function readPeriods(b: BenefitsDoc | null): Period[] {
  if (!b) return [];
  if (Array.isArray(b.multisportPeriods)) return b.multisportPeriods;
  if (b.multisport === true && b.multisportFrom) {
    return [{ from: b.multisportFrom, to: b.multisportTo ?? null }];
  }
  return [];
}

export default function MultisportEditor({ employeeId }: Props) {
  const { can } = useAuth();
  // Both managing (open editor) and saving are gated by benefits.edit. Built-in
  // admin/director hold it → unchanged.
  const canEdit = can("benefits.edit");
  const [doc, setDoc] = useState<BenefitsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [periodRows, setPeriodRows] = useState<PeriodRow[]>([]);
  const [companionRows, setCompanionRows] = useState<CompanionRow[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    try {
      const b = await api.get<BenefitsDoc | null>(`/employees/${employeeId}/benefits`);
      setDoc(b);
    } catch {
      setError("Nepodařilo se načíst Multisport.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  const periods = readPeriods(doc);
  const companions: Companion[] = Array.isArray(doc?.multisportCompanions)
    ? (doc!.multisportCompanions as Companion[])
    : [];
  const active = doc?.multisport === true;

  function openEditor() {
    setPeriodRows(periods.map((p) => ({ _k: uid(), from: p.from, to: p.to ?? "" })));
    setCompanionRows(
      companions.map((c) => ({
        _k: uid(),
        id: c.id,
        name: c.name,
        from: c.from,
        to: c.to ?? "",
        price: String(c.price ?? ""),
      }))
    );
    setEditing(true);
  }

  function closeEditor() {
    if (!saving) setEditing(false);
  }

  async function save() {
    const periodsOut: Period[] = [];
    for (const r of periodRows) {
      if (!r.from) {
        setError("Vyplňte datum začátku období Multisport.");
        return;
      }
      if (r.to && r.to < r.from) {
        setError("Datum konce období musí být stejné nebo pozdější než datum začátku.");
        return;
      }
      periodsOut.push({ from: r.from, to: r.to || null });
    }
    const companionsOut: Companion[] = [];
    for (const r of companionRows) {
      const name = r.name.trim();
      if (!name) {
        setError("Vyplňte jméno u doprovodné Multisport.");
        return;
      }
      if (!r.from) {
        setError("Vyplňte datum začátku u doprovodné Multisport.");
        return;
      }
      if (r.to && r.to < r.from) {
        setError("Datum konce doprovodné musí být stejné nebo pozdější než datum začátku.");
        return;
      }
      const price = Number(r.price);
      if (!Number.isFinite(price) || price < 0) {
        setError("Neplatná cena u doprovodné Multisport.");
        return;
      }
      companionsOut.push({ id: r.id, name, from: r.from, to: r.to || null, price });
    }
    setSaving(true);
    try {
      await api.put(`/employees/${employeeId}/multisport`, {
        periods: periodsOut,
        companions: companionsOut,
      });
      setEditing(false);
      await fetchDoc();
    } catch {
      setError("Nepodařilo se uložit Multisport.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <span className={styles.label}>Multisport</span>
        {active && <span className={styles.badge}>Aktivní</span>}
        {canEdit && (
          <Button data-tour="emp-benefits" variant="secondary" size="sm" onClick={openEditor}>
            Spravovat
          </Button>
        )}
      </div>

      {loading ? (
        <span className={styles.muted}>Načítám…</span>
      ) : periods.length === 0 && companions.length === 0 ? (
        <span className={styles.muted}>Žádný Multisport.</span>
      ) : (
        <>
          {periods.length > 0 && (
            <ul className={styles.list}>
              {periods.map((p, i) => (
                <li key={i}>
                  {formatDateCZ(p.from)} – {p.to ? formatDateCZ(p.to) : "trvá"}
                </li>
              ))}
            </ul>
          )}
          {companions.length > 0 && (
            <div className={styles.companions}>
              <span className={styles.subLabel}>Doprovodná Multisport</span>
              <ul className={styles.list}>
                {companions.map((c, i) => (
                  <li key={i}>
                    {c.name} — {formatDateCZ(c.from)} – {c.to ? formatDateCZ(c.to) : "trvá"} ·{" "}
                    {Number(c.price).toLocaleString("cs-CZ")} Kč
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {editing && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Spravovat Multisport</h2>
              <IconButton aria-label="Zavřít" onClick={closeEditor} disabled={saving}>
                ✕
              </IconButton>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.sectionHead}>
                <span className={styles.subLabel}>Období Multisport</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPeriodRows((rows) => [...rows, { _k: uid(), from: "", to: "" }])}
                >
                  + Přidat období
                </Button>
              </div>
              {periodRows.length === 0 && <p className={styles.muted}>Žádné období.</p>}
              {periodRows.map((r) => (
                <div key={r._k} className={styles.row}>
                  <label className={styles.inl}>
                    <span>Od</span>
                    <input
                      type="date"
                      value={r.from}
                      onChange={(e) =>
                        setPeriodRows((rows) =>
                          rows.map((x) => (x._k === r._k ? { ...x, from: e.target.value } : x))
                        )
                      }
                    />
                  </label>
                  <label className={styles.inl}>
                    <span>Do</span>
                    <input
                      type="date"
                      value={r.to}
                      onChange={(e) =>
                        setPeriodRows((rows) =>
                          rows.map((x) => (x._k === r._k ? { ...x, to: e.target.value } : x))
                        )
                      }
                    />
                  </label>
                  <IconButton
                    aria-label="Odebrat období"
                    onClick={() => setPeriodRows((rows) => rows.filter((x) => x._k !== r._k))}
                  >
                    ✕
                  </IconButton>
                </div>
              ))}

              <div className={styles.sectionHead} style={{ marginTop: 16 }}>
                <span className={styles.subLabel}>Doprovodná Multisport</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCompanionRows((rows) => [
                      ...rows,
                      { _k: uid(), name: "", from: "", to: "", price: "" },
                    ])
                  }
                >
                  + Přidat doprovodnou
                </Button>
              </div>
              {companionRows.length === 0 && <p className={styles.muted}>Žádná doprovodná.</p>}
              {companionRows.map((r) => (
                <div key={r._k} className={styles.companionRow}>
                  <label className={styles.inl}>
                    <span>Jméno</span>
                    <input
                      type="text"
                      value={r.name}
                      onChange={(e) =>
                        setCompanionRows((rows) =>
                          rows.map((x) => (x._k === r._k ? { ...x, name: e.target.value } : x))
                        )
                      }
                    />
                  </label>
                  <label className={styles.inl}>
                    <span>Od</span>
                    <input
                      type="date"
                      value={r.from}
                      onChange={(e) =>
                        setCompanionRows((rows) =>
                          rows.map((x) => (x._k === r._k ? { ...x, from: e.target.value } : x))
                        )
                      }
                    />
                  </label>
                  <label className={styles.inl}>
                    <span>Do</span>
                    <input
                      type="date"
                      value={r.to}
                      onChange={(e) =>
                        setCompanionRows((rows) =>
                          rows.map((x) => (x._k === r._k ? { ...x, to: e.target.value } : x))
                        )
                      }
                    />
                  </label>
                  <label className={styles.inl}>
                    <span>Cena (Kč)</span>
                    <input
                      type="number"
                      min="0"
                      value={r.price}
                      onChange={(e) =>
                        setCompanionRows((rows) =>
                          rows.map((x) => (x._k === r._k ? { ...x, price: e.target.value } : x))
                        )
                      }
                    />
                  </label>
                  <IconButton
                    aria-label="Odebrat doprovodnou"
                    onClick={() => setCompanionRows((rows) => rows.filter((x) => x._k !== r._k))}
                  >
                    ✕
                  </IconButton>
                </div>
              ))}
            </div>
            <div className={styles.modalFooter}>
              <Button variant="secondary" onClick={closeEditor} disabled={saving}>
                Zrušit
              </Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <ConfirmModal
          title="Chyba"
          message={error}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}
    </div>
  );
}
