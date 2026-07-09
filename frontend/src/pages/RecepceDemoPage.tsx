import { useAuth } from "@/hooks/useAuth";
import { accessibleHotels, type Hotel, type TabId } from "@/lib/hotels";
import HandoverTab from "./recepce/HandoverTab";
import WalkinsTab from "./recepce/WalkinsTab";
import TaxiTab from "./recepce/TaxiTab";
import styles from "./RecepcePage.module.css";

/**
 * Tour-only wrapper: renders a single Recepce tab (Předávací protokol / Walkiny /
 * Taxi) fed by mock data (see lib/tours/demoData.ts → the protokol/walkiny/taxi
 * scenarios). Unlike the real RecepcePage it does NOT canonicalize the URL to
 * `/recepce/:hotel/:tab` (that navigation would leave the demo route and drop the
 * active scenario), so it mounts the tab component directly.
 *
 * Hotel choice: among the hotels the user can access, prefer one where they also
 * hold the tab's MANAGE key, so the manager-only controls the tour spotlights
 * (protokol create button, walkiny/taxi visible-period editor, taxi provize
 * total) actually render. Each such step is itself gated on the matching manage
 * permission, so this keeps the anchor present exactly when the step is shown.
 * Users with no accessible hotel never reach these steps (they're permission-
 * gated away), so the null case simply renders nothing.
 */
export default function RecepceDemoPage({ tab }: { tab: TabId }) {
  const { can } = useAuth();
  const hotels = accessibleHotels(can);

  const preferManage = (h: Hotel): boolean => {
    switch (tab) {
      case "protokol":
        return can(h.protokolCreatePerm) || can(h.protokolManagePerm);
      case "walkiny":
        return can(h.walkinyManagePerm);
      case "taxi":
        return can(h.taxiManagePerm);
      default:
        return false;
    }
  };

  const hotel = hotels.find(preferManage) ?? hotels[0];
  if (!hotel) return null;

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Recepce — {hotel.label}</h1>
      </div>
      {tab === "protokol" && <HandoverTab hotel={hotel} />}
      {tab === "walkiny" && <WalkinsTab hotel={hotel} />}
      {tab === "taxi" && <TaxiTab hotel={hotel} />}
    </div>
  );
}
