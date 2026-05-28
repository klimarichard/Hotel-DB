import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ACTION_LABELS,
  actionGlyph,
  actionVerb,
  collectionLabel,
  fieldLabel,
} from "@/lib/audit/labels";
import { formatAuditValue } from "@/lib/audit/format";
import type { AuditEvent } from "@/lib/audit/grouping";
import styles from "./AuditEventCard.module.css";

interface Props {
  event: AuditEvent;
  authorName: string;
  title: string;
  titleHref?: string;
  /** Tighter layout, for the employee-detail mini-list. */
  compact?: boolean;
  /** Hide the author line (already implied by context). */
  hideAuthor?: boolean;
  /** Hide the record title (e.g. on the employee-detail page, where the
   *  record is already implied by the page). */
  hideTitle?: boolean;
}

function formatTime(d: Date | null, withDate: boolean): string {
  if (!d) return "—";
  return d.toLocaleString("cs-CZ", {
    ...(withDate ? { day: "2-digit", month: "2-digit", year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditEventCard({
  event,
  authorName,
  title,
  titleHref,
  compact = false,
  hideAuthor = false,
  hideTitle = false,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const isEmployee = event.collectionRoot === "employees";
  const nounSuffix =
    isEmployee && (event.action === "update" || event.action === "create" || event.action === "delete")
      ? " zaměstnance"
      : "";

  const titleNode = titleHref ? (
    <Link to={titleHref} className={styles.titleLink}>
      {title}
    </Link>
  ) : (
    <span className={styles.titleText}>{title}</span>
  );

  const summaryEntries = event.summary
    ? Object.entries(event.summary).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];
  const extraEntries = event.extra
    ? Object.entries(event.extra).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];

  return (
    <div className={`${styles.card} ${styles["action_" + event.action] ?? ""} ${compact ? styles.compact : ""}`}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <span className={styles.glyph} aria-hidden="true">
            {actionGlyph(event.action)}
          </span>
          <span className={styles.action}>
            {actionVerb(event.action)}
            {nounSuffix}
          </span>
          {!hideTitle && (
            <>
              <span className={styles.sep}>—</span>
              {titleNode}
            </>
          )}
          {!isEmployee && (
            <span className={styles.collTag}>{collectionLabel(event.primaryCollection)}</span>
          )}
        </div>
        <time className={styles.time} title={ACTION_LABELS[event.action]}>
          {formatTime(event.timestamp, !compact)}
        </time>
      </div>

      {!hideAuthor && (
        <div className={styles.author}>
          {authorName}
          {event.userRole && <span className={styles.role}> · {event.userRole}</span>}
        </div>
      )}

      {/* update: changed fields, sub-grouped by section */}
      {event.action === "update" && event.sections.length > 0 && (
        <div className={styles.body}>
          {event.sections.map((section, i) => (
            <div key={i} className={styles.section}>
              {event.sections.length > 1 && <div className={styles.sectionLabel}>{section.label}</div>}
              <dl className={styles.changes}>
                {section.changes.map((c, j) => (
                  <div key={j} className={styles.changeRow}>
                    <dt className={styles.fieldName}>{c.label}</dt>
                    <dd className={styles.changeVal}>
                      {c.redacted ? (
                        <span className={styles.redacted}>citlivý údaj změněn</span>
                      ) : (
                        <>
                          <span className={styles.oldVal}>{formatAuditValue(c.oldValue, c.leaf)}</span>
                          <span className={styles.arrow}>→</span>
                          <span className={styles.newVal}>{formatAuditValue(c.newValue, c.leaf)}</span>
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* create / delete: optional record snapshot */}
      {(event.action === "create" || event.action === "delete") && summaryEntries.length > 0 && (
        <div className={styles.body}>
          <button type="button" className={styles.linkBtn} onClick={() => setShowSummary((s) => !s)}>
            {showSummary ? "Skrýt údaje" : "Zobrazit údaje"}
          </button>
          {showSummary && (
            <dl className={styles.changes}>
              {summaryEntries.map(([k, v]) => (
                <div key={k} className={styles.changeRow}>
                  <dt className={styles.fieldName}>{fieldLabel(event.primaryCollection, k)}</dt>
                  <dd className={styles.changeVal}>
                    <span className={styles.newVal}>
                      {formatAuditValue(v, k.split(".").pop())}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* reveal / export / manual-trigger: free-form extras */}
      {extraEntries.length > 0 && (
        <div className={styles.body}>
          <dl className={styles.changes}>
            {extraEntries.map(([k, v]) => (
              <div key={k} className={styles.changeRow}>
                <dt className={styles.fieldName}>{fieldLabel(event.primaryCollection, k)}</dt>
                <dd className={styles.changeVal}>
                  <span className={styles.newVal}>{formatAuditValue(v, k.split(".").pop())}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className={styles.foot}>
        <button type="button" className={styles.rawToggle} onClick={() => setShowRaw((s) => !s)}>
          {showRaw ? "Skrýt technický detail" : "Technický detail"}
        </button>
      </div>
      {showRaw && <pre className={styles.json}>{JSON.stringify(event.entries, null, 2)}</pre>}
    </div>
  );
}
