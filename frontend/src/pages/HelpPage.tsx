import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/context/OnboardingContext";
import { buildAppTour } from "@/lib/tours";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import Button from "@/components/Button";
import styles from "./HelpPage.module.css";

/**
 * Nápověda — permission-driven Czech reference. It lists exactly the things the
 * current user can do, derived from the same master tour step list (filtered by
 * `can()`) that powers the guided tour, grouped by the permission catalog's own
 * groups. The "Spustit prohlídku" button replays that same filtered tour.
 *
 * Single source of truth: add a permission to the catalog + a tour step and it
 * surfaces here automatically — no per-role help content.
 */

// permission key → catalog group label, built once from the catalog.
const GROUP_BY_PERMISSION: Record<string, string> = PERMISSION_CATALOG.reduce(
  (acc, group) => {
    for (const item of group.items) acc[item.key] = group.group;
    return acc;
  },
  {} as Record<string, string>
);

export default function HelpPage() {
  const { can } = useAuth();
  const { startTour } = useOnboarding();

  // The user's filtered steps, grouped by catalog group (preserving catalog
  // order). Welcome / outro steps (no permission) are intro material, not a
  // capability, so they're excluded from the reference list.
  const groups = useMemo(() => {
    const steps = buildAppTour(can).steps.filter((s) => s.permission);
    const order = PERMISSION_CATALOG.map((g) => g.group);
    const byGroup = new Map<string, { title: string; body: string }[]>();
    for (const step of steps) {
      const group = GROUP_BY_PERMISSION[step.permission as string] ?? "Ostatní";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push({ title: step.title, body: step.body });
    }
    return order
      .filter((g) => byGroup.has(g))
      .map((g) => ({ title: g, items: byGroup.get(g)! }));
  }, [can]);

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

      {groups.map((section) => (
        <section key={section.title} className={styles.section}>
          <h2 className={styles.sectionTitle}>{section.title}</h2>
          {section.items.map((item, j) => (
            <div key={j} className={styles.item}>
              <h3 className={styles.itemTitle}>{item.title}</h3>
              <p className={styles.para}>{item.body}</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
