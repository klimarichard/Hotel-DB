/**
 * Handover protocol change history + undo/redo.
 *
 * Every content save (the PUT on /handovers/:hotel) is diffed at the *element*
 * level — one record per changed note / účet / cash denomination / sm count —
 * and appended to a per-protocol `history` subcollection. Two things ride on
 * that history:
 *
 *   1. The in-protocol history panel (human-readable Czech labels).
 *   2. Undo / redo, implemented as a command-pattern cursor (`histCursor` on the
 *      parent doc). Undo moves the cursor back and applies the *inverse* of one
 *      change; redo moves it forward and re-applies; a brand-new edit truncates
 *      the redo tail. Everything is scoped to a single protocol document, so it
 *      can never reach across shifts — the previous shift is a different doc, and
 *      undo/redo are refused once the shift is signed (frozen).
 *
 * Storage is a subcollection (one tiny doc per change), NOT an on-doc array —
 * an array would rewrite in full on every change, the very O(n) write cost this
 * whole design exists to avoid. History entries carry `at` (clock time) so the
 * daily retention sweep can drop them after 6 months.
 *
 * Money moves (sm→trezor, wata) and signatures are NOT part of the content PUT
 * and therefore never enter the history or the undo stack — deliberate.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HotelSlug } from "./hotels";
import { NoteRow, AccountRow, handoverCol } from "./handoverShared";
import * as clock from "./clock";

// The four content fields that participate in history/undo. Mirrors the fields
// the content PUT sanitizes and writes.
export interface HandoverContent {
  notes: NoteRow[];
  accounts: AccountRow[];
  cashCounts: Record<string, Record<string, number>>;
  smCounts: number[];
}

const DRAWERS = ["kasaCZK", "trezorCZK", "kasaEUR", "trezorEUR"] as const;
type DrawerKey = (typeof DRAWERS)[number];

const DRAWER_LABEL: Record<DrawerKey, { place: string; cur: string }> = {
  kasaCZK: { place: "kasa", cur: "Kč" },
  trezorCZK: { place: "trezor", cur: "Kč" },
  kasaEUR: { place: "kasa", cur: "€" },
  trezorEUR: { place: "trezor", cur: "€" },
};

/**
 * What a single change targets — enough to apply it forward or in reverse.
 * `created` is the synthetic floor of every protocol's history: it carries no
 * values, is never applied, and never appears in a diff.
 */
export type ChangeTarget =
  | { kind: "note"; id: string; field: "text" | "done" | "row"; index?: number }
  | { kind: "account"; id: string; field: "name" | "amount" | "row"; index?: number }
  | { kind: "cash"; drawer: DrawerKey; denom: string }
  | { kind: "sm"; index: number }
  | { kind: "created" };

/** One element-level change, human-labelled, with the values to undo/redo it. */
export interface HandoverChange {
  target: ChangeTarget;
  before: unknown;
  after: unknown;
  label: string;
}

/** A persisted history entry (the subcollection doc shape). */
export interface HistoryEntry extends HandoverChange {
  seq: number;
  at: Timestamp;
  byUid: string;
  byEmail: string;
  undone: boolean;
  /**
   * Shared-terminal attribution: when `byUid` was resolved from the previous
   * shift's Převzal signature, these hold the session account the write
   * physically came through. Absent for ordinary logins.
   */
  viaUid?: string;
  viaEmail?: string;
}

/** Who a history entry is attributed to (see `viaUid` above). */
export interface HistoryActor {
  uid: string;
  email: string;
  viaUid?: string;
  viaEmail?: string;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Group digits with thin spaces, Czech-style: 12345 → "12 345". */
function num(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function truncate(s: string, n = 40): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function quote(s: string): string {
  return `„${truncate(s)}“`;
}

// ─── Diff ────────────────────────────────────────────────────────────────────

/**
 * Stable key for a row: its id when present, else a positional sentinel. The
 * frontend assigns ids (mergeLockable relies on them), so the fallback only
 * guards against malformed input.
 */
function rowKey(row: { id?: string }, index: number): string {
  return row.id && row.id !== "" ? row.id : `#${index}`;
}

function diffNotes(before: NoteRow[], after: NoteRow[], out: HandoverChange[]): void {
  const beforeByKey = new Map<string, { row: NoteRow; index: number }>();
  before.forEach((row, index) => beforeByKey.set(rowKey(row, index), { row, index }));
  const seen = new Set<string>();

  after.forEach((row, index) => {
    const key = rowKey(row, index);
    seen.add(key);
    const prev = beforeByKey.get(key);
    if (!prev) {
      out.push({
        target: { kind: "note", id: key, field: "row", index },
        before: null,
        after: { ...row },
        label: `Přidána poznámka ${quote(row.text)}`,
      });
      return;
    }
    if (prev.row.text !== row.text) {
      out.push({
        target: { kind: "note", id: key, field: "text" },
        before: prev.row.text,
        after: row.text,
        label: `Poznámka změněna: ${quote(prev.row.text)} → ${quote(row.text)}`,
      });
    }
    if (prev.row.done !== row.done) {
      out.push({
        target: { kind: "note", id: key, field: "done" },
        before: prev.row.done,
        after: row.done,
        label: row.done
          ? `Poznámka ${quote(row.text)} označena jako hotová`
          : `Poznámka ${quote(row.text)} znovu otevřena`,
      });
    }
  });

  before.forEach((row, index) => {
    const key = rowKey(row, index);
    if (seen.has(key)) return;
    out.push({
      target: { kind: "note", id: key, field: "row", index },
      before: { ...row },
      after: null,
      label: `Smazána poznámka ${quote(row.text)}`,
    });
  });
}

function diffAccounts(before: AccountRow[], after: AccountRow[], out: HandoverChange[]): void {
  const beforeByKey = new Map<string, { row: AccountRow; index: number }>();
  before.forEach((row, index) => beforeByKey.set(rowKey(row, index), { row, index }));
  const seen = new Set<string>();

  after.forEach((row, index) => {
    const key = rowKey(row, index);
    seen.add(key);
    const prev = beforeByKey.get(key);
    if (!prev) {
      out.push({
        target: { kind: "account", id: key, field: "row", index },
        before: null,
        after: { ...row },
        label: `Přidán účet ${quote(row.name)} (${num(row.amount)} Kč)`,
      });
      return;
    }
    if (prev.row.name !== row.name) {
      out.push({
        target: { kind: "account", id: key, field: "name" },
        before: prev.row.name,
        after: row.name,
        label: `Účet přejmenován: ${quote(prev.row.name)} → ${quote(row.name)}`,
      });
    }
    if (prev.row.amount !== row.amount) {
      out.push({
        target: { kind: "account", id: key, field: "amount" },
        before: prev.row.amount,
        after: row.amount,
        label: `Účet ${quote(row.name)}: ${num(prev.row.amount)} → ${num(row.amount)} Kč`,
      });
    }
  });

  before.forEach((row, index) => {
    const key = rowKey(row, index);
    if (seen.has(key)) return;
    out.push({
      target: { kind: "account", id: key, field: "row", index },
      before: { ...row },
      after: null,
      label: `Smazán účet ${quote(row.name)}`,
    });
  });
}

function drawerMap(cash: Record<string, Record<string, number>>, drawer: DrawerKey): Record<string, number> {
  const m = cash[drawer];
  return m && typeof m === "object" ? m : {};
}

function diffCash(
  before: Record<string, Record<string, number>>,
  after: Record<string, Record<string, number>>,
  out: HandoverChange[]
): void {
  for (const drawer of DRAWERS) {
    const b = drawerMap(before, drawer);
    const a = drawerMap(after, drawer);
    const denoms = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
    for (const denom of denoms) {
      const ov = b[denom] ?? 0;
      const nv = a[denom] ?? 0;
      if (ov === nv) continue;
      const { place, cur } = DRAWER_LABEL[drawer];
      out.push({
        target: { kind: "cash", drawer, denom },
        before: ov,
        after: nv,
        label: `Hotovost ${place} ${denom} ${cur}: ${num(ov)} → ${num(nv)} ks`,
      });
    }
  }
}

function diffSm(before: number[], after: number[], out: HandoverChange[]): void {
  for (let i = 0; i < 3; i++) {
    const ov = typeof before[i] === "number" ? before[i] : 0;
    const nv = typeof after[i] === "number" ? after[i] : 0;
    if (ov === nv) continue;
    out.push({
      target: { kind: "sm", index: i },
      before: ov,
      after: nv,
      label: `SM počet #${i + 1}: ${num(ov)} → ${num(nv)}`,
    });
  }
}

/** Element-level diff of two content snapshots. Empty when nothing changed. */
export function diffHandover(before: Partial<HandoverContent> | null, after: HandoverContent): HandoverChange[] {
  const out: HandoverChange[] = [];
  diffNotes(before?.notes ?? [], after.notes ?? [], out);
  diffAccounts(before?.accounts ?? [], after.accounts ?? [], out);
  diffCash(before?.cashCounts ?? {}, after.cashCounts ?? {}, out);
  diffSm(before?.smCounts ?? [], after.smCounts ?? [], out);
  return out;
}

/**
 * The single entry every protocol's history opens with. Creation is NOT diffed
 * against an empty document — carrying a signed shift forward would otherwise
 * record every note, účet, denomination and sm count as a separate "Přidáno…".
 */
export function createdChange(carriedFromPreviousShift: boolean): HandoverChange {
  return {
    target: { kind: "created" },
    before: null,
    after: null,
    label: carriedFromPreviousShift
      ? "Protokol vytvořen převzetím z předchozí směny"
      : "Protokol vytvořen",
  };
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** The label of a whole-row addition, from the row itself. */
function addedRowLabel(kind: "note" | "account", row: Record<string, unknown>): string {
  if (kind === "note") return `Přidána poznámka ${quote(String(row.text ?? ""))}`;
  return `Přidán účet ${quote(String(row.name ?? ""))} (${num(Number(row.amount) || 0)} Kč)`;
}

/**
 * Rebuild a change's label for an arbitrary before/after pair. Needed when two
 * saves are coalesced into one entry: the stored label describes the *slice*
 * that produced it, and after the merge it has to describe the whole edit.
 * `content` supplies the row name for account amounts, which the target alone
 * does not carry.
 */
function labelFor(
  target: ChangeTarget,
  before: unknown,
  after: unknown,
  content?: HandoverContent
): string {
  switch (target.kind) {
    case "note":
      if (target.field === "row") {
        return after == null
          ? `Smazána poznámka ${quote(String((before as NoteRow)?.text ?? ""))}`
          : addedRowLabel("note", after as Record<string, unknown>);
      }
      if (target.field === "text") {
        return `Poznámka změněna: ${quote(String(before ?? ""))} → ${quote(String(after ?? ""))}`;
      }
      return after === true ? "Poznámka označena jako hotová" : "Poznámka znovu otevřena";
    case "account": {
      if (target.field === "row") {
        return after == null
          ? `Smazán účet ${quote(String((before as AccountRow)?.name ?? ""))}`
          : addedRowLabel("account", after as Record<string, unknown>);
      }
      if (target.field === "name") {
        return `Účet přejmenován: ${quote(String(before ?? ""))} → ${quote(String(after ?? ""))}`;
      }
      const row = content?.accounts.find((a, i) => rowKey(a, i) === target.id);
      return `Účet ${quote(row?.name ?? "")}: ${num(Number(before) || 0)} → ${num(Number(after) || 0)} Kč`;
    }
    case "cash": {
      const { place, cur } = DRAWER_LABEL[target.drawer];
      return `Hotovost ${place} ${target.denom} ${cur}: ${num(Number(before) || 0)} → ${num(Number(after) || 0)} ks`;
    }
    case "sm":
      return `SM počet #${target.index + 1}: ${num(Number(before) || 0)} → ${num(Number(after) || 0)}`;
    default:
      return "Protokol vytvořen";
  }
}

// ─── Apply (forward / inverse) ───────────────────────────────────────────────

function findIndexById(arr: Array<{ id?: string }>, id: string): number {
  return arr.findIndex((r, i) => rowKey(r, i) === id);
}

/**
 * Apply a single change to a mutable content object, in the given direction:
 * "redo" moves toward `after`, "undo" toward `before`. Localised to the one
 * element the change targets — other concurrent edits to the doc are untouched.
 */
export function applyChange(content: HandoverContent, change: HandoverChange, direction: "undo" | "redo"): void {
  const desired = direction === "undo" ? change.before : change.after;
  const t = change.target;

  // The creation marker holds no values — nothing to apply in either direction.
  if (t.kind === "created") return;

  if (t.kind === "note" || t.kind === "account") {
    const arr = (t.kind === "note" ? content.notes : content.accounts) as unknown as Array<Record<string, unknown>>;
    const at = findIndexById(arr as Array<{ id?: string }>, t.id);
    if (t.field === "row") {
      if (desired == null) {
        if (at >= 0) arr.splice(at, 1);
      } else if (at >= 0) {
        arr[at] = desired as Record<string, unknown>;
      } else {
        const insertAt = Math.min(t.index ?? arr.length, arr.length);
        arr.splice(insertAt, 0, desired as Record<string, unknown>);
      }
    } else if (at >= 0) {
      arr[at][t.field] = desired;
    }
    return;
  }

  if (t.kind === "cash") {
    const drawer = (content.cashCounts[t.drawer] ??= {});
    const v = typeof desired === "number" ? desired : 0;
    if (v === 0) delete drawer[t.denom];
    else drawer[t.denom] = v;
    return;
  }

  // sm
  while (content.smCounts.length < 3) content.smCounts.push(0);
  content.smCounts[t.index] = typeof desired === "number" ? desired : 0;
}

// ─── History subcollection + cursor ──────────────────────────────────────────

function historyCol(hotel: HotelSlug, id: string): admin.firestore.CollectionReference {
  return handoverCol(hotel).doc(id).collection("history");
}

export interface CursorState {
  histSeq: number; // highest seq ever assigned
  histCursor: number; // seq currently in effect (0 = before the first entry)
}

export function readCursor(doc: Record<string, unknown> | undefined): CursorState {
  const histSeq = typeof doc?.histSeq === "number" ? (doc.histSeq as number) : 0;
  const histCursor = typeof doc?.histCursor === "number" ? (doc.histCursor as number) : histSeq;
  return { histSeq, histCursor };
}

// ─── Coalescing ──────────────────────────────────────────────────────────────
//
// Content is autosaved ~800 ms after the last keystroke, so typing one poznámka
// produces a save (and therefore a history entry) per thinking pause. Rather than
// delay the save — which would risk losing text — successive saves that keep
// editing the SAME field are folded into the entry already at the tip of the
// stack. The merged entry keeps the OLDEST `before`, so one undo reverts the
// whole edit, and the label is rebuilt to describe it end to end.

const COALESCE_WINDOW_MS = 2 * 60 * 1000;

/** Free-typing fields: repeated edits within the window are one logical edit. */
function isTypingField(t: ChangeTarget): boolean {
  if (t.kind === "note") return t.field === "text";
  if (t.kind === "account") return t.field === "name" || t.field === "amount";
  return t.kind === "cash" || t.kind === "sm";
}

/** Do two targets address the same note / účet / denomination / sm slot? */
function sameRow(a: ChangeTarget, b: ChangeTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "note") return a.id === (b as typeof a).id;
  if (a.kind === "account") return a.id === (b as typeof a).id;
  if (a.kind === "cash") return a.drawer === (b as typeof a).drawer && a.denom === (b as typeof a).denom;
  if (a.kind === "sm") return a.index === (b as typeof a).index;
  return false;
}

/** Same row AND same field. */
function sameTarget(a: ChangeTarget, b: ChangeTarget): boolean {
  if (!sameRow(a, b)) return false;
  if (a.kind === "note") return a.field === (b as typeof a).field;
  if (a.kind === "account") return a.field === (b as typeof a).field;
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The entry currently at the tip of the stack, or null. */
async function tipEntry(hotel: HotelSlug, id: string, cursor: CursorState): Promise<HistoryEntry | null> {
  // Only meaningful with no redo tail — otherwise the tip is about to be truncated.
  if (cursor.histSeq === 0 || cursor.histCursor !== cursor.histSeq) return null;
  const snap = await historyCol(hotel, id).doc(String(cursor.histSeq).padStart(9, "0")).get();
  return snap.exists ? (snap.data() as HistoryEntry) : null;
}

/**
 * Try to fold `change` into the tip entry instead of appending a new one.
 * Returns the resulting cursor when folded, or null when the caller should
 * append normally. Two shapes fold:
 *
 *   - same field edited again  → widen the entry's before→after span
 *   - a field of a row that the tip entry itself ADDED → update the added row
 *
 * A fold that returns a field to its original value deletes the entry outright
 * and rewinds the cursor, so "typed it, then deleted it" leaves no trace.
 */
async function tryCoalesce(
  hotel: HotelSlug,
  id: string,
  cursor: CursorState,
  change: HandoverChange,
  actor: HistoryActor,
  now: Timestamp,
  content?: HandoverContent
): Promise<CursorState | null> {
  if (!isTypingField(change.target)) return null;
  const tip = await tipEntry(hotel, id, cursor);
  if (!tip || tip.undone) return null;
  if (tip.byUid !== actor.uid) return null;
  if (now.toMillis() - tip.at.toMillis() > COALESCE_WINDOW_MS) return null;

  const col = historyCol(hotel, id);
  const ref = col.doc(String(tip.seq).padStart(9, "0"));

  // Shape 1 — the same field, edited again.
  if (sameTarget(tip.target, change.target)) {
    if (sameValue(tip.before, change.after)) {
      await ref.delete();
      const prev = await prevActiveSeq(hotel, id, tip.seq);
      return { histSeq: prev, histCursor: prev };
    }
    await ref.update({
      after: change.after,
      label: labelFor(change.target, tip.before, change.after, content),
      at: now,
    });
    return cursor;
  }

  // Shape 2 — a field of the row this very entry added: keep it one "Přidáno".
  const t = tip.target;
  const c = change.target;
  const isRowAdd =
    (t.kind === "note" || t.kind === "account") && t.field === "row" && tip.before === null && tip.after != null;
  if (isRowAdd && sameRow(t, c) && (c.kind === "note" || c.kind === "account") && c.field !== "row") {
    const merged = { ...(tip.after as Record<string, unknown>), [c.field]: change.after };
    await ref.update({
      after: merged,
      label: addedRowLabel(t.kind as "note" | "account", merged),
      at: now,
    });
    return cursor;
  }

  return null;
}

/**
 * Append the changes from one save as new history entries, discarding any redo
 * tail (entries above the cursor). Returns the new cursor state to persist on
 * the parent doc. No-op (returns the prior state) when there are no changes.
 *
 * A save carrying exactly ONE change is a candidate for coalescing into the tip
 * entry (see tryCoalesce) — a multi-change save is a bulk edit, never typing.
 */
export async function appendHistory(
  hotel: HotelSlug,
  id: string,
  cursor: CursorState,
  changes: HandoverChange[],
  actor: HistoryActor,
  content?: HandoverContent
): Promise<CursorState> {
  if (changes.length === 0) return cursor;

  const at = Timestamp.fromDate(clock.now());
  if (changes.length === 1) {
    const folded = await tryCoalesce(hotel, id, cursor, changes[0], actor, at, content);
    if (folded) return folded;
  }

  const col = historyCol(hotel, id);
  const batch = admin.firestore().batch();

  // Truncate the redo tail: a new edit invalidates everything above the cursor.
  if (cursor.histCursor < cursor.histSeq) {
    const tail = await col.where("seq", ">", cursor.histCursor).get();
    tail.docs.forEach((d) => batch.delete(d.ref));
  }

  let seq = cursor.histCursor; // continue numbering from the (possibly rewound) cursor
  for (const change of changes) {
    seq += 1;
    const entry: HistoryEntry = {
      ...change,
      seq,
      at,
      byUid: actor.uid,
      byEmail: actor.email,
      undone: false,
      ...(actor.viaUid ? { viaUid: actor.viaUid, viaEmail: actor.viaEmail ?? "" } : {}),
    };
    batch.set(col.doc(String(seq).padStart(9, "0")), entry);
  }
  await batch.commit();
  return { histSeq: seq, histCursor: seq };
}

/** The entry at a given seq, or null. */
async function entryAtSeq(hotel: HotelSlug, id: string, seq: number): Promise<HistoryEntry | null> {
  const snap = await historyCol(hotel, id).where("seq", "==", seq).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as HistoryEntry);
}

/** The active entry immediately below `seq` (for the new cursor after an undo). */
async function prevActiveSeq(hotel: HotelSlug, id: string, seq: number): Promise<number> {
  const snap = await historyCol(hotel, id)
    .where("seq", "<", seq)
    .orderBy("seq", "desc")
    .limit(1)
    .get();
  return snap.empty ? 0 : (snap.docs[0].data() as HistoryEntry).seq;
}

/** The lowest entry strictly above the cursor (the next redo target). */
async function nextRedo(hotel: HotelSlug, id: string, cursorSeq: number): Promise<HistoryEntry | null> {
  const snap = await historyCol(hotel, id)
    .where("seq", ">", cursorSeq)
    .orderBy("seq", "asc")
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as HistoryEntry);
}

export interface StepResult {
  change: HandoverChange;
  seq: number;
  cursor: CursorState;
}

/**
 * Compute the next undo step: the entry to reverse and the resulting cursor.
 * Returns null when there is nothing to undo. Does NOT write — the caller
 * applies `change` to the doc and persists `cursor` + marks the entry undone.
 */
export async function planUndo(hotel: HotelSlug, id: string, cursor: CursorState): Promise<StepResult | null> {
  if (cursor.histCursor <= 0) return null;
  const entry = await entryAtSeq(hotel, id, cursor.histCursor);
  if (!entry) return null;
  // The creation marker is the floor of the stack — you cannot undo the protocol
  // into existence. Deleting it is what DELETE /:hotel/:id is for.
  if (entry.target.kind === "created") return null;
  const newCursor = await prevActiveSeq(hotel, id, entry.seq);
  return { change: entry, seq: entry.seq, cursor: { histSeq: cursor.histSeq, histCursor: newCursor } };
}

/** Compute the next redo step, or null when there is nothing to redo. */
export async function planRedo(hotel: HotelSlug, id: string, cursor: CursorState): Promise<StepResult | null> {
  if (cursor.histCursor >= cursor.histSeq) return null;
  const entry = await nextRedo(hotel, id, cursor.histCursor);
  if (!entry) return null;
  return { change: entry, seq: entry.seq, cursor: { histSeq: cursor.histSeq, histCursor: entry.seq } };
}

/** Flag a history entry as (un)done after an undo/redo has been applied. */
export async function markUndone(hotel: HotelSlug, id: string, seq: number, undone: boolean): Promise<void> {
  await historyCol(hotel, id).doc(String(seq).padStart(9, "0")).set({ undone }, { merge: true });
}

export async function canUndoRedo(hotel: HotelSlug, id: string, cursor: CursorState): Promise<{ canUndo: boolean; canRedo: boolean }> {
  // Sitting on the creation marker means the stack is exhausted — mirrors the
  // floor check in planUndo, so the button never offers an undo that 409s.
  let canUndo = cursor.histCursor > 0;
  if (canUndo) {
    const entry = await entryAtSeq(hotel, id, cursor.histCursor);
    if (entry?.target.kind === "created") canUndo = false;
  }
  return { canUndo, canRedo: cursor.histCursor < cursor.histSeq };
}
