import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  accessibleHotels,
  visibleTabs,
  hotelBySlug,
  rememberLastHotel,
  readLastHotel,
  type Hotel,
  type TabId,
} from "@/lib/hotels";
import HotelSelector from "@/components/HotelSelector";
import HandoverTab from "./recepce/HandoverTab";
import WalkinsTab from "./recepce/WalkinsTab";
import TaxiTab from "./recepce/TaxiTab";
import LobbyBarTab from "./recepce/LobbyBarTab";
import TerminalTab from "./recepce/TerminalTab";
import styles from "./RecepcePage.module.css";

/**
 * Reception hub. Access is entirely permission-driven:
 *   - `accessibleHotels(can)` = the hotels the user holds `recepce.<stem>.view` for.
 *   - the hotel sub-nav shows only when >1 hotel is accessible; with exactly one
 *     the user drops straight into it.
 *   - the per-hotel tab bar shows only the tabs the user holds the tab key for.
 *
 * URL scheme: `/recepce/:hotel?/:tab?`. The page canonicalizes the URL (replace)
 * whenever the param is missing, invalid, or points at something the user can't
 * access, so deep-links degrade gracefully and there's always a valid selection.
 */
export default function RecepcePage() {
  const { can } = useAuth();
  const { hotel: hotelParam, tab: tabParam } = useParams();
  const navigate = useNavigate();

  const hotels = accessibleHotels(can);

  // Resolve the selected hotel: the URL param if it's one the user can access,
  // else the last-used hotel, else the first accessible one.
  const paramHotel = hotelBySlug(hotelParam);
  const selectedHotel: Hotel | undefined =
    (paramHotel && hotels.some((h) => h.slug === paramHotel.slug) ? paramHotel : undefined) ??
    hotels.find((h) => h.slug === readLastHotel()) ??
    hotels[0];

  const tabs = selectedHotel ? visibleTabs(selectedHotel, can) : [];
  const selectedTab = tabs.find((t) => t.id === tabParam) ?? tabs[0];

  // Canonicalize the URL when the params don't match the resolved selection.
  useEffect(() => {
    if (!selectedHotel) return;
    const wantHotel = selectedHotel.slug;
    const wantTab = selectedTab?.id;
    if (hotelParam !== wantHotel || (wantTab && tabParam !== wantTab)) {
      navigate(`/recepce/${wantHotel}${wantTab ? `/${wantTab}` : ""}`, { replace: true });
    }
  }, [selectedHotel, selectedTab, hotelParam, tabParam, navigate]);

  useEffect(() => {
    if (selectedHotel) rememberLastHotel(selectedHotel.slug);
  }, [selectedHotel]);

  if (hotels.length === 0) {
    return (
      <div>
        <div className={styles.header}>
          <h1 className={styles.title}>Recepce</h1>
        </div>
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>Žádný přístupný hotel</p>
          <p className={styles.placeholderHint}>
            Nemáte oprávnění k žádnému hotelu recepce. Kontaktujte správce.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Recepce</h1>
        {hotels.length > 1 && selectedHotel && (
          <HotelSelector
            hotels={hotels}
            value={selectedHotel.slug}
            onChange={(slug) => navigate(`/recepce/${slug}`)}
          />
        )}
      </div>

      {selectedHotel && tabs.length > 0 && (
        <div className={styles.tabs} role="tablist" aria-label="Sekce recepce">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selectedTab?.id === t.id}
              className={selectedTab?.id === t.id ? styles.tabActive : styles.tabBtn}
              onClick={() => navigate(`/recepce/${selectedHotel.slug}/${t.id}`)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {selectedHotel && selectedTab ? (
        <TabBody hotel={selectedHotel} tab={selectedTab.id} />
      ) : (
        selectedHotel && (
          <div className={styles.placeholder}>
            <p className={styles.placeholderTitle}>Žádná dostupná sekce</p>
            <p className={styles.placeholderHint}>
              Pro tento hotel nemáte přístup k žádné sekci.
            </p>
          </div>
        )
      )}
    </div>
  );
}

function TabBody({ hotel, tab }: { hotel: Hotel; tab: TabId }) {
  switch (tab) {
    case "protokol":
      return <HandoverTab hotel={hotel} />;
    case "walkiny":
      return <WalkinsTab />;
    case "taxi":
      return <TaxiTab />;
    case "lobbyBar":
      return <LobbyBarTab />;
    case "terminal":
      return <TerminalTab />;
    default:
      return null;
  }
}
