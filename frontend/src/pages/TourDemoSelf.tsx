import { useEffect } from "react";
import EmployeeSelfPage from "./EmployeeSelfPage";
import { tourDemo } from "@/lib/tours/demoData";

/**
 * Tour-only route (/napoveda/ukazka-profil): renders the REAL "Můj profil" page
 * (EmployeeSelfPage) fed entirely by mock data — no backend, no Firestore.
 *
 * It flips on `tourDemo.active` so the API client serves the /me/* fixtures
 * (see lib/tours/demoData.ts). The flag is set synchronously on first render so
 * it's already on before the child page's mount-effect fires, and cleared on
 * unmount. The detail demo (/zamestnanci/tour-demo) needs no flag — it's keyed
 * off the sentinel id and intercepted unconditionally.
 */
export default function TourDemoSelf() {
  tourDemo.active = true; // before EmployeeSelfPage mounts + fetches
  useEffect(() => {
    tourDemo.active = true;
    return () => {
      tourDemo.active = false;
    };
  }, []);
  return <EmployeeSelfPage />;
}
