import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import { verifyCredential } from "@/lib/secondaryAuth";
import SignModal, { type Signer } from "./SignModal";
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
  text: string;
  done: boolean;
}

interface Account {
  name: string;
  amount: number;
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
  predal?: Stamp | null;
  prevzal?: Stamp | null;
  updatedBy?: string;
  updatedAt?: TimestampLike | null;
}

const SHIFT_LABELS: Record<ShiftType, string> = { den: "Den", noc: "Noc" };

const DRAWER_LABELS: Record<DrawerKey, string> = {
  kasaCZK: "KASA CZK",
  trezorCZK: "TREZOR CZK",
  kasaEUR: "KASA €",
  trezorEUR: "TREZOR €",
};

const DRAWER_ORDER: DrawerKey[] = ["kasaCZK", "trezorCZK", "kasaEUR", "trezorEUR"];

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
    .filter((n): n is { text: unknown; done?: unknown } => !!n && typeof n === "object")
    .filter((n) => typeof n.text === "string")
    .map((n) => ({ text: n.text as string, done: n.done === true }));
}

function toPayload(notes: NoteItem[], cashCounts: Record<DrawerKey, Record<string, number>>, accounts: Account[]) {
  return {
    notes: notes.map((n) => ({ text: n.text, done: n.done })),
    cashCounts,
    accounts: accounts
      .filter((a) => a.name.trim() !== "")
      .map((a) => ({ name: a.name.trim(), amount: Math.round(a.amount) || 0 })),
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
        <div className={styles.toolbarCenter}>
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
  const isAdmin = can("system.admin");
  const docId = `${shiftDate}_${shiftType}`;

  const [loaded, setLoaded] = useState<Handover | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [cashCounts, setCashCounts] = useState<Record<DrawerKey, Record<string, number>>>(emptyCashCounts());
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null);

  const [autosaving, setAutosaving] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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

  const predal = loaded?.predal ?? null;
  const prevzal = loaded?.prevzal ?? null;
  // Freeze at Předat: once signed, content is read-only (admin may still edit).
  const canEdit = !predal || isAdmin;

  const savedPayloadRef = useRef<string>(JSON.stringify(toPayload([], emptyCashCounts(), [])));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  /** Seed local state + the saved-baseline from a loaded doc. */
  function applyDoc(data: Handover) {
    const n = coerceNotes(data.notes);
    const cc = {
      kasaCZK: data.cashCounts?.kasaCZK ?? {},
      trezorCZK: data.cashCounts?.trezorCZK ?? {},
      kasaEUR: data.cashCounts?.kasaEUR ?? {},
      trezorEUR: data.cashCounts?.trezorEUR ?? {},
    };
    const acc = data.accounts ?? [];
    setLoaded(data);
    setNotes(n);
    setCashCounts(cc);
    setAccounts(acc);
    savedPayloadRef.current = JSON.stringify(toPayload(n, cc, acc));
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

  const currentPayload = useMemo(() => toPayload(notes, cashCounts, accounts), [notes, cashCounts, accounts]);
  const dirty = JSON.stringify(currentPayload) !== savedPayloadRef.current;

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
        // non-fatal — the dropdown just shows no options / no defaults
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the protocol is closed, check whether the next shift already exists —
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

  // Debounced autosave — active once a record exists and while it's not frozen.
  useEffect(() => {
    if (loading || !loaded) return;
    if (!canEdit) return; // frozen after Předat
    if (!dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, cashCounts, accounts, loading, loaded, dirty, canEdit]);

  async function save() {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setAutosaving(true);
    const payload = toPayload(notes, cashCounts, accounts);
    try {
      const saved = await api.put<Handover>(`/handovers/${hotel.slug}`, { shiftDate, shiftType, ...payload });
      setLoaded(saved);
      savedPayloadRef.current = JSON.stringify(payload);
      setAutosaveError(null);
    } catch (err) {
      setAutosaveError(err instanceof Error ? err.message : "Chyba ukládání.");
    } finally {
      isSavingRef.current = false;
      setAutosaving(false);
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
      const cred = await verifyCredential(signer.name, password);
      const base = `/handovers/${hotel.slug}/${docId}/${signAction.slot}`;
      if (signAction.mode === "sign") {
        // Persist any pending edits BEFORE freezing the content.
        if (dirty && !isSavingRef.current) await save();
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
        doc = await api.put<Handover>(`/handovers/${hotel.slug}`, {
          shiftDate: next.date,
          shiftType: next.shift,
          ...toPayload(notes, cashCounts, accounts),
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
  const accountsTotal = useMemo(() => accounts.reduce((s, a) => s + (a.amount || 0), 0), [accounts]);
  const totalCZK = drawerTotals.kasaCZK + drawerTotals.trezorCZK + accountsTotal;
  const totalEUR = drawerTotals.kasaEUR + drawerTotals.trezorEUR;

  // ── Účty ─────────────────────────────────────────────────────────────────
  function addAccountRow() {
    setAccounts((prev) => [...prev, { name: "", amount: 0 }]);
    setEditingIdx(accounts.length);
  }
  function setAccountName(idx: number, name: string) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, name } : a)));
  }
  function setAccountAmount(idx: number, amount: number) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, amount: Number.isFinite(amount) ? amount : 0 } : a)));
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
    setNotes((prev) => [...prev, { text: "", done: false }]);
    setEditingNoteIdx(notes.length);
  }
  function setNoteText(idx: number, text: string) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, text } : n)));
  }
  function setNoteDone(idx: number, done: boolean) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, done } : n)));
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
      savedPayloadRef.current = JSON.stringify(toPayload([], emptyCashCounts(), []));
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
          {canCreate ? (
            <>
              <p className={styles.placeholderHint}>Vytvořte prázdný předávací protokol a začněte vyplňovat.</p>
              <Button onClick={createEmpty} disabled={creating}>
                {creating ? "Vytvářím…" : "Vytvořit prázdný protokol"}
              </Button>
            </>
          ) : (
            <p className={styles.placeholderHint}>Nemáte oprávnění vytvořit nový protokol.</p>
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
          {predal && prevzal && (
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
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
        <div className={styles.frozenNotice}>Protokol je podepsán a uzamčen — obsah nelze upravit.</div>
      )}

      <div className={styles.protocolGrid}>
        <div className={styles.cashLayout}>
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

          <div className={styles.accountsContainer}>
            <div className={styles.accountsContainerHeader}>
              <h3 className={styles.accountsTitle}>Účty</h3>
              {canEdit && (
                <Button variant="primary" size="sm" onClick={addAccountRow}>
                  + Přidat účet
                </Button>
              )}
            </div>
            <div className={styles.accountsList}>
              {accounts.length === 0 && <div className={styles.accountsEmpty}>Žádné účty.</div>}
              {accounts.map((acc, idx) => {
                const isEditing = editingIdx === idx;
                const altRow = idx % 2 === 1;
                return (
                  <Fragment key={idx}>
                    <div className={`${styles.accountRow} ${altRow ? styles.accountRowAlt : ""}`}>
                      {isEditing ? (
                        <input
                          type="text"
                          className={styles.accountName}
                          value={acc.name}
                          onChange={(e) => setAccountName(idx, e.target.value)}
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
                          placeholder="0"
                        />
                      ) : (
                        <span className={styles.accountAmountRO}>{acc.amount.toLocaleString("cs-CZ")}</span>
                      )}
                      <span className={styles.accountSuffix}>Kč</span>
                      {canEdit && (
                        <EditActionButton
                          editing={isEditing}
                          ariaLabel={isEditing ? "Hotovo" : "Upravit"}
                          onClick={() => setEditingIdx(isEditing ? null : idx)}
                        />
                      )}
                      {canEdit && (
                        <TrashActionButton
                          ariaLabel={`Odstranit účet ${acc.name || "(bez názvu)"}`}
                          onClick={() => requestDeleteAccount(idx)}
                        />
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.protocolRight}>
          <div className={styles.notesContainer}>
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
              {notes.map((n, i) => {
                const isEditingNote = editingNoteIdx === i;
                return (
                  <div key={i} className={`${styles.noteRow} ${i % 2 === 1 ? styles.noteRowAlt : ""}`}>
                    <input
                      type="checkbox"
                      className={styles.noteCheck}
                      checked={n.done}
                      onChange={(e) => setNoteDone(i, e.target.checked)}
                      disabled={!canEdit}
                      aria-label={n.done ? "Označit jako nevyřízené" : "Označit jako vyřízené"}
                    />
                    {isEditingNote ? (
                      <input
                        type="text"
                        className={n.done ? `${styles.noteText} ${styles.noteTextDone}` : styles.noteText}
                        value={n.text}
                        onChange={(e) => setNoteText(i, e.target.value)}
                        placeholder="Poznámka…"
                        autoFocus
                      />
                    ) : (
                      <span className={n.done ? `${styles.noteTextRO} ${styles.noteTextDone}` : styles.noteTextRO}>
                        {n.text || <em className={styles.accountNameEmpty}>(prázdná poznámka)</em>}
                      </span>
                    )}
                    {canEdit && (
                      <EditActionButton
                        editing={isEditingNote}
                        ariaLabel={isEditingNote ? "Hotovo" : "Upravit"}
                        onClick={() => setEditingNoteIdx(isEditingNote ? null : i)}
                      />
                    )}
                    {canEdit && (
                      <TrashActionButton ariaLabel="Odstranit poznámku" onClick={() => requestDeleteNote(i)} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.signaturesRow}>
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
          <Button variant="primary" size="sm" onClick={createNextShift}>
            Vytvořit protokol pro další směnu
          </Button>
        )}
      </div>

      {/* Print-only layout (B&W, one A4) — visible only via window.print(). */}
      <div className={styles.printArea}>
        <div className={styles.printHeader}>
          Předávací protokol — {hotel.label} — {new Date(`${shiftDate}T00:00:00`).toLocaleDateString("cs-CZ")}{" "}
          — {shiftType === "den" ? "Denní" : "Noční"} směna
        </div>
        <div className={styles.printCashGrid}>
          {DRAWER_ORDER.map((drawer) => {
            const denoms = isCzkDrawer(drawer) ? CZK_DENOMS : EUR_DENOMS;
            const symbol = isCzkDrawer(drawer) ? "Kč" : "€";
            return (
              <table key={drawer} className={styles.printTable}>
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
        </div>
        <div className={styles.printLower}>
          <table className={styles.printTable}>
            <caption>Účty</caption>
            <tbody>
              {accounts.filter((a) => a.name.trim() !== "").length === 0 ? (
                <tr>
                  <td colSpan={2}>—</td>
                </tr>
              ) : (
                accounts
                  .filter((a) => a.name.trim() !== "")
                  .map((a, i) => (
                    <tr key={i}>
                      <td className={styles.printAccName}>{a.name}</td>
                      <td>{a.amount.toLocaleString("cs-CZ")} Kč</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
          <table className={styles.printTable}>
            <caption>Souhrn</caption>
            <tbody>
              <tr>
                <td>KASA</td>
                <td>{drawerTotals.kasaCZK.toLocaleString("cs-CZ")} Kč</td>
              </tr>
              <tr>
                <td>TREZOR</td>
                <td>{drawerTotals.trezorCZK.toLocaleString("cs-CZ")} Kč</td>
              </tr>
              <tr>
                <td>ÚČTY</td>
                <td>{accountsTotal.toLocaleString("cs-CZ")} Kč</td>
              </tr>
              <tr className={styles.printTotalRow}>
                <td>TOTAL CZK</td>
                <td>{totalCZK.toLocaleString("cs-CZ")} Kč</td>
              </tr>
              <tr>
                <td>KASA €</td>
                <td>{drawerTotals.kasaEUR.toLocaleString("cs-CZ")} €</td>
              </tr>
              <tr>
                <td>TREZOR €</td>
                <td>{drawerTotals.trezorEUR.toLocaleString("cs-CZ")} €</td>
              </tr>
              <tr className={styles.printTotalRow}>
                <td>TOTAL €</td>
                <td>{totalEUR.toLocaleString("cs-CZ")} €</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.printSignatures}>
          <div>
            <strong>Předal:</strong> {predal?.displayName ?? ""} — {formatTimestamp(predal?.at)}
          </div>
          <div>
            <strong>Převzal:</strong> {prevzal?.displayName ?? ""} — {formatTimestamp(prevzal?.at)}
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

      {confirmModal}
    </>
  );
}
