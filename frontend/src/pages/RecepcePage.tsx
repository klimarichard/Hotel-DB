import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { authApi } from "@/lib/api";
import Button from "@/components/Button";
import {
  accessibleHotels,
  visibleTabs,
  hotelBySlug,
  rememberLastHotel,
  readLastHotel,
  type Hotel,
  type TabId,
} from "@/lib/hotels";
import HandoverTab from "./recepce/HandoverTab";
import WalkinsTab from "./recepce/WalkinsTab";
import TaxiTab from "./recepce/TaxiTab";
import LobbyBarTab from "./recepce/LobbyBarTab";
import TerminalTab from "./recepce/TerminalTab";
import styles from "./RecepcePage.module.css";

/** Per-hotel tint class (colours mirror the Shift page's hotel colours). */
const HOTEL_CLASS: Record<string, string> = {
  A: styles.hotelA,
  S: styles.hotelS,
  Q: styles.hotelQ,
  K: styles.hotelK,
};

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
  const { can, loading: authLoading, recepceDefaultHotel } = useAuth();
  const { hotel: hotelParam, tab: tabParam } = useParams();
  const navigate = useNavigate();

  // The saved default is read straight from useAuth, NOT mirrored into state via
  // an effect: effects run after the render that reads them, so on the first
  // render after auth resolves the mirror would still be null, the resolution
  // below would fall through to the last-used hotel, and the canonicalizing
  // effect would navigate there before the default ever arrived. `pendingDefault`
  // is only an optimistic override for the toggle — `undefined` means "no local
  // override, use the server's value".
  const [pendingDefault, setPendingDefault] = useState<string | null | undefined>(undefined);
  const [savingDefault, setSavingDefault] = useState(false);
  const defaultHotel = pendingDefault !== undefined ? pendingDefault : recepceDefaultHotel;

  const hotels = accessibleHotels(can);

  // Resolve the selected hotel, in order:
  //   1. the URL param, if it names a hotel the user can access
  //   2. the user's saved default — server-side, so it survives a new browser and
  //      cannot be clobbered by whoever last used a shared reception terminal
  //   3. the last-used hotel (localStorage), for users who set no default
  //   4. the first accessible hotel
  // The default is filtered through `hotels` like everything else, so a stale one
  // left behind by a permission revoke simply falls through — it can never open a
  // hotel the user may not see.
  const paramHotel = hotelBySlug(hotelParam);
  const selectedHotel: Hotel | undefined =
    (paramHotel && hotels.some((h) => h.slug === paramHotel.slug) ? paramHotel : undefined) ??
    hotels.find((h) => h.slug === defaultHotel) ??
    hotels.find((h) => h.slug === readLastHotel()) ??
    hotels[0];

  const tabs = selectedHotel ? visibleTabs(selectedHotel, can) : [];
  const selectedTab = tabs.find((t) => t.id === tabParam) ?? tabs[0];

  // Canonicalize the URL when the params don't match the resolved selection.
  // Gated on authLoading: useAuth starts with an empty permission set, so acting
  // before it resolves would canonicalize to the wrong hotel (or none) and then
  // bounce again once the real permissions and default arrive.
  useEffect(() => {
    if (authLoading || !selectedHotel) return;
    const wantHotel = selectedHotel.slug;
    const wantTab = selectedTab?.id;
    if (hotelParam !== wantHotel || (wantTab && tabParam !== wantTab)) {
      navigate(`/recepce/${wantHotel}${wantTab ? `/${wantTab}` : ""}`, { replace: true });
    }
  }, [authLoading, selectedHotel, selectedTab, hotelParam, tabParam, navigate]);

  useEffect(() => {
    if (!authLoading && selectedHotel) rememberLastHotel(selectedHotel.slug);
  }, [authLoading, selectedHotel]);

  /** Set the open hotel as this user's default, or clear it if it already is. */
  async function toggleDefault() {
    if (!selectedHotel || savingDefault) return;
    const next = defaultHotel === selectedHotel.slug ? null : selectedHotel.slug;
    setSavingDefault(true);
    setPendingDefault(next); // optimistic — the control is trivially reversible
    try {
      await authApi.setRecepceDefault(next);
    } catch {
      setPendingDefault(undefined); // fall back to whatever the server still holds
    } finally {
      setSavingDefault(false);
    }
  }

  if (authLoading) return null;

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
      </div>

      {/* Hotel selector – always shown (even for a single accessible hotel, so
          the receptionist can see which hotel they're on), colour-coded. */}
      {selectedHotel && (
        <div className={styles.hotelBar} role="tablist" aria-label="Hotel">
          {hotels.map((h) => {
            const active = h.slug === selectedHotel.slug;
            const isDefault = h.slug === defaultHotel;
            return (
              <button
                key={h.slug}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.hotelPill} ${HOTEL_CLASS[h.code] ?? ""} ${
                  active ? styles.hotelPillActive : ""
                }`}
                onClick={() => navigate(`/recepce/${h.slug}`)}
              >
                {h.label}
                {isDefault && (
                  <span className={styles.defaultStar} aria-label="Výchozí hotel" title="Výchozí hotel">
                    ★
                  </span>
                )}
              </button>
            );
          })}
          {/* Only worth offering when there is actually a choice to make. */}
          {hotels.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleDefault}
              disabled={savingDefault}
              title="Tento hotel se otevře, kdykoliv kliknete na Recepci"
            >
              {defaultHotel === selectedHotel.slug ? "★ Výchozí hotel" : "☆ Nastavit jako výchozí"}
            </Button>
          )}
        </div>
      )}

      {selectedHotel && tabs.length > 0 && (
        <div
          className={`${styles.tabs} ${HOTEL_CLASS[selectedHotel.code] ?? ""}`}
          role="tablist"
          aria-label="Sekce recepce"
        >
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
      return <WalkinsTab hotel={hotel} />;
    case "taxi":
      return <TaxiTab hotel={hotel} />;
    case "lobbyBar":
      return <LobbyBarTab />;
    case "terminal":
      return <TerminalTab />;
    default:
      return null;
  }
}
