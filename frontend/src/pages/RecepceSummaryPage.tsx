import { Fragment, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { HOTELS, type HotelSlug } from "@/lib/hotels";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import styles from "./RecepceSummaryPage.module.css";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-hotel Recepce summary (admin-only, gated by recepce.summary.view).
// A settable date range drives three tables:
//   • Provize minus — server-persisted manual per-employee deductions (top),
//   • Podle hotelu  — per-hotel taxi provision + č/př/wal + walk-in provision,
//                     a Součet (taxi+č+př+wal−provize), a hand-filled Celková
//                     částka (the pool), and its per-shift value,
//   • Počet směn    — per-employee shift counts + per-hotel money shares
//                     (pool ÷ total shifts × the employee's shifts), walk-in
//                     provision, Provize minus, and a final Součet.
// Everything settable except Provize minus is page-local (localStorage).
// ─────────────────────────────────────────────────────────────────────────────

interface WalkinTotals {
  czk: number;
  eur: number;
}
interface WalkinRow {
  hotel: HotelSlug;
  hotelLabel: string;
  date: string;
  employeeName: string;
  resNo: string;
  amount: number;
  currency: string;
}
interface EmployeeRow {
  employeeId: string;
  name: string;
  byHotel: Record<HotelSlug, number>;
  totalShifts: number;
  walkinByHotel: Record<HotelSlug, WalkinTotals>;
}
interface SummaryResponse {
  from: string;
  to: string;
  walkins: WalkinRow[];
  taxiProvisionByHotel: Record<HotelSlug, number>;
  employees: EmployeeRow[];
}
interface ProvizeMinusEntry {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  note: string;
}
interface EmployeeOption {
  employeeId: string;
  name: string;
}
interface HotelParams {
  c: number;
  pr: number;
  wal: number;
}

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_RANGE = "recepce.summary.range";
const LS_RATE = "recepce.summary.rate";
const LS_PARAMS = "recepce.summary.params";
const LS_TOTALMONEY = "recepce.summary.totalMoney";

const WALKIN_PROVISION_RATE = 0.1; // 10 % of the CZK-converted walk-in total.

// ── helpers ───────────────────────────────────────────────────────────────────
function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}
function firstOfThisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}
function currencySymbol(c: string): string {
  return c === "EUR" ? "€" : "Kč";
}
/** A shift count: whole or up to 2 decimals; 0 shows as an en-dash placeholder. */
function fmtShifts(n: number): string {
  if (!n) return "–";
  return (Math.round(n * 100) / 100).toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}
/** A CZK money amount (up to 2 decimals) with a trailing "Kč". */
function fmtCzk(n: number): string {
  return `${(Math.round(n * 100) / 100).toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} Kč`;
}
/** Round down to the nearest 10 CZK (the agreed rounding for provisions + shares). */
function floor10(n: number): number {
  return Math.floor(n / 10) * 10;
}

function zeroNums(): Record<HotelSlug, number> {
  return HOTELS.reduce((acc, h) => {
    acc[h.slug] = 0;
    return acc;
  }, {} as Record<HotelSlug, number>);
}

// ── persistence loaders ─────────────────────────────────────────────────────────
function loadRange(): { from: string; to: string } {
  try {
    const p = JSON.parse(window.localStorage.getItem(LS_RANGE) || "null") as { from?: unknown; to?: unknown } | null;
    if (p && typeof p.from === "string" && typeof p.to === "string") return { from: p.from, to: p.to };
  } catch {
    /* ignore */
  }
  return { from: firstOfThisMonth(), to: todayLocal() };
}
function loadRate(): number {
  try {
    const n = Number(window.localStorage.getItem(LS_RATE));
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* ignore */
  }
  return 25;
}
function loadParams(): Record<HotelSlug, HotelParams> {
  const base = HOTELS.reduce((acc, h) => {
    acc[h.slug] = { c: 0, pr: 0, wal: 0 };
    return acc;
  }, {} as Record<HotelSlug, HotelParams>);
  try {
    const p = JSON.parse(window.localStorage.getItem(LS_PARAMS) || "null") as Record<string, Partial<HotelParams>> | null;
    if (p) {
      for (const h of HOTELS) {
        const v = p[h.slug];
        if (v) base[h.slug] = { c: Number(v.c) || 0, pr: Number(v.pr) || 0, wal: Number(v.wal) || 0 };
      }
    }
  } catch {
    /* ignore */
  }
  return base;
}
function loadTotalMoney(): Record<HotelSlug, number> {
  const base = zeroNums();
  try {
    const p = JSON.parse(window.localStorage.getItem(LS_TOTALMONEY) || "null") as Record<string, unknown> | null;
    if (p) for (const h of HOTELS) base[h.slug] = Number(p[h.slug]) || 0;
  } catch {
    /* ignore */
  }
  return base;
}

export default function RecepceSummaryPage() {
  const initialRange = loadRange();
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [rate, setRate] = useState<number>(loadRate);
  const [params, setParams] = useState<Record<HotelSlug, HotelParams>>(loadParams);
  const [totalMoney, setTotalMoney] = useState<Record<HotelSlug, number>>(loadTotalMoney);

  const [data, setData] = useState<SummaryResponse | null>(null);
  const [provizeMinus, setProvizeMinus] = useState<ProvizeMinusEntry[]>([]);
  const [rangeEmps, setRangeEmps] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [walkinsOpen, setWalkinsOpen] = useState(false);
  const [editingMinus, setEditingMinus] = useState<ProvizeMinusEntry | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void; danger?: boolean } | null>(null);

  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  // ── data loading (all three sources depend on the range) ────────────────────
  async function loadProvizeMinus() {
    if (!rangeValid) return;
    try {
      const list = await api.get<ProvizeMinusEntry[]>(
        `/recepce-summary/provize-minus?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      setProvizeMinus(list);
    } catch {
      /* surfaced by the main load */
    }
  }

  useEffect(() => {
    if (!rangeValid) {
      setData(null);
      setError(from > to ? "Počáteční datum musí být před koncovým." : null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    void (async () => {
      try {
        const [summary, minus, emps] = await Promise.all([
          api.get<SummaryResponse>(`/recepce-summary?${q}`),
          api.get<ProvizeMinusEntry[]>(`/recepce-summary/provize-minus?${q}`),
          api.get<{ employees: EmployeeOption[] }>(`/recepce-summary/employees?${q}`),
        ]);
        if (cancelled) return;
        setData(summary);
        setProvizeMinus(minus);
        setRangeEmps(emps.employees);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(errorMessage(err, "Souhrn se nepodařilo načíst."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // ── persist settables ───────────────────────────────────────────────────────
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_RANGE, JSON.stringify({ from, to }));
    } catch {
      /* ignore */
    }
  }, [from, to]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_RATE, String(rate));
    } catch {
      /* ignore */
    }
  }, [rate]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_PARAMS, JSON.stringify(params));
    } catch {
      /* ignore */
    }
  }, [params]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_TOTALMONEY, JSON.stringify(totalMoney));
    } catch {
      /* ignore */
    }
  }, [totalMoney]);

  function setParam(slug: HotelSlug, key: keyof HotelParams, value: number) {
    setParams((prev) => ({ ...prev, [slug]: { ...prev[slug], [key]: value } }));
  }

  // ── money math ──────────────────────────────────────────────────────────────
  // Walk-in provision floored per (employee, hotel) cell, so the per-employee and
  // per-hotel aggregates share the same atoms → their grand totals match exactly.
  function provisionAt(e: EmployeeRow, slug: HotelSlug): number {
    const t = e.walkinByHotel?.[slug] ?? { czk: 0, eur: 0 };
    return floor10((t.czk + t.eur * rate) * WALKIN_PROVISION_RATE);
  }
  function walkinProvision(e: EmployeeRow): number {
    return HOTELS.reduce((sum, h) => sum + provisionAt(e, h.slug), 0);
  }

  const emps = data?.employees ?? [];

  // Per-hotel aggregates (walk-in provision, total shifts, per-shift value).
  const perHotel = useMemo(() => {
    const walkinProv = zeroNums();
    const shifts = zeroNums();
    for (const e of emps) {
      for (const h of HOTELS) {
        walkinProv[h.slug] += provisionAt(e, h.slug);
        shifts[h.slug] += e.byHotel[h.slug] ?? 0;
      }
    }
    const perShift = zeroNums();
    for (const h of HOTELS) perShift[h.slug] = shifts[h.slug] > 0 ? totalMoney[h.slug] / shifts[h.slug] : 0;
    return { walkinProv, shifts, perShift };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rate, totalMoney]);

  // Provize minus summed per employee (entries already filtered to the range).
  const minusByEmp = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of provizeMinus) m[p.employeeId] = (m[p.employeeId] ?? 0) + (p.amount || 0);
    return m;
  }, [provizeMinus]);

  // A single employee's Kč share at a hotel: shifts × per-shift value, floored to 10.
  function shareMoney(e: EmployeeRow, slug: HotelSlug): number {
    return floor10((e.byHotel[slug] ?? 0) * perHotel.perShift[slug]);
  }
  // The employee's final Součet: Σ hotel shares + walk-in provision − Provize minus.
  function employeeTotal(e: EmployeeRow): number {
    const shares = HOTELS.reduce((sum, h) => sum + shareMoney(e, h.slug), 0);
    return floor10(shares + walkinProvision(e) - (minusByEmp[e.employeeId] ?? 0));
  }

  // Podle hotelu Součet (point 2) = taxi + č + př + wal − walk-in provision.
  function hotelSoucet(slug: HotelSlug): number {
    const p = params[slug];
    return (data?.taxiProvisionByHotel[slug] ?? 0) + p.c + p.pr + p.wal - perHotel.walkinProv[slug];
  }

  // Footer totals.
  const totals = useMemo(() => {
    const taxi = HOTELS.reduce((s, h) => s + (data?.taxiProvisionByHotel[h.slug] ?? 0), 0);
    const walkinProv = HOTELS.reduce((s, h) => s + perHotel.walkinProv[h.slug], 0);
    const soucetHotel = HOTELS.reduce((s, h) => s + hotelSoucet(h.slug), 0);
    const pool = HOTELS.reduce((s, h) => s + totalMoney[h.slug], 0);
    const shiftMoneyByHotel = zeroNums();
    let empTotal = 0;
    let minusTotal = 0;
    for (const e of emps) {
      for (const h of HOTELS) shiftMoneyByHotel[h.slug] += shareMoney(e, h.slug);
      empTotal += employeeTotal(e);
      minusTotal += minusByEmp[e.employeeId] ?? 0;
    }
    const shiftsTotal = HOTELS.reduce((s, h) => s + perHotel.shifts[h.slug], 0);
    return { taxi, walkinProv, soucetHotel, pool, shiftMoneyByHotel, empTotal, minusTotal, shiftsTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rate, totalMoney, params, provizeMinus]);

  // ── Provize minus CRUD ──────────────────────────────────────────────────────
  function requestDeleteMinus(entry: ProvizeMinusEntry) {
    setConfirm({
      title: "Smazat provizi minus?",
      message: `Opravdu smazat záznam z ${formatDate(entry.date)} (${entry.employeeName || "?"}, ${fmtCzk(entry.amount)})?`,
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/recepce-summary/provize-minus/${entry.id}`);
          setConfirm(null);
          await loadProvizeMinus();
        } catch (err) {
          setConfirm({
            title: "Chyba",
            message: errorMessage(err, "Nepodařilo se smazat."),
            onConfirm: () => setConfirm(null),
          });
        }
      },
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Souhrn recepce</h1>
        <div className={styles.controls}>
          <label className={styles.control}>
            <span>Od</span>
            <input type="date" className={styles.input} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className={styles.control}>
            <span>Do</span>
            <input type="date" className={styles.input} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <label className={styles.control}>
            <span>Kurz EUR→CZK</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className={`${styles.input} ${styles.inputNumber}`}
              value={rate === 0 ? "" : rate}
              onChange={(e) => setRate(Number(e.target.value) || 0)}
            />
          </label>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.muted}>Načítám…</div>}

      {data && !loading && (
        <>
          {/* ── Provize minus (persistent, top) ─────────────────────────────── */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Provize minus</h2>
              <Button size="sm" onClick={() => setEditingMinus("new")}>
                + Přidat
              </Button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Zaměstnanec</th>
                    <th className={styles.num}>Částka</th>
                    <th>Poznámka</th>
                    <th aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {provizeMinus.length === 0 && (
                    <tr>
                      <td colSpan={5} className={styles.empty}>
                        Žádné položky v období.
                      </td>
                    </tr>
                  )}
                  {provizeMinus.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.date)}</td>
                      <td>{p.employeeName}</td>
                      <td className={styles.num}>
                        {p.amount === 0 ? <span className={styles.muted}>0 Kč (neurčeno)</span> : fmtCzk(p.amount)}
                      </td>
                      <td>{p.note}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.rowIconBtn} aria-label="Upravit" onClick={() => setEditingMinus(p)}>
                            ✎
                          </button>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`}
                            aria-label="Smazat"
                            onClick={() => requestDeleteMinus(p)}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Podle hotelu (top computation table) ────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Podle hotelu</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Hotel</th>
                    <th className={styles.num}>Provize taxi</th>
                    <th className={styles.num}>č</th>
                    <th className={styles.num}>př</th>
                    <th className={styles.num}>wal</th>
                    <th className={styles.num}>Provize walkiny</th>
                    <th className={styles.num}>Součet</th>
                    <th className={styles.num}>Celková částka</th>
                    <th className={styles.num}>Na 1 směnu</th>
                  </tr>
                </thead>
                <tbody>
                  {HOTELS.map((h) => (
                    <tr key={h.slug}>
                      <td className={styles.hotelCell}>{h.label}</td>
                      <td className={styles.num}>{fmtCzk(data.taxiProvisionByHotel[h.slug] ?? 0)}</td>
                      {(["c", "pr", "wal"] as const).map((key) => (
                        <td key={key} className={styles.num}>
                          <input
                            type="number"
                            step="any"
                            className={`${styles.input} ${styles.inputNumber} ${styles.paramInput}`}
                            value={params[h.slug][key] === 0 ? "" : params[h.slug][key]}
                            placeholder="0"
                            onChange={(ev) => setParam(h.slug, key, Number(ev.target.value) || 0)}
                            aria-label={`${h.label} ${key}`}
                          />
                        </td>
                      ))}
                      <td className={styles.num}>{fmtCzk(perHotel.walkinProv[h.slug])}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(hotelSoucet(h.slug))}</td>
                      <td className={styles.num}>
                        <input
                          type="number"
                          step="any"
                          className={`${styles.input} ${styles.inputNumber} ${styles.paramInput}`}
                          value={totalMoney[h.slug] === 0 ? "" : totalMoney[h.slug]}
                          placeholder="0"
                          onChange={(ev) => setTotalMoney((prev) => ({ ...prev, [h.slug]: Number(ev.target.value) || 0 }))}
                          aria-label={`${h.label} celková částka`}
                        />
                      </td>
                      <td className={styles.num}>{fmtCzk(perHotel.perShift[h.slug])}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={styles.strong}>Celkem</td>
                    <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.taxi)}</td>
                    <td colSpan={3} />
                    <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.walkinProv)}</td>
                    <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.soucetHotel)}</td>
                    <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.pool)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── Počet směn (per-employee distribution) ──────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Počet směn</h2>
            <p className={styles.note}>
              Počítají se pouze recepční denní/noční směny podle hotelu. Dvojité směny (např. DA²) a zaškolovací směny se
              nepočítají; hodinová buňka označená typem směny se počítá jako část směny (hodiny ÷ 12). Částky za směny =
              podíl na částce hotelu podle počtu směn (zaokrouhleno dolů na 10 Kč).
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Zaměstnanec</th>
                    {HOTELS.map((h) => (
                      <th key={h.slug} colSpan={2} className={styles.groupHead}>
                        {h.slug === "amigo-alqush" ? "A&A" : h.label}
                      </th>
                    ))}
                    <th rowSpan={2} className={styles.num}>
                      Celkem směn
                    </th>
                    <th rowSpan={2} className={styles.num}>
                      Provize walk-in
                    </th>
                    <th rowSpan={2} className={styles.num}>
                      Provize minus
                    </th>
                    <th rowSpan={2} className={styles.num}>
                      Součet
                    </th>
                  </tr>
                  <tr>
                    {HOTELS.map((h) => (
                      <Fragment key={h.slug}>
                        <th className={styles.num}>směny</th>
                        <th className={styles.num}>Kč</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {emps.length === 0 && (
                    <tr>
                      <td colSpan={HOTELS.length * 2 + 5} className={styles.empty}>
                        Žádné směny ani walk-iny v období.
                      </td>
                    </tr>
                  )}
                  {emps.map((e) => (
                    <tr key={e.employeeId}>
                      <td>{e.name}</td>
                      {HOTELS.map((h) => (
                        <Fragment key={h.slug}>
                          <td className={styles.num}>{fmtShifts(e.byHotel[h.slug] ?? 0)}</td>
                          <td className={styles.num}>{fmtCzk(shareMoney(e, h.slug))}</td>
                        </Fragment>
                      ))}
                      <td className={`${styles.num} ${styles.strong}`}>{fmtShifts(e.totalShifts)}</td>
                      <td className={styles.num}>{fmtCzk(walkinProvision(e))}</td>
                      <td className={styles.num}>{fmtCzk(minusByEmp[e.employeeId] ?? 0)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(employeeTotal(e))}</td>
                    </tr>
                  ))}
                </tbody>
                {emps.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className={styles.strong}>Celkem</td>
                      {HOTELS.map((h) => (
                        <Fragment key={h.slug}>
                          <td className={`${styles.num} ${styles.strong}`}>{fmtShifts(perHotel.shifts[h.slug])}</td>
                          <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.shiftMoneyByHotel[h.slug])}</td>
                        </Fragment>
                      ))}
                      <td className={`${styles.num} ${styles.strong}`}>{fmtShifts(totals.shiftsTotal)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.walkinProv)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.minusTotal)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totals.empTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* ── Walk-in list (collapsible, bottom) ──────────────────────────── */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.collapseHeader}
              onClick={() => setWalkinsOpen((o) => !o)}
              aria-expanded={walkinsOpen}
            >
              <span className={styles.collapseChevron} data-open={walkinsOpen}>
                ▸
              </span>
              <h2 className={styles.sectionTitle}>Walk-iny</h2>
              <span className={styles.collapseCount}>{data.walkins.length}</span>
            </button>
            {walkinsOpen && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Hotel</th>
                      <th>Datum</th>
                      <th>Zaměstnanec</th>
                      <th>č. rez. v Protelu</th>
                      <th className={styles.num}>Částka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.walkins.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.empty}>
                          Žádné walk-in záznamy v období.
                        </td>
                      </tr>
                    )}
                    {data.walkins.map((w, i) => (
                      <tr key={`${w.hotel}-${i}`}>
                        <td className={styles.hotelCell}>{w.hotelLabel}</td>
                        <td>{formatDate(w.date)}</td>
                        <td>{w.employeeName}</td>
                        <td>{w.resNo}</td>
                        <td className={styles.num}>
                          {w.amount.toLocaleString("cs-CZ")} {currencySymbol(w.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {editingMinus && (
        <ProvizeMinusModal
          initial={editingMinus === "new" ? null : editingMinus}
          employees={rangeEmps}
          defaultDate={to}
          onSaved={() => {
            setEditingMinus(null);
            void loadProvizeMinus();
          }}
          onCancel={() => setEditingMinus(null)}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          showCancel={confirm.title !== "Chyba"}
          confirmLabel={confirm.title === "Chyba" ? "OK" : confirm.danger ? "Smazat" : "OK"}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / edit modal for a Provize-minus entry.
// ─────────────────────────────────────────────────────────────────────────────
function ProvizeMinusModal({
  initial,
  employees,
  defaultDate,
  onSaved,
  onCancel,
}: {
  initial: ProvizeMinusEntry | null;
  employees: EmployeeOption[];
  defaultDate: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [employeeName, setEmployeeName] = useState(initial?.employeeName ?? "");
  const [amount, setAmount] = useState<number>(initial?.amount ?? 0);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep the entry's employee selectable even if outside the current range roster.
  const options = useMemo(() => {
    const list = [...employees];
    if (employeeId && !list.some((e) => e.employeeId === employeeId)) {
      list.unshift({ employeeId, name: employeeName || employeeId });
    }
    return list;
  }, [employees, employeeId, employeeName]);

  function selectEmployee(id: string) {
    setEmployeeId(id);
    const found = employees.find((e) => e.employeeId === id);
    if (found) setEmployeeName(found.name);
  }

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && employeeId !== "" && Number.isFinite(amount) && amount >= 0 && note.trim() !== "";

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const body = { date, employeeId, employeeName, amount: Number(amount) || 0, note: note.trim() };
    try {
      if (isEdit) await api.put(`/recepce-summary/provize-minus/${initial!.id}`, body);
      else await api.post(`/recepce-summary/provize-minus`, body);
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, "Uložení se nezdařilo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? "Upravit provizi minus" : "Nová provize minus"}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            Datum
            <input type="date" className={styles.mInput} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={busy} />
          </label>
          <label className={styles.field}>
            Zaměstnanec
            <select className={styles.mInput} value={employeeId} onChange={(e) => selectEmployee(e.target.value)} disabled={busy}>
              <option value="" disabled>
                {options.length === 0 ? "Žádní zaměstnanci v plánu" : "Vyberte zaměstnance…"}
              </option>
              {options.map((o) => (
                <option key={o.employeeId} value={o.employeeId}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Částka (0 = bude určeno)
            <input
              type="number"
              step="any"
              min="0"
              className={styles.mInput}
              value={amount === 0 ? "" : amount}
              placeholder="0"
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            Poznámka (povinná)
            <input type="text" className={styles.mInput} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </label>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" onClick={submit} disabled={busy || !valid}>
            {busy ? "Ukládám…" : isEdit ? "Uložit" : "Přidat"}
          </Button>
        </div>
      </div>
    </div>
  );
}
