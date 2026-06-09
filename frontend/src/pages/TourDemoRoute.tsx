import { useEffect, ReactNode } from "react";
import { tourDemo, type TourScenario } from "@/lib/tours/demoData";

/**
 * Tour-only route wrapper: renders a REAL page (`children`) fed entirely by mock
 * data — no backend, no Firestore — for the guided tour.
 *
 * It flips on `tourDemo.active` and sets the `scenario` so the API client serves
 * the matching fixtures (see lib/tours/demoData.ts → getDemoResponse). Both are
 * set SYNCHRONOUSLY during render so they're already in place before the child
 * page's mount-effect fires its first fetch, and cleared on unmount.
 *
 * Used for the self / payroll / shifts demos. The employee-detail demo needs no
 * wrapper — it's keyed off the sentinel id "tour-demo" and intercepted always.
 */
export default function TourDemoRoute({
  scenario,
  children,
}: {
  scenario: TourScenario;
  children: ReactNode;
}) {
  tourDemo.active = true; // before the child page mounts + fetches
  tourDemo.scenario = scenario;
  useEffect(() => {
    tourDemo.active = true;
    tourDemo.scenario = scenario;
    return () => {
      tourDemo.active = false;
      tourDemo.scenario = null;
    };
  }, [scenario]);
  return <>{children}</>;
}
