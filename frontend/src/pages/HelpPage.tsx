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
  const { role, roleType, can } = useAuth();
  const { startTour } = useOnboarding();
  const sections = helpSectionsForRole(role);

  // The user's own tour (employee/manager in v1). For roles without one yet,
  // offer the employee tour as a general overview — but only to users who can
  // actually follow it (they need access to every page it visits), so e.g. an
  // účetní isn't bounced through pages they can't open.
  const ownTourId = resolveTourIdForRole(roleType ?? role);
  const canFollowEmployeeTour =
    can("nav.dashboard.view") && can("nav.shifts.view") && can("nav.vacation.view") && can("nav.profile.view");
  const tourId = ownTourId ?? (canFollowEmployeeTour ? "employee" : null);
  const isPreview = !ownTourId && !!tourId;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Nápověda</h1>
        {tourId ? (
          <Button variant="primary" onClick={() => startTour(tourId)}>
            {isPreview ? "Zobrazit ukázku prohlídky" : "Spustit prohlídku"}
          </Button>
        ) : (
          <span className={styles.tourNote}>Prohlídka pro vaši roli se připravuje.</span>
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
