import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import Button from "../../components/Button";
import { CZK_DENOMS, decomposeAll, denomTotal, sumCounts } from "../../lib/denominations";
import styles from "./SmenarnaTab.module.css";

/**
 * Tabulky → Směnárna + ČNB.
 *
 * An AD HOC CALCULATOR. It persists nothing: no Firestore document, no write
 * endpoint, no autosave. Values live in component state and are gone on reload.
 * Its only contact with stored data is a READ of the three global sm rates to
 * prefill "kurz NÁŠ" — it can never affect a Předávací protokol, and a protokol
 * edit can never affect it.
 *
 * Four blocks:
 *   1+2. PŘEDKLÁDÁM / POŽADUJI — a CZK note swap. It need NOT balance on its
 *        own: a shortfall is funded from the CZK the exchange office hands
 *        over. Only a row the exchange money cannot cover is an error.
 *   3.   SMĚNÁRNA — foreign currency at two rates, the margin between them, and
 *        "zbývá ze směnárny" = CELKEM směnárna − (POŽADUJI − PŘEDKLÁDÁM). That
 *        last one is the original spreadsheet's H column, restored verbatim; it
 *        is what drives the red state, and it is negative exactly when the swap
 *        cannot be funded. CELKEM směnárna stays RAW so the row still
 *        reconciles: směnárna − u nás = rozdíl.
 *   4.   Denomination breakdown — the note mix to request from the exchange
 *        office so every pile can be formed physically, plus the note-by-note
 *        changes needed to get from what they gave to what is needed.
 */

/** rates[0..2] are € / $ / £ BY POSITION — settings/sm stores no currency names
 *  (the sm modal is deliberately label-free). The symbol is rendered next to each
 *  rate so a reordering of the sm badges is visible here instead of silent. */
const CURRENCIES = [
  { symbol: "€", label: "EUR" },
  { symbol: "$", label: "USD" },
  { symbol: "£", label: "GBP" },
] as const;

type Triple = [number, number, number];

interface Row {
  id: string;
  label: string;
}

/** Sparse per-denomination counts: zero is deleted, never stored. */
type Counts = Record<string, number>;

/** Rows the page starts with. Editable and removable like any other — these are
 *  a starting point, not a fixed list. */
const DEFAULT_ROW_LABELS = ["AMBI", "SUP", "A&A", "ANKORA"] as const;

let rowSeq = 0;
const newRow = (label = ""): Row => ({ id: `r${++rowSeq}`, label });
const defaultRows = (): Row[] => DEFAULT_ROW_LABELS.map((l) => newRow(l));

const emptyTriple = (): Triple => [0, 0, 0];

/** Mirrors the Recepce cash grid: zero is never displayed, blank means absent. */
function numValue(n: number): string | number {
  return n === 0 ? "" : n;
}

function setCount(counts: Counts, denom: string, n: number): Counts {
  const next = { ...counts };
  if (!Number.isFinite(n) || n <= 0) delete next[denom];
  else next[denom] = Math.floor(n);
  return next;
}

function czk(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(Math.round(n));
}

export default function SmenarnaTab() {
  const [rows, setRows] = useState<Row[]>(defaultRows);

  // Block 1+2 — CZK note swap, per row.
  const [predkladam, setPredkladam] = useState<Record<string, Counts>>({});
  const [pozaduji, setPozaduji] = useState<Record<string, Counts>>({});

  // Block 3 — foreign currency amounts per row, plus the two rate triples.
  const [amounts, setAmounts] = useState<Record<string, Triple>>({});
  const [ourRates, setOurRates] = useState<Triple>(emptyTriple);
  const [cnbRates, setCnbRates] = useState<Triple>(emptyTriple);
  const [ratesLoaded, setRatesLoaded] = useState(false);

  // Block 4 — what the exchange office actually handed over.
  const [smenarnaCounts, setSmenarnaCounts] = useState<Counts>({});

  // Prefill "kurz NÁŠ" from the global sm rates. Read-only and best-effort: a
  // failure leaves the fields at zero for the user to type, it does not error
  // the page. The rates stay editable either way — the sm value is a starting
  // point, not a constraint.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ rates: number[] }>("/exchange/rates")
      .then((r) => {
        if (cancelled) return;
        const t = r.rates ?? [];
        setOurRates([Number(t[0]) || 0, Number(t[1]) || 0, Number(t[2]) || 0]);
        setRatesLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setRatesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function addRow() {
    setRows((r) => [...r, newRow()]);
  }

  function removeRow(id: string) {
    setRows((r) => (r.length <= 1 ? r : r.filter((x) => x.id !== id)));
    const drop = <T,>(m: Record<string, T>): Record<string, T> => {
      const next = { ...m };
      delete next[id];
      return next;
    };
    setPredkladam(drop);
    setPozaduji(drop);
    setAmounts(drop);
  }

  function renameRow(id: string, label: string) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, label } : x)));
  }

  const rowLabel = (row: Row, i: number) => row.label.trim() || `Řádek ${i + 1}`;

  // ── Block 1+2 totals + balance ────────────────────────────────────────────
  const balance = useMemo(
    () =>
      rows.map((row, i) => {
        const give = denomTotal(predkladam[row.id] ?? {});
        const want = denomTotal(pozaduji[row.id] ?? {});
        const amt = amounts[row.id] ?? emptyTriple();
        const smenarna = amt.reduce((s, a, k) => s + a * cnbRates[k], 0);
        const uNas = amt.reduce((s, a, k) => s + a * ourRates[k], 0);
        // The note swap need not balance on its own: a shortfall is topped up
        // from the CZK the exchange office hands over. `gap` > 0 means POŽADUJI
        // exceeds PŘEDKLÁDÁM and that much must come from the exchange; `gap` < 0
        // means surplus notes were presented, which ADDS to what remains.
        const gap = want - give;
        return {
          id: row.id,
          label: rowLabel(row, i),
          give,
          want,
          gap,
          /** Shown in the PŘEDKLÁDÁM table: how much of POŽADUJI the swap itself
           *  cannot cover. Zero when the row balances or has surplus. */
          fromExchange: Math.max(0, gap),
          amt,
          smenarna,
          uNas,
          rozdil: smenarna - uNas,
          /** Excel's H column: CELKEM směnárna − (POŽADUJI − PŘEDKLÁDÁM).
           *  Negative means the exchange money cannot cover the shortfall —
           *  that, and only that, is the red case. */
          zbyva: smenarna - gap,
        };
      }),
    [rows, predkladam, pozaduji, amounts, ourRates, cnbRates]
  );
  const giveTotal = balance.reduce((s, b) => s + b.give, 0);
  const wantTotal = balance.reduce((s, b) => s + b.want, 0);
  const swapTouched = giveTotal > 0 || wantTotal > 0;
  /** Rows where even the exchange money leaves POŽADUJI unfunded. */
  const rowsShort = balance.filter((b) => b.zbyva < 0 && (b.give > 0 || b.want > 0));

  // ── Block 3 — per-row exchange totals ─────────────────────────────────────
  const exchange = balance;
  const exTotals = exchange.reduce(
    (acc, e) => ({
      smenarna: acc.smenarna + e.smenarna,
      uNas: acc.uNas + e.uNas,
      rozdil: acc.rozdil + e.rozdil,
      zbyva: acc.zbyva + e.zbyva,
    }),
    { smenarna: 0, uNas: 0, rozdil: 0, zbyva: 0 }
  );

  // A blank rate is normal — not every run has every currency. It is only a
  // problem once an amount is entered against it, which silently values that
  // currency at zero and overstates the margin.
  const missingRates = useMemo(
    () =>
      CURRENCIES.map((c, k) => {
        const anyAmount = rows.some((row) => (amounts[row.id] ?? emptyTriple())[k] > 0);
        return {
          symbol: c.symbol,
          ourMissing: anyAmount && !(ourRates[k] > 0),
          cnbMissing: anyAmount && !(cnbRates[k] > 0),
        };
      }).filter((m) => m.ourMissing || m.cnbMissing),
    [rows, amounts, ourRates, cnbRates]
  );

  // ── Block 4 — the note mix to request ─────────────────────────────────────
  // One pile per row per purpose: the guest money at our rate, and the margin.
  const piles = useMemo(
    () =>
      exchange.flatMap((e) => [
        { key: `${e.id}:u-nas`, label: `${e.label} – u nás`, amount: e.uNas },
        { key: `${e.id}:rozdil`, label: `${e.label} – rozdíl`, amount: e.rozdil },
      ]),
    [exchange]
  );
  const pool5000 = smenarnaCounts["5000"] ?? 0;
  const decomposed = useMemo(
    () => decomposeAll(piles.map((p) => ({ key: p.key, amount: p.amount })), pool5000),
    [piles, pool5000]
  );
  const needCounts = useMemo(() => sumCounts(decomposed), [decomposed]);
  // Note-by-note changes to get from what the exchange office gave to what the
  // piles need. Both sides are fixed multisets, so the per-denomination delta IS
  // the minimal description — there is nothing to optimise. Positive = ask for
  // that many more, negative = hand that many back.
  const denomChanges = useMemo(
    () =>
      CZK_DENOMS.map((d) => ({
        denom: d,
        delta: (needCounts[d] ?? 0) - (smenarnaCounts[d] ?? 0),
      })).filter((c) => c.delta !== 0),
    [needCounts, smenarnaCounts]
  );
  const needTotal = denomTotal(needCounts);
  const gotTotal = denomTotal(smenarnaCounts);
  // Only a SHORTFALL matters: a per-denomination mismatch is absorbed by breaking
  // bigger notes, but less money than the piles need cannot be.
  const shortfall = gotTotal > 0 && needTotal > gotTotal ? needTotal - gotTotal : 0;

  const labelByKey = new Map(piles.map((p) => [p.key, p.label]));

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Pomocná tabulka. <strong>Nic se neukládá</strong> – po zavření nebo obnovení stránky
        jsou hodnoty pryč. Kurz „u nás" se předvyplní podle hodnot z Recepce, ale můžete ho
        přepsat; zápis do Recepce se nikdy neprovádí.
      </p>

      {/* ── Rows ─────────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>Řádky</h2>
          <Button variant="secondary" size="sm" onClick={addRow}>
            + Přidat řádek
          </Button>
        </div>
        <div className={styles.rowList}>
          {rows.map((row, i) => (
            <div key={row.id} className={styles.rowItem}>
              <input
                className={styles.rowInput}
                value={row.label}
                placeholder={`Řádek ${i + 1}`}
                onChange={(e) => renameRow(row.id, e.target.value)}
                aria-label={`Název řádku ${i + 1}`}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  className={styles.rowRemove}
                  onClick={() => removeRow(row.id)}
                  aria-label={`Odebrat ${rowLabel(row, i)}`}
                  title="Odebrat řádek"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Blocks 1 + 2: the CZK note swap ──────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Výměna bankovek</h2>
        {(
          [
            { title: "PŘEDKLÁDÁM", state: predkladam, set: setPredkladam, showFromExchange: true },
            { title: "POŽADUJI", state: pozaduji, set: setPozaduji, showFromExchange: false },
          ] as const
        ).map((block) => (
          <div key={block.title} className={styles.tableScroll}>
            <table className={styles.grid}>
              <thead>
                <tr>
                  <th className={styles.rowHead}>{block.title}</th>
                  {CZK_DENOMS.map((d) => (
                    <th key={d}>{d}</th>
                  ))}
                  <th className={styles.totalHead}>CELKEM</th>
                  {block.showFromExchange && (
                    <th className={styles.totalHead} title="Kolik z POŽADUJI nepokryjí předložené bankovky a musí přijít ze směnárny">
                      ze směnárny
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const counts = block.state[row.id] ?? {};
                  return (
                    <tr key={row.id}>
                      <th className={styles.rowHead}>{rowLabel(row, i)}</th>
                      {CZK_DENOMS.map((d) => (
                        <td key={d}>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className={styles.cellInput}
                            value={numValue(counts[d] ?? 0)}
                            onChange={(e) =>
                              block.set((prev) => ({
                                ...prev,
                                [row.id]: setCount(prev[row.id] ?? {}, d, Number(e.target.value)),
                              }))
                            }
                            aria-label={`${block.title} ${rowLabel(row, i)} ${d}`}
                          />
                        </td>
                      ))}
                      <td className={styles.totalCell}>{czk(denomTotal(counts))}</td>
                      {block.showFromExchange && (
                        <td className={styles.totalCell}>
                          {balance[i].fromExchange > 0 ? czk(balance[i].fromExchange) : ""}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {/* Balance check – per row AND in total. A row need NOT balance on its
            own: the shortfall is funded from the exchange money. Only a row the
            exchange cannot cover (zbývá < 0) is an error. */}
        <div className={styles.tableScroll}>
          <table className={styles.checkTable}>
            <thead>
              <tr>
                <th className={styles.rowHead}>Kontrola</th>
                <th>Předkládám</th>
                <th>Požaduji</th>
                <th>Ze směnárny</th>
                <th>Zbývá ze směnárny</th>
              </tr>
            </thead>
            <tbody>
              {balance.map((b) => (
                <tr key={b.id} className={b.zbyva < 0 ? styles.badRow : undefined}>
                  <th className={styles.rowHead}>{b.label}</th>
                  <td>{czk(b.give)}</td>
                  <td>{czk(b.want)}</td>
                  <td>{b.fromExchange > 0 ? czk(b.fromExchange) : "0"}</td>
                  <td>{czk(b.zbyva)}</td>
                </tr>
              ))}
              <tr className={exTotals.zbyva < 0 ? styles.badRow : styles.totalRow}>
                <th className={styles.rowHead}>CELKEM</th>
                <td>{czk(giveTotal)}</td>
                <td>{czk(wantTotal)}</td>
                <td>{czk(balance.reduce((s, b) => s + b.fromExchange, 0))}</td>
                <td>{czk(exTotals.zbyva)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {swapTouched && rowsShort.length > 0 && (
          <p className={styles.warn}>
            Nedostatek peněz:{" "}
            {rowsShort
              .map((b) => `${b.label} (chybí ${czk(Math.abs(b.zbyva))} Kč)`)
              .join(", ")}
            . Předložené bankovky ani peníze ze směnárny nestačí na to, co požadujete.
          </p>
        )}
      </section>

      {/* ── Block 3: currency exchange ───────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Směnárna</h2>
        <div className={styles.tableScroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.rowHead}>MĚNA</th>
                {CURRENCIES.map((c) => (
                  <th key={c.symbol}>
                    {c.symbol} <span className={styles.curCode}>{c.label}</span>
                  </th>
                ))}
                <th className={styles.totalHead}>CELKEM směnárna</th>
                <th className={styles.totalHead}>CELKEM u nás</th>
                <th className={styles.totalHead}>ROZDÍL</th>
                <th className={styles.totalHead} title="CELKEM směnárna minus to, co ze směnárny pokrývá výměnu bankovek">
                  zbývá ze směnárny
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className={styles.rowHead}>
                  kurz u nás
                  {!ratesLoaded && <span className={styles.hintInline}> (načítám…)</span>}
                </th>
                {CURRENCIES.map((c, k) => (
                  <td key={c.symbol}>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className={styles.cellInput}
                      value={numValue(ourRates[k])}
                      onChange={(e) =>
                        setOurRates((r) => {
                          const n = [...r] as Triple;
                          n[k] = Number(e.target.value) || 0;
                          return n;
                        })
                      }
                      aria-label={`Kurz u nás ${c.label}`}
                    />
                  </td>
                ))}
                <td colSpan={4} className={styles.mutedCell}>
                  předvyplněno z Recepce, lze přepsat
                </td>
              </tr>
              <tr>
                <th className={styles.rowHead}>kurz ČNB</th>
                {CURRENCIES.map((c, k) => (
                  <td key={c.symbol}>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className={styles.cellInput}
                      value={numValue(cnbRates[k])}
                      onChange={(e) =>
                        setCnbRates((r) => {
                          const n = [...r] as Triple;
                          n[k] = Number(e.target.value) || 0;
                          return n;
                        })
                      }
                      aria-label={`Kurz ČNB ${c.label}`}
                    />
                  </td>
                ))}
                <td colSpan={4} className={styles.mutedCell}>
                  zadejte ručně
                </td>
              </tr>
              <tr className={styles.spacerRow}>
                <td colSpan={8} />
              </tr>
              {exchange.map((e, i) => (
                <tr key={e.id}>
                  <th className={styles.rowHead}>{rowLabel(rows[i], i)}</th>
                  {CURRENCIES.map((c, k) => (
                    <td key={c.symbol}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className={styles.cellInput}
                        value={numValue(e.amt[k])}
                        onChange={(ev) =>
                          setAmounts((prev) => {
                            const cur = [...(prev[e.id] ?? emptyTriple())] as Triple;
                            cur[k] = Number(ev.target.value) || 0;
                            return { ...prev, [e.id]: cur };
                          })
                        }
                        aria-label={`${e.label} ${c.label}`}
                      />
                    </td>
                  ))}
                  <td className={styles.totalCell}>{czk(e.smenarna)}</td>
                  <td className={styles.totalCell}>{czk(e.uNas)}</td>
                  <td className={styles.totalCell}>{czk(e.rozdil)}</td>
                  <td className={e.zbyva < 0 ? styles.badCell : styles.totalCell}>{czk(e.zbyva)}</td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <th className={styles.rowHead}>CELKEM</th>
                <td colSpan={3} />
                <td className={styles.totalCell}>{czk(exTotals.smenarna)}</td>
                <td className={styles.totalCell}>{czk(exTotals.uNas)}</td>
                <td className={styles.totalCell}>{czk(exTotals.rozdil)}</td>
                <td className={exTotals.zbyva < 0 ? styles.badCell : styles.totalCell}>{czk(exTotals.zbyva)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {missingRates.map((m) => (
          <p key={m.symbol} className={styles.warn}>
            U měny {m.symbol} je zadaná částka, ale chybí{" "}
            {m.ourMissing && m.cnbMissing
              ? "kurz u nás i kurz ČNB"
              : m.ourMissing
              ? "kurz u nás"
              : "kurz ČNB"}
            . Tato měna se počítá jako nula.
          </p>
        ))}
      </section>

      {/* ── Block 4: the note mix to request ─────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Ideální složení</h2>
        <div className={styles.denomLayout}>
        <div className={styles.tableScroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.rowHead}>hodnota</th>
                {CZK_DENOMS.map((d) => (
                  <th key={d}>{d}</th>
                ))}
                <th className={styles.totalHead}>CELKEM</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className={styles.rowHead}>směnárna</th>
                {CZK_DENOMS.map((d) => (
                  <td key={d}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className={styles.cellInput}
                      value={numValue(smenarnaCounts[d] ?? 0)}
                      onChange={(e) =>
                        setSmenarnaCounts((prev) => setCount(prev, d, Number(e.target.value)))
                      }
                      aria-label={`Směnárna ${d}`}
                    />
                  </td>
                ))}
                <td className={styles.totalCell}>{czk(gotTotal)}</td>
              </tr>
              <tr className={styles.totalRow}>
                <th className={styles.rowHead}>potřebuji</th>
                {CZK_DENOMS.map((d) => (
                  <td key={d} className={styles.derivedCell}>
                    {needCounts[d] ?? ""}
                  </td>
                ))}
                <td className={styles.totalCell}>{czk(needTotal)}</td>
              </tr>
              <tr className={styles.spacerRow}>
                <td colSpan={CZK_DENOMS.length + 2} />
              </tr>
              {decomposed.map((r) => (
                <tr key={r.key}>
                  <th className={styles.rowHeadSmall}>
                    {labelByKey.get(r.key)}
                    <span className={styles.pileAmount}>{czk(r.amount)}</span>
                  </th>
                  {CZK_DENOMS.map((d) => (
                    <td key={d} className={styles.derivedCell}>
                      {r.counts[d] ?? ""}
                    </td>
                  ))}
                  <td className={styles.totalCell}>{czk(denomTotal(r.counts))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Note-by-note changes from what they gave to what the piles need. */}
        <div className={styles.changesPanel}>
          <table className={styles.changesTable}>
            <thead>
              <tr>
                <th colSpan={2}>Změny nominálů</th>
              </tr>
            </thead>
            <tbody>
              {denomChanges.length === 0 ? (
                <tr>
                  <td colSpan={2} className={styles.changesEmpty}>
                    {gotTotal === 0 ? "Zadejte řádek směnárna" : "Složení sedí"}
                  </td>
                </tr>
              ) : (
                denomChanges.map((c) => (
                  <tr key={c.denom}>
                    <th className={styles.changesDenom}>{c.denom}</th>
                    <td className={c.delta > 0 ? styles.changePlus : styles.changeMinus}>
                      {c.delta > 0 ? `+${c.delta}` : c.delta}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {denomChanges.length > 0 && (
            <p className={styles.changesHint}>
              Kladné = vyžádat navíc, záporné = vrátit.
            </p>
          )}
        </div>
        </div>

        {shortfall > 0 && (
          <p className={styles.warn}>
            Ze směnárny je o {czk(shortfall)} Kč méně, než je potřeba na všechny hromádky
            ({czk(gotTotal)} Kč proti {czk(needTotal)} Kč).
          </p>
        )}
      </section>
    </div>
  );
}
