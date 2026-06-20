import { useState } from "react";
import { Link } from "react-router-dom";
import {
  actionVerb,
  eventLabel,
  fieldLabel,
  subjectNoun,
} from "@/lib/audit/labels";
import { formatAuditValue } from "@/lib/audit/format";
import type { AuditEvent } from "@/lib/audit/grouping";
import styles from "./AuditEventCard.module.css";

export type RefResolver = (fieldLeaf: string, value: unknown) => string | null;

interface Props {
  event: AuditEvent;
  authorName: string;
  title: string;
  titleHref?: string;
  /** Tighter layout, for the employee-detail mini-list. */
  compact?: boolean;
  /** Hide the author on the header line. */
  hideAuthor?: boolean;
  /** Hide the record title (e.g. on the employee-detail page, where the
   *  record is already implied by the page). */
  hideTitle?: boolean;
  /** Resolve an internal-reference value (e.g. employmentRowId) to a human
   *  label. Returns null to fall back to default rendering / hiding. */
  resolveRef?: RefResolver;
}

// Bulky or internal fields hidden from the readable view (still in raw detail).
const HIDDEN_FIELDS = new Set([
  "rowSnapshot",
  "htmlContent",
  "htmlContentLength",
  "unsignedStoragePath",
  "signedStoragePath",
  "hasUnsignedPdf",
]);
// Internal foreign-key fields shown only when a resolver labels them.
const REF_FIELDS = new Set(["employmentRowId"]);

function formatTime(d: Date | null, withDate: boolean): string {
  if (!d) return "—";
  return d.toLocaleString("cs-CZ", {
    ...(withDate ? { day: "2-digit", month: "2-digit", year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function czChangeCount(n: number): string {
  if (n === 1) return "1 změna";
  if (n >= 2 && n <= 4) return `${n} změny`;
  return `${n} změn`;
}

/** Display string for a value, or null when the field should be hidden. */
function displayValue(leaf: string | undefined, value: unknown, resolveRef?: RefResolver): string | null {
  const key = leaf ?? "";
  if (HIDDEN_FIELDS.has(key)) return null;
  if (resolveRef) {
    const resolved = resolveRef(key, value);
    if (resolved != null) return resolved;
  }
  if (REF_FIELDS.has(key)) return null;
  return formatAuditValue(value, leaf);
}

export default function AuditEventCard({
  event,
  authorName,
  title,
  titleHref,
  compact = false,
  hideAuthor = false,
  hideTitle = false,
  resolveRef,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const hasSubject =
    event.action === "create" || event.action === "update" || event.action === "delete";
  // Multi-area employee edits keep the generic root subject ("zaměstnance");
  // single-area edits use the specific area noun ("kontaktní údaje").
  const subjectColl =
    event.action === "update" && event.sections.length > 1
      ? event.collectionRoot
      : event.primaryCollection;
  // A semantic event (approval/rejection/free-claim/Systém auto-action) carries
  // its own full phrase; otherwise fall back to the generic "<verb> <noun>".
  const semanticHeader = eventLabel(event.event);
  const headerVerb =
    semanticHeader ?? actionVerb(event.action) + (hasSubject ? ` ${subjectNoun(subjectColl)}` : "");

  // Suppress the "· N změny" meta for semantic events — the status change is
  // already conveyed by the phrase ("Schválení …"), so the count is noise.
  const changeCount =
    !semanticHeader && event.action === "update"
      ? event.sections.reduce((n, s) => n + s.changes.length, 0)
      : 0;

  const titleNode = titleHref ? (
    <Link to={titleHref} className={styles.titleLink} onClick={(e) => e.stopPropagation()}>
      {title}
    </Link>
  ) : (
    <span className={styles.titleText}>{title}</span>
  );

  // Visible summary / extra entries (create/delete snapshot, reveal/export/trigger extras)
  const summaryRows = event.summary
    ? Object.entries(event.summary)
        .map(([k, v]) => ({ k, label: fieldLabel(event.primaryCollection, k), disp: displayValue(k.split(".").pop(), v, resolveRef) }))
        .filter((r) => r.disp != null)
    : [];
  const extraRows = event.extra
    ? Object.entries(event.extra)
        .map(([k, v]) => ({ k, label: fieldLabel(event.primaryCollection, k), disp: displayValue(k.split(".").pop(), v, resolveRef) }))
        .filter((r) => r.disp != null)
    : [];

  const toggle = () => setExpanded((e) => !e);

  return (
    <div className={`${styles.card} ${styles["action_" + event.action] ?? ""} ${compact ? styles.compact : ""}`}>
      <div
        className={styles.head}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className={styles.chev} aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span className={styles.action}>{headerVerb}</span>
        {!hideTitle && title && (
          <>
            <span className={styles.sep}>—</span>
            {titleNode}
          </>
        )}
        {changeCount > 0 && <span className={styles.meta}>· {czChangeCount(changeCount)}</span>}
        <span className={styles.spacer} />
        {!hideAuthor && <span className={styles.author}>{authorName}</span>}
        <time className={styles.time}>{formatTime(event.timestamp, !compact)}</time>
      </div>

      {expanded && (
        <div className={styles.body}>
          {/* update: changed fields, sub-grouped by section */}
          {event.action === "update" &&
            event.sections.map((section, i) => {
              const rows = section.changes
                .map((c) => ({
                  c,
                  oldDisp: displayValue(c.leaf, c.oldValue, resolveRef),
                  newDisp: displayValue(c.leaf, c.newValue, resolveRef),
                }))
                .filter((r) => r.c.redacted || r.oldDisp != null || r.newDisp != null);
              if (rows.length === 0) return null;
              return (
                <div key={i} className={styles.section}>
                  {event.sections.length > 1 && <div className={styles.sectionLabel}>{section.label}</div>}
                  <dl className={styles.changes}>
                    {rows.map(({ c, oldDisp, newDisp }, j) => (
                      <div key={j} className={styles.changeRow}>
                        <dt className={styles.fieldName}>{c.label}</dt>
                        <dd className={styles.changeVal}>
                          {c.redacted ? (
                            <span className={styles.redacted}>citlivý údaj změněn</span>
                          ) : (
                            <>
                              <span className={styles.oldVal}>{oldDisp ?? "—"}</span>
                              <span className={styles.arrow}>→</span>
                              <span className={styles.newVal}>{newDisp ?? "—"}</span>
                            </>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}

          {/* create / delete snapshot + reveal/export/trigger extras */}
          {(summaryRows.length > 0 || extraRows.length > 0) && (
            <dl className={styles.changes}>
              {[...summaryRows, ...extraRows].map((r) => (
                <div key={r.k} className={styles.changeRow}>
                  <dt className={styles.fieldName}>{r.label}</dt>
                  <dd className={styles.changeVal}>
                    <span className={styles.newVal}>{r.disp}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <button type="button" className={styles.rawToggle} onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "Skrýt technický detail" : "Technický detail"}
          </button>
          {showRaw && <pre className={styles.json}>{JSON.stringify(event.entries, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
