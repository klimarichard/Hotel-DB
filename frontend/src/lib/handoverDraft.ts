/**
 * Crash-safe draft buffer for the předávací protokol.
 *
 * The protokol autosaves, so a draft normally lives for under a second. It
 * matters in exactly the cases where the save does NOT go through: a 409
 * conflict (autosave is paused until the user resolves it), a network drop, an
 * expired session, or the browser being closed mid-edit. Without a buffer those
 * edits exist only in React state and die with the tab — which is precisely how
 * a counted trezor can vanish between the morning and the evening.
 *
 * Why localStorage and not the backend (the project's usual rule is that all
 * client state persists through /api/*): this is not user state, it is an
 * unsent WRITE. Sending it to the server is the very thing that failed, and a
 * draft endpoint would need the same round-trip that is broken. It also must
 * survive an offline reload, which nothing server-side can.
 *
 * Two consequences the key layout has to respect:
 *   • Reception runs on SHARED terminal accounts, so the uid alone does not
 *     identify a person. A draft is therefore scoped to uid + hotel + shift and
 *     always shown with the timestamp it was captured at, so whoever sees the
 *     prompt can tell whether it is theirs.
 *   • Anything left behind expires. A stale draft that resurfaced days later
 *     could re-apply an old cash count over a fresh one, so entries older than
 *     TTL_MS are ignored on read and swept on write.
 */
import type { HandoverPayload } from "./handoverMerge";

const PREFIX = "hotel_hr_handover_draft_";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface HandoverDraft {
  /** Epoch millis the draft was captured. */
  savedAt: number;
  /** The version the edits are derived from – the merge's common ancestor. */
  base: HandoverPayload;
  /** The unsaved edits themselves. */
  payload: HandoverPayload;
  /** `updatedAt` millis of the doc the edits were based on (diagnostics only). */
  baseUpdatedAt: number | null;
  /** True when the draft was parked by an unresolved 409, not just by autosave. */
  conflicted: boolean;
}

function keyFor(uid: string, hotel: string, docId: string): string {
  return `${PREFIX}${uid}_${hotel}_${docId}`;
}

/** localStorage throws in private-mode Safari and when the quota is full; a
 *  draft is a safety net, so every access degrades to "no draft" rather than
 *  taking the protokol down with it. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Drop every expired draft. Cheap – there are at most a handful of keys. */
function sweep(): void {
  safe(() => {
    const now = Date.now();
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) {
        doomed.push(k);
        continue;
      }
      try {
        const d = JSON.parse(raw) as HandoverDraft;
        if (!d?.savedAt || now - d.savedAt > TTL_MS) doomed.push(k);
      } catch {
        doomed.push(k);
      }
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  }, undefined);
}

export function saveDraft(
  uid: string,
  hotel: string,
  docId: string,
  draft: Omit<HandoverDraft, "savedAt">
): void {
  if (!uid) return;
  safe(() => {
    localStorage.setItem(keyFor(uid, hotel, docId), JSON.stringify({ ...draft, savedAt: Date.now() }));
    sweep();
  }, undefined);
}

export function readDraft(uid: string, hotel: string, docId: string): HandoverDraft | null {
  if (!uid) return null;
  return safe(() => {
    const raw = localStorage.getItem(keyFor(uid, hotel, docId));
    if (!raw) return null;
    const d = JSON.parse(raw) as HandoverDraft;
    if (!d?.savedAt || !d.payload || !d.base) return null;
    if (Date.now() - d.savedAt > TTL_MS) {
      localStorage.removeItem(keyFor(uid, hotel, docId));
      return null;
    }
    return d;
  }, null);
}

export function clearDraft(uid: string, hotel: string, docId: string): void {
  if (!uid) return;
  safe(() => localStorage.removeItem(keyFor(uid, hotel, docId)), undefined);
}

/** "18. 8. 11:04" – shown in the recovery prompt so a shared-terminal user can
 *  tell whose unsaved work this is. */
export function draftStamp(savedAt: number): string {
  const d = new Date(savedAt);
  const date = `${d.getDate()}. ${d.getMonth() + 1}.`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}
