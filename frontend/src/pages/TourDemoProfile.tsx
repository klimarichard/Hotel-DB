import { useState } from "react";
import styles from "./TourDemoProfile.module.css";

/**
 * Tour-only demo profile. A fully-populated, INERT dummy employee card used by
 * the guided tour to spotlight person-record controls (reveal sensitive data,
 * manage employment, contracts, documents, benefits) and the Můj profil
 * controls — without touching any real data (nothing is fetched or written).
 *
 * Every control carries a `data-tour` anchor; the three tabs carry anchors too
 * so the tour engine can click them open (the `reveal` step mechanism) before
 * spotlighting a control on that tab. Because all fields are present, anchors
 * like the sensitive-data reveal eye always exist (real records may omit them).
 *
 * Reachable by any authenticated user at /napoveda/ukazka; buttons are no-ops.
 */
const noop = () => {};

export default function TourDemoProfile() {
  const [tab, setTab] = useState<"detail" | "history" | "docs">("detail");
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={styles.page}>
      <div className={styles.banner}>
        Ukázkový profil — slouží pouze průvodci aplikací. Žádná data zde nejsou skutečná.
      </div>

      <div className={styles.hero}>
        <div>
          <h1 className={styles.name} data-tour="demo-title">
            Jan Novák
          </h1>
          <p className={styles.sub}>Recepční · Recepce · HPP</p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.btnSecondary} data-tour="demo-self-edit" onClick={noop}>
            Navrhnout úpravu
          </button>
          <button type="button" className={styles.btnSecondary} data-tour="demo-hero-edit" onClick={noop}>
            Upravit
          </button>
          <button type="button" className={styles.btnDanger} data-tour="demo-hero-delete" onClick={noop}>
            Smazat
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === "detail" ? styles.tabActive : styles.tab}
          data-tour="demo-tab-detail"
          onClick={() => setTab("detail")}
        >
          Detail
        </button>
        <button
          type="button"
          className={tab === "history" ? styles.tabActive : styles.tab}
          data-tour="demo-tab-history"
          onClick={() => setTab("history")}
        >
          Historie pracovního poměru
        </button>
        <button
          type="button"
          className={tab === "docs" ? styles.tabActive : styles.tab}
          data-tour="demo-tab-docs"
          onClick={() => setTab("docs")}
        >
          Další dokumenty
        </button>
      </div>

      {tab === "detail" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Osobní údaje</h2>
            <div className={styles.field}>
              <span className={styles.label}>Jméno</span>
              <span>Jan Novák</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Telefon</span>
              <span>+420 777 123 456</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Rodné číslo</span>
              <span className={styles.sensitive}>
                {revealed ? "900101/1234" : "•••••• / ••••"}
                <button
                  type="button"
                  className={styles.revealBtn}
                  data-tour="demo-reveal"
                  aria-label="Zobrazit citlivý údaj"
                  onClick={() => setRevealed((v) => !v)}
                >
                  👁
                </button>
              </span>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Benefity / Multisport</h2>
              <button type="button" className={styles.btnSecondary} data-tour="demo-benefits" onClick={noop}>
                Spravovat
              </button>
            </div>
            <p className={styles.muted}>Multisport: aktivní · doprovodná osoba: 1</p>
          </section>
        </>
      )}

      {tab === "history" && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Pracovní poměr</h2>
            <button type="button" className={styles.btnPrimary} data-tour="demo-employment" onClick={noop}>
              + Nástup
            </button>
          </div>

          <div className={styles.session}>
            <div className={styles.row}>
              <span>HPP · Recepční · od 1. 1. 2024</span>
              <div className={styles.rowActions}>
                <button type="button" className={styles.btnSmall} data-tour="demo-contract-edit" onClick={noop}>
                  Upravit
                </button>
              </div>
            </div>
            <div className={styles.row}>
              <span>Pracovní smlouva.pdf</span>
              <div className={styles.rowActions}>
                <button type="button" className={styles.btnSmall} data-tour="demo-contract-view" onClick={noop}>
                  Stáhnout
                </button>
                <button type="button" className={styles.btnSmallPrimary} data-tour="demo-contract-generate" onClick={noop}>
                  Generovat smlouvu
                </button>
                <button type="button" className={styles.btnSmall} data-tour="demo-contract-sign" onClick={noop}>
                  Nahrát podepsanou smlouvu
                </button>
                <button type="button" className={styles.btnSmallDanger} data-tour="demo-contract-delete" onClick={noop}>
                  Smazat smlouvu
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "docs" && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Další dokumenty</h2>
            <button type="button" className={styles.btnPrimary} data-tour="demo-doc-upload" onClick={noop}>
              Nahrát dokument
            </button>
          </div>
          <div className={styles.row}>
            <span>Potvrzení o studiu.pdf</span>
            <div className={styles.rowActions}>
              <button type="button" className={styles.btnSmall} data-tour="demo-doc-view" onClick={noop}>
                Zobrazit
              </button>
              <button type="button" className={styles.btnSmallDanger} data-tour="demo-doc-delete" onClick={noop}>
                Smazat
              </button>
            </div>
          </div>
        </section>
      )}

      <section className={styles.card} data-tour="demo-self-requests">
        <h2 className={styles.cardTitle}>Vaše návrhy na změnu údajů</h2>
        <p className={styles.muted}>
          Zde se zobrazují vaše odeslané návrhy na úpravu profilu a jejich stav (čeká, schváleno,
          zamítnuto). Čekající návrh lze stáhnout, dokud nebyl schválen.
        </p>
      </section>
    </div>
  );
}
