import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { HOTELS, type HotelSlug } from "@/lib/hotels";
import styles from "./RecepceSummaryPage.module.css";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-hotel Recepce summary (admin-only, gated by recepce.summary.view).
// A single read-only overview of all four hotels for a settable date range:
//   • every walk-in (hotel-tagged) in the range,
//   • shift counts per receptionist per hotel (desk day/night only; doubles = 0;
//     a numeric cell tagged with a desk type = hours/12 of a shift),
//   • each receptionist's 10 % walk-in provision (EUR converted at a page rate),
//   • taxi provisions per hotel, plus three free per-hotel numbers (č/př/wal).
// Everything settable is page-local (localStorage) — this page persists nothing
// server-side.
// ─────────────────────────────────────────────────────────────────────────────

interface WalkinRow {
  hotel: HotelSlug;
  hotelCode: string;
  hotelLabel: string;
  date: string;
  employeeId: string;
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
  walkinCzk: number;
  walkinEur: number;
}

interface SummaryResponse {
  from: string;
  to: string;
  walkins: WalkinRow[];
  taxiProvisionByHotel: Record<HotelSlug, number>;
  employees: EmployeeRow[];
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

const WALKIN_PROVISION_RATE = 0.1; // 10 % of the CZK-converted walk-in total.

// ── local-date helpers (never new Date("YYYY-MM-DD") — TZ-shifts a day) ───────
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
/** A CZK money amount, rounded to 2 decimals with a trailing "Kč". */
function fmtCzk(n: number): string {
  return `${(Math.round(n * 100) / 100).toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} Kč`;
}

// ── persistence ───────────────────────────────────────────────────────────────
function loadRange(): { from: string; to: string } {
  try {
    const raw = window.localStorage.getItem(LS_RANGE);
    if (raw) {
      const p = JSON.parse(raw) as { from?: unknown; to?: unknown };
      if (typeof p.from === "string" && typeof p.to === "string") return { from: p.from, to: p.to };
    }
  } catch {
    /* ignore */
  }
  return { from: firstOfThisMonth(), to: todayLocal() };
}
function loadRate(): number {
  try {
    const raw = window.localStorage.getItem(LS_RATE);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
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
    const raw = window.localStorage.getItem(LS_PARAMS);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, Partial<HotelParams>>;
      for (const h of HOTELS) {
        const v = p[h.slug];
        if (v) {
          base[h.slug] = {
            c: Number(v.c) || 0,
            pr: Number(v.pr) || 0,
            wal: Number(v.wal) || 0,
          };
        }
      }
    }
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

  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch whenever the range changes (both bounds valid, from ≤ to). The rate and
  // č/př/wal are applied client-side, so changing them never refetches.
  useEffect(() => {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
    if (!valid || from > to) {
      setData(null);
      setError(from > to ? "Počáteční datum musí být před koncovým." : null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await api.get<SummaryResponse>(
          `/recepce-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        if (!cancelled) setData(res);
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
    // Persist the range alongside fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // Persist settables.
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

  function setParam(slug: HotelSlug, key: keyof HotelParams, value: number) {
    setParams((prev) => ({ ...prev, [slug]: { ...prev[slug], [key]: value } }));
  }

  // 10 % of each receptionist's CZK-converted walk-in total (EUR × page rate).
  function walkinProvision(e: EmployeeRow): number {
    return (e.walkinCzk + e.walkinEur * rate) * WALKIN_PROVISION_RATE;
  }

  // Column totals for the shift matrix footer.
  const shiftTotals = useMemo(() => {
    const byHotel = HOTELS.reduce((acc, h) => {
      acc[h.slug] = 0;
      return acc;
    }, {} as Record<HotelSlug, number>);
    let total = 0;
    let provision = 0;
    for (const e of data?.employees ?? []) {
      for (const h of HOTELS) byHotel[h.slug] += e.byHotel[h.slug] ?? 0;
      total += e.totalShifts;
      provision += walkinProvision(e);
    }
    return { byHotel, total, provision };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rate]);

  const totalTaxiProvision = useMemo(
    () => HOTELS.reduce((sum, h) => sum + (data?.taxiProvisionByHotel[h.slug] ?? 0), 0),
    [data]
  );

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
          {/* ── Walk-in list (all hotels) ──────────────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Walk-iny</h2>
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
          </section>

          {/* ── Shift counts per employee per hotel + walk-in provision ─────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Počet směn</h2>
            <p className={styles.note}>
              Počítají se pouze recepční denní/noční směny podle hotelu. Dvojité směny (např. DA²) a zaškolovací směny se
              nepočítají; hodinová buňka označená typem směny se počítá jako část směny (hodiny ÷ 12).
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Zaměstnanec</th>
                    {HOTELS.map((h) => (
                      <th key={h.slug} className={styles.num}>
                        {h.label}
                      </th>
                    ))}
                    <th className={styles.num}>Celkem směn</th>
                    <th className={styles.num}>Provize walk-in</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees.length === 0 && (
                    <tr>
                      <td colSpan={HOTELS.length + 3} className={styles.empty}>
                        Žádné směny ani walk-iny v období.
                      </td>
                    </tr>
                  )}
                  {data.employees.map((e) => (
                    <tr key={e.employeeId}>
                      <td>{e.name}</td>
                      {HOTELS.map((h) => (
                        <td key={h.slug} className={styles.num}>
                          {fmtShifts(e.byHotel[h.slug] ?? 0)}
                        </td>
                      ))}
                      <td className={`${styles.num} ${styles.strong}`}>{fmtShifts(e.totalShifts)}</td>
                      <td className={styles.num}>{fmtCzk(walkinProvision(e))}</td>
                    </tr>
                  ))}
                </tbody>
                {data.employees.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className={styles.strong}>Celkem</td>
                      {HOTELS.map((h) => (
                        <td key={h.slug} className={`${styles.num} ${styles.strong}`}>
                          {fmtShifts(shiftTotals.byHotel[h.slug])}
                        </td>
                      ))}
                      <td className={`${styles.num} ${styles.strong}`}>{fmtShifts(shiftTotals.total)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(shiftTotals.provision)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* ── Per-hotel: taxi provisions + č / př / wal ───────────────────── */}
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
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={styles.strong}>Celkem</td>
                    <td className={`${styles.num} ${styles.strong}`}>{fmtCzk(totalTaxiProvision)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
