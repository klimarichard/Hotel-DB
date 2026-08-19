/**
 * Three-way merge for the předávací protokol.
 *
 * When a content save is rejected with 409 (another user moved the document
 * since we loaded it) the user's edits are still sitting in the browser and
 * would otherwise be thrown away. This module turns that situation into a
 * decidable one by diffing at the ELEMENT level against the common ancestor:
 *
 *      base    – the version the local edits are derived from
 *                (exactly what `savedPayloadRef` holds in HandoverTab)
 *      mine    – the current, unsaved UI state
 *      theirs  – the server's current version (the 409 body's `current`)
 *
 * Why the base is not optional: with only "mine vs theirs" you cannot tell
 * "I set trezor 500 Kč to 20 ks" apart from "I never touched it and THEY set it
 * to 20 ks". For cash counts that distinction is the whole point — merging
 * without it invents or destroys money. With the base, every element falls into
 * one of four buckets: nobody changed it, only I did (safe to apply), only they
 * did (keep theirs, no question asked), or both did (a real conflict that a
 * human must decide).
 *
 * Element granularity mirrors the server's own history diff
 * (functions/src/services/handoverHistory.ts): one item per cash denomination,
 * per sm count, and per note/účet field, so two people editing different rows of
 * the same table never collide.
 *
 * Everything here is pure — no React, no network — so the merge can be reasoned
 * about (and later unit-tested) on its own.
 *
 * ASSUMPTION — note/účet rows are identified by their `id`. Every row this app
 * writes carries one (the editor mints it on Přidat, `toPayload` sends it, and
 * the server preserves it), so the diff can match rows across the three sides.
 * The server does NOT mint ids for rows that arrive without one, so a row
 * written by something other than this frontend would be seen as "deleted here,
 * added there" rather than matched. There are no such rows in production, and
 * the failure mode is a noisy plan rather than lost or duplicated money.
 */

export type DrawerKey = "kasaCZK" | "trezorCZK" | "kasaEUR" | "trezorEUR";

export interface NoteRow {
  id: string;
  text: string;
  done: boolean;
  locked: boolean;
}

export interface AccountRow {
  id: string;
  name: string;
  amount: number;
  locked: boolean;
}

/** The four content fields the protokol's content PUT carries. */
export interface HandoverPayload {
  notes: NoteRow[];
  cashCounts: Record<DrawerKey, Record<string, number>>;
  accounts: AccountRow[];
  smCounts: [number, number, number];
}

const DRAWERS: readonly DrawerKey[] = ["kasaCZK", "trezorCZK", "kasaEUR", "trezorEUR"];

const DRAWER_LABEL: Record<DrawerKey, { place: string; cur: string }> = {
  kasaCZK: { place: "Kasa", cur: "Kč" },
  trezorCZK: { place: "Trezor", cur: "Kč" },
  kasaEUR: { place: "Kasa", cur: "€" },
  trezorEUR: { place: "Trezor", cur: "€" },
};

/** `_row` addresses the row's existence (added / deleted); anything else a field. */
export const ROW_FIELD = "_row";

export interface ElementRef {
  kind: "cash" | "sm" | "note" | "account";
  /** cash → drawer key; note/account → row id; sm → "". */
  id: string;
  /** cash → denomination; sm → index; note/account → field name or `_row`. */
  field: string;
}

export type ElementValue = number | string | boolean | NoteRow | AccountRow | null;

export interface ElementChange {
  ref: ElementRef;
  before: ElementValue;
  after: ElementValue;
}

function keyOf(ref: ElementRef): string {
  return `${ref.kind}|${ref.id}|${ref.field}`;
}

function sameValue(a: ElementValue, b: ElementValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function rowsById<T extends { id: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (r && typeof r.id === "string") m.set(r.id, r);
  return m;
}

/**
 * Element-level diff of two payloads. Absent cash denominations count as 0, so
 * "cleared the field" and "typed 0" are the same change — matching how the
 * server stores counts (it deletes zeros rather than writing them).
 */
export function diffPayload(base: HandoverPayload, next: HandoverPayload): Map<string, ElementChange> {
  const out = new Map<string, ElementChange>();
  const push = (ref: ElementRef, before: ElementValue, after: ElementValue) => {
    if (!sameValue(before, after)) out.set(keyOf(ref), { ref, before, after });
  };

  // Cash: one item per drawer × denomination.
  for (const drawer of DRAWERS) {
    const b = base.cashCounts?.[drawer] ?? {};
    const n = next.cashCounts?.[drawer] ?? {};
    const denoms = new Set([...Object.keys(b), ...Object.keys(n)]);
    for (const denom of denoms) {
      push({ kind: "cash", id: drawer, field: denom }, b[denom] ?? 0, n[denom] ?? 0);
    }
  }

  // sm counts: three fixed slots.
  for (let i = 0; i < 3; i++) {
    push({ kind: "sm", id: "", field: String(i) }, base.smCounts?.[i] ?? 0, next.smCounts?.[i] ?? 0);
  }

  // Notes / účty: row existence first, then the individual fields of rows that
  // exist on both sides. A row present on one side only produces exactly ONE
  // item (`_row`), never a pile of per-field items.
  const noteFields: (keyof NoteRow)[] = ["text", "done", "locked"];
  const accFields: (keyof AccountRow)[] = ["name", "amount", "locked"];

  const diffRows = <T extends { id: string }>(
    kind: "note" | "account",
    baseRows: T[],
    nextRows: T[],
    fields: (keyof T)[]
  ) => {
    const b = rowsById(baseRows);
    const n = rowsById(nextRows);
    for (const id of new Set([...b.keys(), ...n.keys()])) {
      const br = b.get(id);
      const nr = n.get(id);
      if (!br || !nr) {
        push({ kind, id, field: ROW_FIELD }, (br ?? null) as ElementValue, (nr ?? null) as ElementValue);
        continue;
      }
      for (const f of fields) {
        push({ kind, id, field: String(f) }, br[f] as ElementValue, nr[f] as ElementValue);
      }
    }
  };

  diffRows<NoteRow>("note", base.notes ?? [], next.notes ?? [], noteFields);
  diffRows<AccountRow>("account", base.accounts ?? [], next.accounts ?? [], accFields);

  return out;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

function snippet(text: string, max = 28): string {
  const t = (text ?? "").trim();
  if (!t) return "bez textu";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The row a ref points at, taken from whichever side still has it. */
function findRow(ref: ElementRef, sides: HandoverPayload[]): NoteRow | AccountRow | null {
  for (const s of sides) {
    const rows = ref.kind === "note" ? s.notes : s.accounts;
    const hit = (rows ?? []).find((r) => r.id === ref.id);
    if (hit) return hit;
  }
  return null;
}

const NOTE_FIELD_LABEL: Record<string, string> = { text: "text", done: "hotovo", locked: "zámek" };
const ACC_FIELD_LABEL: Record<string, string> = { name: "název", amount: "částka", locked: "zámek" };

/** Human label for one element, e.g. „Trezor 500 Kč" or „Účet „PHM" – částka". */
export function labelFor(ref: ElementRef, sides: HandoverPayload[]): string {
  if (ref.kind === "cash") {
    const d = DRAWER_LABEL[ref.id as DrawerKey];
    return d ? `${d.place} ${ref.field} ${d.cur}` : `${ref.id} ${ref.field}`;
  }
  if (ref.kind === "sm") return `SM počet #${Number(ref.field) + 1}`;

  const row = findRow(ref, sides);
  if (ref.kind === "note") {
    const head = `Poznámka „${snippet((row as NoteRow | null)?.text ?? "")}"`;
    return ref.field === ROW_FIELD ? head : `${head} – ${NOTE_FIELD_LABEL[ref.field] ?? ref.field}`;
  }
  const head = `Účet „${snippet((row as AccountRow | null)?.name ?? "")}"`;
  return ref.field === ROW_FIELD ? head : `${head} – ${ACC_FIELD_LABEL[ref.field] ?? ref.field}`;
}

const NUM = (n: number) => n.toLocaleString("cs-CZ");

/** Display form of one element value. An absent row renders as an en dash. */
export function formatValue(ref: ElementRef, v: ElementValue): string {
  if (ref.field === ROW_FIELD) {
    if (v === null || typeof v !== "object") return "–";
    if (ref.kind === "note") return `„${snippet((v as NoteRow).text)}"`;
    const a = v as AccountRow;
    return `„${snippet(a.name)}" (${NUM(a.amount ?? 0)} Kč)`;
  }
  if (ref.kind === "cash") return `${NUM(Number(v) || 0)} ks`;
  if (ref.kind === "sm") return NUM(Number(v) || 0);
  if (typeof v === "boolean") return v ? "ano" : "ne";
  if (ref.kind === "account" && ref.field === "amount") return `${NUM(Number(v) || 0)} Kč`;
  const s = String(v ?? "");
  return s.trim() ? `„${snippet(s, 40)}"` : "–";
}

// ─── Merge plan ──────────────────────────────────────────────────────────────

export interface MergeItem {
  key: string;
  ref: ElementRef;
  label: string;
  base: ElementValue;
  mine: ElementValue;
  theirs: ElementValue;
  /** Both sides moved this element away from the base, to different values. */
  conflicting: boolean;
  /** False when the change cannot be replayed at all (its row is gone). */
  applicable: boolean;
  /** Czech explanation shown when `applicable` is false. */
  blockedReason?: string;
  /** Whether the user wants this change carried over. */
  apply: boolean;
}

export interface MergePlan {
  /** My unsaved changes, each decidable on its own. */
  items: MergeItem[];
  /** What the other user changed – read-only context, never applied from here. */
  theirItems: MergeItem[];
}

/**
 * Build the decision list. Changes both sides made IDENTICALLY are dropped
 * entirely: the server already holds the value I wanted, so there is nothing to
 * decide and nothing to show.
 *
 * Defaults are deliberately conservative — a non-conflicting change is
 * pre-selected (it is pure gain), a conflicting one is NOT. Where two people
 * counted the same drawer, the newer count on the server stands unless the user
 * deliberately ticks their own.
 */
export function buildMergePlan(base: HandoverPayload, mine: HandoverPayload, theirs: HandoverPayload): MergePlan {
  const myChanges = diffPayload(base, mine);
  const theirChanges = diffPayload(base, theirs);
  const sides = [mine, theirs, base];

  const theirRowIds = {
    note: new Set((theirs.notes ?? []).map((r) => r.id)),
    account: new Set((theirs.accounts ?? []).map((r) => r.id)),
  };

  const items: MergeItem[] = [];
  for (const [key, mineChange] of myChanges) {
    const ref = mineChange.ref;
    const theirChange = theirChanges.get(key);
    if (theirChange && sameValue(theirChange.after, mineChange.after)) continue; // already there

    const conflicting = !!theirChange;

    // A field change whose row no longer exists on the server cannot be replayed:
    // there is nothing to write it into. Surfaced rather than silently dropped.
    let applicable = true;
    let blockedReason: string | undefined;
    if ((ref.kind === "note" || ref.kind === "account") && ref.field !== ROW_FIELD) {
      if (!theirRowIds[ref.kind].has(ref.id)) {
        applicable = false;
        blockedReason = "Řádek byl mezitím smazán jiným uživatelem.";
      }
    }

    items.push({
      key,
      ref,
      label: labelFor(ref, sides),
      base: mineChange.before,
      mine: mineChange.after,
      theirs: theirChange ? theirChange.after : mineChange.before,
      conflicting,
      applicable,
      blockedReason,
      apply: applicable && !conflicting,
    });
  }

  const theirItems: MergeItem[] = [];
  for (const [key, ch] of theirChanges) {
    if (myChanges.has(key)) continue; // already listed as a conflict above
    theirItems.push({
      key,
      ref: ch.ref,
      label: labelFor(ch.ref, sides),
      base: ch.before,
      mine: ch.before,
      theirs: ch.after,
      conflicting: false,
      applicable: false,
      apply: false,
    });
  }

  const order = (i: MergeItem) => (i.conflicting ? 0 : i.applicable ? 1 : 2);
  items.sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, "cs"));
  theirItems.sort((a, b) => a.label.localeCompare(b.label, "cs"));

  return { items, theirItems };
}

/**
 * Produce the payload to save: the server's current version with every selected
 * change of mine laid on top. Unselected and inapplicable items are dropped, so
 * the result never contains a value the user did not agree to.
 */
export function applyMerge(theirs: HandoverPayload, items: MergeItem[]): HandoverPayload {
  const out: HandoverPayload = {
    notes: clone(theirs.notes ?? []),
    accounts: clone(theirs.accounts ?? []),
    cashCounts: {
      kasaCZK: { ...(theirs.cashCounts?.kasaCZK ?? {}) },
      trezorCZK: { ...(theirs.cashCounts?.trezorCZK ?? {}) },
      kasaEUR: { ...(theirs.cashCounts?.kasaEUR ?? {}) },
      trezorEUR: { ...(theirs.cashCounts?.trezorEUR ?? {}) },
    },
    smCounts: [...(theirs.smCounts ?? [0, 0, 0])] as [number, number, number],
  };

  for (const item of items) {
    if (!item.apply || !item.applicable) continue;
    const { ref } = item;

    if (ref.kind === "cash") {
      const drawer = out.cashCounts[ref.id as DrawerKey];
      const n = Number(item.mine) || 0;
      if (n > 0) drawer[ref.field] = Math.floor(n);
      else delete drawer[ref.field];
      continue;
    }

    if (ref.kind === "sm") {
      const i = Number(ref.field);
      if (i >= 0 && i < 3) out.smCounts[i] = Number(item.mine) || 0;
      continue;
    }

    const rows: Array<NoteRow | AccountRow> = ref.kind === "note" ? out.notes : out.accounts;
    if (ref.field === ROW_FIELD) {
      const idx = rows.findIndex((r) => r.id === ref.id);
      if (item.mine === null) {
        // I deleted the row → drop it if it is still there.
        if (idx >= 0) rows.splice(idx, 1);
      } else if (idx < 0) {
        // I added the row → append it (order is not load-bearing for either table).
        rows.push(clone(item.mine as NoteRow | AccountRow));
      }
      continue;
    }

    const row = rows.find((r) => r.id === ref.id);
    if (!row) continue; // guarded by `applicable`, belt and braces
    (row as unknown as Record<string, ElementValue>)[ref.field] = item.mine;
  }

  return out;
}

/** Convenience: does this plan contain anything the user still has to decide? */
export function hasDecisions(plan: MergePlan): boolean {
  return plan.items.length > 0;
}
