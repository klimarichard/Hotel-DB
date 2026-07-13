import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateCZ } from "@/lib/dateFormat";
import { hotelBySlug } from "@/lib/hotels";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { useHandoverWarningsContext } from "@/context/HandoverWarningsContext";
import styles from "../AlertsPage.module.css";

/**
 * Předávací protokol review surface. Two warning `type`s share one collection:
 *   - "chain" (Nenavazující předání) — Předal ≠ previous shift's Převzal.
 *   - "late"  (Pozdní příchod)       — Převzal signed after the next shift's start.
 * Legacy docs without a `type` are treated as "chain". Unread warnings show in
 * their own section; once read (either type) they drop into a shared "Přečtené".
 */
interface HandoverWarning {
  id: string;
  hotel: string;
  shiftDate: string;
  shiftType: "den" | "noc";
  type?: "chain" | "late";
  actorName?: string;
  expectedName?: string; // chain only
  prevzalLabel?: string; // late only — Prague-formatted sign time
  cutoffLabel?: string; // late only — e.g. "07:00"
  read?: boolean;
}

const SHIFT_LABELS: Record<string, string> = { den: "Den", noc: "Noc" };
const warnType = (w: HandoverWarning): "chain" | "late" => (w.type === "late" ? "late" : "chain");
const hotelLabel = (slug: string) => hotelBySlug(slug)?.label ?? slug;

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ActionCell({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <td>
      <button className={styles.markReadBtn} onClick={onClick}>
        {label}
      </button>
    </td>
  );
}

export default function HandoverWarningsTab() {
  const [warnings, setWarnings] = useState<HandoverWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshBadge } = useHandoverWarningsContext();

  useEffect(() => {
    api
      .get<HandoverWarning[]>("/handover-warnings")
      .then(setWarnings)
      .catch(() => setError("Upozornění se nepodařilo načíst."))
      .finally(() => setLoading(false));
  }, []);

  async function setRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    setWarnings((prev) => prev.map((w) => (ids.includes(w.id) ? { ...w, read } : w)));
    try {
      await api.post("/handover-warnings/read", { ids, read });
      refreshBadge(); // keep the tab count + sidebar badge in sync
    } catch {
      api.get<HandoverWarning[]>("/handover-warnings").then(setWarnings).catch(() => {});
      setError("Změnu se nepodařilo uložit. Zkuste to prosím znovu.");
    }
  }

  if (loading) return <div className={styles.state}>Načítám…</div>;

  const chainUnread = warnings.filter((w) => !w.read && warnType(w) === "chain");
  const lateUnread = warnings.filter((w) => !w.read && warnType(w) === "late");
  const read = warnings.filter((w) => w.read);
  const allUnreadIds = [...chainUnread, ...lateUnread].map((w) => w.id);

  return (
    <div>
      {allUnreadIds.length > 0 && (
        <div className={styles.tabHeader}>
          <Button variant="secondary" onClick={() => setRead(allUnreadIds, true)}>
            Označit vše jako přečtené
          </Button>
        </div>
      )}

      {/* ── Nenavazující předání (unread) ──────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          Nenavazující předání
          {chainUnread.length > 0 && <span className={styles.countBadge}>{chainUnread.length}</span>}
        </div>
        {chainUnread.length === 0 ? (
          <div className={styles.empty}>Žádná nenavazující předání.</div>
        ) : (
          <Table headers={["Hotel", "Datum", "Směna", "Předal", "Očekáván", ""]}>
            {chainUnread.map((w) => (
              <tr key={w.id} className={styles.rowExpiring}>
                <td data-label="Hotel">{hotelLabel(w.hotel)}</td>
                <td data-label="Datum">{formatDateCZ(w.shiftDate)}</td>
                <td data-label="Směna">{SHIFT_LABELS[w.shiftType] ?? w.shiftType}</td>
                <td data-label="Předal">{w.actorName || "–"}</td>
                <td data-label="Očekáván">{w.expectedName || "–"}</td>
                <ActionCell label="Přečteno" onClick={() => setRead([w.id], true)} />
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ── Pozdní příchody (unread) ───────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          Pozdní příchody
          {lateUnread.length > 0 && <span className={styles.countBadge}>{lateUnread.length}</span>}
        </div>
        {lateUnread.length === 0 ? (
          <div className={styles.empty}>Žádné pozdní příchody.</div>
        ) : (
          <Table headers={["Hotel", "Datum", "Směna", "Převzal", "Příchod", "Limit", ""]}>
            {lateUnread.map((w) => (
              <tr key={w.id} className={styles.rowExpiring}>
                <td data-label="Hotel">{hotelLabel(w.hotel)}</td>
                <td data-label="Datum">{formatDateCZ(w.shiftDate)}</td>
                <td data-label="Směna">{SHIFT_LABELS[w.shiftType] ?? w.shiftType}</td>
                <td data-label="Převzal">{w.actorName || "–"}</td>
                <td data-label="Příchod">{w.prevzalLabel || "–"}</td>
                <td data-label="Limit">{w.cutoffLabel || "–"}</td>
                <ActionCell label="Přečteno" onClick={() => setRead([w.id], true)} />
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ── Přečtené (shared, both types) ──────────────────────────────────── */}
      {read.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Přečtené</div>
          <Table headers={["Typ", "Hotel", "Datum", "Směna", "Popis", ""]}>
            {read.map((w) => {
              const isLate = warnType(w) === "late";
              return (
                <tr key={w.id} className={styles.rowRead}>
                  <td data-label="Typ">{isLate ? "Pozdní příchod" : "Nenavazující předání"}</td>
                  <td data-label="Hotel">{hotelLabel(w.hotel)}</td>
                  <td data-label="Datum">{formatDateCZ(w.shiftDate)}</td>
                  <td data-label="Směna">{SHIFT_LABELS[w.shiftType] ?? w.shiftType}</td>
                  <td data-label="Popis">
                    {isLate
                      ? `Převzal ${w.actorName || "–"} v ${w.prevzalLabel || "–"} (limit ${w.cutoffLabel || "–"})`
                      : `Předal ${w.actorName || "–"} (očekáván ${w.expectedName || "–"})`}
                  </td>
                  <ActionCell label="Označit jako nepřečtené" onClick={() => setRead([w.id], false)} />
                </tr>
              );
            })}
          </Table>
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
