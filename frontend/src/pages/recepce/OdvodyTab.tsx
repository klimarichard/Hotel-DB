import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import {
  CZK_DENOMS,
  EUR_DENOMS,
  addMonths,
  computeOdvodPlan,
  currentMonth,
  czkNominalTotal,
  deadlinePhrase,
  emptyProtel,
  eurNominalTotal,
  fmtMoney,
  fmtNum,
  monthTitle,
  type OdvodAccount,
  type OdvodContext,
  type OdvodPlan,
  type ProtelValues,
} from "@/lib/odvody";
import styles from "./OdvodyTab.module.css";

/**
 * Odvody — end-of-month transfer of reception cash to the bank.
 *
 * The tab itself is a thin month view: a summary card of what is saved plus the
 * print sheet the accountant carries to the bank. Everything editable lives in
 * the modal, whose figures are previewed live through `computeOdvodPlan` (the
 * client mirror of the server's rules, see lib/odvody.ts).
 *
 * The draft is held HERE rather than inside the modal so the print sheet can
 * fall back to the values being typed when the month has nothing saved yet.
 */

/** Everything a PUT /odvody/:hotel/:month body needs. */
interface OdvodValues {
  nominalsCZK: Record<string, number>;
  nominalsEUR: Record<string, number>;
  receiptIds: string[];
  protel: Record<string, ProtelValues>;
  weights: Record<string, number>;
}

interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  showCancel?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}

function shiftLabel(type: "den" | "noc"): string {
  return type === "noc" ? "noční" : "denní";
}

/**
 * Protel amounts. Whole units only, in BOTH currencies – the vault holds EUR
 * banknotes and no cent coins, so nothing an odvod moves can carry a fraction
 * (see MONEY_STEP in lib/odvody.ts). A typed decimal is rounded rather than
 * rejected, so pasting a Protel figure with a trailing ",00" still works.
 */
function parseAmount(text: string): number {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parsePieces(text: string): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Seed the editable values from what is already saved for the month. */
function valuesFromContext(ctx: OdvodContext): OdvodValues {
  const s = ctx.saved;
  return {
    nominalsCZK: { ...(s?.nominalsCZK ?? {}) },
    nominalsEUR: { ...(s?.nominalsEUR ?? {}) },
    receiptIds: [...(s?.receiptIds ?? [])],
    protel: Object.fromEntries(
      ctx.registers.map((r) => [r.key, { ...emptyProtel(), ...(s?.protel?.[r.key] ?? {}) }])
    ),
    weights: Object.fromEntries(
      ctx.registers.map((r) => [r.key, s?.weights?.[r.key] ?? ctx.defaultWeights?.[r.key] ?? 1])
    ),
  };
}

export default function OdvodyTab({ hotel }: { hotel: Hotel }) {
  const { can } = useAuth();
  const canManage = can(hotel.odvodyManagePerm);

  const [month, setMonth] = useState<string>(currentMonth());
  const [ctx, setCtx] = useState<OdvodContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Non-null exactly while the modal is open — it IS the modal's form state. */
  const [draft, setDraft] = useState<OdvodValues | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<OdvodContext>(`/odvody/${hotel.slug}/${month}`);
      setCtx(res);
    } catch (err) {
      setCtx(null);
      setLoadError(errorMessage(err, "Odvod se nepodařilo načíst."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.slug, month]);

  /**
   * The receipts the modal offers. Normally the server hands back the protocol
   * with this odvod's effect taken back, so the ticked rows are present again.
   * Once the odvod has been PERFORMED the effect is not reversed (the money is
   * gone), so the rows it consumed are added back from the stored effect purely
   * so the read-only view can still show what was ticked.
   */
  const accounts: OdvodAccount[] = useMemo(() => {
    if (!ctx) return [];
    const list = [...ctx.accounts];
    for (const r of ctx.saved?.effect?.removedAccounts ?? []) {
      if (!list.some((a) => a.id === r.id)) {
        list.push({ id: r.id, name: r.name, amount: r.amount, locked: r.locked });
      }
    }
    return list;
  }, [ctx]);

  function receiptsTotalOf(ids: string[]): number {
    return accounts.filter((a) => ids.includes(a.id)).reduce((sum, a) => sum + Math.round(a.amount || 0), 0);
  }

  function planOf(values: OdvodValues): OdvodPlan | null {
    if (!ctx) return null;
    return computeOdvodPlan({
      registers: ctx.registers,
      nominalsCZK: values.nominalsCZK,
      nominalsEUR: values.nominalsEUR,
      receiptsTotal: receiptsTotalOf(values.receiptIds),
      protel: values.protel,
      weights: values.weights,
    });
  }

  // The printed sheet reflects the saved odvod when there is one; otherwise it
  // follows whatever is being typed in the modal.
  const printValues: OdvodValues | null = ctx ? (ctx.saved ? valuesFromContext(ctx) : draft) : null;
  const printPlan = printValues ? planOf(printValues) : null;

  const saved = ctx?.saved ?? null;
  const settled = !!saved?.eurSettled;
  const savedCZK = saved?.effect?.lineAmount ?? 0;
  const savedEUR = eurNominalTotal(saved?.effect?.trezorEurPending ?? {});

  function openModal() {
    if (!ctx) return;
    setDraft(valuesFromContext(ctx));
  }

  function showError(message: string) {
    setConfirm({
      title: "Chyba",
      message,
      showCancel: false,
      confirmLabel: "OK",
      onConfirm: () => setConfirm(null),
    });
  }

  async function saveDraft() {
    if (!ctx || !draft) return;
    setSaving(true);
    try {
      await api.put<{ ok: true }>(`/odvody/${hotel.slug}/${month}`, {
        nominalsCZK: draft.nominalsCZK,
        nominalsEUR: draft.nominalsEUR,
        receiptIds: draft.receiptIds,
        protel: draft.protel,
        weights: draft.weights,
      });
      setDraft(null);
      await load();
    } catch (err) {
      showError(errorMessage(err, "Odvod se nepodařilo uložit."));
    } finally {
      setSaving(false);
    }
  }

  function requestDelete() {
    setConfirm({
      title: "Smazat odvod?",
      message:
        `Opravdu chcete smazat odvod za ${monthTitle(month)}? Zaškrtnuté účty se vrátí do protokolu, ` +
        "bankovky se připíšou zpět do trezoru a řádek „odvod + účty“ zmizí.",
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void doDelete(),
    });
  }

  async function doDelete() {
    setConfirm(null);
    try {
      await api.delete<{ ok: true }>(`/odvody/${hotel.slug}/${month}`);
      await load();
    } catch (err) {
      showError(errorMessage(err, "Odvod se nepodařilo smazat."));
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.navBtn}
            aria-label="Předchozí měsíc"
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            ‹
          </button>
          <span className={styles.monthLabel}>{monthTitle(month)}</span>
          <button
            type="button"
            className={styles.navBtn}
            aria-label="Následující měsíc"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            ›
          </button>
        </div>
        <div className={styles.headerActions}>
          {canManage && (
            <Button size="sm" onClick={openModal} disabled={!ctx} data-tour="odvody-open">
              {saved ? "Upravit odvod" : "Zadat odvod"}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => window.print()} data-tour="odvody-print">
            Tisk
          </Button>
          {canManage && saved && !settled && (
            <Button variant="danger" size="sm" onClick={requestDelete}>
              Smazat odvod
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>Načítám…</div>
      ) : loadError ? (
        <div className={`${styles.empty} ${styles.statusError}`}>{loadError}</div>
      ) : ctx ? (
        <>
          {ctx.target.blocked && <div className={styles.banner}>{ctx.target.blocked}</div>}

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Odvod za {monthTitle(month)}</h3>
              {saved &&
                (settled ? (
                  <span className={styles.badgeDone}>Provedeno</span>
                ) : (
                  <span className={styles.badgePending}>Připraveno</span>
                ))}
            </div>

            {saved ? (
              <div className={styles.cardBody}>
                <div className={styles.cardRow}>
                  <span>TOTAL CZK</span>
                  <strong>{fmtMoney(savedCZK, "CZK")}</strong>
                </div>
                <div className={styles.cardRow}>
                  <span>TOTAL EUR</span>
                  <strong>{fmtMoney(savedEUR, "EUR")}</strong>
                </div>
                <div className={styles.cardRow}>
                  <span>Zapsáno v protokolu</span>
                  <strong>
                    {saved.effect
                      ? `${formatDate(saved.effect.shiftDate)} – ${shiftLabel(saved.effect.shiftType)}`
                      : "–"}
                  </strong>
                </div>
                <div className={styles.cardRow}>
                  <span>Provedeno</span>
                  <strong>
                    {settled && saved.eurSettledOn
                      ? `${formatDate(saved.eurSettledOn.shiftDate)} – ${shiftLabel(saved.eurSettledOn.shiftType)}`
                      : settled
                        ? "ano"
                        : "zatím ne"}
                  </strong>
                </div>
                {settled && (
                  <p className={styles.cardNote}>
                    Odvod už byl proveden – peníze fyzicky odešly, proto ho nelze měnit.
                  </p>
                )}
              </div>
            ) : (
              <div className={styles.cardBody}>
                <p className={styles.cardNote}>Za tento měsíc zatím není zadaný žádný odvod.</p>
              </div>
            )}
          </div>
        </>
      ) : null}

      {ctx && draft && (
        <OdvodModal
          ctx={ctx}
          accounts={accounts}
          values={draft}
          setValues={(updater) => setDraft((prev) => (prev ? updater(prev) : prev))}
          plan={planOf(draft)}
          receiptsTotal={receiptsTotalOf(draft.receiptIds)}
          readOnly={!canManage || settled}
          saving={saving}
          onSave={() => void saveDraft()}
          onCancel={() => setDraft(null)}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          showCancel={confirm.showCancel}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Print-only sheet (B&W, one A4) – visible only via window.print(). */}
      <div className={styles.printArea}>
        <div className={styles.printTitle}>ODVODY</div>
        <div className={styles.printMonth}>{monthTitle(month)}</div>
        {printPlan && (
          <div className={styles.printBody}>
            {printPlan.czk.registers.map((r, i) => (
              <div key={r.key} className={styles.printRegister}>
                {printPlan.czk.registers.length > 1 && <div className={styles.printRegisterLabel}>{r.label}</div>}
                <div className={styles.printRow}>
                  <span>CZK cash:</span>
                  <span>{fmtNum(r.cash, "CZK")}</span>
                </div>
                <div className={styles.printRow}>
                  <span>CZK cash depozit:</span>
                  <span>{fmtNum(r.deposit, "CZK")}</span>
                </div>
                <div className={styles.printRow}>
                  <span>EUR cash:</span>
                  <span>{fmtNum(printPlan.eur.registers[i]?.cash ?? 0, "EUR")}</span>
                </div>
                <div className={styles.printRow}>
                  <span>EUR cash depozit:</span>
                  <span>{fmtNum(printPlan.eur.registers[i]?.deposit ?? 0, "EUR")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx && <div className={styles.printDeadline}>Odvody provést před uzávěrkou {deadlinePhrase(ctx.lastDay)}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Money field – keeps its own text buffer so a half-typed decimal ("12," /
// "12.") survives the round-trip through the numeric state above.
// ─────────────────────────────────────────────────────────────────────────────
function MoneyInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  const pushed = useRef(value);

  useEffect(() => {
    if (value !== pushed.current) {
      pushed.current = value;
      setText(value === 0 ? "" : String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      className={`${styles.input} ${styles.inputNumber}`}
      value={text}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseAmount(e.target.value);
        pushed.current = n;
        onChange(n);
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The modal
// ─────────────────────────────────────────────────────────────────────────────
function OdvodModal({
  ctx,
  accounts,
  values,
  setValues,
  plan,
  receiptsTotal,
  readOnly,
  saving,
  onSave,
  onCancel,
}: {
  ctx: OdvodContext;
  accounts: OdvodAccount[];
  values: OdvodValues;
  setValues: (updater: (prev: OdvodValues) => OdvodValues) => void;
  plan: OdvodPlan | null;
  receiptsTotal: number;
  readOnly: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  function setPieces(currency: "CZK" | "EUR", denom: string, pieces: number) {
    setValues((prev) => {
      const key = currency === "CZK" ? "nominalsCZK" : "nominalsEUR";
      const next = { ...prev[key] };
      if (pieces > 0) next[denom] = pieces;
      else delete next[denom];
      return { ...prev, [key]: next };
    });
  }

  function toggleReceipt(id: string) {
    setValues((prev) => ({
      ...prev,
      receiptIds: prev.receiptIds.includes(id)
        ? prev.receiptIds.filter((x) => x !== id)
        : [...prev.receiptIds, id],
    }));
  }

  function setProtel(key: string, field: keyof ProtelValues, n: number) {
    setValues((prev) => ({
      ...prev,
      protel: { ...prev.protel, [key]: { ...(prev.protel[key] ?? emptyProtel()), [field]: n } },
    }));
  }

  function setWeight(key: string, n: number) {
    setValues((prev) => ({ ...prev, weights: { ...prev.weights, [key]: n } }));
  }

  const czkTotal = czkNominalTotal(values.nominalsCZK);
  const eurTotal = eurNominalTotal(values.nominalsEUR);

  return (
    // The overlay deliberately carries NO onClick – a half-filled odvod must not
    // be lost to a stray click outside the dialog.
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Odvod – {monthTitle(ctx.month)}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>

        <div className={styles.modalBody}>
          {readOnly && (
            <p className={styles.readOnlyNote}>
              Odvod už byl proveden – peníze fyzicky odešly, proto ho nelze měnit.
            </p>
          )}
          {ctx.target.blocked && <div className={styles.banner}>{ctx.target.blocked}</div>}

          {/* 1 — nominály CZK */}
          <DenomSection
            title="Nominály CZK"
            currency="CZK"
            denoms={CZK_DENOMS}
            symbol="Kč"
            pieces={values.nominalsCZK}
            available={ctx.trezorCZK}
            total={czkTotal}
            disabled={readOnly}
            onChange={(d, n) => setPieces("CZK", d, n)}
          />

          {/* 2 — nominály EUR */}
          <DenomSection
            title="Nominály EUR"
            currency="EUR"
            denoms={EUR_DENOMS}
            symbol="€"
            pieces={values.nominalsEUR}
            available={ctx.trezorEUR}
            total={eurTotal}
            disabled={readOnly}
            onChange={(d, n) => setPieces("EUR", d, n)}
          />

          {/* 3 — účty */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Účty k odvedení</h3>
            <p className={styles.sectionHint}>Zaškrtnuté účty se z protokolu odeberou.</p>
            {accounts.length === 0 ? (
              <p className={styles.sectionEmpty}>V protokolu nejsou žádné účty.</p>
            ) : (
              <>
                <ul className={styles.accountList}>
                  {accounts.map((a) => (
                    <li key={a.id}>
                      <label className={styles.accountRow}>
                        <input
                          type="checkbox"
                          checked={values.receiptIds.includes(a.id)}
                          disabled={readOnly}
                          onChange={() => toggleReceipt(a.id)}
                        />
                        <span className={styles.accountName}>{a.name || "(bez názvu)"}</span>
                        <span className={styles.accountAmount}>{fmtMoney(a.amount, "CZK")}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className={styles.sectionTotal}>
                  <span>Účty celkem</span>
                  <strong>{fmtMoney(receiptsTotal, "CZK")}</strong>
                </div>
              </>
            )}
          </section>

          {/* 4 — hodnoty z Protelu */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Hodnoty z Protelu</h3>
            {ctx.registers.map((r) => {
              const p = values.protel[r.key] ?? emptyProtel();
              return (
                <div key={r.key} className={styles.protelGroup}>
                  {ctx.registers.length > 1 && <div className={styles.protelLabel}>{r.label}</div>}
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      CZK cash
                      <MoneyInput
                        value={p.czkCash}
                        disabled={readOnly}
                        onChange={(n) => setProtel(r.key, "czkCash", n)}
                      />
                    </label>
                    <label className={styles.field}>
                      CZK cash depozit
                      <MoneyInput
                        value={p.czkDeposit}
                        disabled={readOnly}
                        onChange={(n) => setProtel(r.key, "czkDeposit", n)}
                      />
                    </label>
                    <label className={styles.field}>
                      EUR cash
                      <MoneyInput
                        value={p.eurCash}
                        disabled={readOnly}
                        onChange={(n) => setProtel(r.key, "eurCash", n)}
                      />
                    </label>
                    <label className={styles.field}>
                      EUR cash depozit
                      <MoneyInput
                        value={p.eurDeposit}
                        disabled={readOnly}
                        onChange={(n) => setProtel(r.key, "eurDeposit", n)}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </section>

          {/* 5 — poměr rozdělení (jen u hotelů se dvěma pokladnami) */}
          {ctx.registers.length > 1 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Poměr rozdělení</h3>
              <p className={styles.sectionHint}>
                Zbylá hotovost se rozdělí tak, aby zůstatky byly v tomto poměru.
              </p>
              <div className={styles.grid2}>
                {ctx.registers.map((r) => (
                  <label key={r.key} className={styles.field}>
                    {r.label}
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className={`${styles.input} ${styles.inputNumber}`}
                      value={values.weights[r.key] ? String(values.weights[r.key]) : ""}
                      placeholder="0"
                      disabled={readOnly}
                      onChange={(e) => setWeight(r.key, parsePieces(e.target.value))}
                    />
                    <span className={styles.fieldHint}>počet pokojů</span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* 6 — výpočet */}
          {plan && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Výpočet</h3>
              <div className={styles.preview}>
                <div className={styles.previewRow}>
                  <span>Nominály CZK</span>
                  <span className={styles.previewValue}>{fmtMoney(plan.czkNominals, "CZK")}</span>
                </div>
                <div className={styles.previewRow}>
                  <span>Účty</span>
                  <span className={styles.previewValue}>{fmtMoney(plan.receipts, "CZK")}</span>
                </div>
                <div className={styles.previewTotal}>
                  <span>Celkem CZK k odvedení</span>
                  <span className={styles.previewValue}>{fmtMoney(plan.totalCZK, "CZK")}</span>
                </div>
                <div className={styles.previewTotal}>
                  <span>Celkem EUR k odvedení</span>
                  <span className={styles.previewValue}>{fmtMoney(plan.totalEUR, "EUR")}</span>
                </div>
              </div>

              {plan.czk.registers.map((r, i) => (
                <div key={r.key} className={styles.planTableWrap}>
                  {plan.czk.registers.length > 1 && <div className={styles.protelLabel}>{r.label}</div>}
                  <table className={styles.planTable}>
                    <tbody>
                      <tr>
                        <td>CZK cash</td>
                        <td className={styles.numCell}>{fmtMoney(r.cash, "CZK")}</td>
                      </tr>
                      <tr>
                        <td>CZK cash depozit</td>
                        <td className={styles.numCell}>{fmtMoney(r.deposit, "CZK")}</td>
                      </tr>
                      <tr>
                        <td>EUR cash</td>
                        <td className={styles.numCell}>{fmtMoney(plan.eur.registers[i]?.cash ?? 0, "EUR")}</td>
                      </tr>
                      <tr>
                        <td>EUR cash depozit</td>
                        <td className={styles.numCell}>{fmtMoney(plan.eur.registers[i]?.deposit ?? 0, "EUR")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}

              {plan.warnings.length > 0 && (
                <ul className={styles.warnList}>
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            {readOnly ? "Zavřít" : "Zrušit"}
          </Button>
          {!readOnly && (
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Ukládám…" : "Uložit odvod"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Denomination table — Nominál | KS | K dispozici | Mezisoučet
// ─────────────────────────────────────────────────────────────────────────────
function DenomSection({
  title,
  currency,
  denoms,
  symbol,
  pieces,
  available,
  total,
  disabled,
  onChange,
}: {
  title: string;
  currency: "CZK" | "EUR";
  denoms: readonly string[];
  symbol: string;
  pieces: Record<string, number>;
  available: Record<string, number>;
  total: number;
  disabled?: boolean;
  onChange: (denom: string, pieces: number) => void;
}) {
  const over = denoms.filter((d) => (pieces[d] ?? 0) > (available[d] ?? 0));

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.denomWrap}>
        <table className={styles.denomTable}>
          <thead>
            <tr>
              <th>Nominál</th>
              <th className={styles.numCell}>KS</th>
              <th className={styles.numCell}>K dispozici</th>
              <th className={styles.numCell}>Mezisoučet</th>
            </tr>
          </thead>
          <tbody>
            {denoms.map((d) => {
              const ks = pieces[d] ?? 0;
              const avail = available[d] ?? 0;
              const exceeded = ks > avail;
              return (
                <tr key={d}>
                  <td className={styles.denomCell}>
                    {d} {symbol}
                  </td>
                  <td className={styles.numCell}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className={`${styles.input} ${styles.inputNumber} ${styles.ksInput} ${
                        exceeded ? styles.inputError : ""
                      }`}
                      value={ks === 0 ? "" : String(ks)}
                      placeholder="0"
                      disabled={disabled}
                      onChange={(e) => onChange(d, parsePieces(e.target.value))}
                    />
                  </td>
                  <td className={`${styles.numCell} ${exceeded ? styles.statusError : styles.mutedCell}`}>
                    {avail} ks
                  </td>
                  <td className={styles.numCell}>{fmtMoney(Number(d) * ks, currency)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>CELKEM</td>
              <td />
              <td />
              <td className={styles.numCell}>{fmtMoney(total, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {over.length > 0 && (
        <p className={styles.denomNote}>
          V trezoru není dost bankovek: {over.map((d) => `${d} ${symbol} (k odvodu ${pieces[d] ?? 0} ks, v protokolu ${available[d] ?? 0} ks)`).join(", ")}.
        </p>
      )}
    </section>
  );
}
