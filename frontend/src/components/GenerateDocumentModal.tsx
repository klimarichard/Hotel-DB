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
  requiredCustomVars,
  isComputedVarType,
  resolveComputedVars,
  formatCustomValue,
  findImageOption,
  missingCustomVars,
  fillTemplate,
  type CustomVarDefs,
  type CustomVarImageOption,
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

  // Memoised so `defs` keeps a stable identity across renders – the computed
  // resolution below depends on it, and a fresh `{}` every render would rerun it
  // on every keystroke anywhere in the form.
  const defs: CustomVarDefs = useMemo(() => template?.variableDefs ?? {}, [template]);

  /**
   * Slots the form has to deal with, in {{var1}}..{{var25}} order.
   *
   * requiredCustomVars, NOT usedCustomVars: a "math" slot's operands may never
   * appear in the document text – {{var3}} = var1 * var2 with only {{var3}}
   * printed is the ordinary shape of a total – so scanning the text alone gave
   * those operands no field, left them empty, and printed a blank where the
   * total should be, with nothing anywhere explaining why.
   */
  const slots = useMemo(
    () => (template ? requiredCustomVars(template.htmlContent, defs) : []),
    [template, defs]
  );

  // Pre-fill configured defaults exactly once. Guarded by a ref rather than a
  // dependency list because re-running it would overwrite whatever the user has
  // typed since – the same guard GenerateContractModal uses.
  useEffect(() => {
    if (!template || prefilledRef.current) return;
    prefilledRef.current = true;
    const seed: Record<string, string> = {};
    for (const key of requiredCustomVars(template.htmlContent, template.variableDefs ?? {})) {
      const dflt = template.variableDefs?.[key]?.default;
      if (dflt?.kind === "literal" && dflt.value) seed[key] = dflt.value;
    }
    if (Object.keys(seed).length > 0) setValues(seed);
  }, [template]);

  /**
   * The derived slots ("math", "condition"), recomputed on every keystroke so
   * the read-only rows below update live. This is the feature's whole feedback
   * loop: a total that only appears on the printed PDF is a total nobody can
   * check before printing it.
   */
  const resolved = useMemo(
    () => resolveComputedVars(slots, defs, values),
    [slots, defs, values]
  );

  /**
   * The choices an "image" slot can actually offer: a name to pick, and a
   * picture to print. A half-configured choice is dropped rather than listed –
   * picking it would look like an answer and print nothing (the editor warns
   * about exactly this).
   */
  function imageOptions(key: string): CustomVarImageOption[] {
    return (defs[key]?.images ?? []).filter((o) => o.label.trim() && o.src);
  }

  // An image slot with no pictures configured is already exempt inside
  // missingCustomVars – it cannot be answered, so it must not block printing.
  // That rule lives in the engine rather than here so the contract modals get
  // it too; a local post-filter would have had to be written three times and
  // would have drifted the first time one of them changed.
  const missing = template
    ? missingCustomVars(template.htmlContent, defs, values)
    : [];

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
        // A computed slot has no typed-in value to format; its printed form
        // comes from the resolution merged in below.
        if (isComputedVarType(type)) continue;
        // The third argument is mandatory in practice for an "image" slot: the
        // typed value is only the chosen picture's NAME, and without the slot's
        // own definition to look it up in, formatCustomValue has no picture to
        // emit and the document prints an empty space. Passed for every type –
        // the others ignore it.
        vars[key] = formatCustomValue(type, values[key] ?? "", defs[key]);
      }
      Object.assign(vars, resolved.formatted);
      // The raw map is the third argument on purpose: {{#case}} matches against
      // raw values, not printed ones. A number prints with thousands separators
      // ("1 500") that its raw form doesn't have ("1500"), so matching the
      // printed strings would make a numeric switch fail for a reason invisible
      // both here and in the editor.
      const filled = fillTemplate(template.htmlContent, vars, resolved.raw);
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

    /**
     * A computed slot ("Výpočet" / "Podmínka") gets no input – it is derived
     * from the others – but it is NOT hidden either. Showing the live result
     * here is what lets the user check a total before printing it, which is the
     * only chance they get: the PDF opens in a new tab and nothing is stored, so
     * a wrong number is discovered by whoever the document is handed to.
     */
    if (isComputedVarType(type)) {
      // A condition is a yes/no, and printing its raw "ano" / "" would show a
      // blank for "no" – indistinguishable from "not computed yet".
      const value =
        type === "condition"
          ? (resolved.raw[key] ? "Ano" : "Ne")
          : resolved.formatted[key] ?? "";
      return (
        <div key={key} className={styles.computedRow}>
          <span className={styles.computedLabel}>{label}</span>
          <span className={value ? styles.computedValue : styles.computedEmpty}>
            {value || "– doplňte hodnoty výše –"}
          </span>
        </div>
      );
    }

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

    if (type === "image") {
      const options = imageOptions(key);
      // Nothing to pick: state it plainly and move on. Deliberately NOT a
      // free-text fallback – see isUnfillableImage for why that would be worse
      // than useless here – and deliberately not hidden either, because the
      // document has a gap where this picture should be and whoever prints it
      // is the person who can tell an editor about it.
      if (options.length === 0) {
        return (
          <div key={key} className={styles.imageNotice}>
            <span className={styles.label}>{label}</span>
            <span className={styles.imageNoticeText}>
              Pro tuto proměnnou nejsou nastavené žádné obrázky – v dokumentu zůstane
              prázdné místo.
            </span>
          </div>
        );
      }
      // The picture the current answer will print. Shown live, because a name
      // in a dropdown is not a picture: "Razítko Praha" and "Razítko Brno" are
      // indistinguishable until you see them, and the PDF opens in a new tab
      // with nothing stored, so this is the last chance to notice.
      const picked = findImageOption(def, raw);
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
              <option key={`${o.label}-${i}`} value={o.label}>{o.label}</option>
            ))}
          </select>
          {picked && (
            <div className={styles.imagePreview}>
              <img src={picked.src} alt={picked.label} className={styles.imagePreviewImg} />
            </div>
          )}
        </div>
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
        {type === "longtext" ? (
          // A paragraph of prose in a one-line box is unreviewable, and the line
          // breaks the author types here become <br> in the printed document –
          // so they have to be visible while typing.
          <textarea
            id={`docvar-${key}`}
            rows={5}
            className={
              isMissing
                ? `${styles.input} ${styles.textarea} ${styles.inputMissing}`
                : `${styles.input} ${styles.textarea}`
            }
            value={raw}
            onChange={(e) => setValue(key, e.target.value)}
          />
        ) : (
          <input
            id={`docvar-${key}`}
            type={type === "date" ? "date" : type === "number" ? "number" : "text"}
            className={isMissing ? `${styles.input} ${styles.inputMissing}` : styles.input}
            value={raw}
            onChange={(e) => setValue(key, e.target.value)}
          />
        )}
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
