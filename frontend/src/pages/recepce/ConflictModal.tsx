/**
 * The předávací protokol's conflict / unsaved-changes dialog.
 *
 * Replaces the old inline banner. The banner rendered above the cash tables, so
 * anyone scrolled down to the trezor never saw it — and because a raised
 * conflict also PAUSES autosave, every keystroke after that point was silently
 * discarded. A modal cannot be scrolled past, and this one deliberately has no
 * ✕ and no backdrop dismissal: the only ways out are to merge or to discard, so
 * an unresolved conflict can never be left quietly sitting there.
 *
 * It always shows the three-way comparison (původně / moje / na serveru) rather
 * than a yes-no question, because with cash counts the correct answer depends on
 * values the user has to see. Non-conflicting changes come pre-ticked; where
 * both sides moved the same element the tick is OFF, so the other person's newer
 * figure stands unless this user deliberately overrides it.
 */
import { useMemo, useState } from "react";
import Button from "@/components/Button";
import type { MergeItem } from "@/lib/handoverMerge";
import { formatValue } from "@/lib/handoverMerge";
import styles from "./ConflictModal.module.css";

export type ConflictMode = "conflict" | "draft" | "deleted" | "frozen";

interface Props {
  mode: ConflictMode;
  /** Draft mode: when the unsaved changes were captured ("18. 8. 11:04"). */
  stampedAt?: string;
  /** Who moved the document, when the server told us. */
  otherUser?: string | null;
  items: MergeItem[];
  theirItems: MergeItem[];
  busy?: boolean;
  error?: string | null;
  onToggle: (key: string, apply: boolean) => void;
  onToggleAll: (apply: boolean) => void;
  onMerge: () => void;
  onDiscard: () => void;
}

const TITLE: Record<ConflictMode, string> = {
  conflict: "Protokol byl mezitím upraven",
  draft: "Nalezeny neuložené změny",
  deleted: "Protokol byl mezitím smazán",
  frozen: "Protokol byl mezitím podepsán",
};

function intro(mode: ConflictMode, otherUser?: string | null, stampedAt?: string): string {
  const who = otherUser ? `Uživatel ${otherUser}` : "Jiný uživatel";
  switch (mode) {
    case "conflict":
      return `${who} uložil tento protokol dřív, než se stihly uložit vaše úpravy. Vaše změny zatím nejsou uloženy nikde – níže rozhodněte, které se mají přenést do aktuální verze.`;
    case "draft":
      return `Z tohoto protokolu se nepodařilo uložit změny${stampedAt ? ` z ${stampedAt}` : ""}. Zůstaly uložené jen ve vašem prohlížeči. Vyberte, které se mají doplnit do aktuální verze.`;
    case "deleted":
      return "Protokol byl mezitím smazán jiným uživatelem, takže vaše neuložené změny už není kam přenést. Níže je jejich přehled – opište si prosím, co potřebujete, dřív než okno zavřete.";
    case "frozen":
      return `${who} protokol podepsal, takže je uzamčený a změny do něj nelze doplnit. Níže je přehled vašich neuložených změn – opište si je, případně požádejte o odemčení podpisu.`;
  }
}

export default function ConflictModal({
  mode,
  stampedAt,
  otherUser,
  items,
  theirItems,
  busy = false,
  error,
  onToggle,
  onToggleAll,
  onMerge,
  onDiscard,
}: Props) {
  const [copied, setCopied] = useState(false);
  const readOnly = mode === "deleted" || mode === "frozen";

  const selectable = useMemo(() => items.filter((i) => i.applicable), [items]);
  const selectedCount = useMemo(() => items.filter((i) => i.apply && i.applicable).length, [items]);
  const conflictCount = useMemo(() => items.filter((i) => i.conflicting).length, [items]);

  /** Plain-text dump of the pending changes, for when merging is impossible. */
  async function copyList() {
    const lines = items.map(
      (i) => `${i.label}: původně ${formatValue(i.ref, i.base)} → moje ${formatValue(i.ref, i.mine)}` +
        (i.conflicting ? ` (na serveru ${formatValue(i.ref, i.theirs)})` : "")
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (insecure context / permission): the list is on screen
      // anyway, so there is nothing to fall back to.
    }
  }

  return (
    // No onClick on the overlay: this dialog holds unsaved cash figures and must
    // never be dismissible by a stray click (project rule), and in the conflict
    // case it must not be dismissible at all.
    <div className={styles.overlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={TITLE[mode]}>
        <div className={styles.header}>
          <h2 className={styles.title}>{TITLE[mode]}</h2>
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>{intro(mode, otherUser, stampedAt)}</p>

          {conflictCount > 0 && (
            <p className={styles.warn}>
              U {conflictCount === 1 ? "jedné položky" : `${conflictCount} položek`} zapsali hodnotu oba.
              Ty nejsou předvybrané – zaškrtněte je jen tehdy, když má platit vaše hodnota.
            </p>
          )}

          {items.length === 0 ? (
            <p className={styles.empty}>Žádné neuložené změny.</p>
          ) : (
            <>
              {!readOnly && selectable.length > 1 && (
                <div className={styles.selectAll}>
                  <Button variant="ghost" size="sm" onClick={() => onToggleAll(true)} disabled={busy}>
                    Vybrat vše
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onToggleAll(false)} disabled={busy}>
                    Zrušit výběr
                  </Button>
                  <span className={styles.selectCount}>
                    Vybráno {selectedCount} z {selectable.length}
                  </span>
                </div>
              )}

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {!readOnly && <th className={styles.checkCol} aria-label="Přenést" />}
                      <th>Položka</th>
                      <th>Původně</th>
                      <th>Moje hodnota</th>
                      <th>Na serveru</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr
                        key={i.key}
                        className={
                          !i.applicable ? styles.rowBlocked : i.conflicting ? styles.rowConflict : undefined
                        }
                      >
                        {!readOnly && (
                          <td className={styles.checkCol}>
                            <input
                              type="checkbox"
                              checked={i.apply && i.applicable}
                              disabled={!i.applicable || busy}
                              onChange={(e) => onToggle(i.key, e.target.checked)}
                              aria-label={`Přenést: ${i.label}`}
                            />
                          </td>
                        )}
                        <td>
                          {i.label}
                          {i.blockedReason && <span className={styles.blockedNote}>{i.blockedReason}</span>}
                        </td>
                        <td className={styles.num}>{formatValue(i.ref, i.base)}</td>
                        <td className={`${styles.num} ${styles.mine}`}>{formatValue(i.ref, i.mine)}</td>
                        <td className={styles.num}>{formatValue(i.ref, i.theirs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {theirItems.length > 0 && (
            <details className={styles.theirs}>
              <summary>
                Ostatní změny jiného uživatele ({theirItems.length}) – ty zůstávají beze změny
              </summary>
              <ul className={styles.theirList}>
                {theirItems.map((t) => (
                  <li key={t.key}>
                    {t.label}: {formatValue(t.ref, t.base)} → {formatValue(t.ref, t.theirs)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          {items.length > 0 && (
            <Button variant="ghost" onClick={() => void copyList()} disabled={busy}>
              {copied ? "Zkopírováno" : "Zkopírovat přehled"}
            </Button>
          )}
          <span className={styles.footerSpacer} />
          {readOnly ? (
            <Button variant="primary" onClick={onDiscard} disabled={busy}>
              Rozumím, načíst aktuální verzi
            </Button>
          ) : (
            <>
              <Button variant="danger" onClick={onDiscard} disabled={busy}>
                Zahodit mé změny
              </Button>
              <Button variant="primary" onClick={onMerge} disabled={busy}>
                {busy
                  ? "Ukládám…"
                  : selectedCount === 0
                    ? "Načíst aktuální verzi"
                    : `Sloučit a uložit (${selectedCount})`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
