import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import Button from "./Button";
import IconButton from "./IconButton";
import ConfirmModal from "./ConfirmModal";
import {
  EXPORT_COLUMNS,
  GROUP_LABELS,
  toCsv,
  downloadCsv,
  defaultExportFilename,
  sanitizeFilename,
  type ExportColumn,
  type ExportRow,
  type ColumnGroup,
} from "../lib/csvExport";
import styles from "./ExportEmployeesModal.module.css";

type StatusChoice = "active" | "terminated" | "all";

interface Props {
  onClose: () => void;
}

interface ExportResponse {
  employees: ExportRow[];
}

const STATUS_LABELS: Record<StatusChoice, string> = {
  active: "Aktivní",
  terminated: "Ukončení",
  all: "Vše",
};

const CONTRACT_TYPES = ["HPP", "DPP", "PPP", "HPP - mat."];
const COMPANIES = ["HPM", "STP"];

// Group ordering in the picker (mirrors the seed column order, roughly).
const GROUP_ORDER: ColumnGroup[] = ["basic", "documents", "contact", "employment", "benefits", "sensitive"];

export default function ExportEmployeesModal({ onClose }: Props) {
  // ─── Filters ──────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<StatusChoice>("active");
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(new Set());
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [selectedNationalities, setSelectedNationalities] = useState<Set<string>>(new Set());
  const [selectedJobTitles, setSelectedJobTitles] = useState<Set<string>>(new Set());

  // ─── Columns ──────────────────────────────────────────────────────────────
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.filter((c) => !c.sensitive).map((c) => c.key))
  );
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [filename, setFilename] = useState<string>(() => defaultExportFilename());

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSensitive, setConfirmSensitive] = useState(false);

  // Discover available nationalities + job titles by peeking at a small sample.
  // Kept lazy: we only load them when the user first opens a multi-filter block.
  // For simplicity in v1, we populate the lists on first render from a tiny
  // non-sensitive request.
  const [discoveredNationalities, setDiscoveredNationalities] = useState<string[]>([]);
  const [discoveredJobTitles, setDiscoveredJobTitles] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Array<{ nationality?: string; currentJobTitle?: string }>>("/employees")
      .then((all) => {
        if (cancelled) return;
        const nats = new Set<string>();
        const titles = new Set<string>();
        for (const e of all) {
          if (e.nationality) nats.add(e.nationality);
          if (e.currentJobTitle) titles.add(e.currentJobTitle);
        }
        setDiscoveredNationalities([...nats].sort((a, b) => a.localeCompare(b, "cs")));
        setDiscoveredJobTitles([...titles].sort((a, b) => a.localeCompare(b, "cs")));
      })
      .catch(() => {
        // Silent failure — the user can still export; the multi-filters just stay empty.
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ─── Derived ──────────────────────────────────────────────────────────────
  const columnsByGroup: Record<ColumnGroup, ExportColumn[]> = useMemo(() => {
    const out = { basic: [], documents: [], contact: [], employment: [], benefits: [], sensitive: [] } as
      Record<ColumnGroup, ExportColumn[]>;
    for (const c of EXPORT_COLUMNS) out[c.group].push(c);
    return out;
  }, []);

  const exportableColumns = useMemo(
    () => EXPORT_COLUMNS.filter((c) => selectedColumns.has(c.key) && (!c.sensitive || includeSensitive)),
    [selectedColumns, includeSensitive]
  );

  const columnsCount = exportableColumns.length;

  // ─── Toggle helpers ───────────────────────────────────────────────────────
  function toggleInSet(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSet(next);
  }

  function toggleColumn(col: ExportColumn) {
    // Picking a sensitive column is blocked unless the toggle is on.
    if (col.sensitive && !includeSensitive) return;
    toggleInSet(selectedColumns, setSelectedColumns, col.key);
  }

  function toggleGroup(group: ColumnGroup, on: boolean) {
    const next = new Set(selectedColumns);
    for (const c of columnsByGroup[group]) {
      if (c.sensitive && !includeSensitive) continue;
      if (on) next.add(c.key);
      else next.delete(c.key);
    }
    setSelectedColumns(next);
  }

  function handleSensitiveToggle(on: boolean) {
    if (on) {
      // Require explicit confirmation via ConfirmModal (no native dialogs per CLAUDE.md).
      setConfirmSensitive(true);
      return;
    }
    // Turning off: also deselect any currently-picked sensitive columns.
    const next = new Set(selectedColumns);
    for (const c of EXPORT_COLUMNS) if (c.sensitive) next.delete(c.key);
    setSelectedColumns(next);
    setIncludeSensitive(false);
  }

  function acceptSensitive() {
    setIncludeSensitive(true);
    setConfirmSensitive(false);
  }

  // ─── Submit ───────────────────────────────────────────────────────────────
  async function handleExport() {
    if (columnsCount === 0) {
      setError("Vyberte alespoň jeden sloupec.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (includeSensitive) params.set("includeSensitive", "true");
      // Single-value server-side filters are used when exactly one value is
      // selected so Firestore narrows the read. Multi-value filters are
      // applied client-side below.
      if (selectedCompanies.size === 1) params.set("companyId", [...selectedCompanies][0]);
      if (selectedContracts.size === 1) params.set("contractType", [...selectedContracts][0]);
      if (selectedNationalities.size === 1) params.set("nationality", [...selectedNationalities][0]);
      if (selectedJobTitles.size === 1) params.set("jobTitle", [...selectedJobTitles][0]);

      const response = await api.get<ExportResponse>(
        `/employees/export?${params.toString()}`
      );

      const filtered = response.employees.filter((row) => {
        if (selectedCompanies.size > 1 && !selectedCompanies.has(String(row.currentCompanyId ?? ""))) return false;
        if (selectedContracts.size > 1 && !selectedContracts.has(String(row.currentContractType ?? ""))) return false;
        if (selectedNationalities.size > 1 && !selectedNationalities.has(String(row.nationality ?? ""))) return false;
        if (selectedJobTitles.size > 1 && !selectedJobTitles.has(String(row.currentJobTitle ?? ""))) return false;
        return true;
      });

      if (filtered.length === 0) {
        setError("Filtry nevrátily žádné zaměstnance.");
        return;
      }

      const csv = toCsv(filtered, exportableColumns);
      downloadCsv(sanitizeFilename(filename), csv);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message || `Chyba ${e.status}`);
      else setError(e instanceof Error ? e.message : "Chyba při exportu");
    } finally {
      setExporting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2 className={styles.title}>Exportovat zaměstnance do CSV</h2>
            <IconButton onClick={onClose} aria-label="Zavřít">✕</IconButton>
          </div>
          <div className={styles.body}>
            {/* ── Filtry ── */}
            <section className={styles.section}>
              <h3 className={styles.sectionHeading}>Filtry</h3>

              <div className={styles.subHeading}>Stav</div>
              <div className={styles.pills}>
                {(["active", "terminated", "all"] as StatusChoice[]).map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={status === s ? styles.pillActive : styles.pill}
                    onClick={() => setStatus(s)}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>

              <div className={styles.subHeading}>Firma</div>
              <div className={styles.checkGrid3}>
                {COMPANIES.map((c) => (
                  <label key={c} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={selectedCompanies.has(c)}
                      onChange={() => toggleInSet(selectedCompanies, setSelectedCompanies, c)}
                    />
                    {c}
                  </label>
                ))}
              </div>

              <div className={styles.subHeading}>Typ smlouvy</div>
              <div className={styles.checkGrid3}>
                {CONTRACT_TYPES.map((t) => (
                  <label key={t} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={selectedContracts.has(t)}
                      onChange={() => toggleInSet(selectedContracts, setSelectedContracts, t)}
                    />
                    {t}
                  </label>
                ))}
              </div>

              {discoveredNationalities.length > 0 && (
                <>
                  <div className={styles.subHeading}>Národnost</div>
                  <div className={styles.checkGrid3}>
                    {discoveredNationalities.map((n) => (
                      <label key={n} className={styles.checkItem}>
                        <input
                          type="checkbox"
                          checked={selectedNationalities.has(n)}
                          onChange={() => toggleInSet(selectedNationalities, setSelectedNationalities, n)}
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {discoveredJobTitles.length > 0 && (
                <>
                  <div className={styles.subHeading}>Pracovní pozice</div>
                  <div className={styles.checkGrid}>
                    {discoveredJobTitles.map((j) => (
                      <label key={j} className={styles.checkItem}>
                        <input
                          type="checkbox"
                          checked={selectedJobTitles.has(j)}
                          onChange={() => toggleInSet(selectedJobTitles, setSelectedJobTitles, j)}
                        />
                        {j}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {optionsLoading && <div className={styles.hint}>Načítám filtry…</div>}
              {!optionsLoading && (discoveredNationalities.length === 0 || discoveredJobTitles.length === 0) && (
                <div className={styles.hint}>
                  Nevybrané filtry = exportovat vše z dané kategorie.
                </div>
              )}
            </section>

            {/* ── Sloupce ── */}
            <section className={styles.section}>
              <h3 className={styles.sectionHeading}>
                Sloupce
                <span className={styles.counts}>
                  Vybráno: {columnsCount} / {EXPORT_COLUMNS.length}
                </span>
              </h3>

              {GROUP_ORDER.map((group) => {
                const cols = columnsByGroup[group];
                if (cols.length === 0) return null;
                const allOn = cols.every(
                  (c) => selectedColumns.has(c.key) || (c.sensitive && !includeSensitive)
                );
                return (
                  <div key={group}>
                    <div className={styles.subHeading}>
                      {GROUP_LABELS[group]}
                      <button
                        type="button"
                        className={styles.groupLink}
                        onClick={() => toggleGroup(group, !allOn)}
                      >
                        {allOn ? "Zrušit výběr" : "Vybrat vše"}
                      </button>
                    </div>
                    <div className={styles.checkGrid}>
                      {cols.map((c) => {
                        const disabled = !!c.sensitive && !includeSensitive;
                        return (
                          <label
                            key={c.key}
                            className={[styles.checkItem, disabled ? styles.checkItemDisabled : ""].join(" ")}
                          >
                            <input
                              type="checkbox"
                              checked={selectedColumns.has(c.key)}
                              disabled={disabled}
                              onChange={() => toggleColumn(c)}
                            />
                            {c.label}
                            {c.sensitive && <span className={styles.lockIcon} title="Citlivý údaj">🔒</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>

            {/* ── Název souboru ── */}
            <section className={styles.section}>
              <h3 className={styles.sectionHeading}>Název souboru</h3>
              <input
                className={styles.filenameInput}
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onBlur={() => setFilename((f) => sanitizeFilename(f))}
                placeholder={defaultExportFilename()}
              />
              <div className={styles.hint}>
                Přípona <code>.csv</code> se doplní automaticky. Nepovolené znaky
                (<code>\ / : * ? " &lt; &gt; |</code>) se odstraní.
              </div>
            </section>

            {/* ── Citlivé údaje ── */}
            <section className={styles.section}>
              <label className={styles.sensitiveLabel}>
                <input
                  type="checkbox"
                  checked={includeSensitive}
                  onChange={(e) => handleSensitiveToggle(e.target.checked)}
                />
                <span>
                  <strong>Včetně citlivých údajů</strong> (rodné číslo, číslo OP, číslo pojištěnce, číslo účtu).
                  Tato akce bude zaznamenána do auditu.
                </span>
              </label>
            </section>

            {error && <p className={styles.error}>{error}</p>}
          </div>

          <div className={styles.footer}>
            <div className={styles.counts}>{columnsCount} sloupců</div>
            <div className={styles.footerButtons}>
              <Button variant="secondary" onClick={onClose} disabled={exporting}>
                Zrušit
              </Button>
              <Button
                variant="primary"
                onClick={handleExport}
                disabled={exporting || columnsCount === 0}
              >
                {exporting ? "Exportuji…" : "Exportovat CSV"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {confirmSensitive && (
        <ConfirmModal
          title="Exportovat citlivé údaje?"
          message="Chystáte se exportovat citlivé osobní údaje (rodné číslo, číslo OP, číslo účtu, číslo pojištěnce). Tato akce bude zaznamenána do auditu. Pokračovat?"
          confirmLabel="Ano, povolit"
          cancelLabel="Zrušit"
          danger
          onConfirm={acceptSensitive}
          onCancel={() => setConfirmSensitive(false)}
        />
      )}
    </>
  );
}
