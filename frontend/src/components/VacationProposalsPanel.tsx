import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { employeeDisplayName } from "@/lib/employeeName";
import { MONTH_NAMES } from "@/lib/dateFormat";
import { useVacationProposals } from "@/context/VacationProposalsContext";
import styles from "./VacationProposalsPanel.module.css";

/** Shape of GET /vacation-proposals (pending only; app side computed live). */
export interface VacationProposal {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  year: number;
  month: number;
  contract: string;
  slipName: string;
  pdf: { letosni: number; lonska: number; dodatkova: number; total: number };
  appRemaining: number | null;
  currentYearHours: number | null;
  proposedCurrentYearHours: number;
  delta: number;
  createdAt: string;
  createdByName: string | null;
}

const h = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
const signedH = (n: number) => (n > 0 ? "+" : "") + h(n);

/**
 * Vacation-balance corrections proposed by Kontrola mezd (payslip ≠ ledger),
 * waiting for whoever manages vacation balances. Renders nothing when there is
 * nothing to resolve. Převzít recomputes on the server from the ledger AS IT IS
 * NOW, so a value shown here can't be applied stale; Zamítnout keeps the ledger.
 */
export default function VacationProposalsPanel({ onLedgerChanged }: { onLedgerChanged: () => void }) {
  const { refresh: refreshCount } = useVacationProposals();
  const [proposals, setProposals] = useState<VacationProposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState<VacationProposal | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ proposals: VacationProposal[] }>("/vacation-proposals");
      setProposals(res.proposals ?? []);
    } catch {
      setError("Návrhy úprav dovolené se nepodařilo načíst.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(p: VacationProposal, action: "apply" | "dismiss") {
    setBusy(p.id);
    setError(null);
    try {
      await api.post(`/vacation-proposals/${p.id}/${action}`, {});
      setProposals((list) => list.filter((x) => x.id !== p.id));
      if (action === "apply") onLedgerChanged();
    } catch (err) {
      setError(
        `${action === "apply" ? "Úpravu se nepodařilo převzít" : "Návrh se nepodařilo zamítnout"}.${
          err instanceof Error && err.message ? ` (${err.message})` : ""
        }`,
      );
      void load(); // e.g. 409 – someone else already resolved it
    } finally {
      setBusy(null);
      void refreshCount();
    }
  }

  if (!proposals.length && !error) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>Návrhy úprav nároku z kontroly mezd ({proposals.length})</h2>
      <p className={styles.hint}>
        Zůstatek dovolené na mzdovém lístku se liší od aplikace. Převzít nastaví Letošní nárok tak, aby zůstatek
        odpovídal lístku; Zamítnout ponechá evidenci beze změny.
      </p>
      {proposals.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Zaměstnanec</th>
                <th>Měsíc</th>
                <th>Úvazek</th>
                <th className={styles.num}>Zůstatek v aplikaci</th>
                <th className={styles.num}>Zůstatek na lístku</th>
                <th className={styles.num}>Rozdíl</th>
                <th className={styles.num}>Letošní nárok</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id}>
                  <td>{employeeDisplayName(p)}</td>
                  <td>
                    {MONTH_NAMES[p.month - 1]} {p.year}
                  </td>
                  <td className={styles.muted}>{p.contract}</td>
                  <td className={styles.num}>{p.appRemaining === null ? "nárok nezadán" : `${h(p.appRemaining)} h`}</td>
                  <td
                    className={styles.num}
                    title={`Letošní ${h(p.pdf.letosni)} h · Loňská ${h(p.pdf.lonska)} h · Dodatková ${h(p.pdf.dodatkova)} h`}
                  >
                    {h(p.pdf.total)} h
                  </td>
                  <td className={`${styles.num} ${styles.delta}`}>{signedH(p.delta)} h</td>
                  <td className={styles.num}>
                    {p.currentYearHours === null ? "–" : h(p.currentYearHours)} → <strong>{h(p.proposedCurrentYearHours)}</strong> h
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => act(p, "apply")}>
                        {busy === p.id ? "Ukládám…" : "Převzít"}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setConfirmDismiss(p)}>
                        Zamítnout
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}

      {confirmDismiss && (
        <ConfirmModal
          title="Zamítnout návrh"
          message={`Evidence dovolené zaměstnance ${employeeDisplayName(confirmDismiss)} zůstane beze změny. Návrh se znovu objeví jen tehdy, když další kontrola mezd ukáže jiný zůstatek.`}
          confirmLabel="Zamítnout"
          danger
          onConfirm={() => {
            const p = confirmDismiss;
            setConfirmDismiss(null);
            void act(p, "dismiss");
          }}
          onCancel={() => setConfirmDismiss(null)}
        />
      )}
    </div>
  );
}
