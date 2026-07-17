import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import { verifyCredential } from "@/lib/secondaryAuth";
import SignModal, { type Signer } from "@/components/SignModal";
import styles from "./HandoverTab.module.css";

type ShiftType = "den" | "noc";
type DrawerKey = "kasaCZK" | "trezorCZK" | "kasaEUR" | "trezorEUR";

const CZK_DENOMS = ["5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
const EUR_DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;

const AUTOSAVE_DELAY_MS = 800;

// firebase-admin's Timestamp serialises over the wire as { _seconds } (private
// field), not { seconds }. Tolerate both shapes.
type TimestampLike =
  | { seconds: number; nanoseconds?: number }
  | { _seconds: number; _nanoseconds?: number };

interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  locked: boolean;
}

interface Account {
  id: string;
  name: string;
  amount: number;
  locked: boolean;
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

type SignatureSlot = "predal" | "prevzal";

interface Stamp {
  uid: string;
  displayName: string;
  email: string;
  at: TimestampLike | null;
}

interface Handover {
  id: string;
  shiftDate: string;
  shiftType: ShiftType;
  notes?: NoteItem[] | null;
  cashCounts?: Partial<Record<DrawerKey, Record<string, number>>>;
  accounts?: Account[];
  /** The three sm counts. sm's CZK value = Σ rateᵢ·countᵢ (rates are global). */
  smCounts?: number[] | null;
  /** Accumulated sm trezor scalar (moved from sm by sm.manage users). */
  smTrezor?: number | null;
  /** wata scalar (± by protokol.manage users; may be negative). */
  wata?: number | null;
  predal?: Stamp | null;
  prevzal?: Stamp | null;
  updatedBy?: string;
  updatedAt?: TimestampLike | null;
}

/** One protocol change-history entry (from GET /handovers/:hotel/:id/history). */
interface HistoryEntry {
  seq: number;
  at: TimestampLike | null;
  label: string;
  by: string;
  undone: boolean;
  applied: boolean;
}

function tsSeconds(ts: TimestampLike | null | undefined): number | null {
  if (!ts) return null;
  if ("seconds" in ts && typeof ts.seconds === "number") return ts.seconds;
  if ("_seconds" in ts && typeof ts._seconds === "number") return ts._seconds;
  return null;
}

/** Epoch millis of a timestamp — the optimistic-concurrency token sent to the
 *  server. Uses seconds*1000 + floor(nanos/1e6), the SAME formula as the server's
 *  `tsMillis`, so the two agree bit-for-bit on whether the doc has moved. */
function tsMillis(ts: TimestampLike | null | undefined): number | null {
  const s = tsSeconds(ts);
  if (s == null) return null;
  const n =
    ts && "nanoseconds" in ts && typeof (ts as { nanoseconds?: number }).nanoseconds === "number"
      ? (ts as { nanoseconds: number }).nanoseconds
      : ts && "_nanoseconds" in ts && typeof (ts as { _nanoseconds?: number })._nanoseconds === "number"
        ? (ts as { _nanoseconds: number })._nanoseconds
        : 0;
  return s * 1000 + Math.floor(n / 1e6);
}

/** "8.7. 14:32" style, for the history panel. Empty on a missing timestamp. */
function stampDateTime(ts: TimestampLike | null | undefined): string {
  const s = tsSeconds(ts);
  if (s == null) return "";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s * 1000));
}

/** Coerce any input into a fixed length-3 numeric tuple (missing/invalid → 0). */
function triple(raw: unknown): [number, number, number] {
  const a = Array.isArray(raw) ? raw : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return [n(a[0]), n(a[1]), n(a[2])];
}

/** Σ rateᵢ·countᵢ – the sm row's CZK value. */
function smDot(rates: [number, number, number], counts: [number, number, number]): number {
  return rates[0] * counts[0] + rates[1] * counts[1] + rates[2] * counts[2];
}

const SHIFT_LABELS: Record<ShiftType, string> = { den: "Den", noc: "Noc" };

const DRAWER_LABELS: Record<DrawerKey, string> = {
  kasaCZK: "KASA CZK",
  trezorCZK: "TREZOR CZK",
  kasaEUR: "KASA €",
  trezorEUR: "TREZOR €",
};

const DRAWER_ORDER: DrawerKey[] = ["kasaCZK", "trezorCZK", "kasaEUR", "trezorEUR"];

/** Grid-area class per drawer, for the print layout (mirrors the app's cashLayout). */
const PRINT_AREA_CLASS: Record<DrawerKey, string> = {
  kasaCZK: styles.pKasaCZK,
  trezorCZK: styles.pTrezorCZK,
  kasaEUR: styles.pKasaEUR,
  trezorEUR: styles.pTrezorEUR,
};

function isCzkDrawer(key: DrawerKey): boolean {
  return key === "kasaCZK" || key === "trezorCZK";
}

function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

function defaultShiftForNow(): ShiftType {
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "den" : "noc";
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function previousShift(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "noc") return { date, shift: "den" };
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(y, m - 1, d);
  prev.setDate(prev.getDate() - 1);
  return { date: fmtDate(prev), shift: "noc" };
}

function nextShift(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "den") return { date, shift: "noc" };
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + 1);
  return { date: fmtDate(next), shift: "den" };
}

function timestampSeconds(ts: TimestampLike | null | undefined): number | null {
  if (!ts) return null;
  const a = ts as { seconds?: unknown };
  if (typeof a.seconds === "number") return a.seconds;
  const b = ts as { _seconds?: unknown };
  if (typeof b._seconds === "number") return b._seconds;
  return null;
}

function formatTimeOnly(ts: TimestampLike | null | undefined): string {
  const s = timestampSeconds(ts);
  if (s === null) return "";
  return new Date(s * 1000).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function formatTimestamp(ts: TimestampLike | null | undefined): string {
  const s = timestampSeconds(ts);
  if (s === null) return "";
  return new Date(s * 1000).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function emptyCashCounts(): Record<DrawerKey, Record<string, number>> {
  return { kasaCZK: {}, trezorCZK: {}, kasaEUR: {}, trezorEUR: {} };
}

function drawerSubtotal(counts: Record<string, number>): number {
  let total = 0;
  for (const [denom, n] of Object.entries(counts)) total += Number(denom) * (n || 0);
  return total;
}

function coerceNotes(raw: unknown): NoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .filter((n) => typeof n.text === "string")
    .map((n) => ({
      id: typeof n.id === "string" && n.id ? n.id : genId(),
      text: n.text as string,
      done: n.done === true,
      locked: n.locked === true,
    }));
}

function coerceAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .filter((a) => typeof a.name === "string")
    .map((a) => ({
      id: typeof a.id === "string" && a.id ? a.id : genId(),
      name: a.name as string,
      amount: typeof a.amount === "number" ? a.amount : 0,
      locked: a.locked === true,
    }));
}

function toPayload(
  notes: NoteItem[],
  cashCounts: Record<DrawerKey, Record<string, number>>,
  accounts: Account[],
  smCounts: [number, number, number]
) {
  return {
    notes: notes.map((n) => ({ id: n.id, text: n.text, done: n.done, locked: n.locked })),
    cashCounts,
    accounts: accounts
      .filter((a) => a.name.trim() !== "")
      .map((a) => ({ id: a.id, name: a.name.trim(), amount: Math.round(a.amount) || 0, locked: a.locked })),
    // smTrezor + wata are NOT sent here – they mutate only via dedicated endpoints.
    smCounts,
  };
}

// ── Inline row-action icons (feather-style) ──────────────────────────────────
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
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

function EditActionButton({ editing, ariaLabel, onClick }: { editing: boolean; ariaLabel: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.rowIconBtn} aria-label={ariaLabel} onClick={onClick}>
      {editing ? <CheckIcon /> : <PencilIcon />}
    </button>
  );
}
function TrashActionButton({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label={ariaLabel} onClick={onClick}>
      <TrashIcon />
    </button>
  );
}

/** Size a note textarea to fit its content (no inner scrollbar), so long notes
 *  show every line. Used as a ref callback (mount) and on each edit. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {locked ? <path d="M8 11V7a4 4 0 0 1 8 0v4" /> : <path d="M8 11V7a4 4 0 0 1 7.5-2" />}
    </svg>
  );
}

/** Interactive lock toggle (manage users). */
function LockActionButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.rowIconBtn} ${locked ? styles.rowIconBtnLocked : ""}`}
      aria-label={locked ? "Odemknout" : "Zamknout"}
      title={locked ? "Odemknout" : "Zamknout"}
      onClick={onClick}
    >
      <LockIcon locked={locked} />
    </button>
  );
}

function SignatureBlock({
  label,
  stamp,
  buttonLabel,
  onSign,
  signDisabled,
  canRevert,
  onRevert,
}: {
  label: string;
  stamp: Stamp | null;
  buttonLabel: string;
  onSign: () => void;
  signDisabled?: boolean;
  canRevert: boolean;
  onRevert: () => void;
}) {
  return (
    <div className={styles.signatureBlock}>
      <span className={styles.signatureLabel}>{label}</span>
      {stamp ? (
        <div className={styles.signatureStamp}>
          <strong className={styles.signatureName}>{stamp.displayName}</strong>
          <span className={styles.signatureTime}>{formatTimestamp(stamp.at)}</span>
          {canRevert && <TrashActionButton ariaLabel={`Odebrat podpis ${label}`} onClick={onRevert} />}
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={onSign} disabled={signDisabled}>
          {buttonLabel}
        </Button>
      )}
    </div>
  );
}

/** One of the three pinned Účty rows (sm / sm trezor / wata). The label is a
 *  button when the viewer may act on it, otherwise plain text; the value column
 *  mirrors the regular account rows so the grid lines up. */
function SpecialRow({
  label,
  value,
  clickable,
  onClick,
  title,
  dataTour,
}: {
  label: string;
  value: number;
  clickable: boolean;
  onClick: () => void;
  title?: string;
  /** Optional guided-tour anchor (data-tour) for spotlighting this row. */
  dataTour?: string;
}) {
  return (
    <div className={`${styles.accountRow} ${styles.specialRow}`} data-tour={dataTour}>
      {clickable ? (
        <button type="button" className={styles.specialName} onClick={onClick} title={title ?? "Upravit"}>
          {label}
        </button>
      ) : (
        <span className={styles.specialNameStatic}>{label}</span>
      )}
      <span className={styles.accountAmountRO}>{value.toLocaleString("cs-CZ")}</span>
      <span className={styles.accountSuffix}>Kč</span>
      <div className={styles.rowActions} />
    </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Outer tab: owns the toolbar (date + shift navigation) and mounts a FRESH,
// keyed ProtocolEditor per (hotel, date, shift) so no state can bleed across
// shift navigation.
// ─────────────────────────────────────────────────────────────────────────────
export default function HandoverTab({ hotel }: { hotel: Hotel }) {
  const [shiftDate, setShiftDate] = useState<string>(todayLocal());
  const [shiftType, setShiftType] = useState<ShiftType>(defaultShiftForNow());

  // A doc handed over from createNextShift so the target editor renders it
  // directly (avoids a read-after-write GET of the just-created next-shift doc).
  const [seeded, setSeeded] = useState<Handover | null>(null);

  function go(date: string, shift: ShiftType, doc: Handover | null = null) {
    setShiftDate(date);
    setShiftType(shift);
    setSeeded(doc);
  }

  const initialDoc =
    seeded && seeded.shiftDate === shiftDate && seeded.shiftType === shiftType ? seeded : null;

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft} />
        <div className={styles.toolbarCenter} data-tour="protokol-toolbar">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const p = previousShift(shiftDate, shiftType);
              go(p.date, p.shift);
            }}
            title="Předchozí směna"
          >
            ← Předchozí
          </Button>
          <span className={styles.toolbarLabel}>Datum</span>
          <input
            type="date"
            className={styles.dateInput}
            value={shiftDate}
            onChange={(e) => e.target.value && go(e.target.value, shiftType)}
          />
          <span className={styles.toolbarLabel}>Směna</span>
          <div className={styles.shiftGroup}>
            {(Object.keys(SHIFT_LABELS) as ShiftType[]).map((s) => (
              <button
                key={s}
                type="button"
                className={shiftType === s ? styles.shiftBtnActive : styles.shiftBtn}
                onClick={() => go(shiftDate, s)}
              >
                {SHIFT_LABELS[s]}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const n = nextShift(shiftDate, shiftType);
              go(n.date, n.shift);
            }}
            title="Následující směna"
          >
            Následující →
          </Button>
        </div>
        <div className={styles.toolbarRight} />
      </div>

      <ProtocolEditor
        key={`${hotel.slug}_${shiftDate}_${shiftType}`}
        hotel={hotel}
        shiftDate={shiftDate}
        shiftType={shiftType}
        initialDoc={initialDoc}
        onNavigate={go}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner editor for a single (hotel, date, shift). Keyed by the parent, so it
// mounts fresh whenever the shift changes: loads its doc once, shows the create
// button when none exists, and otherwise renders the three autosaving tables.
// ─────────────────────────────────────────────────────────────────────────────
function ProtocolEditor({
  hotel,
  shiftDate,
  shiftType,
  initialDoc,
  onNavigate,
}: {
  hotel: Hotel;
  shiftDate: string;
  shiftType: ShiftType;
  /** When set, render this doc directly instead of fetching (avoids a
   *  read-after-write GET of a just-created next-shift duplicate). */
  initialDoc: Handover | null;
  onNavigate: (date: string, shift: ShiftType, doc?: Handover | null) => void;
}) {
  const { can } = useAuth();
  const canCreate = can(hotel.protokolCreatePerm);
  const canDelete = can(hotel.protokolDeletePerm);
  const canManage = can(hotel.protokolManagePerm);
  const canManageSm = can("recepce.sm.manage");
  const isAdmin = can("system.admin");
  const docId = `${shiftDate}_${shiftType}`;

  const [loaded, setLoaded] = useState<Handover | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [cashCounts, setCashCounts] = useState<Record<DrawerKey, Record<string, number>>>(emptyCashCounts());
  const [accounts, setAccounts] = useState<Account[]>([]);
  // sm counts flow through autosave (content); smTrezor + wata mutate only via
  // their dedicated endpoints. Rates are global (settings/sm), fetched separately.
  const [smCounts, setSmCounts] = useState<[number, number, number]>([0, 0, 0]);
  const [smTrezor, setSmTrezor] = useState<number>(0);
  const [wata, setWata] = useState<number>(0);
  const [rates, setRates] = useState<[number, number, number]>([0, 0, 0]);
  // Which special row's modal is open (sm counts/rates, or wata ±).
  const [smModalOpen, setSmModalOpen] = useState(false);
  const [wataModalOpen, setWataModalOpen] = useState(false);
  const [smBusy, setSmBusy] = useState(false);
  const [smError, setSmError] = useState<string | null>(null);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null);

  const [autosaving, setAutosaving] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ── Change history + undo/redo ───────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);

  // ── Signatures ─────────────────────────────────────────────────────────────
  const [signers, setSigners] = useState<Signer[]>([]);
  // Narrower pool for reverting a signature: the signer + manage/admin holders.
  const [revokers, setRevokers] = useState<Signer[]>([]);
  // Default signer uids from the shift plan: this shift → Předal, next → Převzal.
  const [scheduled, setScheduled] = useState<{ predal: string | null; prevzal: string | null }>({
    predal: null,
    prevzal: null,
  });
  const [signAction, setSignAction] = useState<
    { slot: SignatureSlot; mode: "sign" | "revert"; stamp?: Stamp | null } | null
  >(null);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  // Whether the NEXT shift already has a protocol (hides the create-next button).
  const [nextExists, setNextExists] = useState(false);
  /**
   * Only meaningful in the empty state. `true` once we know the previous shift's
   * protocol exists AND is fully signed — that shift is supposed to hand this one
   * over ("Vytvořit protokol pro další směnu"), so creating a blank one here would
   * silently drop the cash, účty and open poznámky it should have carried across.
   * `null` while unknown; an unsigned or missing previous shift leaves it false so
   * the chain can never deadlock.
   */
  const [prevHandedOver, setPrevHandedOver] = useState<boolean | null>(null);
  // Set when another user has changed (or deleted) this doc since we loaded it and
  // we have unsaved edits: a non-destructive banner lets the user reload. `current`
  // is the server's version (null = it was deleted). While set, autosave is paused.
  const [externalChange, setExternalChange] = useState<{ current: Handover | null } | null>(null);

  const predal = loaded?.predal ?? null;
  const prevzal = loaded?.prevzal ?? null;
  // Freeze on ANY signature (Předal or Převzal). Two levels:
  //  • canEdit – content + sm/wata edits – keeps the admin override.
  //  • canStep – undo/redo – is frozen for EVERYONE, admin included.
  const signed = !!(predal || prevzal);
  const canEdit = !signed || isAdmin;
  const canStep = !signed;

  const savedPayloadRef = useRef<string>(JSON.stringify(toPayload([], emptyCashCounts(), [], [0, 0, 0])));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  // The input currently being typed into, if any (see beginEdit/endEdit). `key`
  // identifies the field so re-focusing the same one after a blur still mints a
  // new token; `id` is what the server matches on and must be unique per client,
  // since two tabs of the same user would otherwise collide.
  const editRef = useRef<{ key: string; id: string; closed: boolean } | null>(null);
  const editSeqRef = useRef(0);
  const clientIdRef = useRef(genId());
  // Latest values mirrored into refs so the change-detection poll can read them
  // without re-subscribing its interval/listeners on every keystroke.
  const loadedRef = useRef<Handover | null>(null);
  const dirtyRef = useRef(false);
  const externalRef = useRef<{ current: Handover | null } | null>(null);

  /** Seed local state + the saved-baseline from a loaded doc. */
  function applyDoc(data: Handover) {
    const n = coerceNotes(data.notes);
    const cc = {
      kasaCZK: data.cashCounts?.kasaCZK ?? {},
      trezorCZK: data.cashCounts?.trezorCZK ?? {},
      kasaEUR: data.cashCounts?.kasaEUR ?? {},
      trezorEUR: data.cashCounts?.trezorEUR ?? {},
    };
    const acc = coerceAccounts(data.accounts);
    const sc = triple(data.smCounts);
    setLoaded(data);
    setNotes(n);
    setCashCounts(cc);
    setAccounts(acc);
    setSmCounts(sc);
    setSmTrezor(typeof data.smTrezor === "number" ? data.smTrezor : 0);
    setWata(typeof data.wata === "number" ? data.wata : 0);
    savedPayloadRef.current = JSON.stringify(toPayload(n, cc, acc, sc));
  }

  // Load the doc once (component is keyed per shift, so mount == shift change).
  useEffect(() => {
    // Seeded from createNextShift → render it directly, skip the (racy) GET.
    if (initialDoc) {
      applyDoc(initialDoc);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await api.get<Handover>(`/handovers/${hotel.slug}/${docId}`);
        if (!cancelled) applyDoc(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoaded(null); // no record yet → empty state with create button
        } else {
          setLoadError(err instanceof Error ? err.message : "Nepodařilo se načíst protokol.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentPayload = useMemo(
    () => toPayload(notes, cashCounts, accounts, smCounts),
    [notes, cashCounts, accounts, smCounts]
  );
  const dirty = JSON.stringify(currentPayload) !== savedPayloadRef.current;

  // Mirror the live values the detection poll reads (see the poll effect below).
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    externalRef.current = externalChange;
  }, [externalChange]);

  // Load the signer pool for this shift's month (for the sign dropdown).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{
          signers: Signer[];
          scheduled: { predal: string | null; prevzal: string | null };
        }>(`/handovers/${hotel.slug}/signers?date=${encodeURIComponent(shiftDate)}&shift=${shiftType}`);
        if (!cancelled) {
          setSigners(res.signers);
          setScheduled(res.scheduled);
        }
      } catch {
        // non-fatal – the dropdown just shows no options / no defaults
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the global sm rates (shared across hotels) so the sm row can show its
  // CZK value. Read-only for most users; sm.manage edits them in the sm modal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ rates: number[] }>(`/handovers/sm/rates`);
        if (!cancelled) setRates(triple(res.rates));
      } catch {
        // non-fatal – sm value just shows against zero rates until this succeeds
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the protocol is closed, check whether the next shift already exists –
  // if so, the "create next shift" button is hidden.
  useEffect(() => {
    if (!prevzal) {
      setNextExists(false);
      return;
    }
    let cancelled = false;
    const next = nextShift(shiftDate, shiftType);
    void (async () => {
      try {
        await api.get<Handover>(`/handovers/${hotel.slug}/${next.date}_${next.shift}`);
        if (!cancelled) setNextExists(true);
      } catch (e) {
        if (!cancelled) setNextExists(!(e instanceof ApiError && e.status === 404));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevzal]);

  // Empty state only: does the previous shift already exist and stand signed off?
  // If it does, this protocol must be born from its "další směna" button so the
  // balances carry over — so the blank-create button is withheld here.
  useEffect(() => {
    if (loading || loaded) return;
    let cancelled = false;
    const prev = previousShift(shiftDate, shiftType);
    void (async () => {
      try {
        const doc = await api.get<Handover>(`/handovers/${hotel.slug}/${prev.date}_${prev.shift}`);
        if (!cancelled) setPrevHandedOver(!!(doc.predal && doc.prevzal));
      } catch {
        // 404 (no previous protocol) or a network error: allow the blank create.
        if (!cancelled) setPrevHandedOver(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loaded]);

  // Debounced autosave – active once a record exists and while it's not frozen.
  useEffect(() => {
    if (loading || !loaded) return;
    if (externalChange) return; // paused while an unresolved external-change banner is up
    if (!canEdit) return; // frozen after Předat
    if (!dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, cashCounts, accounts, smCounts, loading, loaded, dirty, canEdit, externalChange]);

  // ── Edit sessions (history coalescing) ─────────────────────────────────────
  // One token per focus-to-blur pass over one input. The server folds successive
  // autosaves carrying the same token into a single history entry, so typing a
  // poznámka leaves one entry rather than one per 800 ms pause — see
  // `tryCoalesce` in functions/src/services/handoverHistory.ts.
  //
  // A blurred session is marked `closed`, NOT dropped: if the flush below loses a
  // race with a save already in flight, the straggler autosave that follows must
  // still carry the token and fold, rather than opening a second entry. Only a
  // fresh focus mints a new token.
  function beginEdit(key: string) {
    const cur = editRef.current;
    if (cur && !cur.closed && cur.key === key) return;
    endEdit();
    editSeqRef.current += 1;
    editRef.current = { key, id: `${clientIdRef.current}-${editSeqRef.current}`, closed: false };
  }

  /** Seal the current session and push the final value out without waiting 800 ms. */
  function endEdit() {
    const sess = editRef.current;
    if (!sess || sess.closed) return;
    sess.closed = true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (dirtyRef.current && canEdit && !externalRef.current) void save();
  }

  async function save(): Promise<boolean> {
    if (isSavingRef.current) return false;
    isSavingRef.current = true;
    setAutosaving(true);
    const payload = toPayload(notes, cashCounts, accounts, smCounts);
    try {
      const saved = await api.put<Handover>(`/handovers/${hotel.slug}`, {
        shiftDate,
        shiftType,
        ...payload,
        // Optimistic-concurrency token: the version we currently hold. The server
        // rejects the save (409) if the stored doc has moved since, rather than
        // silently overwriting a colleague's edit.
        baseUpdatedAt: tsMillis(loaded?.updatedAt),
        editSession: editRef.current?.id ?? null,
      });
      setLoaded(saved);
      savedPayloadRef.current = JSON.stringify(payload);
      setAutosaveError(null);
      // A sealed session has now reached the server, stragglers included. Drop the
      // token so a later, unrelated single-change save can't inherit it and fold
      // into the entry this session produced. A failed save keeps it, to retry.
      if (editRef.current?.closed) editRef.current = null;
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Another user changed (or deleted) the doc since we loaded it. Don't
        // clobber — surface the server's version and let the user reload.
        const body = err.body as { current?: Handover | null } | undefined;
        setExternalChange({ current: body?.current ?? null });
        setAutosaveError(null);
        return false;
      }
      setAutosaveError(err instanceof Error ? err.message : "Chyba ukládání.");
      return false;
    } finally {
      isSavingRef.current = false;
      setAutosaving(false);
    }
  }

  /** Discard local edits and adopt the server's current version (conflict banner). */
  function reloadFromExternal() {
    const cur = externalChange?.current ?? null;
    if (cur) {
      applyDoc(cur);
    } else {
      // Deleted on the server → drop back to the empty state (create button).
      setLoaded(null);
      setNotes([]);
      setCashCounts(emptyCashCounts());
      setAccounts([]);
      setSmCounts([0, 0, 0]);
      setSmTrezor(0);
      setWata(0);
      savedPayloadRef.current = JSON.stringify(toPayload([], emptyCashCounts(), [], [0, 0, 0]));
    }
    setExternalChange(null);
    setAutosaveError(null);
  }

  // Detect another user's edits. The doc has no realtime channel (firestore.rules
  // block direct client reads, so an onSnapshot is impossible), so we poll while
  // the tab is visible + refetch on focus. If the stored doc has moved: reload
  // silently when we have no unsaved edits, else raise the non-destructive banner.
  // Reads live values via refs so the interval/listeners subscribe once per shift.
  useEffect(() => {
    async function check() {
      if (isSavingRef.current || externalRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (!loadedRef.current) return;
      try {
        const server = await api.get<Handover>(`/handovers/${hotel.slug}/${docId}`);
        const serverMs = tsMillis(server.updatedAt);
        const baseMs = tsMillis(loadedRef.current?.updatedAt);
        if (serverMs === null || baseMs === null || serverMs === baseMs) return;
        if (dirtyRef.current) setExternalChange({ current: server });
        else applyDoc(server);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          if (dirtyRef.current) setExternalChange({ current: null });
          else {
            setLoaded(null);
            setNotes([]);
            setCashCounts(emptyCashCounts());
            setAccounts([]);
            setSmCounts([0, 0, 0]);
            setSmTrezor(0);
            setWata(0);
            savedPayloadRef.current = JSON.stringify(toPayload([], emptyCashCounts(), [], [0, 0, 0]));
          }
        }
        // transient errors: ignore (next tick retries)
      }
    }
    const iv = setInterval(() => void check(), 15000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.slug, docId]);

  // Reload the change history whenever the doc is (re)saved – `loaded` gets a new
  // reference on every save/undo/redo, so this refreshes the panel + undo state.
  useEffect(() => {
    if (!loaded) {
      setHistory([]);
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ entries: HistoryEntry[]; canUndo: boolean; canRedo: boolean }>(
          `/handovers/${hotel.slug}/${docId}/history`
        );
        if (!cancelled) {
          setHistory(res.entries);
          setCanUndo(res.canUndo);
          setCanRedo(res.canRedo);
        }
      } catch {
        /* history is non-essential – a failed load must not break the editor */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, hotel.slug, docId]);

  /** Undo or redo one step on the server, then reseed local state from the result. */
  async function step(dir: "undo" | "redo") {
    if (stepBusy) return;
    setStepBusy(true);
    try {
      const saved = await api.post<Handover & { canUndo: boolean; canRedo: boolean }>(
        `/handovers/${hotel.slug}/${docId}/${dir}`,
        {}
      );
      applyDoc(saved);
      setCanUndo(saved.canUndo);
      setCanRedo(saved.canRedo);
    } catch (err) {
      setAutosaveError(err instanceof Error ? err.message : "Akci se nepodařilo provést.");
    } finally {
      setStepBusy(false);
    }
  }

  async function createEmpty() {
    setCreating(true);
    try {
      const saved = await api.put<Handover>(`/handovers/${hotel.slug}`, {
        shiftDate,
        shiftType,
        notes: [],
        cashCounts: emptyCashCounts(),
        accounts: [],
      });
      applyDoc(saved);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Protokol se nepodařilo vytvořit.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    } finally {
      setCreating(false);
    }
  }

  // ── Signatures (Předat / Převzít / Un-sign) ────────────────────────────────
  function signErrorMessage(err: unknown): string {
    if (err instanceof ApiError) return err.message || "Akce se nezdařila.";
    const code = (err as { code?: string })?.code;
    if (typeof code === "string" && code.startsWith("auth/")) return "Neplatné jméno nebo heslo.";
    if (err instanceof Error && err.message) return err.message;
    return "Ověření se nezdařilo.";
  }

  function openSign(slot: SignatureSlot) {
    setSignError(null);
    setSignAction({ slot, mode: "sign" });
  }
  async function openRevert(slot: SignatureSlot, stamp: Stamp) {
    setSignError(null);
    // Fallback (network error): at least let the signer self-unsign.
    const fallback: Signer = {
      uid: stamp.uid,
      name: (stamp.email || "").split("@")[0],
      email: stamp.email || "",
      label: stamp.displayName,
    };
    try {
      const list = await api.get<Signer[]>(
        `/handovers/${hotel.slug}/revokers?signer=${encodeURIComponent(stamp.uid)}`
      );
      setRevokers(list.length > 0 ? list : [fallback]);
    } catch {
      setRevokers([fallback]);
    }
    setSignAction({ slot, mode: "revert", stamp });
  }

  async function handleSignSubmit(signer: Signer, password: string) {
    if (!signAction) return;
    setSignBusy(true);
    setSignError(null);
    try {
      const cred = await verifyCredential(signer.email, password);
      const base = `/handovers/${hotel.slug}/${docId}/${signAction.slot}`;
      if (signAction.mode === "sign") {
        // Persist any pending edits BEFORE freezing the content. If that save hits
        // a conflict (409), the external-change banner is raised — abort the sign
        // rather than stamping over a version we no longer hold.
        if (dirty && !isSavingRef.current) {
          const ok = await save();
          if (!ok) {
            setSignBusy(false);
            return;
          }
        }
        const saved = await api.post<Handover>(base, { idToken: cred.idToken });
        applyDoc(saved);
      } else {
        const saved = await api.post<Handover>(`${base}/revert`, { idToken: cred.idToken });
        applyDoc(saved);
      }
      setSignAction(null);
    } catch (err) {
      setSignError(signErrorMessage(err));
    } finally {
      setSignBusy(false);
    }
  }

  /** After Převzít: create the next shift as an exact duplicate (cash/účty/notes,
   *  no signatures) unless it already exists, then navigate to it. */
  async function createNextShift() {
    const next = nextShift(shiftDate, shiftType);
    const nextId = `${next.date}_${next.shift}`;
    try {
      // If the next shift already has a protocol, just open it; otherwise create
      // the duplicate. Either way we carry the doc into the target editor so it
      // renders without a read-after-write GET.
      let doc: Handover | null = null;
      try {
        doc = await api.get<Handover>(`/handovers/${hotel.slug}/${nextId}`);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      if (!doc) {
        // Poznámky ticked off during this shift stay with it — the next shift
        // inherits only what is still outstanding, not a list of struck-through
        // leftovers. (The backend drops any that slip through on a create.)
        const outstanding = notes.filter((n) => !n.done);
        doc = await api.put<Handover>(`/handovers/${hotel.slug}`, {
          shiftDate: next.date,
          shiftType: next.shift,
          ...toPayload(outstanding, cashCounts, accounts, smCounts),
        });
      }
      onNavigate(next.date, next.shift, doc);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Další směnu se nepodařilo vytvořit.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  // ── sm / sm trezor / wata ──────────────────────────────────────────────────
  // Clickability: sm counts editable by any protocol-edit user; rates + transfer
  // + sm trezor by sm.manage; wata by the hotel's protokol.manage. All disabled
  // once frozen (canEdit is false for non-admins after Předat).
  const smClickable = canEdit && !!loaded;
  const smTrezorClickable = canEdit && canManageSm && !!loaded;
  const wataClickable = canEdit && canManage && !!loaded;
  // Hide a zero-valued balance row from users who can't manage it (declutter for
  // regular receptionists); managers always see their row, even at 0.
  const showSmTrezorRow = canManageSm || smTrezor !== 0;
  const showWataRow = canManage || wata !== 0;

  function openSmModal() {
    if (!smClickable) return;
    setSmError(null);
    setSmModalOpen(true);
  }
  function openWataModal() {
    if (!wataClickable) return;
    setSmError(null);
    setWataModalOpen(true);
  }

  /** Save sm counts (always) + global rates (only when sm.manage changed them). */
  async function saveSm(counts: [number, number, number], newRates: [number, number, number] | null) {
    setSmBusy(true);
    setSmError(null);
    try {
      if (newRates) {
        const res = await api.put<{ rates: number[] }>(`/handovers/sm/rates`, { rates: newRates });
        setRates(triple(res.rates));
      }
      setSmCounts(counts); // triggers autosave of the content PUT
      setSmModalOpen(false);
    } catch (err) {
      setSmError(err instanceof Error ? err.message : "Uložení se nezdařilo.");
    } finally {
      setSmBusy(false);
    }
  }

  /** MOVE a portion of the sm counts into sm trezor (sm.manage only). */
  async function transferSm(transfer: [number, number, number]) {
    setSmBusy(true);
    setSmError(null);
    try {
      const saved = await api.post<Handover>(`/handovers/${hotel.slug}/${docId}/sm-transfer`, { transfer });
      applyDoc(saved);
      setSmModalOpen(false);
    } catch (err) {
      setSmError(err instanceof Error ? err.message : "Přesun se nezdařil.");
    } finally {
      setSmBusy(false);
    }
  }

  function requestClearSmTrezor() {
    if (!smTrezorClickable) return;
    setConfirm({
      title: "Vynulovat sm trezor?",
      message: `Aktuální hodnota sm trezor (${smTrezor.toLocaleString("cs-CZ")} Kč) bude nastavena na nulu. Pokračovat?`,
      danger: true,
      confirmLabel: "Vynulovat",
      onConfirm: () => void clearSmTrezor(),
    });
  }
  async function clearSmTrezor() {
    try {
      const saved = await api.post<Handover>(`/handovers/${hotel.slug}/${docId}/sm-trezor/clear`, {});
      applyDoc(saved);
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Vynulování se nezdařilo.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  /** Add (delta>0) or subtract (delta<0) from wata (protokol.manage only). */
  async function applyWata(delta: number) {
    setSmBusy(true);
    setSmError(null);
    try {
      const saved = await api.post<Handover>(`/handovers/${hotel.slug}/${docId}/wata`, { delta });
      applyDoc(saved);
      setWataModalOpen(false);
    } catch (err) {
      setSmError(err instanceof Error ? err.message : "Úprava se nezdařila.");
    } finally {
      setSmBusy(false);
    }
  }

  // ── Cash ─────────────────────────────────────────────────────────────────
  function setDenomCount(drawer: DrawerKey, denom: string, n: number) {
    setCashCounts((prev) => {
      const next = { ...prev[drawer] };
      if (!Number.isFinite(n) || n <= 0) delete next[denom];
      else next[denom] = Math.floor(n);
      return { ...prev, [drawer]: next };
    });
  }
  const drawerTotals = useMemo(
    () => ({
      kasaCZK: drawerSubtotal(cashCounts.kasaCZK),
      trezorCZK: drawerSubtotal(cashCounts.trezorCZK),
      kasaEUR: drawerSubtotal(cashCounts.kasaEUR),
      trezorEUR: drawerSubtotal(cashCounts.trezorEUR),
    }),
    [cashCounts]
  );
  const regularAccountsTotal = useMemo(() => accounts.reduce((s, a) => s + (a.amount || 0), 0), [accounts]);
  // sm row value = Σ rateᵢ·countᵢ. The Účty total folds in sm + sm trezor + wata
  // (wata may be negative), so ÚČTY / CELKEM / TOTAL CZK all include the three.
  const smAmount = useMemo(() => smDot(rates, smCounts), [rates, smCounts]);
  const accountsTotal = regularAccountsTotal + smAmount + smTrezor + wata;
  const totalCZK = drawerTotals.kasaCZK + drawerTotals.trezorCZK + accountsTotal;
  const totalEUR = drawerTotals.kasaEUR + drawerTotals.trezorEUR;

  // ── Účty ─────────────────────────────────────────────────────────────────
  function addAccountRow() {
    setAccounts((prev) => [...prev, { id: genId(), name: "", amount: 0, locked: false }]);
    setEditingIdx(accounts.length);
  }
  function setAccountName(idx: number, name: string) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, name } : a)));
  }
  function setAccountAmount(idx: number, amount: number) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, amount: Number.isFinite(amount) ? amount : 0 } : a)));
  }
  function setAccountLocked(idx: number, locked: boolean) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, locked } : a)));
  }
  function removeAccount(idx: number) {
    setAccounts((prev) => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }
  function requestDeleteAccount(idx: number) {
    const acc = accounts[idx];
    if (!acc || (acc.name.trim() === "" && !acc.amount)) {
      removeAccount(idx);
      return;
    }
    setConfirm({
      title: "Odstranit účet?",
      message: `Opravdu chcete odstranit účet „${acc.name || "(bez názvu)"}"?`,
      danger: true,
      onConfirm: () => {
        removeAccount(idx);
        setConfirm(null);
      },
    });
  }

  // ── Poznámky ─────────────────────────────────────────────────────────────
  function addNote() {
    setNotes((prev) => [...prev, { id: genId(), text: "", done: false, locked: false }]);
    setEditingNoteIdx(notes.length);
  }
  function setNoteText(idx: number, text: string) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, text } : n)));
  }
  function setNoteDone(idx: number, done: boolean) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, done } : n)));
  }
  function setNoteLocked(idx: number, locked: boolean) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, locked } : n)));
  }
  function removeNote(idx: number) {
    setNotes((prev) => prev.filter((_, i) => i !== idx));
    setEditingNoteIdx(null);
  }
  function requestDeleteNote(idx: number) {
    const n = notes[idx];
    if (!n || n.text.trim() === "") {
      removeNote(idx);
      return;
    }
    setConfirm({
      title: "Odstranit poznámku?",
      message: "Opravdu chcete odstranit tuto poznámku?",
      danger: true,
      onConfirm: () => {
        removeNote(idx);
        setConfirm(null);
      },
    });
  }

  // ── Delete whole protocol ────────────────────────────────────────────────
  function requestDeleteProtocol() {
    setConfirm({
      title: "Smazat protokol?",
      message: "Opravdu chcete smazat celý předávací protokol pro tuto směnu? Tuto akci nelze vrátit.",
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void deleteProtocol(),
    });
  }
  async function deleteProtocol() {
    try {
      await api.delete<{ ok: true }>(`/handovers/${hotel.slug}/${docId}`);
      // Back to the empty state (create button).
      setLoaded(null);
      setNotes([]);
      setCashCounts(emptyCashCounts());
      setAccounts([]);
      setSmCounts([0, 0, 0]);
      setSmTrezor(0);
      setWata(0);
      savedPayloadRef.current = JSON.stringify(toPayload([], emptyCashCounts(), [], [0, 0, 0]));
      setAutosaveError(null);
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Protokol se nepodařilo smazat.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  const statusText = autosaveError
    ? autosaveError
    : autosaving
      ? "Ukládám…"
      : dirty
        ? "Neuloženo"
        : loaded
          ? `Uloženo ${formatTimeOnly(loaded.updatedAt)}`
          : "";

  const confirmModal = confirm && (
    <ConfirmModal
      title={confirm.title}
      message={confirm.message}
      danger={confirm.danger}
      showCancel={confirm.showCancel}
      confirmLabel={confirm.confirmLabel}
      onConfirm={confirm.onConfirm}
      onCancel={() => setConfirm(null)}
    />
  );

  if (loading) {
    return <div className={styles.placeholder}>Načítám…</div>;
  }

  if (loadError) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Chyba</p>
        <p className={styles.placeholderHint}>{loadError}</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <>
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>Pro tuto směnu zatím není žádný záznam</p>
          {!canCreate ? (
            <p className={styles.placeholderHint}>Nemáte oprávnění vytvořit nový protokol.</p>
          ) : prevHandedOver === null ? null : prevHandedOver ? (
            <p className={styles.placeholderHint}>
              Předchozí směna je podepsaná. Otevřete její protokol a použijte tlačítko „Vytvořit protokol pro další
              směnu“ – tím se převede hotovost, účty i nedokončené poznámky.
            </p>
          ) : (
            <>
              <p className={styles.placeholderHint}>Vytvořte prázdný předávací protokol a začněte vyplňovat.</p>
              <Button onClick={createEmpty} disabled={creating} data-tour="protokol-create">
                {creating ? "Vytvářím…" : "Vytvořit prázdný protokol"}
              </Button>
            </>
          )}
        </div>
        {confirmModal}
      </>
    );
  }

  return (
    <>
      <div className={styles.editorHeader}>
        <span className={autosaveError ? `${styles.metaText} ${styles.metaError}` : styles.metaText}>{statusText}</span>
        <div className={styles.editorHeaderActions}>
          {/* Tight tour anchor: undo/redo + Historie only, so the spotlight isn't
              thrown off-centre by the admin-only Tisk / Smazat buttons beside them. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }} data-tour="protokol-history">
          {canStep && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void step("undo")}
                disabled={!canUndo || stepBusy || dirty || autosaving}
                title="Vrátit poslední změnu"
              >
                ↶ Zpět
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void step("redo")}
                disabled={!canRedo || stepBusy || dirty || autosaving}
                title="Znovu provést vrácenou změnu"
              >
                ↷ Vpřed
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen((o) => !o)}>
            Historie{history.length ? ` (${history.length})` : ""}
          </Button>
          </div>
          {predal && prevzal && (
            <Button variant="secondary" size="sm" onClick={() => window.print()} data-tour="protokol-print">
              Tisk
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" size="sm" onClick={requestDeleteProtocol}>
              Smazat protokol
            </Button>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className={styles.frozenNotice}>Protokol je podepsán a uzamčen – obsah nelze upravit.</div>
      )}
      {canEdit && signed && (
        <div className={styles.frozenNotice}>
          Protokol je podepsán – obsah může upravit pouze administrátor, krok zpět/vpřed je uzamčen.
        </div>
      )}
      {externalChange && (
        <div className={styles.frozenNotice}>
          {externalChange.current === null
            ? "Tento protokol byl mezitím smazán jiným uživatelem. Vaše neuložené změny nebyly uloženy."
            : "Tento protokol byl mezitím upraven jiným uživatelem. Vaše neuložené změny nebyly uloženy."}{" "}
          <Button variant="secondary" size="sm" onClick={reloadFromExternal}>
            {externalChange.current === null ? "Zavřít" : "Načíst aktuální verzi"}
          </Button>
        </div>
      )}

      {historyOpen && (
        <div className={styles.historyPanel}>
          <div className={styles.historyPanelHead}>Historie změn</div>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>Zatím žádné zaznamenané změny.</p>
          ) : (
            <ul className={styles.historyList}>
              {history.map((h) => (
                <li key={h.seq} className={h.undone ? styles.historyUndone : undefined}>
                  <span className={styles.historyLabel}>{h.label}</span>
                  <span className={styles.historyMeta}>
                    {h.by} · {stampDateTime(h.at)}
                    {h.undone ? " · vráceno" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.protocolGrid}>
        <div className={styles.cashLayout} data-tour="protokol-cash">
          {DRAWER_ORDER.map((drawer) => {
            const denoms = isCzkDrawer(drawer) ? CZK_DENOMS : EUR_DENOMS;
            const symbol = isCzkDrawer(drawer) ? "Kč" : "€";
            return (
              <div key={drawer} className={`${styles.cashTable} ${styles[drawer]}`}>
                <div className={styles.cashTableHead}>{DRAWER_LABELS[drawer]}</div>
                <div className={styles.cashRowHeader}>
                  <span>Nominál</span>
                  <span>KS</span>
                  <span>Mezisoučet</span>
                </div>
                {denoms.map((d, i) => {
                  const ks = cashCounts[drawer][d] ?? 0;
                  const subtotal = Number(d) * ks;
                  return (
                    <div key={d} className={`${styles.cashRow} ${i % 2 === 1 ? styles.cashRowAlt : ""}`}>
                      <span className={styles.denom}>
                        {d} {symbol}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className={styles.cashInput}
                        value={ks === 0 ? "" : ks}
                        onChange={(e) => setDenomCount(drawer, d, Number(e.target.value))}
                        onFocus={() => beginEdit(`cash:${drawer}:${d}`)}
                        onBlur={endEdit}
                        placeholder="0"
                        disabled={!canEdit}
                      />
                      <span className={styles.subtotal}>
                        {subtotal.toLocaleString("cs-CZ")} {symbol}
                      </span>
                    </div>
                  );
                })}
                <div className={styles.cashTotal}>
                  CELKEM&nbsp;{drawerTotals[drawer].toLocaleString("cs-CZ")} {symbol}
                </div>
              </div>
            );
          })}

          <div className={styles.summary}>
            <div className={styles.summaryGroup}>
              <div className={styles.summaryRow}>
                <span>KASA</span>
                <strong>{drawerTotals.kasaCZK.toLocaleString("cs-CZ")} Kč</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>TREZOR</span>
                <strong>{drawerTotals.trezorCZK.toLocaleString("cs-CZ")} Kč</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>ÚČTY</span>
                <strong>{accountsTotal.toLocaleString("cs-CZ")} Kč</strong>
              </div>
              <div className={styles.summaryRowTotal}>
                <span>TOTAL CZK</span>
                <strong>{totalCZK.toLocaleString("cs-CZ")} Kč</strong>
              </div>
            </div>
            <div className={styles.summaryGroup}>
              <div className={styles.summaryRow}>
                <span>KASA €</span>
                <strong>{drawerTotals.kasaEUR.toLocaleString("cs-CZ")} €</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>TREZOR €</span>
                <strong>{drawerTotals.trezorEUR.toLocaleString("cs-CZ")} €</strong>
              </div>
              {/* Spacer so TOTAL € lines up with TOTAL CZK (which has an extra ÚČTY row). */}
              <div className={styles.summaryRow} aria-hidden="true">
                <span>&nbsp;</span>
                <strong>&nbsp;</strong>
              </div>
              <div className={styles.summaryRowTotal}>
                <span>TOTAL €</span>
                <strong>{totalEUR.toLocaleString("cs-CZ")} €</strong>
              </div>
            </div>
          </div>

          <div className={styles.accountsContainer} data-tour="protokol-ucty">
            <div className={styles.accountsContainerHeader}>
              <h3 className={styles.accountsTitle}>Účty</h3>
              {canEdit && (
                <Button variant="primary" size="sm" onClick={addAccountRow}>
                  + Přidat účet
                </Button>
              )}
            </div>
            <div className={styles.accountsList}>
              {/* Three special rows pinned to the top, above a separator. */}
              <SpecialRow
                label="sm"
                value={smAmount}
                clickable={smClickable}
                onClick={openSmModal}
                title="Upravit sm"
                dataTour="protokol-sm"
              />
              {showSmTrezorRow && (
                <SpecialRow
                  label="sm trezor"
                  value={smTrezor}
                  clickable={smTrezorClickable}
                  onClick={requestClearSmTrezor}
                  title="Vynulovat sm trezor"
                />
              )}
              {showWataRow && (
                <SpecialRow
                  label="wata"
                  value={wata}
                  clickable={wataClickable}
                  onClick={openWataModal}
                  title="Přičíst / odečíst wata"
                />
              )}
              <div className={styles.accountSeparator} />
              {accounts.length === 0 && <div className={styles.accountsEmpty}>Žádné účty.</div>}
              {/* Locked accounts float to the top (manage-locked = pinned), the
                  same as Poznámky. Display-only order: handlers keep the account's
                  original array index, so persistence and edit state are untouched. */}
              {accounts
                .map((acc, idx) => ({ acc, idx }))
                .sort((a, b) => Number(b.acc.locked) - Number(a.acc.locked))
                .map(({ acc, idx }, pos, sorted) => {
                const isEditing = editingIdx === idx;
                const altRow = pos % 2 === 1;
                const rowEditable = canEdit && (!acc.locked || canManage);
                // First unlocked account after a locked one: divider between groups.
                const isGroupBoundary = !acc.locked && pos > 0 && sorted[pos - 1].acc.locked;
                return (
                  <Fragment key={acc.id ?? idx}>
                    {isGroupBoundary && <div className={styles.accountSeparator} />}
                    <div className={`${styles.accountRow} ${altRow ? styles.accountRowAlt : ""}`}>
                      {isEditing ? (
                        <input
                          type="text"
                          className={styles.accountName}
                          value={acc.name}
                          onChange={(e) => setAccountName(idx, e.target.value)}
                          onFocus={() => beginEdit(`acct:${acc.id}:name`)}
                          onBlur={endEdit}
                          placeholder="Název (např. Květiny)"
                          autoFocus
                        />
                      ) : (
                        <span className={styles.accountNameRO}>
                          {acc.name || <em className={styles.accountNameEmpty}>(bez názvu)</em>}
                        </span>
                      )}
                      {isEditing ? (
                        <input
                          type="number"
                          step={1}
                          className={styles.accountAmount}
                          value={acc.amount === 0 ? "" : acc.amount}
                          onChange={(e) => setAccountAmount(idx, Number(e.target.value))}
                          onFocus={() => beginEdit(`acct:${acc.id}:amount`)}
                          onBlur={endEdit}
                          placeholder="0"
                        />
                      ) : (
                        <span className={styles.accountAmountRO}>{acc.amount.toLocaleString("cs-CZ")}</span>
                      )}
                      <span className={styles.accountSuffix}>Kč</span>
                      <div className={styles.rowActions}>
                        {rowEditable && (
                          <EditActionButton
                            editing={isEditing}
                            ariaLabel={isEditing ? "Hotovo" : "Upravit"}
                            onClick={() => setEditingIdx(isEditing ? null : idx)}
                          />
                        )}
                        {rowEditable && (
                          <TrashActionButton
                            ariaLabel={`Odstranit účet ${acc.name || "(bez názvu)"}`}
                            onClick={() => requestDeleteAccount(idx)}
                          />
                        )}
                        {canManage && canEdit && (
                          <LockActionButton locked={acc.locked} onClick={() => setAccountLocked(idx, !acc.locked)} />
                        )}
                        {acc.locked && !canManage && (
                          <span className={styles.rowLockedIndicator} title="Uzamčeno">
                            <LockIcon locked />
                          </span>
                        )}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <div className={`${styles.accountRow} ${styles.accountTotalRow}`}>
              <span className={styles.accountNameRO}>CELKEM</span>
              <span className={styles.accountAmountRO}>{accountsTotal.toLocaleString("cs-CZ")}</span>
              <span className={styles.accountSuffix}>Kč</span>
              <div className={styles.rowActions} />
            </div>
          </div>
        </div>

        <div className={styles.protocolRight}>
          <div className={styles.notesContainer} data-tour="protokol-notes">
            <div className={styles.notesContainerHeader}>
              <h3 className={styles.accountsTitle}>Poznámky</h3>
              {canEdit && (
                <Button variant="primary" size="sm" onClick={addNote}>
                  + Přidat poznámku
                </Button>
              )}
            </div>
            <div className={styles.notesList}>
              {notes.length === 0 && <div className={styles.accountsEmpty}>Žádné poznámky.</div>}
              {/* Locked notes float to the top (manage-locked = pinned/important).
                  This is a DISPLAY-only order: handlers keep the note's original
                  array index, so persistence order and edit state are untouched. */}
              {notes
                .map((n, idx) => ({ n, idx }))
                .sort((a, b) => Number(b.n.locked) - Number(a.n.locked))
                .map(({ n, idx }, pos, sorted) => {
                  const isEditingNote = editingNoteIdx === idx;
                  const rowEditable = canEdit && (!n.locked || canManage);
                  // First unlocked note that follows a locked one: render a
                  // divider (same as the Účty special-row separator) so pinned
                  // notes are visually split from the rest.
                  const isGroupBoundary = !n.locked && pos > 0 && sorted[pos - 1].n.locked;
                  return (
                    <Fragment key={n.id ?? idx}>
                      {isGroupBoundary && <div className={styles.accountSeparator} />}
                      <div className={`${styles.noteRow} ${pos % 2 === 1 ? styles.noteRowAlt : ""}`}>
                      <input
                        type="checkbox"
                        className={styles.noteCheck}
                        checked={n.done}
                        onChange={(e) => setNoteDone(idx, e.target.checked)}
                        disabled={!rowEditable}
                        aria-label={n.done ? "Označit jako nevyřízené" : "Označit jako vyřízené"}
                      />
                      {isEditingNote ? (
                        <textarea
                          ref={autoGrow}
                          className={n.done ? `${styles.noteText} ${styles.noteTextDone}` : styles.noteText}
                          value={n.text}
                          onChange={(e) => {
                            setNoteText(idx, e.target.value);
                            autoGrow(e.currentTarget);
                          }}
                          onFocus={() => beginEdit(`note:${n.id}:text`)}
                          onBlur={endEdit}
                          placeholder="Poznámka…"
                          rows={1}
                          autoFocus
                        />
                      ) : (
                        <span className={n.done ? `${styles.noteTextRO} ${styles.noteTextDone}` : styles.noteTextRO}>
                          {n.text || <em className={styles.accountNameEmpty}>(prázdná poznámka)</em>}
                        </span>
                      )}
                      <div className={styles.rowActions}>
                        {rowEditable && (
                          <EditActionButton
                            editing={isEditingNote}
                            ariaLabel={isEditingNote ? "Hotovo" : "Upravit"}
                            onClick={() => setEditingNoteIdx(isEditingNote ? null : idx)}
                          />
                        )}
                        {rowEditable && (
                          <TrashActionButton ariaLabel="Odstranit poznámku" onClick={() => requestDeleteNote(idx)} />
                        )}
                        {canManage && canEdit && (
                          <LockActionButton locked={n.locked} onClick={() => setNoteLocked(idx, !n.locked)} />
                        )}
                        {n.locked && !canManage && (
                          <span className={styles.rowLockedIndicator} title="Uzamčeno">
                            <LockIcon locked />
                          </span>
                        )}
                      </div>
                    </div>
                    </Fragment>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.signaturesRow} data-tour="protokol-signatures">
        <SignatureBlock
          label="Předal"
          stamp={predal}
          buttonLabel="Předat"
          onSign={() => openSign("predal")}
          signDisabled={signers.length === 0}
          canRevert={!!predal && !prevzal}
          onRevert={() => predal && openRevert("predal", predal)}
        />
        <SignatureBlock
          label="Převzal"
          stamp={prevzal}
          buttonLabel="Převzít"
          onSign={() => openSign("prevzal")}
          signDisabled={!predal || signers.length === 0}
          canRevert={!!prevzal}
          onRevert={() => prevzal && openRevert("prevzal", prevzal)}
        />
        {prevzal && !nextExists && (
          <Button variant="primary" size="sm" onClick={createNextShift} data-tour="protokol-nextshift">
            Vytvořit protokol pro další směnu
          </Button>
        )}
      </div>

      {/* Print-only layout (B&W, one A4) – visible only via window.print(). */}
      <div className={styles.printArea}>
        <div className={styles.printHeader}>
          Předávací protokol – {hotel.label} – {new Date(`${shiftDate}T00:00:00`).toLocaleDateString("cs-CZ")}{" "}
          – {shiftType === "den" ? "Denní" : "Noční"} směna
        </div>
        <div className={styles.printBody}>
          {DRAWER_ORDER.map((drawer) => {
            const denoms = isCzkDrawer(drawer) ? CZK_DENOMS : EUR_DENOMS;
            const symbol = isCzkDrawer(drawer) ? "Kč" : "€";
            return (
              <table key={drawer} className={`${styles.printTable} ${PRINT_AREA_CLASS[drawer]}`}>
                <caption>{DRAWER_LABELS[drawer]}</caption>
                <thead>
                  <tr>
                    <th>Nominál</th>
                    <th>KS</th>
                    <th>Mezisoučet</th>
                  </tr>
                </thead>
                <tbody>
                  {denoms.map((d) => {
                    const ks = cashCounts[drawer][d] ?? 0;
                    return (
                      <tr key={d}>
                        <td>{d}</td>
                        <td>{ks || ""}</td>
                        <td>{(Number(d) * ks).toLocaleString("cs-CZ")}</td>
                      </tr>
                    );
                  })}
                  <tr className={styles.printTotalRow}>
                    <td colSpan={2}>CELKEM</td>
                    <td>
                      {drawerTotals[drawer].toLocaleString("cs-CZ")} {symbol}
                    </td>
                  </tr>
                </tbody>
              </table>
            );
          })}

          {/* Souhrn – same two-group (CZK | EUR) layout as the on-screen summary. */}
          <div className={`${styles.pSummary} ${styles.printSummary}`}>
            <div className={styles.printSummaryGroup}>
              <div className={styles.printSummaryRow}>
                <span>KASA</span>
                <span>{drawerTotals.kasaCZK.toLocaleString("cs-CZ")} Kč</span>
              </div>
              <div className={styles.printSummaryRow}>
                <span>TREZOR</span>
                <span>{drawerTotals.trezorCZK.toLocaleString("cs-CZ")} Kč</span>
              </div>
              <div className={styles.printSummaryRow}>
                <span>ÚČTY</span>
                <span>{accountsTotal.toLocaleString("cs-CZ")} Kč</span>
              </div>
              <div className={styles.printSummaryTotal}>
                <span>TOTAL CZK</span>
                <span>{totalCZK.toLocaleString("cs-CZ")} Kč</span>
              </div>
            </div>
            <div className={styles.printSummaryGroup}>
              <div className={styles.printSummaryRow}>
                <span>KASA €</span>
                <span>{drawerTotals.kasaEUR.toLocaleString("cs-CZ")} €</span>
              </div>
              <div className={styles.printSummaryRow}>
                <span>TREZOR €</span>
                <span>{drawerTotals.trezorEUR.toLocaleString("cs-CZ")} €</span>
              </div>
              {/* Spacer so TOTAL € lines up with TOTAL CZK (extra ÚČTY row). */}
              <div className={styles.printSummaryRow} aria-hidden="true">
                <span>&nbsp;</span>
                <span>&nbsp;</span>
              </div>
              <div className={styles.printSummaryTotal}>
                <span>TOTAL €</span>
                <span>{totalEUR.toLocaleString("cs-CZ")} €</span>
              </div>
            </div>
          </div>

          {/* Účty – flex column so CELKEM pins to the bottom of the (tall) section. */}
          <div className={`${styles.pAccounts} ${styles.printAccounts}`}>
            <div className={styles.printAccountsTitle}>Účty</div>
            <div className={styles.printAccountsList}>
              <div className={styles.printAccountRow}>
                <span className={styles.printAccName}>sm</span>
                <span>{smAmount.toLocaleString("cs-CZ")} Kč</span>
              </div>
              {showSmTrezorRow && (
                <div className={styles.printAccountRow}>
                  <span className={styles.printAccName}>sm trezor</span>
                  <span>{smTrezor.toLocaleString("cs-CZ")} Kč</span>
                </div>
              )}
              {showWataRow && (
                <div className={styles.printAccountRow}>
                  <span className={styles.printAccName}>wata</span>
                  <span>{wata.toLocaleString("cs-CZ")} Kč</span>
                </div>
              )}
              {accounts
                .filter((a) => a.name.trim() !== "")
                .map((a, i) => (
                  <div key={i} className={styles.printAccountRow}>
                    <span className={styles.printAccName}>{a.name}</span>
                    <span>{a.amount.toLocaleString("cs-CZ")} Kč</span>
                  </div>
                ))}
            </div>
            <div className={styles.printAccountsTotal}>
              <span className={styles.printAccName}>CELKEM</span>
              <span>{accountsTotal.toLocaleString("cs-CZ")} Kč</span>
            </div>
          </div>
        </div>
        <div className={styles.printSignatures}>
          <div>
            <strong>Předal:</strong> {predal?.displayName ?? ""} – {formatTimestamp(predal?.at)}
          </div>
          <div>
            <strong>Převzal:</strong> {prevzal?.displayName ?? ""} – {formatTimestamp(prevzal?.at)}
          </div>
        </div>
      </div>

      {signAction && (
        <SignModal
          title={
            signAction.mode === "sign"
              ? signAction.slot === "predal"
                ? "Předat směnu"
                : "Převzít směnu"
              : "Odebrat podpis"
          }
          subtitle={
            signAction.mode === "revert" && signAction.stamp
              ? `${signAction.slot === "predal" ? "Předal" : "Převzal"}: ${signAction.stamp.displayName}`
              : signAction.slot === "predal"
                ? "Zadejte jméno a heslo předávajícího."
                : "Zadejte jméno a heslo přebírajícího."
          }
          confirmLabel={signAction.mode === "sign" ? "Podepsat" : "Odebrat podpis"}
          signers={signAction.mode === "revert" ? revokers : signers}
          defaultSignerUid={
            signAction.mode === "revert"
              ? signAction.stamp?.uid
              : (signAction.slot === "predal" ? scheduled.predal : scheduled.prevzal) ?? undefined
          }
          busy={signBusy}
          errorText={signError}
          onSubmit={handleSignSubmit}
          onCancel={() => {
            setSignAction(null);
            setSignError(null);
          }}
        />
      )}

      {smModalOpen && loaded && (
        <SmModal
          rates={rates}
          counts={smCounts}
          smTrezor={smTrezor}
          canManageSm={canManageSm}
          canEditCounts={canEdit}
          contentDirty={dirty}
          busy={smBusy}
          errorText={smError}
          onSave={saveSm}
          onTransfer={transferSm}
          onCancel={() => {
            setSmModalOpen(false);
            setSmError(null);
          }}
        />
      )}

      {wataModalOpen && loaded && (
        <WataModal
          current={wata}
          busy={smBusy}
          errorText={smError}
          onApply={applyWata}
          onCancel={() => {
            setWataModalOpen(false);
            setSmError(null);
          }}
        />
      )}

      {confirmModal}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// sm modal – edit the three counts (any edit user), the three GLOBAL rates
// (sm.manage only), and optionally MOVE part of the counts into sm trezor
// (sm.manage only). The transfer panel is disabled while there are unsaved count
// edits so it always operates on the server's current counts.
// ─────────────────────────────────────────────────────────────────────────────
function SmModal({
  rates,
  counts,
  smTrezor,
  canManageSm,
  canEditCounts,
  contentDirty,
  busy,
  errorText,
  onSave,
  onTransfer,
  onCancel,
}: {
  rates: [number, number, number];
  counts: [number, number, number];
  smTrezor: number;
  canManageSm: boolean;
  canEditCounts: boolean;
  contentDirty: boolean;
  busy: boolean;
  errorText: string | null;
  onSave: (counts: [number, number, number], rates: [number, number, number] | null) => void;
  onTransfer: (transfer: [number, number, number]) => void;
  onCancel: () => void;
}) {
  const [draftRates, setDraftRates] = useState<[number, number, number]>(rates);
  const [draftCounts, setDraftCounts] = useState<[number, number, number]>(counts);
  const [transfer, setTransfer] = useState<[number, number, number]>([0, 0, 0]);
  // Which rate badge is being inline-edited (manage users click a badge to edit).
  const [editingRate, setEditingRate] = useState<number | null>(null);

  const idxs = [0, 1, 2] as const;
  const setAt = (
    setter: Dispatch<SetStateAction<[number, number, number]>>,
    i: number,
    v: number
  ) => setter((prev) => prev.map((x, j) => (j === i ? (Number.isFinite(v) && v >= 0 ? v : 0) : x)) as [number, number, number]);

  const product = smDot(draftRates, draftCounts);
  const ratesChanged = canManageSm && idxs.some((i) => draftRates[i] !== rates[i]);
  const countsDirty = idxs.some((i) => draftCounts[i] !== counts[i]);
  // Transfer clamps to the SAVED counts and needs the server in sync.
  const clampedTransfer = idxs.map((i) => Math.min(transfer[i], counts[i])) as unknown as [number, number, number];
  const movedCzk = smDot(rates, clampedTransfer);
  const transferSyncBlocked = contentDirty || countsDirty || ratesChanged;
  const transferEmpty = idxs.every((i) => clampedTransfer[i] <= 0);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.smModal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>sm</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          {canManageSm && <p className={styles.modalHint}>Hodnoty jsou společné pro všechny hotely.</p>}
          {/* Per column: rate badge on top (click-to-edit for manage), count field below. */}
          <div className={styles.smGrid}>
            {idxs.map((i) => (
              <div key={`r${i}`} className={styles.smCell}>
                {canManageSm && editingRate === i ? (
                  <input
                    type="number"
                    step="any"
                    min={0}
                    className={styles.smInput}
                    value={draftRates[i] === 0 ? "" : draftRates[i]}
                    onChange={(e) => setAt(setDraftRates, i, Number(e.target.value))}
                    onBlur={() => setEditingRate(null)}
                    placeholder="0"
                    autoFocus
                    disabled={busy}
                  />
                ) : canManageSm ? (
                  <button
                    type="button"
                    className={`${styles.smRate} ${styles.smRateEditable}`}
                    onClick={() => setEditingRate(i)}
                    title="Upravit"
                    disabled={busy}
                  >
                    {draftRates[i].toLocaleString("cs-CZ")}
                  </button>
                ) : (
                  <span className={styles.smRate}>{rates[i].toLocaleString("cs-CZ")}</span>
                )}
              </div>
            ))}
            {idxs.map((i) => (
              <div key={`c${i}`} className={styles.smCell}>
                <input
                  type="number"
                  step="any"
                  min={0}
                  className={styles.smInput}
                  value={draftCounts[i] === 0 ? "" : draftCounts[i]}
                  onChange={(e) => setAt(setDraftCounts, i, Number(e.target.value))}
                  placeholder="0"
                  disabled={busy || !canEditCounts}
                />
              </div>
            ))}
          </div>
          <div className={styles.smTotal}>
            <span>sm celkem</span>
            <strong>{product.toLocaleString("cs-CZ")} Kč</strong>
          </div>

          {canManageSm && (
            <>
              <div className={styles.smDivider} />
              <p className={styles.smSectionTitle}>Přesun do sm trezor</p>
              <p className={styles.modalHint}>
                Přesune zadané počty ze sm do sm trezor (sm trezor: {smTrezor.toLocaleString("cs-CZ")} Kč).
              </p>
              <div className={styles.smGrid}>
                {idxs.map((i) => (
                  <div key={`t${i}`} className={styles.smCell}>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={counts[i]}
                      className={styles.smInput}
                      value={transfer[i] === 0 ? "" : transfer[i]}
                      onChange={(e) => setAt(setTransfer, i, Number(e.target.value))}
                      placeholder="0"
                      disabled={busy || transferSyncBlocked}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.smTotal}>
                <span>Přesunout</span>
                <strong>{movedCzk.toLocaleString("cs-CZ")} Kč</strong>
              </div>
              {transferSyncBlocked && (
                <p className={styles.modalHint}>Nejprve uložte změny, poté můžete přesunout.</p>
              )}
              <Button
                variant="secondary"
                size="sm"
                block
                disabled={busy || transferSyncBlocked || transferEmpty}
                onClick={() => onTransfer(clampedTransfer)}
              >
                Přesunout do sm trezor
              </Button>
            </>
          )}

          {errorText && <div className={styles.error}>{errorText}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button
            type="button"
            disabled={busy || (!canEditCounts && !ratesChanged)}
            onClick={() => onSave(draftCounts, ratesChanged ? draftRates : null)}
          >
            {busy ? "Ukládám…" : "Uložit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// wata modal – add or subtract an amount from the current wata scalar.
// ─────────────────────────────────────────────────────────────────────────────
function WataModal({
  current,
  busy,
  errorText,
  onApply,
  onCancel,
}: {
  current: number;
  busy: boolean;
  errorText: string | null;
  onApply: (delta: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState<number>(0);
  const valid = Number.isFinite(amount) && amount > 0;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.smModal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>wata</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <div className={styles.smTotal}>
            <span>Aktuální hodnota</span>
            <strong>{current.toLocaleString("cs-CZ")} Kč</strong>
          </div>
          <label className={styles.smLabel} style={{ alignItems: "stretch", textTransform: "none", letterSpacing: 0 }}>
            Částka (Kč)
            <input
              type="number"
              step="any"
              min={0}
              className={styles.smInput}
              value={amount === 0 ? "" : amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="0"
              disabled={busy}
              autoFocus
            />
          </label>
          {errorText && <div className={styles.error}>{errorText}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <div className={styles.smWataButtons}>
            <Button variant="danger" type="button" disabled={busy || !valid} onClick={() => onApply(-Math.abs(amount))}>
              − Odečíst
            </Button>
            <Button type="button" disabled={busy || !valid} onClick={() => onApply(Math.abs(amount))}>
              + Přičíst
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
