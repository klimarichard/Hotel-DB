import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/context/OnboardingContext";
import { resolveTourIdForRole } from "@/lib/tours";
import { helpSectionsForRole } from "@/lib/help/helpContent";
import Button from "@/components/Button";
import styles from "./HelpPage.module.css";

/**
 * Nápověda — role-aware Czech reference page. The "Spustit prohlídku" button
 * replays the guided tour for roles that have one (employee + manager in v1).
 */
export default function HelpPage() {
  const { role } = useAuth();
  const { startTour } = useOnboarding();
  const sections = helpSectionsForRole(role);
  const tourId = resolveTourIdForRole(role);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Nápověda</h1>
        {tourId && (
          <Button variant="primary" onClick={() => startTour(tourId)}>
            Spustit prohlídku
          </Button>
        )}
      </div>

      {sections.map((section, i) => (
        <section key={i} className={styles.section}>
          <h2 className={styles.sectionTitle}>{section.title}</h2>
          {section.body.map((paragraph, j) => (
            <p key={j} className={styles.para}>
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
