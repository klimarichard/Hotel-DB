import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./LobbyBarTab.module.css";

type Currency = "CZK" | "EUR";

interface LobbyBarItem {
  id: string;
  name: string;
  priceCZK: number;
  priceEUR: number;
}

interface LobbyBarConfig {
  items: LobbyBarItem[];
  provisionCZK: number;
  provisionEUR: number;
}

interface LobbyBarSale {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  quantity: number;
  currency: Currency;
  employeeId: string;
  employeeName: string;
  unitPrice: number;
  price: number;
  provision: number;
  doSpolecne: number;
}

interface Range {
  from: string | null;
  to: string | null;
}

interface EmployeeOption {
  employeeId: string;
  name: string;
}

function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}
function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}
function currencySymbol(c: Currency): string {
  return c === "CZK" ? "Kč" : "€";
}
function formatMoney(value: number, c: Currency): string {
  return `${value.toLocaleString("cs-CZ")} ${currencySymbol(c)}`;
}
function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

/** Money rounding matching the server (whole CZK, two decimals for EUR). */
function roundMoney(x: number, c: Currency): number {
  return c === "CZK" ? Math.round(x) : Math.round(x * 100) / 100;
}

/**
 * Local mirror of the backend `computeSale` – used ONLY for the read-only
 * preview in the sale modal. The stored row always comes from the server.
 */
function computePreview(
  item: LobbyBarItem | undefined,
  quantity: number,
  currency: Currency,
  cfg: { provisionCZK: number; provisionEUR: number }
): { price: number; provision: number; doSpolecne: number } {
  if (!item || !Number.isFinite(quantity) || quantity <= 0) {
    return { price: 0, provision: 0, doSpolecne: 0 };
  }
  const unitPrice = currency === "CZK" ? item.priceCZK : item.priceEUR;
  const rate = currency === "CZK" ? cfg.provisionCZK : cfg.provisionEUR;
  const price = roundMoney(quantity * unitPrice, currency);
  const provision = roundMoney(quantity * rate, currency);
  const doSpolecne = roundMoney(price - provision, currency);
  return { price, provision, doSpolecne };
}

/**
 * Preview for a whole multi-line sale. Each line is rounded on its own – exactly
 * like the server, which stores one document per line – and only then summed, so
 * the previewed total always equals the sum of the rows that end up in the table.
 */
function computeLinesPreview(
  lines: { itemId: string; quantity: number }[],
  currency: Currency,
  cfg: LobbyBarConfig
): { price: number; provision: number; doSpolecne: number } {
  const sum = lines.reduce(
    (acc, l) => {
      const p = computePreview(
        cfg.items.find((i) => i.id === l.itemId),
        l.quantity,
        currency,
        cfg
      );
      return {
        price: acc.price + p.price,
        provision: acc.provision + p.provision,
        doSpolecne: acc.doSpolecne + p.doSpolecne,
      };
    },
    { price: 0, provision: 0, doSpolecne: 0 }
  );
  // Re-round the sums: adding several 2-decimal EUR values reintroduces float noise.
  return {
    price: roundMoney(sum.price, currency),
    provision: roundMoney(sum.provision, currency),
    doSpolecne: roundMoney(sum.doSpolecne, currency),
  };
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
    </svg>
  );
}
function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  showCancel?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

export default function LobbyBarTab({ hotel }: { hotel: Hotel }) {
  const { can } = useAuth();
  const canManage = !!hotel.lobbyBarManagePerm && can(hotel.lobbyBarManagePerm);

  const [sales, setSales] = useState<LobbyBarSale[]>([]);
  const [config, setConfig] = useState<LobbyBarConfig>({ items: [], provisionCZK: 0, provisionEUR: 0 });
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<LobbyBarSale | "new" | null>(null);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [salesRes, rng, cfg] = await Promise.all([
        api.get<LobbyBarSale[]>(`/lobby-bar/${hotel.slug}`),
        api.get<Range>(`/lobby-bar/${hotel.slug}/range`),
        api.get<LobbyBarConfig>(`/lobby-bar/${hotel.slug}/items`),
      ]);
      setSales(salesRes);
      setRange(rng);
      setConfig(cfg);
      setRangeFrom(rng.from ?? "");
      setRangeTo(rng.to ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Nepodařilo se načíst prodeje lobby baru.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.slug]);

  async function saveRange() {
    setRangeSaving(true);
    setRangeError(null);
    try {
      const rng = await api.put<Range>(`/lobby-bar/${hotel.slug}/range`, { from: rangeFrom || null, to: rangeTo || null });
      setRange(rng);
      await load();
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : "Období se nepodařilo uložit.");
    } finally {
      setRangeSaving(false);
    }
  }

  function requestDelete(sale: LobbyBarSale) {
    setConfirm({
      title: "Smazat prodej?",
      message: `Opravdu chcete smazat prodej z ${formatDate(sale.date)} (${sale.itemName || "?"}, ${sale.quantity}× ${formatMoney(sale.price, sale.currency)})?`,
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void doDelete(sale.id),
    });
  }
  async function doDelete(id: string) {
    try {
      await api.delete<{ ok: true }>(`/lobby-bar/${hotel.slug}/${id}`);
      setSales((prev) => prev.filter((s) => s.id !== id));
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Prodej se nepodařilo smazat.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  const hasRange = !!(range.from || range.to);

  // Totals over the sales inside the effective visible period – only the
  // lobbyBar.manage holders see them. Managers receive ALL sales from the API
  // (the range bounds only non-managers), so re-apply the saved range here,
  // matching the backend's one-sided semantics. CZK and EUR are summed
  // independently and never mixed or converted.
  const totals = useMemo(() => {
    const { from, to } = range;
    const acc = {
      provision: { CZK: 0, EUR: 0 },
      doSpolecne: { CZK: 0, EUR: 0 },
    };
    for (const s of sales) {
      if (from && s.date < from) continue;
      if (to && s.date > to) continue;
      acc.provision[s.currency] += Number.isFinite(s.provision) ? s.provision : 0;
      acc.doSpolecne[s.currency] += Number.isFinite(s.doSpolecne) ? s.doSpolecne : 0;
    }
    return acc;
  }, [sales, range]);

  // Join the per-currency parts of a total into one string, dropping a currency
  // whose sub-total is 0 (both never combined into a single number).
  function joinCurrencies(m: { CZK: number; EUR: number }): string {
    const parts: string[] = [];
    if (m.CZK !== 0) parts.push(formatMoney(m.CZK, "CZK"));
    if (m.EUR !== 0) parts.push(formatMoney(m.EUR, "EUR"));
    return parts.join(" · ");
  }

  const showProvision = totals.provision.CZK !== 0 || totals.provision.EUR !== 0;
  const showDoSpolecne = totals.doSpolecne.CZK !== 0 || totals.doSpolecne.EUR !== 0;

  return (
    <div className={styles.panel}>
      {(canManage || hasRange) && (
        <div className={styles.header}>
          {canManage ? (
            <div className={styles.rangeEditor}>
              <span className={styles.rangeLabel}>Viditelné období:</span>
              <input type="date" className={styles.dateInput} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} aria-label="Od" />
              <span>–</span>
              <input type="date" className={styles.dateInput} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} aria-label="Do" />
              <Button variant="secondary" size="sm" onClick={saveRange} disabled={rangeSaving}>
                {rangeSaving ? "Ukládám…" : "Uložit období"}
              </Button>
              {rangeError && <span className={`${styles.statusText} ${styles.statusError}`}>{rangeError}</span>}
            </div>
          ) : (
            <span className={styles.rangeInfo}>
              Zobrazené období: {range.from ? formatDate(range.from) : "…"} – {range.to ? formatDate(range.to) : "…"}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>Načítám…</div>
      ) : loadError ? (
        <div className={`${styles.empty} ${styles.statusError}`}>{loadError}</div>
      ) : (
        <div className={styles.content}>
          <div className={styles.left}>
            {canManage && (showProvision || showDoSpolecne) && (
              <div className={styles.provizeTotal} data-tour="lobbybar-totals">
                {showProvision && (
                  <div className={styles.provizeTotalLine}>
                    <span className={styles.provizeTotalLabel}>Provize za viditelné období:</span>{" "}
                    <span className={styles.provizeTotalValue}>{joinCurrencies(totals.provision)}</span>
                  </div>
                )}
                {showDoSpolecne && (
                  <div className={styles.provizeTotalLine}>
                    <span className={styles.provizeTotalLabel}>Do společné za viditelné období:</span>{" "}
                    <span className={styles.provizeTotalValue}>{joinCurrencies(totals.doSpolecne)}</span>
                  </div>
                )}
              </div>
            )}
            <div className={styles.leftToolbar}>
              <Button size="sm" onClick={() => setEditing("new")} data-tour="lobbybar-add">
                + Přidat prodej
              </Button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Položka</th>
                    <th className={styles.numCellLeft}>Počet</th>
                    <th>Měna</th>
                    <th>Prodal</th>
                    <th className={styles.numCellLeft}>Cena</th>
                    <th className={styles.numCellLeft}>Provize</th>
                    <th className={styles.numCellLeft}>Do společné</th>
                    <th aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {sales.length === 0 && (
                    <tr>
                      <td colSpan={9} className={styles.empty}>
                        Žádné prodeje lobby baru.
                      </td>
                    </tr>
                  )}
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td>{formatDate(s.date)}</td>
                      <td>{s.itemName}</td>
                      <td className={styles.numCellLeft}>{s.quantity}</td>
                      <td>{currencySymbol(s.currency)}</td>
                      <td>{s.employeeName}</td>
                      <td className={styles.numCellLeft}>{formatMoney(s.price, s.currency)}</td>
                      <td className={styles.numCellLeft}>{formatMoney(s.provision, s.currency)}</td>
                      <td className={styles.numCellLeft}>{formatMoney(s.doSpolecne, s.currency)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.rowIconBtn} aria-label="Upravit" onClick={() => setEditing(s)}>
                            <PencilIcon />
                          </button>
                          <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label="Smazat" onClick={() => requestDelete(s)}>
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className={styles.pricelist} data-tour="lobbybar-cenik">
            <div className={styles.pricelistHeader}>
              <h3 className={styles.pricelistTitle}>Ceník položek</h3>
              {canManage && (
                <Button variant="secondary" size="sm" onClick={() => setItemsOpen(true)}>
                  Upravit
                </Button>
              )}
            </div>
            <div className={styles.pricelistBody}>
              <table className={styles.priceTable}>
                <thead>
                  <tr>
                    <th className={styles.itemNameCell}>Položka</th>
                    <th className={styles.numCellLeft}>CZK</th>
                    <th className={styles.numCellLeft}>EUR</th>
                  </tr>
                </thead>
                <tbody>
                  {config.items.length === 0 && (
                    <tr>
                      <td colSpan={3} className={styles.empty}>
                        Žádné položky.
                      </td>
                    </tr>
                  )}
                  {config.items.map((it) => (
                    <tr key={it.id}>
                      <td className={styles.itemNameCell}>{it.name}</td>
                      <td className={styles.numCellLeft}>{it.priceCZK.toLocaleString("cs-CZ")} Kč</td>
                      <td className={styles.numCellLeft}>{it.priceEUR.toLocaleString("cs-CZ")} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.provisionNote}>
                <span className={styles.provisionNoteLabel}>Provize:</span>{" "}
                {config.provisionCZK.toLocaleString("cs-CZ")} Kč / {config.provisionEUR.toLocaleString("cs-CZ")} € za kus
              </div>
            </div>
          </aside>
        </div>
      )}

      {editing && (
        <SaleModal
          hotel={hotel}
          canManage={canManage}
          range={range}
          config={config}
          initial={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {itemsOpen && (
        <ItemsModal
          hotel={hotel}
          config={config}
          onSaved={(next) => {
            setConfig(next);
            setItemsOpen(false);
          }}
          onCancel={() => setItemsOpen(false)}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sale add/edit modal. The employee dropdown is loaded from the selected date's
// month shift plan and refetches when the month changes; a non-manage user's
// date is bounded by the visible range. Cena / Provize / Do společné are shown
// as a read-only preview only – the stored values are computed server-side.
//
// Adding: the modal takes N item lines that share one date / employee / currency
// (one guest, one payment) and posts them to /batch, which writes one sale
// document per line atomically. Editing: a stored row is one item, so the modal
// collapses to a single line and PUTs it back on its own.
// ─────────────────────────────────────────────────────────────────────────────

/** One item line in the add form. `quantity` stays a string so the field can be cleared. */
interface DraftLine {
  _key: string;
  itemId: string;
  quantity: string;
}

/** Czech plural of "položka" for the submit button: 2–4 položky, 5+ položek. */
function polozkyLabel(n: number): string {
  return n >= 2 && n <= 4 ? `${n} položky` : `${n} položek`;
}

function SaleModal({
  hotel,
  canManage,
  range,
  config,
  initial,
  onSaved,
  onCancel,
}: {
  hotel: Hotel;
  canManage: boolean;
  range: Range;
  config: LobbyBarConfig;
  initial: LobbyBarSale | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayLocal());
  const [lines, setLines] = useState<DraftLine[]>([
    initial
      ? { _key: genId(), itemId: initial.itemId, quantity: String(initial.quantity) }
      : { _key: genId(), itemId: "", quantity: "1" },
  ]);
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? "CZK");
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [employeeName, setEmployeeName] = useState(initial?.employeeName ?? "");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const month = date.slice(0, 7);

  // Load the employee pool for the selected date's month (refetch on month change).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<EmployeeOption[]>(
          `/lobby-bar/${hotel.slug}/employees?date=${encodeURIComponent(date)}`
        );
        if (!cancelled) setEmployees(list);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, hotel.slug]);

  // Keep the currently-selected employee selectable even if they're not in this
  // month's plan (e.g. editing an old entry).
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

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { _key: genId(), itemId: "", quantity: "1" }]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l._key !== key)));
  }

  /** Lines with a parsed integer quantity, used for both validation and the preview. */
  const parsedLines = useMemo(
    () => lines.map((l) => ({ itemId: l.itemId, quantity: Math.floor(Number(l.quantity)) })),
    [lines]
  );
  const preview = useMemo(() => computeLinesPreview(parsedLines, currency, config), [parsedLines, currency, config]);

  const dateMin = !canManage && range.from ? range.from : undefined;
  const dateMax = !canManage && range.to ? range.to : undefined;
  const linesValid = parsedLines.every((l) => l.itemId !== "" && Number.isInteger(l.quantity) && l.quantity >= 1);
  const valid = linesValid && lines.length >= 1 && employeeId !== "";

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      if (isEdit) {
        const { itemId, quantity } = parsedLines[0];
        await api.put(`/lobby-bar/${hotel.slug}/${initial!.id}`, { date, itemId, quantity, currency, employeeId, employeeName });
      } else {
        // One request for all lines: the server writes them in a single batch,
        // so a rejected line never leaves half the round saved.
        await api.post(`/lobby-bar/${hotel.slug}/batch`, { date, currency, employeeId, employeeName, lines: parsedLines });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modal} ${styles.modalSale}`}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? "Upravit prodej" : "Nový prodej"}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <div className={styles.row2}>
            <label className={styles.field}>
              Datum
              <input
                type="date"
                className={styles.input}
                value={date}
                min={dateMin}
                max={dateMax}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className={styles.field}>
              Měna
              <select className={styles.select} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} disabled={busy}>
                <option value="CZK">Kč</option>
                <option value="EUR">€</option>
              </select>
            </label>
          </div>
          <label className={styles.field}>
            Prodal
            <select className={styles.select} value={employeeId} onChange={(e) => selectEmployee(e.target.value)} disabled={busy}>
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

          <div className={styles.lines}>
            <table className={styles.routesTable}>
              <thead>
                <tr>
                  <th>Položka</th>
                  <th className={styles.lineQtyHead}>Počet</th>
                  {!isEdit && <th aria-label="Akce" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._key}>
                    <td>
                      <select
                        className={styles.routeInput}
                        value={l.itemId}
                        onChange={(e) => updateLine(l._key, { itemId: e.target.value })}
                        aria-label="Položka"
                        disabled={busy}
                      >
                        <option value="" disabled>
                          {config.items.length === 0 ? "Žádné položky v ceníku" : "Vyberte položku…"}
                        </option>
                        {config.items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className={`${styles.routeInput} ${styles.routeNum}`}
                        value={l.quantity}
                        onChange={(e) => updateLine(l._key, { quantity: e.target.value })}
                        aria-label="Počet"
                        placeholder="1"
                        disabled={busy}
                      />
                    </td>
                    {!isEdit && (
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`}
                            aria-label="Odebrat položku"
                            title="Odebrat položku"
                            onClick={() => removeLine(l._key)}
                            disabled={busy || lines.length <= 1}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!isEdit && (
              <Button variant="secondary" size="sm" type="button" onClick={addLine} disabled={busy || config.items.length === 0}>
                + Přidat položku
              </Button>
            )}
          </div>

          <div className={styles.preview}>
            <span className={styles.previewTitle}>Náhled (vypočítá se automaticky)</span>
            <div className={styles.previewRow}>
              <span>{isEdit ? "Cena" : "Celkem"}</span>
              <span className={styles.previewValue}>{formatMoney(preview.price, currency)}</span>
            </div>
            <div className={styles.previewRow}>
              <span>Provize</span>
              <span className={styles.previewValue}>{formatMoney(preview.provision, currency)}</span>
            </div>
            <div className={styles.previewRow}>
              <span>Do společné</span>
              <span className={styles.previewValue}>{formatMoney(preview.doSpolecne, currency)}</span>
            </div>
          </div>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" onClick={submit} disabled={busy || !valid}>
            {busy ? "Ukládám…" : isEdit ? "Uložit" : lines.length > 1 ? `Přidat ${polozkyLabel(lines.length)}` : "Přidat"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Item catalogue (ceník) editor + per-currency provision rates. Manage only.
// ─────────────────────────────────────────────────────────────────────────────
interface DraftItem extends LobbyBarItem {
  _key: string;
}

function ItemsModal({
  hotel,
  config,
  onSaved,
  onCancel,
}: {
  hotel: Hotel;
  config: LobbyBarConfig;
  onSaved: (next: LobbyBarConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DraftItem[]>(config.items.map((it) => ({ ...it, _key: it.id || genId() })));
  const [provisionCZK, setProvisionCZK] = useState<number>(config.provisionCZK);
  const [provisionEUR, setProvisionEUR] = useState<number>(config.provisionEUR);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(key: string, patch: Partial<LobbyBarItem>) {
    setDraft((prev) => prev.map((it) => (it._key === key ? { ...it, ...patch } : it)));
  }
  function remove(key: string) {
    setDraft((prev) => prev.filter((it) => it._key !== key));
  }
  function add() {
    setDraft((prev) => [...prev, { _key: genId(), id: "", name: "", priceCZK: 0, priceEUR: 0 }]);
  }
  /** Reorder an item (order is persisted verbatim as the array position). */
  function move(key: string, dir: -1 | 1) {
    setDraft((prev) => {
      const i = prev.findIndex((it) => it._key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const items = draft
      .filter((it) => it.name.trim() !== "")
      .map((it) => ({ id: it.id, name: it.name.trim(), priceCZK: Number(it.priceCZK) || 0, priceEUR: Number(it.priceEUR) || 0 }));
    const payload = { items, provisionCZK: Number(provisionCZK) || 0, provisionEUR: Number(provisionEUR) || 0 };
    try {
      const res = await api.put<LobbyBarConfig>(`/lobby-bar/${hotel.slug}/items`, payload);
      onSaved(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modal} ${styles.modalWide}`}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Ceník položek</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <table className={styles.routesTable}>
            <thead>
              <tr>
                <th>Položka</th>
                <th>CZK</th>
                <th>EUR</th>
                <th aria-label="Akce" />
              </tr>
            </thead>
            <tbody>
              {draft.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    Žádné položky.
                  </td>
                </tr>
              )}
              {draft.map((it, idx) => (
                <tr key={it._key}>
                  <td>
                    <input className={styles.routeInput} value={it.name} onChange={(e) => update(it._key, { name: e.target.value })} placeholder="název položky" disabled={busy} />
                  </td>
                  <td>
                    <input type="number" step="any" className={`${styles.routeInput} ${styles.routeNum}`} value={it.priceCZK === 0 ? "" : it.priceCZK} onChange={(e) => update(it._key, { priceCZK: Number(e.target.value) })} placeholder="0" disabled={busy} />
                  </td>
                  <td>
                    <input type="number" step="any" className={`${styles.routeInput} ${styles.routeNum}`} value={it.priceEUR === 0 ? "" : it.priceEUR} onChange={(e) => update(it._key, { priceEUR: Number(e.target.value) })} placeholder="0" disabled={busy} />
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.rowIconBtn} aria-label="Posunout nahoru" title="Posunout nahoru" onClick={() => move(it._key, -1)} disabled={busy || idx === 0}>
                        <ChevronUpIcon />
                      </button>
                      <button type="button" className={styles.rowIconBtn} aria-label="Posunout dolů" title="Posunout dolů" onClick={() => move(it._key, 1)} disabled={busy || idx === draft.length - 1}>
                        <ChevronDownIcon />
                      </button>
                      <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label="Odstranit položku" onClick={() => remove(it._key)} disabled={busy}>
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.provisionEditor}>
            <label className={styles.field}>
              Provize za kus (Kč)
              <input type="number" step="any" className={`${styles.input} ${styles.inputNumber}`} value={provisionCZK === 0 ? "" : provisionCZK} onChange={(e) => setProvisionCZK(Number(e.target.value))} placeholder="0" disabled={busy} />
            </label>
            <label className={styles.field}>
              Provize za kus (€)
              <input type="number" step="any" className={`${styles.input} ${styles.inputNumber}`} value={provisionEUR === 0 ? "" : provisionEUR} onChange={(e) => setProvisionEUR(Number(e.target.value))} placeholder="0" disabled={busy} />
            </label>
          </div>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" size="sm" type="button" onClick={add} disabled={busy} style={{ marginRight: "auto" }}>
            + Přidat položku
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "Ukládám…" : "Uložit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
