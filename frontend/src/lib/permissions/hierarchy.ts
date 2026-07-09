/**
 * Dependency-resolution for the hierarchical permission matrix. Pure + framework-
 * free so it's unit-testable and shared by both editors (UserTypesTab + the
 * per-user UserPermissionsModal). The hierarchy is a UI affordance only – the
 * backend stores/validates a flat array and never sees any of this.
 *
 * Rules (from PERMISSIONS_LIST.md, see catalog.ts):
 *  - A section master (level 0) is always toggleable; it gates the whole section.
 *  - A level-1 item is enabled (clickable) only when its section master is checked.
 *  - A level-N≥2 item is enabled only when its parent – the nearest preceding
 *    level-(N-1) item within the same subsection – is checked.
 *  - Unchecking a parent cascades off all its descendants (the contiguous run of
 *    deeper-level items after it, up to the next equal-or-higher-order item or the
 *    end of the subsection; the master's subtree is the whole section).
 *  - `exclusiveGroup` siblings are mutually exclusive: checking one unchecks the
 *    others (and cascades off their descendants).
 */
import { PERMISSION_SECTIONS, NON_GRANTABLE_PERMISSIONS, type PermItem, type PermSubsection } from "./catalog";

interface FlatItem {
  key: string;
  label: string;
  level: number;
  exclusiveGroup?: string;
  spaceBefore: boolean;
  grantable: boolean;
  flatIdx: number;
  sectionIdx: number;
  subStart: number; // first flatIdx of this item's subsection
  subEnd: number; // one past the last flatIdx of this item's subsection
  masterIdx: number; // flatIdx of this section's level-0 master
  parentIdx: number | null; // null only for masters
  descendantIdxs: number[];
}

// ── Build the flat, resolved item table once at module load ──────────────────
const FLAT: FlatItem[] = [];
PERMISSION_SECTIONS.forEach((section, sectionIdx) => {
  const sectionStart = FLAT.length;
  section.subsections.forEach((sub) => {
    const subStart = FLAT.length;
    sub.items.forEach((raw) => {
      const it: PermItem = raw;
      FLAT.push({
        key: it.key,
        label: it.label,
        level: it.level,
        exclusiveGroup: it.exclusiveGroup,
        spaceBefore: !!it.spaceBefore,
        grantable: !NON_GRANTABLE_PERMISSIONS.has(it.key),
        flatIdx: FLAT.length,
        sectionIdx,
        subStart,
        subEnd: -1, // back-filled below
        masterIdx: -1, // back-filled below
        parentIdx: null, // resolved below
        descendantIdxs: [],
      });
    });
    const subEnd = FLAT.length;
    for (let i = subStart; i < subEnd; i++) FLAT[i].subEnd = subEnd;
  });
  // The section master is the first item of the section (its sole level-0 item).
  for (let i = sectionStart; i < FLAT.length; i++) FLAT[i].masterIdx = sectionStart;
});

// parentIdx
for (const it of FLAT) {
  if (it.level === 0) {
    it.parentIdx = null;
  } else if (it.level === 1) {
    it.parentIdx = it.masterIdx;
  } else {
    let p: number | null = null;
    for (let i = it.flatIdx - 1; i >= it.subStart; i--) {
      if (FLAT[i].level === it.level - 1) {
        p = i;
        break;
      }
      if (FLAT[i].level < it.level - 1) break; // crossed out of this branch
    }
    it.parentIdx = p;
  }
}

// descendantIdxs
for (const it of FLAT) {
  if (it.level === 0) {
    // master → the whole section (every other item in it)
    it.descendantIdxs = FLAT.filter(
      (x) => x.sectionIdx === it.sectionIdx && x.flatIdx !== it.flatIdx
    ).map((x) => x.flatIdx);
    continue;
  }
  const desc: number[] = [];
  for (let i = it.flatIdx + 1; i < it.subEnd; i++) {
    if (FLAT[i].level <= it.level) break; // next equal-or-higher-order item → stop
    desc.push(i);
  }
  it.descendantIdxs = desc;
}

const BY_KEY = new Map<string, number>(FLAT.map((it) => [it.key, it.flatIdx]));
const GROUPS = new Map<string, number[]>();
for (const it of FLAT) {
  if (!it.exclusiveGroup) continue;
  const arr = GROUPS.get(it.exclusiveGroup) ?? [];
  arr.push(it.flatIdx);
  GROUPS.set(it.exclusiveGroup, arr);
}

const parentKeyOf = (it: FlatItem): string | null =>
  it.parentIdx == null ? null : FLAT[it.parentIdx].key;

// ── Public API ───────────────────────────────────────────────────────────────

/** Per-key map of whether the checkbox is clickable given the current checked set. */
export function computeEnabled(checked: ReadonlySet<string>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const it of FLAT) {
    if (it.level === 0) {
      out.set(it.key, true);
      continue;
    }
    const pk = parentKeyOf(it);
    out.set(it.key, pk != null && checked.has(pk));
  }
  return out;
}

/**
 * Return the next checked-set after toggling `key`. Toggling OFF removes the key
 * and all its descendants; toggling ON adds the key and removes any currently-
 * checked exclusive siblings (plus their descendants). Callers should only invoke
 * this for ENABLED keys (the matrix disables the rest); unknown keys are no-ops.
 */
export function resolveToggle(checked: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(checked);
  const idx = BY_KEY.get(key);
  if (idx == null) return next;
  const it = FLAT[idx];
  if (next.has(key)) {
    next.delete(key);
    for (const d of it.descendantIdxs) next.delete(FLAT[d].key);
    return next;
  }
  next.add(key);
  if (it.exclusiveGroup) {
    for (const sibIdx of GROUPS.get(it.exclusiveGroup) ?? []) {
      if (sibIdx === idx) continue;
      const sib = FLAT[sibIdx];
      if (!next.has(sib.key)) continue;
      next.delete(sib.key);
      for (const d of sib.descendantIdxs) next.delete(FLAT[d].key);
    }
  }
  return next;
}

/**
 * Coerce a possibly-non-conforming set into a hierarchy-valid one. Used on save
 * (e.g. cleaning a legacy type whose stored set predates the hierarchy).
 *
 * Repair is capability-PRESERVING: rather than dropping a child whose parent is
 * missing, we add the missing ancestors (a parent is an enabling prerequisite,
 * never more privileged than its child – so adding it can't grant unintended
 * power). Mutual-exclusion conflicts are then resolved by keeping the first-in-
 * order member and dropping the rest with their subtrees. Unknown keys (not in
 * the catalog) pass through untouched – a frontend/backend key gap must never
 * silently drop a stored grant.
 */
export function normalize(set: ReadonlySet<string>): Set<string> {
  const work = new Set<string>(set); // keeps unknown keys as-is
  // Pass A – repair upward: ensure every present item's full ancestor chain.
  for (const it of FLAT) {
    if (!work.has(it.key)) continue;
    let p = it.parentIdx;
    while (p != null) {
      work.add(FLAT[p].key);
      p = FLAT[p].parentIdx;
    }
  }
  // Pass B – mutual exclusion: per group keep the first-in-order member, drop the
  // rest + their now-orphaned subtrees (runs after A so an ancestor A added into a
  // group joins the contest).
  for (const idxs of GROUPS.values()) {
    const present = idxs.filter((i) => work.has(FLAT[i].key));
    if (present.length <= 1) continue;
    for (const i of present.slice(1)) {
      work.delete(FLAT[i].key);
      for (const d of FLAT[i].descendantIdxs) work.delete(FLAT[d].key);
    }
  }
  return work;
}

// ── Render model for the matrix component (optional fields safely normalized) ──
export interface RenderItem {
  key: string;
  label: string;
  level: number;
  exclusiveGroup?: string;
  spaceBefore: boolean;
  grantable: boolean;
}
export interface RenderSubsection {
  title?: string;
  items: RenderItem[];
}
export interface RenderSection {
  title: string;
  subsections: RenderSubsection[];
}

export const RENDER_MODEL: RenderSection[] = PERMISSION_SECTIONS.map((sec) => ({
  title: sec.title,
  subsections: sec.subsections.map((rawSub) => {
    const sub: PermSubsection = rawSub;
    return {
    title: sub.title,
    items: sub.items.map((raw) => {
      const it: PermItem = raw;
      return {
        key: it.key,
        label: it.label,
        level: it.level,
        exclusiveGroup: it.exclusiveGroup,
        spaceBefore: !!it.spaceBefore,
        grantable: !NON_GRANTABLE_PERMISSIONS.has(it.key),
      };
    }),
    };
  }),
}));
