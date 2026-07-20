import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { visibleTabulkyTabs, type TabulkyTabId } from "../lib/tabulky";
import SmenarnaTab from "./tabulky/SmenarnaTab";
import styles from "./TabulkyPage.module.css";

/**
 * Tabulky — a hub for standalone calculation tables that do not belong to any
 * one hotel. Mirrors RecepcePage's shell minus the hotel dimension: tab state
 * lives in the URL (/tabulky/:tab), and the tab list comes from lib/tabulky.ts.
 */
export default function TabulkyPage() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { can, loading: authLoading } = useAuth();

  const tabs = visibleTabulkyTabs(can);
  const selectedTab = tabs.find((t) => t.id === tabParam) ?? tabs[0];

  // Canonicalize the URL when the param doesn't match the resolved selection.
  // Gated on authLoading: useAuth starts with an EMPTY permission set, so acting
  // before it resolves would redirect away from a tab the user can actually see.
  useEffect(() => {
    if (authLoading || !selectedTab) return;
    if (tabParam !== selectedTab.id) {
      navigate(`/tabulky/${selectedTab.id}`, { replace: true });
    }
  }, [authLoading, selectedTab, tabParam, navigate]);

  if (authLoading) return null;

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Tabulky</h1>
      </div>

      {tabs.length > 0 && (
        <div className={styles.tabs} role="tablist" aria-label="Sekce tabulek">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selectedTab?.id === t.id}
              className={selectedTab?.id === t.id ? styles.tabActive : styles.tabBtn}
              onClick={() => navigate(`/tabulky/${t.id}`)}
              data-tour={`tabulky-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {selectedTab ? (
        <TabBody tab={selectedTab.id} />
      ) : (
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>Žádná dostupná tabulka</p>
          <p className={styles.placeholderHint}>
            Nemáte oprávnění k žádné z tabulek. Kontaktujte správce.
          </p>
        </div>
      )}
    </div>
  );
}

function TabBody({ tab }: { tab: TabulkyTabId }) {
  switch (tab) {
    case "smenarna":
      return <SmenarnaTab />;
    default:
      return null;
  }
}
