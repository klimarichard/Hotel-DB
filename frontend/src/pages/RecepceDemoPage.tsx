import { useAuth } from "@/hooks/useAuth";
import { accessibleHotels, type Hotel, type TabId } from "@/lib/hotels";
import HandoverTab from "./recepce/HandoverTab";
import WalkinsTab from "./recepce/WalkinsTab";
import TaxiTab from "./recepce/TaxiTab";
import LobbyBarTab from "./recepce/LobbyBarTab";
import TerminalTab from "./recepce/TerminalTab";
import styles from "./RecepcePage.module.css";

/**
 * Tour-only wrapper: renders a single Recepce tab (Předávací protokol / Walkiny /
 * Taxi) fed by mock data (see lib/tours/demoData.ts → the protokol/walkiny/taxi
 * scenarios). Unlike the real RecepcePage it does NOT canonicalize the URL to
 * `/recepce/:hotel/:tab` (that navigation would leave the demo route and drop the
 * active scenario), so it mounts the tab component directly.
 *
 * Hotel choice, in two steps:
 *
 *  1. Keep only hotels that actually HAVE this tab. Protokol/Walkiny/Taxi exist
 *     everywhere, but Lobby bar is Ambiance-only and Terminál is Amigo-only —
 *     rendering those against another hotel would mount a tab that hotel does not
 *     have and call endpoints gated on a key nobody holds for it.
 *  2. Among what's left, prefer one where the user also holds the tab's MANAGE
 *     key, so the manager-only controls the tour spotlights (protokol create
 *     button, visible-period editors, taxi provize total, lobby-bar totals,
 *     terminál "Předáno" column) actually render. Each such step is itself gated
 *     on the matching manage permission, so this keeps the anchor present exactly
 *     when the step is shown.
 *
 * Users with no accessible hotel never reach these steps (they're permission-
 * gated away), so the null case simply renders nothing.
 */
export default function RecepceDemoPage({ tab }: { tab: TabId }) {
  const { can } = useAuth();
  const hotels = accessibleHotels(can).filter((h) => h.tabs.some((t) => t.id === tab));

  const preferManage = (h: Hotel): boolean => {
    switch (tab) {
      case "protokol":
        return can(h.protokolCreatePerm) || can(h.protokolManagePerm);
      case "walkiny":
        return can(h.walkinyManagePerm);
      case "taxi":
        return can(h.taxiManagePerm);
      case "lobbyBar":
        return !!h.lobbyBarManagePerm && can(h.lobbyBarManagePerm);
      case "terminal":
        return !!h.terminalManagePerm && can(h.terminalManagePerm);
      default:
        return false;
    }
  };

  const hotel = hotels.find(preferManage) ?? hotels[0];
  if (!hotel) return null;

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Recepce – {hotel.label}</h1>
      </div>
      {tab === "protokol" && <HandoverTab hotel={hotel} />}
      {tab === "walkiny" && <WalkinsTab hotel={hotel} />}
      {tab === "taxi" && <TaxiTab hotel={hotel} />}
      {tab === "lobbyBar" && <LobbyBarTab hotel={hotel} />}
      {tab === "terminal" && <TerminalTab hotel={hotel} />}
    </div>
  );
}
