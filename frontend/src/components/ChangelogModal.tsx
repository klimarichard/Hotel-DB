import { Fragment } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import { CHANGELOG } from "@/lib/changelog";
import styles from "./ChangelogModal.module.css";

/** Czech-formatted date, e.g. "10. 7. 2026". */
function formatDateCZ(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}

/** Major 0 = built before the v1.0.0 production launch, never ran in prod. */
function isPreRelease(version: string): boolean {
  return version.split(".")[0] === "0";
}

/**
 * Read-only list of app release notes, opened by clicking the version in the
 * footer (gated by `system.version.changelog`). Content lives in
 * `lib/changelog.ts`. Closes only via its buttons — never backdrop click.
 */
export default function ChangelogModal({ onClose }: { onClose: () => void }) {
  const firstPreRelease = CHANGELOG.findIndex((e) => isPreRelease(e.version));

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Změny v aplikaci</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onClose} />
        </div>
        <div className={styles.body}>
          {CHANGELOG.map((entry, idx) => (
            <Fragment key={entry.version}>
              {idx === firstPreRelease && (
                <div className={styles.preReleaseDivider}>
                  Vývojové verze (před spuštěním)
                </div>
              )}
              <section className={styles.entry}>
                <div className={styles.entryHead}>
                  <span className={styles.version}>v{entry.version}</span>
                  <span className={styles.date}>{formatDateCZ(entry.date)}</span>
                </div>
                <ul className={styles.changes}>
                  {entry.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </section>
            </Fragment>
          ))}
        </div>
        <div className={styles.footer}>
          <Button type="button" onClick={onClose}>
            Zavřít
          </Button>
        </div>
      </div>
    </div>
  );
}
