import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/context/OnboardingContext";
import { buildAppTour } from "@/lib/tours";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { getHelpImage } from "@/lib/help/helpImages";
import Button from "@/components/Button";
import styles from "./HelpPage.module.css";

/**
 * Nápověda – permission-driven Czech reference. It lists exactly the things the
 * current user can do, derived from the same master tour step list (filtered by
 * `can()`) that powers the guided tour, grouped by the permission catalog's own
 * groups. The "Spustit prohlídku" button replays that same filtered tour.
 *
 * Full-text search filters this already-permission-filtered list, so results can
 * never include content the user has no access to. Each section may show an
 * optional screenshot (see lib/help/helpImages.ts).
 *
 * Single source of truth: add a permission to the catalog + a tour step and it
 * surfaces here automatically – no per-role help content.
 */

// permission key → catalog group label, built once from the catalog.
const GROUP_BY_PERMISSION: Record<string, string> = PERMISSION_CATALOG.reduce(
  (acc, group) => {
    for (const item of group.items) acc[item.key] = group.group;
    return acc;
  },
  {} as Record<string, string>
);

/** Lowercase + strip diacritics so "smeny" matches "Směny". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export default function HelpPage() {
  const { can } = useAuth();
  const { startTour } = useOnboarding();
  const [query, setQuery] = useState("");

  // The user's filtered steps, grouped by catalog group (preserving catalog
  // order). Welcome / outro steps (no permission) are intro material, not a
  // capability, so they're excluded from the reference list.
  const groups = useMemo(() => {
    // Build the tour with NO context (default) so each item's `index` lines up
    // with the array `startTour(index)` rebuilds via the same `buildAppTour(can)`
    // call – that's what lets a clicked item jump to the exact step. The index is
    // the step's position in the FULL built list (welcome/outro included), then we
    // drop the permission-less intro steps for display only.
    const allSteps = buildAppTour(can).steps;
    const order = PERMISSION_CATALOG.map((g) => g.group);
    const byGroup = new Map<string, { title: string; body: string; index: number }[]>();
    allSteps.forEach((step, index) => {
      if (!step.permission) return; // welcome / outro – intro material, not a capability
      // A step may carry an array of permissions (merged variants); group by the first.
      const permKey = Array.isArray(step.permission) ? step.permission[0] : step.permission;
      const group = GROUP_BY_PERMISSION[permKey as string] ?? "Ostatní";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push({ title: step.title, body: step.body, index });
    });
    return order
      .filter((g) => byGroup.has(g))
      .map((g) => ({ title: g, items: byGroup.get(g)! }));
  }, [can]);

  // Search over the permission-filtered content only. A section whose title
  // matches keeps all its items; otherwise only matching items are kept.
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return groups;
    return groups
      .map((section) => {
        const titleMatch = normalize(section.title).includes(q);
        const items = titleMatch
          ? section.items
          : section.items.filter(
              (it) => normalize(it.title).includes(q) || normalize(it.body).includes(q)
            );
        return { ...section, items };
      })
      .filter((section) => section.items.length > 0);
  }, [groups, query]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Nápověda</h1>
        <Button variant="primary" onClick={() => startTour()}>
          Spustit prohlídku
        </Button>
      </div>

      <p className={styles.intro}>
        Níže najdete přehled částí aplikace a akcí, které máte k dispozici. Obsah odpovídá vašim
        oprávněním, takže uvidíte přesně to, co můžete používat. Interaktivního průvodce spustíte
        tlačítkem nahoře.
      </p>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Hledat v nápovědě…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Hledat v nápovědě"
        />
      </div>

      {visible.length === 0 ? (
        <p className={styles.noResults}>
          Pro „{query.trim()}“ nebyly nalezeny žádné výsledky.
        </p>
      ) : (
        visible.map((section) => {
          const shot = getHelpImage(section.title);
          return (
            <section key={section.title} className={styles.section}>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
              {shot && (
                <img className={styles.shot} src={shot} alt={`Náhled: ${section.title}`} loading="lazy" />
              )}
              <div className={styles.items}>
                {section.items.map((item, j) => (
                  <button
                    key={j}
                    type="button"
                    className={styles.item}
                    onClick={() => startTour(item.index)}
                    title="Zobrazit v průvodci"
                  >
                    <span className={styles.itemGo} aria-hidden="true">
                      ▸
                    </span>
                    <h3 className={styles.itemTitle}>{item.title}</h3>
                    <p className={styles.para}>{item.body}</p>
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
