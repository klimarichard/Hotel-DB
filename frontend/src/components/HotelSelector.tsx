import type { Hotel, HotelSlug } from "@/lib/hotels";
import styles from "./HotelSelector.module.css";

interface Props {
  /** The hotels the user may switch between (already permission-filtered by the parent). */
  hotels: readonly Hotel[];
  value: HotelSlug;
  onChange: (next: HotelSlug) => void;
}

/**
 * Pill row for switching between the reception hotels the user can access.
 * Purely presentational — the parent (RecepcePage) computes the accessible set
 * from the permission model and only renders this when there's more than one.
 */
export default function HotelSelector({ hotels, value, onChange }: Props) {
  if (hotels.length === 0) return null;
  if (hotels.length === 1) {
    return (
      <div className={styles.selector}>
        <span className={styles.badge}>{hotels[0].label}</span>
      </div>
    );
  }

  return (
    <div className={styles.selector} role="tablist" aria-label="Hotel">
      {hotels.map((h) => {
        const active = h.slug === value;
        return (
          <button
            key={h.slug}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? styles.pillActive : styles.pill}
            onClick={() => {
              if (!active) onChange(h.slug);
            }}
          >
            {h.label}
          </button>
        );
      })}
    </div>
  );
}
