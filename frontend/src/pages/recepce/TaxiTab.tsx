import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./TaxiTab.module.css";

interface TaxiRoute {
  id: string;
  name: string;
  price: number;
  provision: number;
  roundtrip: boolean;
}

interface TaxiRide {
  id: string;
  date: string;
  time: string;
  room: string;
  pax: number | null;
  routeName: string;
  amount: number;
  provision: number;
  note: string;
}

interface Range {
  from: string | null;
  to: string | null;
}

const OTHER = "__other__";

function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}
function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}
function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
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

export default function TaxiTab({ hotel }: { hotel: Hotel }) {
  const { can } = useAuth();
  const canManage = can(hotel.taxiManagePerm);
  const canManageRates = can("recepce.taxi.manageRates");

  const [rides, setRides] = useState<TaxiRide[]>([]);
  const [routes, setRoutes] = useState<TaxiRoute[]>([]);
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<TaxiRide | "new" | null>(null);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [ridesRes, rng, routesRes] = await Promise.all([
        api.get<TaxiRide[]>(`/taxi/${hotel.slug}`),
        api.get<Range>(`/taxi/${hotel.slug}/range`),
        api.get<{ routes: TaxiRoute[] }>(`/taxi/routes`),
      ]);
      setRides(ridesRes);
      setRange(rng);
      setRoutes(routesRes.routes);
      setRangeFrom(rng.from ?? "");
      setRangeTo(rng.to ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Nepodařilo se načíst taxi jízdy.");
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
      const rng = await api.put<Range>(`/taxi/${hotel.slug}/range`, { from: rangeFrom || null, to: rangeTo || null });
      setRange(rng);
      await load();
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : "Období se nepodařilo uložit.");
    } finally {
      setRangeSaving(false);
    }
  }

  function requestDelete(ride: TaxiRide) {
    setConfirm({
      title: "Smazat jízdu?",
      message: `Opravdu chcete smazat jízdu z ${formatDate(ride.date)} (${ride.routeName || "jiné"}, ${ride.amount.toLocaleString("cs-CZ")} Kč)?`,
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void doDelete(ride.id),
    });
  }
  async function doDelete(id: string) {
    try {
      await api.delete<{ ok: true }>(`/taxi/${hotel.slug}/${id}`);
      setRides((prev) => prev.filter((r) => r.id !== id));
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Jízdu se nepodařilo smazat.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  const hasRange = !!(range.from || range.to);

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
            <div className={styles.leftToolbar}>
              <Button size="sm" onClick={() => setEditing("new")}>
                + Přidat jízdu
              </Button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Čas</th>
                    <th>Pokoj</th>
                    <th>PAX</th>
                    <th>Destinace</th>
                    <th>Částka</th>
                    <th>Provize</th>
                    <th>Poznámka</th>
                    <th aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {rides.length === 0 && (
                    <tr>
                      <td colSpan={9} className={styles.empty}>
                        Žádné taxi jízdy.
                      </td>
                    </tr>
                  )}
                  {rides.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.time}</td>
                      <td>{r.room}</td>
                      <td className={styles.numCell}>{r.pax ?? ""}</td>
                      <td>{r.routeName || <span className={styles.otherTag}>jiné</span>}</td>
                      <td className={styles.numCell}>{r.amount.toLocaleString("cs-CZ")} Kč</td>
                      <td className={styles.numCell}>{r.provision.toLocaleString("cs-CZ")} Kč</td>
                      <td className={styles.noteCell} title={r.note}>
                        {r.note}
                      </td>
                      <td className={styles.actionsCell}>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.rowIconBtn} aria-label="Upravit" onClick={() => setEditing(r)}>
                            <PencilIcon />
                          </button>
                          <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label="Smazat" onClick={() => requestDelete(r)}>
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

          <aside className={styles.pricelist}>
            <div className={styles.pricelistHeader}>
              <h3 className={styles.pricelistTitle}>Ceník tras</h3>
              {canManageRates && (
                <Button variant="secondary" size="sm" onClick={() => setRoutesOpen(true)}>
                  Upravit
                </Button>
              )}
            </div>
            <div className={styles.pricelistBody}>
              <table className={styles.priceTable}>
                <thead>
                  <tr>
                    <th>Trasa</th>
                    <th>Cena</th>
                    <th>Provize</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.length === 0 && (
                    <tr>
                      <td colSpan={3} className={styles.empty}>
                        Žádné trasy.
                      </td>
                    </tr>
                  )}
                  {routes.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name}
                        {r.roundtrip && (
                          <span className={styles.roundBadge} title="Zpáteční">
                            ↺
                          </span>
                        )}
                      </td>
                      <td className={styles.numCell}>{r.price.toLocaleString("cs-CZ")} Kč</td>
                      <td className={styles.numCell}>{r.provision.toLocaleString("cs-CZ")} Kč</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      )}

      {editing && (
        <RideModal
          hotel={hotel}
          canManage={canManage}
          range={range}
          routes={routes}
          initial={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {routesOpen && (
        <RoutesModal
          canEdit={canManageRates}
          routes={routes}
          onSaved={(next) => {
            setRoutes(next);
            setRoutesOpen(false);
          }}
          onCancel={() => setRoutesOpen(false)}
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
// Ride add/edit modal. A common route auto-fills (and locks) amount + provision;
// "Jiné…" makes them manual with a mandatory note. Time is required unless the
// selected route is a roundtrip.
// ─────────────────────────────────────────────────────────────────────────────
function initialDestOf(initial: TaxiRide | null, routes: TaxiRoute[]): string {
  if (!initial) return "";
  if (initial.routeName === "") return OTHER;
  const r = routes.find((x) => x.name === initial.routeName);
  return r ? r.id : OTHER;
}

function RideModal({
  hotel,
  canManage,
  range,
  routes,
  initial,
  onSaved,
  onCancel,
}: {
  hotel: Hotel;
  canManage: boolean;
  range: Range;
  routes: TaxiRoute[];
  initial: TaxiRide | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayLocal());
  const [time, setTime] = useState(initial?.time ?? "");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [pax, setPax] = useState(initial?.pax != null ? String(initial.pax) : "");
  const [dest, setDest] = useState(initialDestOf(initial, routes));
  const [amount, setAmount] = useState<number>(initial?.amount ?? 0);
  const [provision, setProvision] = useState<number>(initial?.provision ?? 0);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isOther = dest === OTHER;
  const selectedRoute = useMemo(() => routes.find((r) => r.id === dest), [routes, dest]);
  const timeRequired = isOther ? true : selectedRoute ? !selectedRoute.roundtrip : true;

  function selectDest(v: string) {
    setDest(v);
    const r = routes.find((x) => x.id === v);
    if (r) {
      setAmount(r.price);
      setProvision(r.provision);
    }
  }

  const dateMin = !canManage && range.from ? range.from : undefined;
  const dateMax = !canManage && range.to ? range.to : undefined;

  const valid =
    dest !== "" &&
    (!timeRequired || time.trim() !== "") &&
    (!isOther || (Number.isFinite(amount) && note.trim() !== ""));

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const body = {
      date,
      time: time.trim(),
      room: room.trim(),
      pax: pax.trim() === "" ? null : Number(pax),
      routeId: isOther ? "" : dest,
      amount: Number(amount) || 0,
      provision: Number(provision) || 0,
      note: note.trim(),
    };
    try {
      if (isEdit) await api.put(`/taxi/${hotel.slug}/${initial!.id}`, body);
      else await api.post(`/taxi/${hotel.slug}`, body);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? "Upravit jízdu" : "Nová jízda"}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <div className={styles.row2}>
            <label className={styles.field}>
              Datum
              <input type="date" className={styles.input} value={date} min={dateMin} max={dateMax} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={busy} />
            </label>
            <label className={styles.field}>
              Čas{timeRequired ? "" : " (nepovinné)"}
              <input type="time" className={styles.input} value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
            </label>
          </div>
          <div className={styles.row2}>
            <label className={styles.field}>
              Pokoj (nepovinné)
              <input type="text" className={styles.input} value={room} onChange={(e) => setRoom(e.target.value)} placeholder="např. 307" disabled={busy} />
            </label>
            <label className={styles.field}>
              PAX (nepovinné)
              <input type="number" min={0} step={1} className={`${styles.input} ${styles.inputNumber}`} value={pax} onChange={(e) => setPax(e.target.value)} placeholder="počet osob" disabled={busy} />
            </label>
          </div>
          <label className={styles.field}>
            Destinace
            <select className={styles.select} value={dest} onChange={(e) => selectDest(e.target.value)} disabled={busy}>
              <option value="" disabled>
                Vyberte trasu…
              </option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value={OTHER}>Jiné…</option>
            </select>
          </label>
          <div className={styles.row2}>
            <label className={styles.field}>
              Částka (Kč)
              <input type="number" step="any" className={`${styles.input} ${styles.inputNumber}`} value={amount === 0 ? "" : amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="0" disabled={busy || !isOther} />
            </label>
            <label className={styles.field}>
              Provize (Kč)
              <input type="number" step="any" className={`${styles.input} ${styles.inputNumber}`} value={provision === 0 ? "" : provision} onChange={(e) => setProvision(Number(e.target.value))} placeholder="0" disabled={busy || !isOther} />
            </label>
          </div>
          <label className={styles.field}>
            Poznámka{isOther ? "" : " (nepovinné)"}
            <input type="text" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isOther ? "povinné u vlastní trasy" : ""} disabled={busy} />
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

// ─────────────────────────────────────────────────────────────────────────────
// Global routes (ceník) editor. Read-only unless the caller holds
// recepce.taxi.manageRates.
// ─────────────────────────────────────────────────────────────────────────────
interface DraftRoute extends TaxiRoute {
  _key: string;
}

function RoutesModal({
  canEdit,
  routes,
  onSaved,
  onCancel,
}: {
  canEdit: boolean;
  routes: TaxiRoute[];
  onSaved: (next: TaxiRoute[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DraftRoute[]>(routes.map((r) => ({ ...r, _key: r.id || genId() })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(key: string, patch: Partial<TaxiRoute>) {
    setDraft((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setDraft((prev) => prev.filter((r) => r._key !== key));
  }
  function add() {
    setDraft((prev) => [...prev, { _key: genId(), id: "", name: "", price: 0, provision: 0, roundtrip: false }]);
  }
  /** Reorder a route (order is persisted verbatim as the array position). */
  function move(key: string, dir: -1 | 1) {
    setDraft((prev) => {
      const i = prev.findIndex((r) => r._key === key);
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
    const payload = draft
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({ id: r.id, name: r.name.trim(), price: Number(r.price) || 0, provision: Number(r.provision) || 0, roundtrip: r.roundtrip }));
    try {
      const res = await api.put<{ routes: TaxiRoute[] }>(`/taxi/routes`, { routes: payload });
      onSaved(res.routes);
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
          <h2 className={styles.modalTitle}>Ceník tras</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <table className={styles.routesTable}>
            <thead>
              <tr>
                <th>Trasa</th>
                <th>Cena</th>
                <th>Provize</th>
                <th>Round-trip</th>
                {canEdit && <th aria-label="Akce" />}
              </tr>
            </thead>
            <tbody>
              {draft.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 5 : 4} className={styles.empty}>
                    Žádné trasy.
                  </td>
                </tr>
              )}
              {draft.map((r, idx) => (
                <tr key={r._key}>
                  <td>
                    {canEdit ? (
                      <input className={styles.routeInput} value={r.name} onChange={(e) => update(r._key, { name: e.target.value })} placeholder="název trasy" disabled={busy} />
                    ) : (
                      r.name
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <input type="number" step="any" className={`${styles.routeInput} ${styles.routeNum}`} value={r.price === 0 ? "" : r.price} onChange={(e) => update(r._key, { price: Number(e.target.value) })} placeholder="0" disabled={busy} />
                    ) : (
                      `${r.price.toLocaleString("cs-CZ")} Kč`
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <input type="number" step="any" className={`${styles.routeInput} ${styles.routeNum}`} value={r.provision === 0 ? "" : r.provision} onChange={(e) => update(r._key, { provision: Number(e.target.value) })} placeholder="0" disabled={busy} />
                    ) : (
                      `${r.provision.toLocaleString("cs-CZ")} Kč`
                    )}
                  </td>
                  <td>
                    <input type="checkbox" className={styles.routeCheck} checked={r.roundtrip} onChange={(e) => update(r._key, { roundtrip: e.target.checked })} disabled={busy || !canEdit} aria-label="Round-trip" />
                  </td>
                  {canEdit && (
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" className={styles.rowIconBtn} aria-label="Posunout nahoru" title="Posunout nahoru" onClick={() => move(r._key, -1)} disabled={busy || idx === 0}>
                          <ChevronUpIcon />
                        </button>
                        <button type="button" className={styles.rowIconBtn} aria-label="Posunout dolů" title="Posunout dolů" onClick={() => move(r._key, 1)} disabled={busy || idx === draft.length - 1}>
                          <ChevronDownIcon />
                        </button>
                        <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label="Odstranit trasu" onClick={() => remove(r._key)} disabled={busy}>
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          {canEdit && (
            <Button variant="secondary" size="sm" type="button" onClick={add} disabled={busy} style={{ marginRight: "auto" }}>
              + Přidat trasu
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            {canEdit ? "Zrušit" : "Zavřít"}
          </Button>
          {canEdit && (
            <Button type="button" onClick={save} disabled={busy}>
              {busy ? "Ukládám…" : "Uložit"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
