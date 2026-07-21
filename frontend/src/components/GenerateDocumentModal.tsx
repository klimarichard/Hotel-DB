import { useState, useEffect, useMemo, useRef } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import modalStyles from "@/components/ConfirmModal.module.css";
import styles from "./GenerateDocumentModal.module.css";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { openPdfBlob } from "@/lib/pdfMerge";
// The custom-variable engine lives in contractVariables.ts for historical
// reasons, but the parts imported here (slot discovery, formatting, missing-value
// detection, {{#if}} substitution) have no employee or contract coupling at all.
import {
  usedCustomVars,
  formatCustomValue,
  missingCustomVars,
  fillTemplate,
  type CustomVarDefs,
  type CustomVarType,
} from "@/lib/contractVariables";

interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const DEFAULT_MARGINS: PageMargins = { top: 15, bottom: 15, left: 15, right: 15 };

interface DocumentTemplate {
  id: string;
  name: string;
  htmlContent: string;
  variableDefs?: CustomVarDefs;
  margins?: PageMargins;
}

interface Props {
  templateId: string;
  onClose: () => void;
}

/**
 * Fill a document template's custom variables and open the rendered PDF in a new
 * tab for printing.
 *
 * Deliberately different from GenerateContractModal in two ways:
 *  - There is no employee. Every placeholder in the document is a custom slot the
 *    user types in here; nothing is resolved from a record.
 *  - Nothing is persisted. The PDF is rendered, opened, and forgotten – no
 *    Storage blob, no Firestore doc, no history. So there is no "saved" state to
 *    reconcile and no audit entry.
 */
export default function GenerateDocumentModal({ templateId, onClose }: Props) {
  const { user } = useAuth();
  const [template, setTemplate] = useState<DocumentTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  // Validation is revealed by pressing the button, never on open – showing a red
  // box over a form the user has not touched yet reads as an accusation.
  const [triedGenerate, setTriedGenerate] = useState(false);
  const prefilledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const doc = await api.get<DocumentTemplate>(`/dokumenty/${templateId}`);
        if (cancelled) return;
        setTemplate(doc);
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? "Dokument se nepodařilo načíst.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  // Slots the document actually uses, in {{var1}}..{{var10}} order.
  const slots = useMemo(
    () => (template ? usedCustomVars(template.htmlContent) : []),
    [template]
  );
  const defs = template?.variableDefs ?? {};

  // Pre-fill configured defaults exactly once. Guarded by a ref rather than a
  // dependency list because re-running it would overwrite whatever the user has
  // typed since – the same guard GenerateContractModal uses.
  useEffect(() => {
    if (!template || prefilledRef.current) return;
    prefilledRef.current = true;
    const seed: Record<string, string> = {};
    for (const key of usedCustomVars(template.htmlContent)) {
      const dflt = template.variableDefs?.[key]?.default;
      if (dflt?.kind === "literal" && dflt.value) seed[key] = dflt.value;
    }
    if (Object.keys(seed).length > 0) setValues(seed);
  }, [template]);

  const missing = template ? missingCustomVars(template.htmlContent, defs, values) : [];

  function setValue(key: string, raw: string) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  async function handleGenerate() {
    if (!template || generating) return;
    setTriedGenerate(true);
    if (missing.length > 0) return;
    if (!user) { setError("Nejste přihlášeni."); return; }

    setGenerating(true);
    setError(null);
    try {
      const vars: Record<string, string> = {};
      for (const key of slots) {
        const type: CustomVarType = defs[key]?.type ?? "text";
        vars[key] = formatCustomValue(type, values[key] ?? "");
      }
      const filled = fillTemplate(template.htmlContent, vars);
      const margins = template.margins ?? DEFAULT_MARGINS;

      const token = await user.getIdToken();
      const resp = await fetch("/api/dokumenty/render-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ html: filled, margins }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || "Dokument se nepodařilo vytvořit.");
      }
      openPdfBlob(await resp.blob());
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Dokument se nepodařilo vytvořit.");
    } finally {
      setGenerating(false);
    }
  }

  function renderField(key: string) {
    const def = defs[key];
    const type: CustomVarType = def?.type ?? "text";
    // An unconfigured slot still works; it just has no name to show, so fall back
    // to its raw key rather than rendering a label-less input.
    const label = def?.label?.trim() || `{{${key}}}`;
    const raw = values[key] ?? "";
    const isMissing = triedGenerate && missing.includes(key);

    if (type === "bool") {
      return (
        <label key={key} className={styles.boolRow}>
          <input
            type="checkbox"
            checked={raw === "true"}
            onChange={(e) => setValue(key, e.target.checked ? "true" : "")}
          />
          <span>{label}</span>
        </label>
      );
    }

    if (type === "list") {
      // An optionless list is an authoring mistake (the editor warns about it),
      // but it must not become an unfillable required field here – fall back to
      // a free-text input so the document can still be produced.
      const options = def?.options ?? [];
      if (options.length === 0) {
        return (
          <div key={key} className={styles.field}>
            <label className={styles.label} htmlFor={`docvar-${key}`}>{label}</label>
            <input
              id={`docvar-${key}`}
              type="text"
              className={isMissing ? `${styles.input} ${styles.inputMissing}` : styles.input}
              value={raw}
              onChange={(e) => setValue(key, e.target.value)}
            />
          </div>
        );
      }
      return (
        <div key={key} className={styles.field}>
          <label className={styles.label} htmlFor={`docvar-${key}`}>
            {label}
            {def?.optional && <span className={styles.optional}> (nepovinné)</span>}
          </label>
          <select
            id={`docvar-${key}`}
            className={isMissing ? `${styles.input} ${styles.inputMissing}` : styles.input}
            value={raw}
            onChange={(e) => setValue(key, e.target.value)}
          >
            <option value="">– vyberte –</option>
            {options.map((o, i) => (
              <option key={`${o}-${i}`} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={key} className={styles.field}>
        <label className={styles.label} htmlFor={`docvar-${key}`}>
          {label}
          {def?.optional && <span className={styles.optional}> (nepovinné)</span>}
        </label>
        <input
          id={`docvar-${key}`}
          type={type === "date" ? "date" : type === "number" ? "number" : "text"}
          className={isMissing ? `${styles.input} ${styles.inputMissing}` : styles.input}
          value={raw}
          onChange={(e) => setValue(key, e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className={modalStyles.overlay}>
      <div className={modalStyles.modal} style={{ maxWidth: 560, width: "min(560px, 96vw)" }}>
        <div className={modalStyles.header}>
          <h3 className={modalStyles.title}>
            {template ? template.name : "Dokument"}
          </h3>
          <IconButton variant="close" aria-label="Zavřít" onClick={onClose}>
            ✕
          </IconButton>
        </div>

        <div className={modalStyles.body}>
          {loading && <p>Načítání…</p>}

          {!loading && template && slots.length === 0 && (
            <p>
              Tento dokument nemá žádné proměnné k vyplnění – rovnou jej vytisknete
              tlačítkem níže.
            </p>
          )}

          {!loading && template && slots.length > 0 && (
            <>
              <p className={styles.hint}>
                Doplňte údaje a dokument se otevře jako PDF v nové záložce, odkud
                jej vytisknete.
              </p>
              {slots.map(renderField)}
            </>
          )}

          {triedGenerate && missing.length > 0 && (
            <p className={styles.error}>
              Vyplňte prosím všechna povinná pole ({missing.length}).
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={modalStyles.footer}>
          <Button variant="secondary" onClick={onClose} disabled={generating}>
            Zrušit
          </Button>
          <Button variant="primary" onClick={handleGenerate} disabled={loading || !template || generating}>
            {generating ? "Připravuji…" : "Vytisknout"}
          </Button>
        </div>
      </div>
    </div>
  );
}
