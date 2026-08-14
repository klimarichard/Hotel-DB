import styles from "./AlignedLabel.module.css";

interface Props {
  /**
   * Every label this button slot can ever render – the other row types'
   * wordings and the transient busy captions. They are rendered invisibly
   * underneath the real label, so the button reserves the width of the widest
   * one and the same action lines up in a vertical list of rows.
   */
  variants: readonly string[];
  /** The label actually shown. It is measured too, so it can never be clipped. */
  children: React.ReactNode;
}

/**
 * Equal-width button labels without hard-coded pixel widths.
 *
 * The employment-history rows word every action after the document the row
 * carries ("Smazat smlouvu" / "Smazat dodatek" / "Smazat ukončení"), which made
 * the buttons in the stacked list ragged. CSS alone cannot size an element to
 * the widest sibling *in another row*, and a fixed `min-width` would have to be
 * re-tuned by hand every time one of those Czech nouns changes.
 *
 * So every candidate label is rendered into the same CSS-grid cell: the grid
 * column sizes to the widest item, the ghosts are `visibility: hidden` (out of
 * the accessibility tree, still occupying space) and the real label is centred
 * on top. Add a variant and the width follows automatically.
 *
 * On phones the ghosts are dropped (`display: none`, see the module CSS) – rows
 * are collapsed one at a time there, so there is no column to align, and the
 * reserved width would only push the actions into extra wraps.
 */
export default function AlignedLabel({ variants, children }: Props) {
  return (
    <span className={styles.box}>
      {variants.map((v) => (
        <span key={v} className={styles.ghost} aria-hidden="true">
          {v}
        </span>
      ))}
      <span className={styles.label}>{children}</span>
    </span>
  );
}
