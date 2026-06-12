import type { ReactNode } from "react";
import { computeEnabled, RENDER_MODEL } from "@/lib/permissions/hierarchy";
import styles from "./PermissionMatrix.module.css";

interface Props {
  /** Effective checked-state for a key (type baseline, or baseline∪extra−revoked). */
  isChecked: (key: string) => boolean;
  /** Caller applies the hierarchy cascade (resolveToggle) to its own state model. */
  onToggle: (key: string) => void;
  /** Whole matrix read-only (system type, or caller lacks users.permissions.manage). */
  readOnly?: boolean;
  /** Per-key adornment, e.g. the ● override dot in the per-user modal. */
  decorate?: (key: string) => ReactNode;
  /** Admin target: render everything checked + locked (system.admin confers all). */
  forceAllOn?: boolean;
  /** Use a vertical grid instead of masonry — for height-constrained, scrollable
   *  containers (the per-user modal) where masonry would overflow horizontally. */
  gridLayout?: boolean;
}

/**
 * Hierarchical permission matrix shared by UserTypesTab and UserPermissionsModal.
 * Renders sections → subsections → rows indented by level; a row is disabled when
 * its parent is unchecked (computeEnabled), greying out to signal the dependency.
 * The cascade/exclusion logic lives in lib/permissions/hierarchy.ts — this only
 * renders state and reports raw toggles.
 */
export default function PermissionMatrix({
  isChecked,
  onToggle,
  readOnly = false,
  decorate,
  forceAllOn = false,
  gridLayout = false,
}: Props) {
  // Build the checked set once, then the enabled map (skipped when all forced on).
  const checked = new Set<string>();
  if (!forceAllOn) {
    for (const section of RENDER_MODEL)
      for (const sub of section.subsections)
        for (const it of sub.items) if (isChecked(it.key)) checked.add(it.key);
  }
  const enabled = forceAllOn ? null : computeEnabled(checked);

  return (
    <div className={gridLayout ? styles.matrixGrid : styles.matrix}>
      {RENDER_MODEL.map((section) => (
        <fieldset key={section.title} className={styles.section} disabled={readOnly}>
          <legend className={styles.sectionTitle}>{section.title}</legend>
          {section.subsections.map((sub, si) => (
            <div key={sub.title ?? `s${si}`} className={styles.subsection}>
              {sub.title && <div className={styles.subTitle}>{sub.title}</div>}
              {sub.items.map((it) => {
                const checkedNow = forceAllOn ? true : isChecked(it.key);
                const rowEnabled = it.level === 0 ? true : !!enabled?.get(it.key);
                const disabled = readOnly || forceAllOn || !it.grantable || !rowEnabled;
                const exclusive = !!it.exclusiveGroup;
                const rowClass = [
                  styles.row,
                  it.level === 0 ? styles.master : "",
                  it.spaceBefore ? styles.gap : "",
                  exclusive ? styles.radio : "",
                  disabled && !checkedNow ? styles.dim : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <label
                    key={it.key}
                    className={rowClass}
                    style={it.level > 0 ? { paddingLeft: `${it.level * 1.1}rem` } : undefined}
                    title={exclusive ? "Vyberte jednu z těchto možností (vzájemně se vylučují)" : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checkedNow}
                      disabled={disabled}
                      onChange={() => onToggle(it.key)}
                    />
                    <span className={styles.label}>{it.label}</span>
                    {decorate?.(it.key)}
                  </label>
                );
              })}
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
