import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { verifyCredential, signInPrimary } from "@/lib/secondaryAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import PredalPrevzalModal from "./PredalPrevzalModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./HandoverTab.module.css";

type ShiftType = "den" | "noc";
type Currency = "EUR" | "USD" | "GBP";
type DrawerKey = "kasaCZK" | "trezorCZK" | "kasaEUR" | "trezorEUR";

const CZK_DENOMS = ["5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
const EUR_DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;

const AUTOSAVE_DELAY_MS = 800;
const SNAPSHOT_DELAY_MS = 500;
const MAX_HISTORY = 30;

// firebase-admin's Timestamp has no toJSON method, so it's serialised over
// the wire as { _seconds, _nanoseconds } (the private fields) — not
// { seconds, nanoseconds }. Tolerate both shapes so this code keeps working
// regardless of where the payload originated.
type TimestampLike =
  | { seconds: number; nanoseconds?: number }
  | { _seconds: number; _nanoseconds?: number };

interface Stamp {
  uid: string;
  displayName: string;
  email: string;
  at: TimestampLike | null;
}

interface NoteItem {
  text: string;
  done: boolean;
}

interface Account {
  name: string;
  amount: number;
}

interface Handover {
  id: string;
  shiftDate: string;
  shiftType: ShiftType;
  notes?: NoteItem[] | string | null;
  cashCounts?: Partial<Record<DrawerKey, Record<string, number>>>;
  accounts?: Account[];
  smBreakdown?: Record<Currency, number> | null;
  predal?: Stamp | null;
  prevzal?: Stamp | null;
  updatedBy?: string;
  updatedAt?: TimestampLike | null;
}

interface ExchangeRates {
  EUR: number;
  USD: number;
  GBP: number;
}

type Snapshot = {
  notes: NoteItem[];
  cashCounts: Record<DrawerKey, Record<string, number>>;
  accounts: Account[];
  smBreakdown: Record<Currency, number>;
};

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

function previousShift(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "noc") return { date, shift: "den" };
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(y, m - 1, d);
  prev.setDate(prev.getDate() - 1);
  const py = prev.getFullYear();
  const pm = String(prev.getMonth() + 1).padStart(2, "0");
  const pd = String(prev.getDate()).padStart(2, "0");
  return { date: `${py}-${pm}-${pd}`, shift: "noc" };
}

function nextShift(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "den") return { date, shift: "noc" };
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + 1);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, "0");
  const nd = String(next.getDate()).padStart(2, "0");
  return { date: `${ny}-${nm}-${nd}`, shift: "den" };
}

function timestampSeconds(ts: TimestampLike | null | undefined): number | null {
  if (!ts) return null;
  const a = ts as { seconds?: unknown };
  if (typeof a.seconds === "number") return a.seconds;
  const b = ts as { _seconds?: unknown };
  if (typeof b._seconds === "number") return b._seconds;
  return null;
}

function formatTimestamp(ts: TimestampLike | null | undefined): string {
  const s = timestampSeconds(ts);
  if (s === null) return "";
  const d = new Date(s * 1000);
  return d.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeOnly(ts: TimestampLike | null | undefined): string {
  const s = timestampSeconds(ts);
  if (s === null) return "";
  const d = new Date(s * 1000);
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function emptyDrawer(): Record<string, number> {
  return {};
}

function emptyCashCounts(): Record<DrawerKey, Record<string, number>> {
  return {
    kasaCZK: emptyDrawer(),
    trezorCZK: emptyDrawer(),
    kasaEUR: emptyDrawer(),
    trezorEUR: emptyDrawer(),
  };
}

function drawerSubtotal(counts: Record<string, number>): number {
  let total = 0;
  for (const [denom, n] of Object.entries(counts)) {
    total += Number(denom) * (n || 0);
  }
  return total;
}

function coerceNotes(raw: unknown): NoteItem[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((n): n is { text: unknown; done?: unknown } => !!n && typeof n === "object")
      .filter((n) => typeof n.text === "string")
      .map((n) => ({ text: n.text as string, done: n.done === true }));
  }
  return [];
}

function coerceSmBreakdown(raw: unknown): Record<Currency, number> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cleanCount = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  return {
    EUR: cleanCount(r.EUR),
    USD: cleanCount(r.USD),
    GBP: cleanCount(r.GBP),
  };
}

function snapshotFromHandover(h: Handover | null): Snapshot {
  return {
    notes: coerceNotes(h?.notes),
    cashCounts: {
      kasaCZK: h?.cashCounts?.kasaCZK ?? {},
      trezorCZK: h?.cashCounts?.trezorCZK ?? {},
      kasaEUR: h?.cashCounts?.kasaEUR ?? {},
      trezorEUR: h?.cashCounts?.trezorEUR ?? {},
    },
    accounts: h?.accounts ?? [],
    smBreakdown: coerceSmBreakdown(h?.smBreakdown),
  };
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The only special account is "sm" (rank 0), which sorts to the top and is
// edited via the breakdown popover. Everything else is a normal row (rank 1).
function specialAccountRank(name: string): number {
  if (name === "sm") return 0;
  return 1;
}

function isSpecialAccountName(name: string): boolean {
  return specialAccountRank(name) < 1;
}

function sortAccountIndices(accounts: Account[]): number[] {
  const indices = accounts.map((_, i) => i);
  return indices.sort((aIdx, bIdx) => {
    const rankA = specialAccountRank(accounts[aIdx].name);
    const rankB = specialAccountRank(accounts[bIdx].name);
    if (rankA !== rankB) return rankA - rankB;
    return aIdx - bIdx;
  });
}

// ─── Inline icon SVGs ─────────────────────────────────────────────────────
// Feather-style strokes — match the project's monochrome icon look.

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Row-level pencil/edit micro-action. IconButton on this branch only carries
// the "close"/"refresh" variants, and CLAUDE.md keeps row-level micro-actions
// on local CSS — so these are plain buttons styled from HandoverTab.module.css.
function EditActionButton({
  editing,
  ariaLabel,
  onClick,
}: {
  editing: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.rowIconBtn} aria-label={ariaLabel} onClick={onClick}>
      {editing ? <CheckIcon /> : <PencilIcon />}
    </button>
  );
}

function TrashActionButton({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

interface HandoverTabProps {
  hotel: Hotel;
}

export default function HandoverTab({ hotel }: HandoverTabProps) {
  const { user, can } = useAuth();
  const isAdmin = can("system.admin");
  const canEditRates = isAdmin;

  const [shiftDate, setShiftDate] = useState<string>(todayLocal());
  const [shiftType, setShiftType] = useState<ShiftType>(defaultShiftForNow());

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [cashCounts, setCashCounts] = useState<Record<DrawerKey, Record<string, number>>>(
    emptyCashCounts()
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [predal, setPredal] = useState<Stamp | null>(null);
  const [prevzal, setPrevzal] = useState<Stamp | null>(null);

  const [smBreakdown, setSmBreakdown] = useState<Record<Currency, number>>({
    EUR: 0,
    USD: 0,
    GBP: 0,
  });
  const [rates, setRates] = useState<ExchangeRates>({ EUR: 25, USD: 22, GBP: 29 });

  const [loaded, setLoaded] = useState<Handover | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [autosaving, setAutosaving] = useState<boolean>(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef<boolean>(false);

  const [past, setPast] = useState<Snapshot[]>([]);
  const lastSeenRef = useRef<Snapshot | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-row edit toggle for the accounts list. Only one row is in edit mode at
  // a time. The persisted index (not the sort-display index) is stored.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null);

  // Pending delete — prompts the user before wiping a row that has content
  // or before clearing a signature stamp.
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: "account"; idx: number; label: string }
    | { kind: "note"; idx: number; label: string }
    | { kind: "stamp"; slot: "predal" | "prevzal"; label: string }
    | null
  >(null);

  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null);
  const [stampSlot, setStampSlot] = useState<"predal" | "prevzal" | null>(null);
  const [stampBusy, setStampBusy] = useState<boolean>(false);
  const [stampError, setStampError] = useState<string | null>(null);
  const [loginSwapPrompt, setLoginSwapPrompt] = useState<
    { name: string; email: string; password: string } | null
  >(null);
  const [smModalOpen, setSmModalOpen] = useState<boolean>(false);
  const [kurzyModalOpen, setKurzyModalOpen] = useState<boolean>(false);
  const [createNextChecked, setCreateNextChecked] = useState<boolean>(true);

  // When the current (date, shift) has no protocol, the empty placeholder
  // needs to know whether the *previous* shift exists and whether it's been
  // signed off (Převzal stamped). Fetched in the load effect's 404 branch.
  const [previousState, setPreviousState] = useState<
    { exists: boolean; closed: boolean; data: Handover | null } | null
  >(null);

  // ─── Load on (date, shift) change ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditingIdx(null);
    const id = `${shiftDate}_${shiftType}`;

    void (async () => {
      try {
        const data = await api.get<Handover>(`/handovers/${hotel.slug}/${id}`);
        if (cancelled) return;
        const snap = snapshotFromHandover(data);
        setLoaded(data);
        setNotes(snap.notes);
        setCashCounts(snap.cashCounts);
        setAccounts(snap.accounts);
        setPredal(data.predal ?? null);
        setPrevzal(data.prevzal ?? null);
        setSmBreakdown(snap.smBreakdown);
        setPast([]);
        lastSeenRef.current = snap;
        setAutosaveError(null);
        setPreviousState(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // No protokol for this shift. Don't auto-create. The empty
          // placeholder offers a "Vytvořit protokol" button only when the
          // immediately previous shift exists AND is signed (Převzal). All
          // other cases show an explanatory hint and no button.
          const initial: Snapshot = {
            notes: [],
            cashCounts: emptyCashCounts(),
            accounts: [],
            smBreakdown: { EUR: 0, USD: 0, GBP: 0 },
          };
          setLoaded(null);
          setNotes(initial.notes);
          setCashCounts(initial.cashCounts);
          setAccounts(initial.accounts);
          setPredal(null);
          setPrevzal(null);
          setSmBreakdown(initial.smBreakdown);
          setPast([]);
          lastSeenRef.current = initial;
          setAutosaveError(null);

          // Fetch immediately previous shift to decide what the placeholder
          // shows. Network failure here is non-fatal — fall back to the
          // "no previous available" hint.
          try {
            const prev = previousShift(shiftDate, shiftType);
            const prevData = await api.get<Handover>(
              `/handovers/${hotel.slug}/${prev.date}_${prev.shift}`
            );
            if (cancelled) return;
            setPreviousState({
              exists: true,
              closed: prevData.prevzal != null,
              data: prevData,
            });
          } catch (prevErr) {
            if (cancelled) return;
            if (prevErr instanceof ApiError && prevErr.status === 404) {
              setPreviousState({ exists: false, closed: false, data: null });
            } else {
              setPreviousState({ exists: false, closed: false, data: null });
            }
          }
        } else {
          setErrorModal({
            title: "Chyba",
            message:
              err instanceof Error ? err.message : "Nepodařilo se načíst předávací protokol.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftDate, shiftType]);

  useEffect(() => {
    api
      .get<ExchangeRates>("/exchange-rates")
      .then(setRates)
      .catch(() => {});
  }, []);

  const drawerTotals = useMemo(
    () => ({
      kasaCZK: drawerSubtotal(cashCounts.kasaCZK),
      trezorCZK: drawerSubtotal(cashCounts.trezorCZK),
      kasaEUR: drawerSubtotal(cashCounts.kasaEUR),
      trezorEUR: drawerSubtotal(cashCounts.trezorEUR),
    }),
    [cashCounts]
  );

  const accountsTotal = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.amount || 0), 0),
    [accounts]
  );

  const totalCZK = drawerTotals.kasaCZK + drawerTotals.trezorCZK + accountsTotal;
  const totalEUR = drawerTotals.kasaEUR + drawerTotals.trezorEUR;

  const sortedAccountIndices = useMemo(() => sortAccountIndices(accounts), [accounts]);

  const dirty = useMemo(() => {
    const cur: Snapshot = { notes, cashCounts, accounts, smBreakdown };
    return !snapshotsEqual(cur, snapshotFromHandover(loaded));
  }, [notes, cashCounts, accounts, smBreakdown, loaded]);

  // Client mirror of the backend lock: a fully-signed (predal + prevzal) doc is
  // read-only for everyone except an admin. Otherwise anyone who can see the
  // tab (the RecepcePage view-permission gate) may edit.
  const isClosed = !!(predal && prevzal);
  const canEdit = !isClosed || isAdmin;

  useEffect(() => {
    if (loading) return;
    if (!loaded) return; // no auto-create — admin creates explicitly
    if (!dirty) return;
    if (!canEdit) return; // doc is locked — silently skip (UI also disables inputs)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void performAutoSave();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, cashCounts, accounts, smBreakdown, loading, loaded, dirty, canEdit, shiftDate, shiftType]);

  async function performAutoSave() {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setAutosaving(true);
    try {
      const cleanAccounts = accounts.filter((a) => a.name.trim() !== "");
      await api.put<{ id: string }>(`/handovers/${hotel.slug}`, {
        shiftDate,
        shiftType,
        notes,
        cashCounts,
        accounts: cleanAccounts,
        smBreakdown,
      });
      const fresh = await api.get<Handover>(`/handovers/${hotel.slug}/${shiftDate}_${shiftType}`);
      setLoaded(fresh);
      setAutosaveError(null);
    } catch (err) {
      setAutosaveError(err instanceof Error ? err.message : "Chyba ukládání.");
    } finally {
      isSavingRef.current = false;
      setAutosaving(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    if (!canEdit) return; // no undo history while locked — nothing should change
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    const cur: Snapshot = { notes, cashCounts, accounts, smBreakdown };
    if (lastSeenRef.current === null) {
      lastSeenRef.current = cur;
      return;
    }
    snapshotTimerRef.current = setTimeout(() => {
      const prev = lastSeenRef.current;
      if (prev && !snapshotsEqual(prev, cur)) {
        setPast((p) => [...p, prev].slice(-MAX_HISTORY));
        lastSeenRef.current = cur;
      }
    }, SNAPSHOT_DELAY_MS);
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [notes, cashCounts, accounts, smBreakdown, loading, canEdit]);

  function undo() {
    if (!canEdit) return;
    if (past.length === 0) return;
    const target = past[past.length - 1];
    setNotes(target.notes);
    setCashCounts(target.cashCounts);
    setAccounts(target.accounts);
    setSmBreakdown(target.smBreakdown);
    setPast((p) => p.slice(0, -1));
    setEditingIdx(null);
    lastSeenRef.current = target;
  }

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past]);

  // ─── Notes handlers ─────────────────────────────────────────────────────
  function setNoteText(idx: number, text: string) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, text } : n)));
  }
  function setNoteDone(idx: number, done: boolean) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, done } : n)));
  }
  function addNote() {
    setEditingNoteIdx(notes.length);
    setNotes((prev) => [...prev, { text: "", done: false }]);
  }
  function removeNote(idx: number) {
    setNotes((prev) => prev.filter((_, i) => i !== idx));
    if (editingNoteIdx === idx) setEditingNoteIdx(null);
    else if (editingNoteIdx !== null && editingNoteIdx > idx) {
      setEditingNoteIdx(editingNoteIdx - 1);
    }
  }
  function startEditNote(idx: number) {
    setEditingNoteIdx(idx);
  }
  function stopEditNote() {
    setEditingNoteIdx(null);
  }

  // ─── Delete-with-confirm ────────────────────────────────────────────────
  // Empty rows (just-added, never typed in) skip the prompt — confirming a
  // delete on an empty row would just be friction.
  function requestDeleteAccount(idx: number) {
    const acc = accounts[idx];
    if (!acc) return;
    if (acc.name.trim() === "" && acc.amount === 0) {
      removeAccountRow(idx);
      return;
    }
    setConfirmDelete({
      kind: "account",
      idx,
      label: acc.name || "(bez názvu)",
    });
  }
  function requestDeleteNote(idx: number) {
    const note = notes[idx];
    if (!note) return;
    if (note.text.trim() === "") {
      removeNote(idx);
      return;
    }
    setConfirmDelete({ kind: "note", idx, label: note.text });
  }
  function requestRevertStamp(slot: "predal" | "prevzal") {
    const stamp = slot === "predal" ? predal : prevzal;
    if (!stamp) return;
    setConfirmDelete({ kind: "stamp", slot, label: stamp.displayName });
  }
  async function performRevertStamp(slot: "predal" | "prevzal") {
    const id = `${shiftDate}_${shiftType}`;
    try {
      await api.delete<{ ok: true }>(`/handovers/${hotel.slug}/${id}/${slot}`);
      if (slot === "predal") setPredal(null);
      else setPrevzal(null);
    } catch (err) {
      setErrorModal({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Nepodařilo se odebrat podpis.",
      });
    }
  }
  function performDelete() {
    if (!confirmDelete) return;
    if (confirmDelete.kind === "account") {
      removeAccountRow(confirmDelete.idx);
    } else if (confirmDelete.kind === "note") {
      removeNote(confirmDelete.idx);
    } else {
      void performRevertStamp(confirmDelete.slot);
    }
    setConfirmDelete(null);
  }

  // A stamp can be reverted by the person who signed it, or by an admin.
  function canRevertStamp(stamp: Stamp | null): boolean {
    if (!stamp) return false;
    return stamp.uid === user?.uid || isAdmin;
  }

  // ─── Cash count handlers ────────────────────────────────────────────────
  function setDenomCount(drawer: DrawerKey, denom: string, n: number) {
    setCashCounts((prev) => {
      const next = { ...prev[drawer] };
      if (!Number.isFinite(n) || n <= 0) {
        delete next[denom];
      } else {
        next[denom] = Math.floor(n);
      }
      return { ...prev, [drawer]: next };
    });
  }

  // ─── Accounts handlers ──────────────────────────────────────────────────
  function setAccountName(idx: number, name: string) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, name } : a)));
  }
  function setAccountAmount(idx: number, amount: number) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, amount } : a)));
  }
  function addAccountRow() {
    // New row's persisted index is the current accounts length.
    setEditingIdx(accounts.length);
    setAccounts((prev) => [...prev, { name: "", amount: 0 }]);
  }
  function removeAccountRow(idx: number) {
    setAccounts((prev) => prev.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
    else if (editingIdx !== null && editingIdx > idx) setEditingIdx(editingIdx - 1);
  }
  function startEditAccount(idx: number) {
    if (accounts[idx]?.name === "sm") {
      setSmModalOpen(true);
      return;
    }
    setEditingIdx(idx);
  }
  function stopEditAccount() {
    setEditingIdx(null);
  }

  function applySmBreakdown(next: Record<Currency, number>) {
    setSmBreakdown(next);
    const czk = Math.round(next.EUR * rates.EUR + next.USD * rates.USD + next.GBP * rates.GBP);
    setAccounts((prev) => {
      const idx = prev.findIndex((a) => a.name === "sm");
      if (idx === -1) return [...prev, { name: "sm", amount: czk }];
      return prev.map((a, i) => (i === idx ? { ...a, amount: czk } : a));
    });
  }

  // ─── Předal / Převzal ───────────────────────────────────────────────────
  async function handleStampSubmit(email: string, password: string) {
    if (!stampSlot) return;
    setStampBusy(true);
    setStampError(null);
    try {
      const cred = await verifyCredential(email, password);
      const id = `${shiftDate}_${shiftType}`;
      if (!loaded || dirty) {
        await api.put<{ id: string }>(`/handovers/${hotel.slug}`, {
          shiftDate,
          shiftType,
          notes,
          cashCounts,
          accounts: accounts.filter((a) => a.name.trim() !== ""),
          smBreakdown,
        });
      }
      const result = await api.post<{ ok: true; predal?: Stamp; prevzal?: Stamp }>(
        `/handovers/${hotel.slug}/${id}/${stampSlot}`,
        { idToken: cred.idToken }
      );
      if (stampSlot === "predal" && result.predal) setPredal(result.predal);
      if (stampSlot === "prevzal" && result.prevzal) setPrevzal(result.prevzal);

      const slot = stampSlot;
      setStampSlot(null);

      if (slot === "prevzal") {
        setCreateNextChecked(true);
        setLoginSwapPrompt({
          name: cred.displayName ?? result.prevzal?.displayName ?? cred.email,
          email,
          password,
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setStampError(err.message || "Nepodařilo se uložit podpis.");
      } else if (
        err instanceof Error &&
        /password|credential|user-not-found|invalid-login/i.test(err.message)
      ) {
        setStampError("Neplatný e-mail nebo heslo.");
      } else {
        setStampError(err instanceof Error ? err.message : "Nepodařilo se ověřit přihlášení.");
      }
    } finally {
      setStampBusy(false);
    }
  }

  async function handleLoginSwapConfirm() {
    if (!loginSwapPrompt) return;
    const target = nextShift(shiftDate, shiftType);
    const willCreateNext = createNextChecked;

    // Capture state BEFORE the session swap. After swap the API client uses
    // the incoming user's token, so the new doc lands with createdBy set to
    // them — but the *content* still has to come from the protocol the
    // outgoing receptionist just signed off.
    const carriedNotes = willCreateNext
      ? notes.filter((n) => !n.done && n.text.trim() !== "").map((n) => ({ text: n.text, done: false }))
      : [];
    const copiedAccounts = willCreateNext ? accounts.filter((a) => a.name.trim() !== "") : [];
    const copiedCashCounts = willCreateNext ? cashCounts : emptyCashCounts();
    const copiedBreakdown = willCreateNext ? smBreakdown : { EUR: 0, USD: 0, GBP: 0 };

    try {
      await signInPrimary(loginSwapPrompt.email, loginSwapPrompt.password);
      setLoginSwapPrompt(null);

      if (willCreateNext) {
        await api.put<{ id: string }>(`/handovers/${hotel.slug}`, {
          shiftDate: target.date,
          shiftType: target.shift,
          notes: carriedNotes,
          cashCounts: copiedCashCounts,
          accounts: copiedAccounts,
          smBreakdown: copiedBreakdown,
        });
        // Navigate to the freshly-created next-shift protocol. The load
        // effect re-fires on the date/shift change and fetches the new doc.
        setShiftDate(target.date);
        setShiftType(target.shift);
      }
    } catch (err) {
      setLoginSwapPrompt(null);
      setErrorModal({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Přihlášení nového uživatele se nezdařilo.",
      });
    }
  }

  // Bootstrap path — admin only, only used when there's no previous shift
  // to derive from (typically the very first protocol on a fresh install).
  async function createEmptyProtocol() {
    try {
      await api.put<{ id: string }>(`/handovers/${hotel.slug}`, {
        shiftDate,
        shiftType,
        notes: [],
        cashCounts: emptyCashCounts(),
        accounts: [],
        smBreakdown: { EUR: 0, USD: 0, GBP: 0 },
      });
      const fresh = await api.get<Handover>(`/handovers/${hotel.slug}/${shiftDate}_${shiftType}`);
      const snap = snapshotFromHandover(fresh);
      setLoaded(fresh);
      setNotes(snap.notes);
      setCashCounts(snap.cashCounts);
      setAccounts(snap.accounts);
      setSmBreakdown(snap.smBreakdown);
      setPredal(fresh.predal ?? null);
      setPrevzal(fresh.prevzal ?? null);
      lastSeenRef.current = snap;
      setPreviousState(null);
    } catch (err) {
      setErrorModal({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Nepodařilo se vytvořit protokol.",
      });
    }
  }

  async function createProtocolFromPrevious() {
    const prevData = previousState?.data;
    if (!prevData || !previousState?.closed) return;

    const carriedNotes = coerceNotes(prevData.notes)
      .filter((n) => !n.done && n.text.trim() !== "")
      .map((n) => ({ text: n.text, done: false }));
    const copiedCashCounts = {
      kasaCZK: prevData.cashCounts?.kasaCZK ?? {},
      trezorCZK: prevData.cashCounts?.trezorCZK ?? {},
      kasaEUR: prevData.cashCounts?.kasaEUR ?? {},
      trezorEUR: prevData.cashCounts?.trezorEUR ?? {},
    };
    const copiedAccounts = (prevData.accounts ?? []).filter((a) => a.name.trim() !== "");
    const copiedBreakdown = coerceSmBreakdown(prevData.smBreakdown);

    try {
      await api.put<{ id: string }>(`/handovers/${hotel.slug}`, {
        shiftDate,
        shiftType,
        notes: carriedNotes,
        cashCounts: copiedCashCounts,
        accounts: copiedAccounts,
        smBreakdown: copiedBreakdown,
      });
      const fresh = await api.get<Handover>(`/handovers/${hotel.slug}/${shiftDate}_${shiftType}`);
      const snap = snapshotFromHandover(fresh);
      setLoaded(fresh);
      setNotes(snap.notes);
      setCashCounts(snap.cashCounts);
      setAccounts(snap.accounts);
      setSmBreakdown(snap.smBreakdown);
      setPredal(fresh.predal ?? null);
      setPrevzal(fresh.prevzal ?? null);
      lastSeenRef.current = snap;
      setPreviousState(null);
    } catch (err) {
      setErrorModal({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Nepodařilo se vytvořit protokol.",
      });
    }
  }

  const lockedReason = loaded && !canEdit ? "Uzavřeno — pouze pro čtení" : null;

  const statusText = autosaveError
    ? autosaveError
    : autosaving
    ? "Ukládám…"
    : lockedReason
    ? lockedReason
    : loaded
    ? `Uloženo ${formatTimeOnly(loaded.updatedAt)}`
    : dirty
    ? "Neuloženo"
    : "Pro tuto směnu zatím není žádný záznam.";

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
              setShiftDate(p.date);
              setShiftType(p.shift);
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
            onChange={(e) => setShiftDate(e.target.value)}
          />
          <span className={styles.toolbarLabel}>Směna</span>
          <div className={styles.shiftGroup}>
            {(Object.keys(SHIFT_LABELS) as ShiftType[]).map((s) => (
              <button
                key={s}
                type="button"
                className={shiftType === s ? styles.shiftBtnActive : styles.shiftBtn}
                onClick={() => setShiftType(s)}
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
              setShiftDate(n.date);
              setShiftType(n.shift);
            }}
            title="Následující směna"
          >
            Následující →
          </Button>
        </div>

        <div className={styles.toolbarRight}>
          <Button
            variant="secondary"
            size="sm"
            disabled={past.length === 0}
            onClick={undo}
            title="Zpět (Ctrl+Z)"
          >
            Zpět
          </Button>
        </div>
      </div>

      {loading ? (
        <div className={styles.placeholder}>Načítám…</div>
      ) : !loaded ? (
        <div className={styles.placeholder}>
          <h3 className={styles.placeholderTitle}>Pro tuto směnu zatím není žádný záznam</h3>
          {previousState?.exists && previousState.closed ? (
            <>
              <p className={styles.placeholderHint}>
                Nový protokol bude vytvořen s daty převzatými z předchozí (uzavřené) směny — kromě
                vyřízených poznámek.
              </p>
              <Button onClick={createProtocolFromPrevious}>Vytvořit protokol</Button>
            </>
          ) : previousState?.exists && !previousState.closed ? (
            <p className={styles.placeholderHint}>
              Předchozí protokol není uzavřen. Pro vytvoření tohoto protokolu je nejdříve nutné
              podepsat předchozí směnu — &bdquo;Převzal&ldquo;.
            </p>
          ) : (
            <>
              <p className={styles.placeholderHint}>Žádný předchozí protokol není k dispozici.</p>
              {isAdmin && (
                <Button onClick={createEmptyProtocol}>Vytvořit prázdný protokol</Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── 2/3 cash+účty (with summary + signatures inline) | 1/3 poznámky */}
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
                        <div
                          key={d}
                          className={`${styles.cashRow} ${i % 2 === 1 ? styles.cashRowAlt : ""}`}
                        >
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
                            disabled={loading || !canEdit}
                          />
                          <span className={styles.subtotal}>
                            {subtotal.toLocaleString("cs-CZ")} {symbol}
                          </span>
                        </div>
                      );
                    })}
                    <div className={styles.cashTotal}>
                      CELKEM&nbsp;
                      {drawerTotals[drawer].toLocaleString("cs-CZ")} {symbol}
                    </div>
                  </div>
                );
              })}

              {/* Summary spans columns 1-2 (KASA + TREZOR), not the Účty column */}
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
                  <div className={styles.summaryRowTotal}>
                    <span>TOTAL €</span>
                    <strong>{totalEUR.toLocaleString("cs-CZ")} €</strong>
                  </div>
                </div>
              </div>

              {/* Signatures sit inside the grid so they stay aligned with KASA/TREZOR
                  columns; Účty extends down beside them. */}
              <SignatureBlock
                className={styles.sigPredalCell}
                label="Předal"
                stamp={predal}
                buttonLabel="Označit jako předané"
                canRevert={canRevertStamp(predal)}
                onRevert={() => requestRevertStamp("predal")}
                onClick={() => {
                  setStampError(null);
                  setStampSlot("predal");
                }}
              />
              <SignatureBlock
                className={styles.sigPrevzalCell}
                label="Převzal"
                stamp={prevzal}
                buttonLabel="Označit jako převzaté"
                canRevert={canRevertStamp(prevzal)}
                onRevert={() => requestRevertStamp("prevzal")}
                onClick={() => {
                  setStampError(null);
                  setStampSlot("prevzal");
                }}
              />

              <div className={styles.accountsContainer}>
                <div className={styles.accountsContainerHeader}>
                  <h3 className={styles.accountsTitle}>Účty</h3>
                  <div className={styles.specialRowButtons}>
                    {!accounts.some((a) => a.name === "sm") && (
                      <Button variant="ghost" size="sm" onClick={() => setSmModalOpen(true)}>
                        + sm
                      </Button>
                    )}
                    <Button variant="primary" size="sm" onClick={addAccountRow} disabled={!canEdit}>
                      + Přidat účet
                    </Button>
                  </div>
                </div>
                <div className={styles.accountsList}>
                  {accounts.length === 0 && <div className={styles.accountsEmpty}>Žádné účty.</div>}
                  {sortedAccountIndices.map((idx, sortedIdx) => {
                    const acc = accounts[idx];
                    const isSm = acc.name === "sm";
                    const isSpecial = isSpecialAccountName(acc.name);
                    // sm is everyone-edit (via the breakdown popover); regular rows are
                    // everyone-edit. Whole-doc lock (closed) takes precedence.
                    const restrictedReadOnly = !canEdit;
                    const isEditing = editingIdx === idx && !isSm;
                    const prevWasSpecial =
                      sortedIdx > 0 &&
                      isSpecialAccountName(accounts[sortedAccountIndices[sortedIdx - 1]].name);
                    const showSeparator = !isSpecial && prevWasSpecial;
                    const altRow = sortedIdx % 2 === 1;
                    return (
                      <Fragment key={idx}>
                        {showSeparator && <div className={styles.accountSeparator} />}
                        <div
                          className={`${styles.accountRow} ${altRow ? styles.accountRowAlt : ""}`}
                        >
                          {isEditing && !isSm ? (
                            <input
                              type="text"
                              className={styles.accountName}
                              value={acc.name}
                              onChange={(e) => setAccountName(idx, e.target.value)}
                              placeholder="Název (např. Květiny)"
                              disabled={loading || !canEdit}
                              autoFocus
                            />
                          ) : (
                            <span className={styles.accountNameRO}>
                              {acc.name || (
                                <em className={styles.accountNameEmpty}>(bez názvu)</em>
                              )}
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
                              disabled={loading || !canEdit}
                            />
                          ) : (
                            <span className={styles.accountAmountRO}>
                              {acc.amount.toLocaleString("cs-CZ")}
                            </span>
                          )}
                          <span className={styles.accountSuffix}>Kč</span>

                          {!restrictedReadOnly && (
                            <EditActionButton
                              editing={isEditing}
                              ariaLabel={isEditing ? "Hotovo" : "Upravit"}
                              onClick={() =>
                                isEditing ? stopEditAccount() : startEditAccount(idx)
                              }
                            />
                          )}
                          {!restrictedReadOnly && (
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

            {/* ── Poznámky column ───────────────────────────────────────── */}
            <div className={styles.protocolRight}>
              <div className={styles.notesContainer}>
                <div className={styles.notesContainerHeader}>
                  <h3 className={styles.accountsTitle}>Poznámky pro další směnu</h3>
                  <Button variant="primary" size="sm" onClick={addNote} disabled={!canEdit}>
                    + Přidat poznámku
                  </Button>
                </div>
                <div className={styles.notesList}>
                  {notes.length === 0 && <div className={styles.accountsEmpty}>Žádné poznámky.</div>}
                  {notes.map((n, i) => {
                    const isEditingNote = editingNoteIdx === i;
                    return (
                      <div
                        key={i}
                        className={`${styles.noteRow} ${i % 2 === 1 ? styles.noteRowAlt : ""}`}
                      >
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
                            className={
                              n.done ? `${styles.noteText} ${styles.noteTextDone}` : styles.noteText
                            }
                            value={n.text}
                            onChange={(e) => setNoteText(i, e.target.value)}
                            placeholder="Poznámka…"
                            disabled={loading || !canEdit}
                            autoFocus
                          />
                        ) : (
                          <span
                            className={
                              n.done
                                ? `${styles.noteTextRO} ${styles.noteTextDone}`
                                : styles.noteTextRO
                            }
                          >
                            {n.text || (
                              <em className={styles.accountNameEmpty}>(prázdná poznámka)</em>
                            )}
                          </span>
                        )}
                        {canEdit && (
                          <>
                            <EditActionButton
                              editing={isEditingNote}
                              ariaLabel={isEditingNote ? "Hotovo" : "Upravit"}
                              onClick={() => (isEditingNote ? stopEditNote() : startEditNote(i))}
                            />
                            <TrashActionButton
                              ariaLabel="Odstranit poznámku"
                              onClick={() => requestDeleteNote(i)}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.metaRow}>
            <span
              className={autosaveError ? `${styles.metaText} ${styles.metaError}` : styles.metaText}
            >
              {statusText}
            </span>
          </div>
        </>
      )}

      {errorModal && (
        <ConfirmModal
          title={errorModal.title}
          message={errorModal.message}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setErrorModal(null)}
          onCancel={() => setErrorModal(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={
            confirmDelete.kind === "account"
              ? "Odstranit účet?"
              : confirmDelete.kind === "note"
              ? "Odstranit poznámku?"
              : confirmDelete.slot === "predal"
              ? "Odebrat podpis Předal?"
              : "Odebrat podpis Převzal?"
          }
          message={
            confirmDelete.kind === "account"
              ? `Opravdu chcete odstranit účet „${confirmDelete.label}"?`
              : confirmDelete.kind === "note"
              ? `Opravdu chcete odstranit poznámku „${confirmDelete.label}"?`
              : `Opravdu chcete odebrat podpis ${confirmDelete.label}?`
          }
          confirmLabel={confirmDelete.kind === "stamp" ? "Odebrat" : "Odstranit"}
          cancelLabel="Zrušit"
          danger
          onConfirm={performDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {stampSlot && (
        <PredalPrevzalModal
          title={stampSlot === "predal" ? "Označit jako předané" : "Označit jako převzaté"}
          confirmLabel={stampSlot === "predal" ? "Předat" : "Převzít"}
          initialEmail={stampSlot === "predal" ? user?.email ?? "" : ""}
          busy={stampBusy}
          errorText={stampError}
          onSubmit={handleStampSubmit}
          onCancel={() => {
            setStampSlot(null);
            setStampError(null);
          }}
        />
      )}

      {loginSwapPrompt && (
        <div className={styles.modalOverlay}>
          <div className={styles.smModal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Přihlásit jako nový uživatel?</h2>
              <IconButton
                variant="close"
                aria-label="Zavřít"
                onClick={() => setLoginSwapPrompt(null)}
              >
                ✕
              </IconButton>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Chcete se nyní přihlásit jako <strong>{loginSwapPrompt.name}</strong>?
              </p>
              <label className={styles.swapCheckbox}>
                <input
                  type="checkbox"
                  checked={createNextChecked}
                  onChange={(e) => setCreateNextChecked(e.target.checked)}
                />
                <span>
                  Vytvořit nový protokol pro{" "}
                  <strong>
                    {(() => {
                      const t = nextShift(shiftDate, shiftType);
                      const [y, m, d] = t.date.split("-").map(Number);
                      const formatted = new Date(y, m - 1, d).toLocaleDateString("cs-CZ", {
                        day: "numeric",
                        month: "numeric",
                        year: "numeric",
                      });
                      return `${formatted} ${SHIFT_LABELS[t.shift]}`;
                    })()}
                  </strong>{" "}
                  s daty převzatými z aktuálního protokolu (kromě vyřízených poznámek).
                </span>
              </label>
            </div>
            <div className={styles.modalFooter}>
              <Button variant="secondary" onClick={() => setLoginSwapPrompt(null)}>
                Ne, ponechat
              </Button>
              <Button onClick={handleLoginSwapConfirm}>Ano, přihlásit</Button>
            </div>
          </div>
        </div>
      )}

      {smModalOpen && (
        <SmBreakdownModal
          initial={smBreakdown}
          rates={rates}
          canEditRates={canEditRates}
          onOpenKurzy={() => setKurzyModalOpen(true)}
          onConfirm={(next) => {
            applySmBreakdown(next);
            setSmModalOpen(false);
          }}
          onCancel={() => setSmModalOpen(false)}
        />
      )}

      {kurzyModalOpen && (
        <KurzyModal
          initial={rates}
          onSaved={(next) => {
            setRates(next);
            setKurzyModalOpen(false);
          }}
          onCancel={() => setKurzyModalOpen(false)}
          onError={(msg) => setErrorModal({ title: "Chyba", message: msg })}
        />
      )}
    </div>
  );
}

function SignatureBlock({
  label,
  stamp,
  buttonLabel,
  onClick,
  canRevert,
  onRevert,
  className,
}: {
  label: string;
  stamp: Stamp | null;
  buttonLabel: string;
  onClick: () => void;
  canRevert: boolean;
  onRevert: () => void;
  className?: string;
}) {
  return (
    <div className={className ? `${styles.signatureBlock} ${className}` : styles.signatureBlock}>
      <span className={styles.toolbarLabel}>{label}</span>
      {stamp ? (
        <div className={styles.signatureStamp}>
          <div className={styles.signatureStampText}>
            <strong>{stamp.displayName}</strong>
            <span className={styles.metaText}>{formatTimestamp(stamp.at)}</span>
          </div>
          {canRevert && (
            <TrashActionButton ariaLabel={`Odebrat podpis ${label}`} onClick={onRevert} />
          )}
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={onClick}>
          {buttonLabel}
        </Button>
      )}
    </div>
  );
}

function SmBreakdownModal({
  initial,
  rates,
  canEditRates,
  onOpenKurzy,
  onConfirm,
  onCancel,
}: {
  initial: Record<Currency, number>;
  rates: ExchangeRates;
  canEditRates: boolean;
  onOpenKurzy: () => void;
  onConfirm: (next: Record<Currency, number>) => void;
  onCancel: () => void;
}) {
  const [eur, setEur] = useState(initial.EUR);
  const [usd, setUsd] = useState(initial.USD);
  const [gbp, setGbp] = useState(initial.GBP);

  const czk = Math.round(eur * rates.EUR + usd * rates.USD + gbp * rates.GBP);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.smModal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>sm</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel}>
            ✕
          </IconButton>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.smGrid}>
            <label className={styles.smLabel}>
              <span className={styles.smRate}>{rates.EUR}</span>
              <input
                type="number"
                step={1}
                min={0}
                className={styles.smInput}
                value={eur === 0 ? "" : eur}
                onChange={(e) => setEur(Number(e.target.value) || 0)}
                placeholder="0"
                autoFocus
              />
            </label>
            <label className={styles.smLabel}>
              <span className={styles.smRate}>{rates.USD}</span>
              <input
                type="number"
                step={1}
                min={0}
                className={styles.smInput}
                value={usd === 0 ? "" : usd}
                onChange={(e) => setUsd(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </label>
            <label className={styles.smLabel}>
              <span className={styles.smRate}>{rates.GBP}</span>
              <input
                type="number"
                step={1}
                min={0}
                className={styles.smInput}
                value={gbp === 0 ? "" : gbp}
                onChange={(e) => setGbp(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </label>
          </div>
          <div className={styles.smTotal}>
            <span>Celkem v CZK</span>
            <strong>{czk.toLocaleString("cs-CZ")} Kč</strong>
          </div>
        </div>
        <div className={styles.modalFooter}>
          {canEditRates && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenKurzy}
              className={styles.modalFooterStart}
            >
              Upravit hodnoty sm
            </Button>
          )}
          <Button variant="secondary" onClick={onCancel}>
            Zrušit
          </Button>
          <Button onClick={() => onConfirm({ EUR: eur, USD: usd, GBP: gbp })}>Uložit</Button>
        </div>
      </div>
    </div>
  );
}

function KurzyModal({
  initial,
  onSaved,
  onCancel,
  onError,
}: {
  initial: ExchangeRates;
  onSaved: (next: ExchangeRates) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [eur, setEur] = useState(initial.EUR);
  const [usd, setUsd] = useState(initial.USD);
  const [gbp, setGbp] = useState(initial.GBP);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    try {
      await api.put<{ ok: true; rates: ExchangeRates }>("/exchange-rates", {
        EUR: eur,
        USD: usd,
        GBP: gbp,
      });
      onSaved({ EUR: eur, USD: usd, GBP: gbp });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nepodařilo se uložit hodnoty.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.smModal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Hodnoty sm</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel}>
            ✕
          </IconButton>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalHint}>Hodnoty pro výpočet částky v řádku „sm".</p>
          <div className={styles.smGrid}>
            <label className={styles.smLabel}>
              EUR
              <input
                type="number"
                min={0.01}
                step={0.01}
                className={styles.smInput}
                value={eur}
                onChange={(e) => setEur(Number(e.target.value) || 0)}
                disabled={busy}
                autoFocus
              />
            </label>
            <label className={styles.smLabel}>
              USD
              <input
                type="number"
                min={0.01}
                step={0.01}
                className={styles.smInput}
                value={usd}
                onChange={(e) => setUsd(Number(e.target.value) || 0)}
                disabled={busy}
              />
            </label>
            <label className={styles.smLabel}>
              GBP
              <input
                type="number"
                min={0.01}
                step={0.01}
                className={styles.smInput}
                value={gbp}
                onChange={(e) => setGbp(Number(e.target.value) || 0)}
                disabled={busy}
              />
            </label>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button onClick={handleSave} disabled={busy || eur <= 0 || usd <= 0 || gbp <= 0}>
            {busy ? "Ukládám…" : "Uložit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
