import { Fragment, useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import Button from "@/components/Button";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import {
  STARTER_KIT_OPTIONS,
  Table,
  ResizableImage,
  IMAGE_WIDTH_PRESETS,
  ListItemIndent,
  NbspKeybind,
  LineHeight,
  PageBreak,
  PasteCleanup,
  SearchHighlight,
  searchPluginKey,
  ListItemStyle,
  FontSize,
  TabParagraph,
} from "@/lib/editor/extensions";

import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "@/components/ConfirmModal";
import modalStyles from "@/components/ConfirmModal.module.css";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  VARIABLE_GROUPS,
  CONTRACT_VAR_COUNT,
  customVarKeys,
  isCustomVarKey,
  CUSTOM_VAR_TYPE_LABELS,
  CUSTOM_VAR_MAX_OPTIONS,
  CUSTOM_VAR_FORMULA_MAX,
  CUSTOM_VAR_DECIMALS_MAX,
  CUSTOM_VAR_MAX_IMAGES,
  CUSTOM_VAR_IMAGE_MAX_CHARS,
  CUSTOM_VAR_IMAGE_WIDTHS,
  CUSTOM_VAR_IMAGE_ALIGNS,
  CUSTOM_VAR_IMAGE_ALIGN_LABELS,
  isComputedVarType,
  comparableTypeOfCustom,
  formulaDependencies,
  evalMathFormula,
  OPS_FOR_COMPARABLE,
  usedCustomVars,
  fillTemplate,
  COMPARABLE_VARS,
  COMPARE_OP_LABELS,
  type ComparableType,
  type CustomVarDefs,
  type CustomVarType,
  type CustomVarDefault,
  type CompareOp,
  type CustomVarCondition,
  type CustomVarImageOption,
  type CustomVarImageAlign,
} from "@/lib/contractVariables";
import { prepareImageDataUri, dataUriKb, IMAGE_MIME_TYPES } from "@/lib/imageDownscale";
import {
  buildPreview,
  defaultBools,
  usedConditionals,
  usedConditionOperands,
  PREVIEW_RAW_DEFAULTS,
  CONDITIONAL_LABELS,
} from "@/lib/templatePreview";
import { formatTimestampCZ } from "@/lib/dateFormat";
import styles from "./ContractTemplatesPage.module.css";


const ALL_TYPES = Object.keys(CONTRACT_TYPE_LABELS) as ContractType[];

/**
 * The custom slots a CONTRACT template offers: {{var1}}…{{var10}}.
 *
 * Deliberately NOT `CUSTOM_VAR_KEYS`, which is the engine's recognition ceiling
 * (25 since v5.2.0, when Dokumenty needed the wider space). A contract is a
 * signed legal document and stays at CONTRACT_VAR_COUNT — and the contracts
 * server validator refuses to store a def beyond it, so a picker offering 25
 * would hand out eleven slots that silently lose their configuration on save.
 */
const CONTRACT_SLOT_KEYS = customVarKeys(CONTRACT_VAR_COUNT);
const CONTRACT_SLOT_SET = new Set(CONTRACT_SLOT_KEYS);

/**
 * When the pictures on a template's "Obrázek" slots start crowding out the
 * document itself, in characters of base64 across every such slot.
 *
 * Every picture is inlined on the SAME Firestore document as the template's
 * HTML (see lib/imageDownscale.ts for why it cannot be a Storage URL), and
 * Firestore refuses a document over 1 MiB. Eight choices at the per-picture cap
 * would be ~960 000 characters on their own, so the ceiling is genuinely
 * reachable rather than theoretical. 600 000 is ~60 % of it, which still leaves
 * roughly 400 kB for the text and for any pictures the author pasted straight
 * into the document — enough headroom that the warning arrives while there is
 * still something to do about it, instead of as a failed save after an hour of
 * editing.
 */
const IMAGE_TOTAL_WARN_CHARS = 600_000;

/** A choice that can actually be picked AND rendered: it has both halves. */
function isUsableImageOption(opt: CustomVarImageOption): boolean {
  return opt.label.trim() !== "" && !!opt.src;
}

interface TemplateMeta {
  id: string;
  type: ContractType;
  name: string;
  /** "standalone" for user-created custom templates; null/undefined for built-ins. */
  kind?: "standalone" | null;
  /** Absent = active. `false` = deactivated (hidden from generation, sorted last). */
  active?: boolean;
  variables: string[];
  updatedAt?: { seconds: number } | null;
}

interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const DEFAULT_MARGINS: PageMargins = { top: 15, bottom: 15, left: 15, right: 15 };

const MARGIN_PRESETS: { key: string; label: string; value: PageMargins }[] = [
  { key: "standard", label: "Standardní", value: { top: 25, bottom: 25, left: 25, right: 25 } },
  { key: "narrow", label: "Úzké", value: { top: 13, bottom: 13, left: 13, right: 13 } },
  { key: "moderate", label: "Střední", value: { top: 25, bottom: 25, left: 19, right: 19 } },
  { key: "wide", label: "Široké", value: { top: 25, bottom: 25, left: 51, right: 51 } },
];

function marginsEqual(a: PageMargins, b: PageMargins): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/**
 * Warning text for custom slots that the template's text uses but never named.
 * Such a slot still works (it falls back to Text and shows its raw key to
 * whoever generates the document), which is exactly why it needs flagging: it
 * looks like a bug rather than an omission.
 *
 * Returns null when there is nothing to warn about.
 */
function customVarWarning(html: string, defs: CustomVarDefs): string | null {
  const allUsed = usedCustomVars(html);
  // Slots the ENGINE recognises but this page does not offer ({{var11}}+, typed
  // by hand or pasted in from a Dokumenty template). They cannot be configured
  // here – the server would reject the def – so they get their own message
  // instead of "chybí název a typ", which the user could never act on.
  const overLimit = allUsed.filter((k) => !CONTRACT_SLOT_SET.has(k));
  const used = allUsed.filter((k) => CONTRACT_SLOT_SET.has(k));
  const unnamed = used.filter((k) => !defs[k]?.label?.trim());
  // A "list" slot with no choices renders an empty dropdown that can never be
  // satisfied, so the generate form falls back to a free-text box for it. That
  // fallback keeps the document producible, which is precisely why the omission
  // has to be surfaced here instead of being discovered by whoever fills it in.
  const emptyLists = used.filter(
    (k) => defs[k]?.type === "list" && !(defs[k]?.options ?? []).some((o) => o.trim())
  );
  // A math slot with no formula prints nothing at all – the same silent blank a
  // missing value would leave, but with no field anywhere to notice it in.
  const emptyFormulas = used.filter(
    (k) => defs[k]?.type === "math" && !(defs[k]?.formula ?? "").trim()
  );
  // An image slot with no usable choice offers nothing to pick and prints
  // nothing – the same silent blank as an empty list, but with no free-text
  // fallback to rescue it, so the generate dialog can only say "not configured".
  const emptyImages = used.filter(
    (k) => defs[k]?.type === "image" && !(defs[k]?.images ?? []).some(isUsableImageOption)
  );
  // Half-filled choices: a name with no picture would print nothing when picked,
  // a picture with no name can never be picked at all. Either way the author
  // sees a choice that looks finished and behaves as if it were missing.
  const partialImages = used.filter(
    (k) =>
      defs[k]?.type === "image" &&
      (defs[k]?.images ?? []).some((o) => (o.label.trim() !== "") !== !!o.src)
  );
  const parts: string[] = [];
  if (unnamed.length > 0) parts.push(`Bez nastavení: ${unnamed.join(", ")} – chybí název a typ.`);
  if (emptyLists.length > 0) parts.push(`Bez možností: ${emptyLists.join(", ")} – seznam nemá žádné hodnoty.`);
  if (emptyFormulas.length > 0) parts.push(`Bez vzorce: ${emptyFormulas.join(", ")} – výpočet nic nevypíše.`);
  if (emptyImages.length > 0) parts.push(`Bez obrázků: ${emptyImages.join(", ")} – žádná možnost nemá název i obrázek.`);
  if (partialImages.length > 0) parts.push(`Neúplné obrázky: ${partialImages.join(", ")} – možnost má jen název, nebo jen obrázek.`);
  if (overLimit.length > 0) {
    parts.push(
      `Mimo rozsah: ${overLimit.join(", ")} – šablony smluv nabízejí jen ` +
        `${CONTRACT_VAR_COUNT} vlastních proměnných (var1–var${CONTRACT_VAR_COUNT}), ` +
        `nastavit je nelze.`
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

interface TemplateDoc extends TemplateMeta {
  htmlContent: string;
  margins?: PageMargins;
  /** Per-template config of the {{var1}}..{{var10}} slots. */
  variableDefs?: CustomVarDefs;
}

function SaveIcon() {
  // Floppy-disk glyph at 14×14 – matches the Button text size.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

export default function ContractTemplatesPage() {
  const { user, can } = useAuth();
  // Editing is gated by contractTemplates.manage; a view-only user (route perm
  // contractTemplates.view) sees templates read-only – no toolbar, no Save, no
  // Create, no variable-insert, no margins editor.
  const canManage = can("contractTemplates.manage");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<Record<string, TemplateMeta | null>>({});
  const [customTypes, setCustomTypes] = useState<TemplateMeta[]>([]);
  const [selected, setSelected] = useState<ContractType>(ALL_TYPES[0]);
  const [saving, setSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createIdDraft, setCreateIdDraft] = useState("");
  const [createNameDraft, setCreateNameDraft] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Delete / activate-toggle: a staged confirm dialog, an error dialog, and the
  // id currently being mutated (disables that row's buttons).
  const [actionConfirm, setActionConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const [marginsOpen, setMarginsOpen] = useState(false);
  const [margins, setMargins] = useState<PageMargins>(DEFAULT_MARGINS);
  // Per-template config of the {{var1}}..{{var10}} slots (label + type). Saved
  // with the template; the same slot means different things in different ones.
  const [variableDefs, setVariableDefs] = useState<CustomVarDefs>({});
  const [customVarsOpen, setCustomVarsOpen] = useState(false);
  // "Obrázek" slots: one hidden file input serves every choice's upload button,
  // with the choice the next pick belongs to held here (a per-row input would be
  // one DOM node per picture for no gain). `varImageShrunk` remembers which
  // choices were downscaled on the way in – an inline note, not an error.
  const varImageInputRef = useRef<HTMLInputElement>(null);
  const [varImageTarget, setVarImageTarget] = useState<{ key: string; index: number } | null>(null);
  const [varImageShrunk, setVarImageShrunk] = useState<Record<string, boolean>>({});
  // "Přepínač" – the small dialog that assembles a {{#case varN = …}} block.
  // Retyping the compared value by hand is the main way a switch silently fails
  // to match, so for a "list" slot the dialog picks from the configured choices.
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [caseKey, setCaseKey] = useState("");
  const [caseOp, setCaseOp] = useState<"=" | "!=">("=");
  const [caseValue, setCaseValue] = useState("");
  // Set on save: custom slots used in the text that have no name/type yet.
  // Persists (unlike the "Uloženo" toast) until they are configured.
  const [varWarning, setVarWarning] = useState<string | null>(null);
  // Force a rerender on every editor transaction so isActive(...) checks
  // (active toolbar buttons, in-table contextual buttons, etc.) reflect
  // selection changes. TipTap React v3 doesn't subscribe to these by default.
  const [, forceRerender] = useReducer((x: number) => x + 1, 0);

  // ── Náhled (preview) ──────────────────────────────────────────────────────
  // Layout (tab stops, wraps, page breaks) is impossible to judge in the raw
  // editor: the {{#if …}} markers themselves occupy space in the line. Preview
  // renders the document as it will actually print, with sample data.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBools, setPreviewBools] = useState<Record<string, boolean>>({});
  // Editable operand values for derived conditions in the preview (ISO date /
  // number strings), keyed by comparable-variable key. Seeded from the sample
  // defaults; lets the user drive a condition and watch which branch it keeps.
  const [previewRaw, setPreviewRaw] = useState<Record<string, string>>({});
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  // The PDF preview goes through the same endpoint that generates real contracts,
  // which is gated on contracts.generate. A template editor without it still gets
  // the in-editor preview; only the PDF button is hidden.
  const canPreviewPdf = can("contracts.generate");

  // The 3-column workspace + 210mm A4 canvas + TipTap toolbars aren't usable on
  // a phone, so below the phone breakpoint we show a "use a larger screen" notice
  // instead of the editor. Mirrors the matchMedia hook in ShiftPlannerPage.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(
      "(max-width: 559.98px), (orientation: landscape) and (max-height: 480px)"
    );
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Unsaved-changes tracking. The loader sets `isLoadingRef` while it
  // pushes content into the editor so the resulting `update` events don't
  // get counted as user edits.
  const [isDirty, setIsDirty] = useState(false);
  const isLoadingRef = useRef(false);
  // Target template id remembered while the unsaved-changes confirm modal
  // is open. null when no switch is pending.
  const [pendingSwitch, setPendingSwitch] = useState<ContractType | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure(STARTER_KIT_OPTIONS),
      TabParagraph,
      ListItemIndent,
      NbspKeybind,
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      LineHeight,
      ListItemStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PageBreak,
      PasteCleanup,
      SearchHighlight,
    ],
    content: "",
    editable: canManage,
    editorProps: {
      attributes: { class: styles.editorContent },
      handleKeyDown(view, event) {
        if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
          if (!view.editable) return false;
          event.preventDefault();
          setFindOpen(true);
          setTimeout(() => findInputRef.current?.focus(), 0);
          return true;
        }
        if (event.key === "Tab") {
          // Inside a list item: let ListItemIndent's keyboard shortcut handle it.
          const { $from } = view.state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === "listItem") return false;
          }
          // Outside a list: insert \t (lands on the next CSS tab stop).
          event.preventDefault();
          view.dispatch(view.state.tr.insertText("\t"));
          return true;
        }
        return false;
      },
    },
  });

  // ── Náhled (preview) – needs `editor`, so it lives below it ────────────────
  // Both memos also depend on editor.state.doc: forceRerender fires on every
  // transaction, so a {{#if}} typed while the preview is open picks up its
  // checkbox and re-renders without leaving preview.
  const editorDoc = editor?.state.doc;

  /** Conditionals THIS template actually uses; only these get a checkbox. */
  const previewConditionals = useMemo(() => {
    if (!previewOpen || !editor) return [];
    return usedConditionals(editor.getHTML(), variableDefs);
  }, [previewOpen, editor, variableDefs, editorDoc]);

  /** Comparable operands the template's derived conditions compare on – shown as
   *  editable fields so the user can drive each condition in the preview. */
  const previewOperands = useMemo(() => {
    if (!previewOpen || !editor) return [];
    const keys = usedConditionOperands(editor.getHTML(), variableDefs);
    return keys
      .map((k) => COMPARABLE_VARS.find((v) => v.key === k))
      .filter((v): v is (typeof COMPARABLE_VARS)[number] => !!v);
  }, [previewOpen, editor, variableDefs, editorDoc]);

  /** The document as it will print: variables filled, conditionals resolved. */
  const previewHtml = useMemo(() => {
    if (!previewOpen || !editor) return "";
    const html = editor.getHTML();
    // The raw map is fillTemplate's third argument and is what {{#case}} matches
    // on; without it a switch could never pick a branch in the preview.
    const { vars, raw } = buildPreview(html, variableDefs, previewBools, previewRaw);
    return fillTemplate(html, vars, raw);
  }, [previewOpen, editor, variableDefs, previewBools, previewRaw, editorDoc]);

  function openPreview() {
    if (!editor) return;
    const html = editor.getHTML();
    const keys = usedConditionals(html, variableDefs);
    // Seed any conditional we don't have state for yet, keeping the ones already
    // flipped this session.
    setPreviewBools((prev) => ({ ...defaultBools(keys), ...prev }));
    // Seed condition operands from the sample defaults (keep any already edited).
    const opKeys = usedConditionOperands(html, variableDefs);
    setPreviewRaw((prev) => {
      const next = { ...prev };
      for (const k of opKeys) if (!(k in next)) next[k] = String(PREVIEW_RAW_DEFAULTS[k] ?? "");
      return next;
    });
    setPreviewOpen(true);
  }

  /**
   * Render the CURRENT editor content through the same Puppeteer endpoint that
   * produces real contracts, and open the PDF. The in-editor preview uses the
   * browser's layout engine, so it can only APPROXIMATE where a tab stop or a
   * page break lands; this is the byte-accurate check.
   */
  async function handlePdfPreview() {
    if (!editor || !user || pdfPreviewLoading) return;
    setPdfPreviewLoading(true);
    try {
      const html = editor.getHTML();
      const { vars, raw } = buildPreview(html, variableDefs, previewBools, previewRaw);
      const filled = fillTemplate(html, vars, raw);
      const token = await user.getIdToken();
      const resp = await fetch("/api/contracts/render-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ html: filled, margins }),
      });
      if (!resp.ok) throw new Error();
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErrorModal("Nepodařilo se vytvořit náhled PDF.");
    } finally {
      setPdfPreviewLoading(false);
    }
  }

  const fetchTemplates = useCallback(async () => {
    if (!user) return;
    const token = await user.getIdToken();
    const resp = await fetch("/api/contractTemplates", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return;
    const list: TemplateMeta[] = await resp.json();
    const map: Record<string, TemplateMeta | null> = {};
    for (const t of ALL_TYPES) map[t] = null;
    for (const t of list) map[t.type ?? t.id] = t;
    setTemplates(map);
    setCustomTypes(list.filter((t) => t.kind === "standalone"));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // --- Delete (custom templates) / activate-toggle (built-ins) ---
  // The page talks to the API via raw fetch + bearer token (see fetchTemplates);
  // these helpers keep that convention.
  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await user!.getIdToken();
      const hasBody = init?.body !== undefined;
      return fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
      });
    },
    [user]
  );

  async function doSetActive(id: string, active: boolean) {
    setActionConfirm(null);
    if (!user) return;
    setBusyTemplateId(id);
    try {
      const resp = await authFetch(`/api/contractTemplates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setErrorModal(body.error ?? "Změnu se nepodařilo uložit.");
        return;
      }
      await fetchTemplates();
    } catch (e) {
      setErrorModal((e as Error).message ?? "Změnu se nepodařilo uložit.");
    } finally {
      setBusyTemplateId(null);
    }
  }

  function handleToggleActive(id: string, currentlyActive: boolean, label: string) {
    if (!currentlyActive) {
      // Reactivating is safe/non-destructive – do it immediately, no confirm.
      doSetActive(id, true);
      return;
    }
    setActionConfirm({
      title: "Deaktivovat šablonu",
      message: `Šablona „${label}" se skryje z generování smluv a přesune se na konec seznamu. Kdykoli ji můžete znovu aktivovat.`,
      confirmLabel: "Deaktivovat",
      onConfirm: () => doSetActive(id, false),
    });
  }

  async function doDeleteTemplate(t: TemplateMeta) {
    setActionConfirm(null);
    if (!user) return;
    setBusyTemplateId(t.id);
    try {
      const resp = await authFetch(`/api/contractTemplates/${t.id}`, { method: "DELETE" });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setErrorModal(body.error ?? "Šablonu se nepodařilo smazat.");
        return;
      }
      if (selected === t.id) setSelected(ALL_TYPES[0]);
      await fetchTemplates();
    } catch (e) {
      setErrorModal((e as Error).message ?? "Šablonu se nepodařilo smazat.");
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function handleDeleteTemplate(t: TemplateMeta) {
    if (!user) return;
    // Best-effort usage count so the confirm can warn how many generated
    // documents reference this template (they survive the delete).
    setBusyTemplateId(t.id);
    let count = 0;
    try {
      const resp = await authFetch(`/api/contractTemplates/${t.id}/usage`);
      if (resp.ok) count = (await resp.json()).count ?? 0;
    } catch {
      /* count is advisory; fall through with 0 */
    }
    setBusyTemplateId(null);
    const usageLine =
      count > 0
        ? `Šablona je použita u vygenerovaných dokumentů (počet: ${count}). Ty zůstanou zachovány, ztratí ale odkaz na název šablony. `
        : "";
    setActionConfirm({
      title: "Smazat šablonu",
      message: `${usageLine}Opravdu chcete smazat šablonu „${t.name}"? Tato akce je nevratná.`,
      confirmLabel: "Smazat",
      danger: true,
      onConfirm: () => doDeleteTemplate(t),
    });
  }

  useEffect(() => {
    if (!editor) return;
    const handler = () => forceRerender();
    editor.on("transaction", handler);
    return () => { editor.off("transaction", handler); };
  }, [editor]);

  // Keep the editor's editable state in sync with the permission, which resolves
  // asynchronously after auth loads (and could change on re-auth).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canManage);
  }, [editor, canManage]);

  /**
   * Visually push every page-break node down to the start of the next A4
   * page (with a 15 mm top margin on the new page). The .a4Page CSS uses a
   * 309 mm cycle (297 mm paper + 12 mm gap), so a page break inserted at
   * offset Y is stretched to height ((floor(Y/309)+1)*309 + 15) - Y mm.
   * Heights are reset to 0 first so re-measurement on subsequent
   * transactions accounts for cumulative effect of breaks above.
   */
  useEffect(() => {
    if (!editor) return;
    const PAGE_CYCLE_MM = 309;
    const TOP_MARGIN_MM = margins.top;
    const measure = () => {
      const a4 = document.querySelector(`.${styles.a4Page}`) as HTMLElement | null;
      if (!a4) return;
      const a4Rect = a4.getBoundingClientRect();
      const pxPerMm = a4Rect.width / 210;
      const breaks = Array.from(
        a4.querySelectorAll<HTMLElement>('[data-page-break="true"]')
      );
      breaks.forEach((br) => { br.style.height = "0px"; });
      // Re-measure in DOM order so each break sees the cumulative shift
      // from breaks above it.
      breaks.forEach((br) => {
        const offsetTop = br.getBoundingClientRect().top - a4.getBoundingClientRect().top;
        const offsetMm = offsetTop / pxPerMm;
        const targetMm = (Math.floor(offsetMm / PAGE_CYCLE_MM) + 1) * PAGE_CYCLE_MM + TOP_MARGIN_MM;
        const heightMm = Math.max(0, targetMm - offsetMm);
        br.style.height = `${heightMm * pxPerMm}px`;
      });
    };
    const handler = () => requestAnimationFrame(measure);
    editor.on("transaction", handler);
    handler();
    return () => { editor.off("transaction", handler); };
  }, [editor, margins]);

  // Load the selected template's content into the editor.
  // Depending on `selectedTemplateId` (not the whole templates map) ensures
  // the effect re-fires once fetchTemplates() resolves and the id materializes,
  // while staying stable across saves that re-fetch the list under the same id.
  const selectedTemplateId = templates[selected]?.id;
  useEffect(() => {
    if (!editor || !user) return;

    if (!selectedTemplateId) {
      editor.commands.setContent("<p></p>");
      return;
    }

    (async () => {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/contractTemplates/${selectedTemplateId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const doc: TemplateDoc = await resp.json();
      isLoadingRef.current = true;
      editor.commands.setContent(doc.htmlContent || "<p></p>");
      setMargins(doc.margins ?? DEFAULT_MARGINS);
      const defs = doc.variableDefs ?? {};
      setVariableDefs(defs);
      // Warn straight away: a template can arrive with unconfigured slots (saved
      // before they were named, or the {{varN}} was typed by hand), and the user
      // must not have to make an edit before hearing about it.
      setVarWarning(customVarWarning(doc.htmlContent || "", defs));
      // Release the flag on the next tick so any synchronous `update`
      // events fired by setContent are still counted as load events.
      setTimeout(() => {
        isLoadingRef.current = false;
        setIsDirty(false);
      }, 0);
    })();
  }, [selectedTemplateId, editor, user]);

  // Mark dirty on any user-driven editor update.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (isLoadingRef.current) return;
      setIsDirty(true);
    };
    editor.on("update", onUpdate);
    return () => { editor.off("update", onUpdate); };
  }, [editor]);

  // Keep the "unconfigured slot" warning current while editing: inserting
  // {{var4}} should flag it at once, and deleting the last {{var2}} should clear
  // it. Debounced, because it reads the whole document (getHTML) and the update
  // event fires on every keystroke.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recompute = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setVarWarning(customVarWarning(editor.getHTML(), variableDefs));
      }, 400);
    };
    editor.on("update", recompute);
    return () => {
      clearTimeout(timer);
      editor.off("update", recompute);
    };
  }, [editor, variableDefs]);

  /**
   * `kind`:
   *   undefined → plain `{{key}}`
   *   "if"      → `{{#if key}}…{{/if}}`      — block shown when the value is set
   *   "unless"  → `{{#unless key}}…{{/unless}}` — block shown when it is NOT set
   * The caret lands between the tags so the paragraph can be typed straight in.
   */
  function insertVariable(key: string, kind?: "if" | "unless") {
    if (!editor) return;
    if (kind === "if" || kind === "unless") {
      const left = kind === "if" ? `{{#if ${key}}}` : `{{#unless ${key}}}`;
      const right = kind === "if" ? `{{/if}}` : `{{/unless}}`;
      const from = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .insertContent(left + right)
        .setTextSelection(from + left.length)
        .run();
      return;
    }
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  }

  /** Custom slots this template already uses – what the switch can branch on. */
  function caseSlotKeys(): string[] {
    if (!editor) return [];
    return usedCustomVars(editor.getHTML()).filter((k) => CONTRACT_SLOT_SET.has(k));
  }

  function openCaseModal() {
    const keys = caseSlotKeys();
    // Keep the previous pick when it is still a slot of this template, so
    // inserting a second branch of the same switch needs no re-selection.
    setCaseKey((prev) => (keys.includes(prev) ? prev : keys[0] ?? ""));
    setCaseValue("");
    setCaseOp("=");
    setCaseModalOpen(true);
  }

  /**
   * Insert `{{#case varN = value}}…{{/case}}` with the caret between the tags, so
   * the branch's text can be typed straight in. Mirrors insertVariable's
   * {{#if}} handling.
   */
  function insertCaseBlock() {
    if (!editor || !caseKey) return;
    const left = `{{#case ${caseKey} ${caseOp} ${caseValue.trim()}}}`;
    const right = "{{/case}}";
    const from = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .insertContent(left + right)
      .setTextSelection(from + left.length)
      .run();
    setCaseModalOpen(false);
  }

  async function handleSave() {
    if (!editor || !user) return;
    setSaving(true);
    setSaveMsg(null);

    try {
      const token = await user.getIdToken();
      const htmlContent = editor.getHTML();
      const id = selected; // use the type as the doc ID for easy lookup
      const resp = await fetch(`/api/contractTemplates/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: selected,
          // Built-in types resolve via the label map; custom (standalone)
          // templates aren't in it, so fall back to their stored name –
          // otherwise the backend rejects with "type, name, and htmlContent
          // are required" because name comes through undefined.
          name:
            CONTRACT_TYPE_LABELS[selected] ??
            customTypes.find((t) => t.id === selected)?.name ??
            templates[selected]?.name ??
            selected,
          htmlContent,
          margins,
          variableDefs,
        }),
      });

      if (!resp.ok) {
        // Surface the backend's Czech error (e.g. "Šablona je příliš velká…")
        // instead of a generic message, so the user knows the real cause.
        let detail = "";
        try {
          const body = (await resp.json()) as { error?: string };
          detail = body?.error ?? "";
        } catch { /* non-JSON body – fall through to generic */ }
        throw new Error(detail || `Chyba při ukládání (${resp.status})`);
      }
      setSaveMsg("Uloženo");
      setIsDirty(false);

      setVarWarning(customVarWarning(htmlContent, variableDefs));

      await fetchTemplates();
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      // Detailed errors (e.g. the 1 MB size message) need longer to read than
      // the brief success toast.
      setSaveMsg(err instanceof Error ? err.message : "Chyba při ukládání");
      setTimeout(() => setSaveMsg(null), 10000);
    } finally {
      setSaving(false);
    }
  }

  // Wrap the sidebar template switch so unsaved changes prompt the user.
  function requestTemplateSwitch(id: ContractType) {
    if (id === selected) return;
    if (isDirty) {
      setPendingSwitch(id);
      return;
    }
    setSelected(id);
  }

  async function handleSaveAndSwitch() {
    const target = pendingSwitch;
    if (!target) return;
    await handleSave();
    setPendingSwitch(null);
    setSelected(target);
  }

  function handleDiscardAndSwitch() {
    const target = pendingSwitch;
    if (!target) return;
    setPendingSwitch(null);
    setIsDirty(false);
    setSelected(target);
  }

  function applySearch(query: string) {
    if (!editor) return;
    editor.view.dispatch(editor.view.state.tr.setMeta(searchPluginKey, { query }));
  }

  function findNext() {
    if (!editor || !findQuery) return;
    const lower = findQuery.toLowerCase();
    const { state } = editor.view;
    const startPos = state.selection.to;
    let foundFrom = -1;
    state.doc.descendants((node, pos) => {
      if (foundFrom !== -1) return false;
      if (!node.isText || !node.text) return;
      const idx = node.text.toLowerCase().indexOf(lower);
      if (idx !== -1 && pos + idx >= startPos) {
        foundFrom = pos + idx;
        return false;
      }
      return undefined;
    });
    // Wrap-around: search from the start.
    if (foundFrom === -1) {
      state.doc.descendants((node, pos) => {
        if (foundFrom !== -1) return false;
        if (!node.isText || !node.text) return;
        const idx = node.text.toLowerCase().indexOf(lower);
        if (idx !== -1) {
          foundFrom = pos + idx;
          return false;
        }
        return undefined;
      });
    }
    if (foundFrom === -1) return;
    editor.chain().focus().setTextSelection({ from: foundFrom, to: foundFrom + findQuery.length }).run();
    editor.view.dom.querySelector(".tt-search-hit.tt-search-active")?.classList.remove("tt-search-active");
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const el = sel?.anchorNode?.parentElement?.closest(".tt-search-hit");
      el?.scrollIntoView({ block: "center" });
    });
  }

  function replaceCurrent() {
    if (!editor || !findQuery) return;
    const { from, to } = editor.view.state.selection;
    const selected = editor.view.state.doc.textBetween(from, to);
    if (selected.toLowerCase() === findQuery.toLowerCase()) {
      editor.chain().focus().insertContentAt({ from, to }, replaceQuery).run();
    }
    findNext();
  }

  function replaceAll() {
    if (!editor || !findQuery) return;
    const lower = findQuery.toLowerCase();
    // Collect ranges first (descending) then replace; replacing in document order
    // would shift later positions.
    const ranges: { from: number; to: number }[] = [];
    editor.view.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const text = node.text.toLowerCase();
      let from = 0;
      while (true) {
        const idx = text.indexOf(lower, from);
        if (idx === -1) break;
        ranges.push({ from: pos + idx, to: pos + idx + findQuery.length });
        from = idx + findQuery.length;
      }
    });
    let chain = editor.chain().focus();
    for (let i = ranges.length - 1; i >= 0; i--) {
      chain = chain.insertContentAt(ranges[i], replaceQuery);
    }
    chain.run();
  }

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: reader.result as string }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  /**
   * A picture picked for one choice of an "Obrázek" slot. Goes through
   * prepareImageDataUri, which downscales an oversized file rather than
   * refusing it outright, and refuses only when even that isn't enough – the
   * message it returns is the one to show, because it says what to do next.
   */
  async function handleVarImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = varImageTarget;
    // Reset before the await: without it, picking the SAME file again fires no
    // change event and the upload silently does nothing.
    e.target.value = "";
    if (!file || !target) return;
    const result = await prepareImageDataUri(file, CUSTOM_VAR_IMAGE_MAX_CHARS);
    if (!result.ok) {
      setErrorModal(result.message);
      return;
    }
    setVariableDefs((prev) => {
      const def = prev[target.key];
      const images = def?.images ?? [];
      // The row can be gone if the author removed it while the file dialog was
      // open; writing the picture back would resurrect a deleted choice.
      if (!def || !images[target.index]) return prev;
      const next = images.map((o, i) =>
        i === target.index ? { ...o, src: result.dataUri } : o
      );
      return { ...prev, [target.key]: { ...def, images: next } };
    });
    setVarImageShrunk((prev) => ({
      ...prev,
      [`${target.key}:${target.index}`]: result.shrunk,
    }));
    setIsDirty(true);
  }

  if (isPhone) {
    return (
      <div className={styles.phoneNotice}>
        <div className={styles.phoneNoticeIcon} aria-hidden="true">🖥️</div>
        <h1 className={styles.phoneNoticeTitle}>Šablony smluv</h1>
        <p className={styles.phoneNoticeText}>
          Editor šablon pracuje s celou stránkou formátu A4 a širokým panelem nástrojů,
          které se na telefon nevejdou. Otevřete jej prosím na počítači nebo na tabletu
          na šířku.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h1 className={styles.title}>Šablony smluv</h1>
          {canManage && (
            <Button
              variant="primary"
              data-tour="templates-new"
              onClick={() => {
                setCreateIdDraft("");
                setCreateNameDraft("");
                setCreateError(null);
                setCreateModalOpen(true);
              }}
            >
              + Nová šablona
            </Button>
          )}
        </div>
        {canManage && (
          <div className={styles.headerActions}>
            {varWarning && (
              <button
                type="button"
                className={styles.varWarn}
                title={`${varWarning} Kliknutím otevřete nastavení vlastních proměnných.`}
                onClick={() => setCustomVarsOpen(true)}
              >
                ⚠ {varWarning}
              </button>
            )}
            {saveMsg && (
              <span className={`${styles.saveMsg} ${saveMsg === "Uloženo" ? styles.saveMsgOk : styles.saveMsgErr}`}>
                {saveMsg}
              </span>
            )}
            {/* Pinned right by margin-left:auto. .varWarn is flex:1 so it already
                held the button in place while a warning showed - but the save
                message can appear WITHOUT a warning, and with no flexible sibling
                it pushed the button left. Same wrapper as DokumentyPage, so a
                control added to either header inherits the behaviour. */}
            <div className={styles.headerActionsFixed}>
              <Button variant="primary" onClick={handleSave} disabled={saving || !isDirty}>
                <span className={styles.saveBtnInner}>
                  <SaveIcon />
                  {saving ? "Ukládám…" : "Uložit šablonu"}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.workspace}>
        {/* Left: template list */}
        <aside className={styles.sidebar} data-tour="templates-list">
          {loading ? (
            <p className={styles.loadingText}>Načítám…</p>
          ) : (
            <ul className={styles.templateList}>
              {(() => {
                const entries = [
                  ...ALL_TYPES.map((id) => ({ id, label: CONTRACT_TYPE_LABELS[id], builtin: true })),
                  ...customTypes.map((t) => ({ id: t.id, label: t.name, builtin: false })),
                ].map((e) => {
                  const meta = templates[e.id];
                  const active = meta ? meta.active !== false : true;
                  return { ...e, meta, active };
                });
                const activeEntries = entries.filter((e) => e.active);
                const inactiveEntries = entries.filter((e) => !e.active);

                const renderItem = ({ id, label, builtin, meta, active }: (typeof entries)[number]) => (
                  <li
                    key={id}
                    className={`${styles.templateItem} ${selected === id ? styles.templateItemActive : ""} ${!active ? styles.templateItemInactive : ""}`}
                    onClick={() => requestTemplateSwitch(id)}
                  >
                    <span className={styles.templateName}>
                      {label}
                      {selected === id && isDirty && (
                        <span className={styles.dirtyDot} title="Neuložené změny">•</span>
                      )}
                    </span>
                    <div className={styles.templateItemFooter}>
                      {meta ? (
                        <span className={styles.templateDate}>
                          {formatTimestampCZ(meta.updatedAt)}
                        </span>
                      ) : (
                        <span className={styles.templateEmpty}>Prázdná</span>
                      )}
                      {canManage && (
                        <div
                          className={styles.templateActions}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {builtin ? (
                            <button
                              type="button"
                              className={styles.templateActionBtn}
                              // A "Prázdná" (doc-less) built-in has nothing to
                              // deactivate – the PATCH would 404.
                              disabled={busyTemplateId === id || (!meta && active)}
                              onClick={() => handleToggleActive(id, active, label)}
                              title={active ? "Skrýt z generování a přesunout dolů" : "Znovu aktivovat"}
                            >
                              {active ? "Deaktivovat" : "Aktivovat"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`${styles.templateActionBtn} ${styles.templateActionDanger}`}
                              disabled={busyTemplateId === id}
                              onClick={() => meta && handleDeleteTemplate(meta)}
                              title="Smazat šablonu"
                            >
                              Smazat
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );

                // Active templates first; the inactive group is anchored to the
                // BOTTOM of the sidebar (the divider's margin-top:auto eats the
                // free space) under a "Neaktivní" heading, so the split is obvious.
                return (
                  <>
                    {activeEntries.map(renderItem)}
                    {inactiveEntries.length > 0 && (
                      <li key="__inactive_sep__" className={styles.inactiveDivider}>
                        Neaktivní
                      </li>
                    )}
                    {inactiveEntries.map(renderItem)}
                  </>
                );
              })()}
            </ul>
          )}
        </aside>

        {/* Center: TipTap editor */}
        <div className={styles.editorWrapper}>
          {canManage && (
          <div className={styles.toolbar}>
            {/* Undo / Redo (Word convention: leftmost) */}
            <button
              className={styles.toolBtn}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().undo().run(); }}
              disabled={!editor?.can().undo()}
              title="Zpět (Ctrl+Z)"
            >↶</button>
            <button
              className={styles.toolBtn}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().redo().run(); }}
              disabled={!editor?.can().redo()}
              title="Vpřed (Ctrl+Y)"
            >↷</button>

            <span className={styles.toolSep} />

            {/* Font family */}
            <select
              className={styles.toolSelect}
              value={editor?.getAttributes("textStyle").fontFamily ?? "Arial"}
              onChange={(e) => {
                e.preventDefault();
                editor?.chain().focus().setFontFamily(e.target.value).run();
              }}
              title="Písmo"
            >
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Calibri">Calibri</option>
              <option value="Courier New">Courier New</option>
            </select>

            {/* Font size */}
            <select
              className={styles.toolSelect}
              value={editor?.getAttributes("textStyle").fontSize ?? ""}
              onChange={(e) => {
                e.preventDefault();
                const size = e.target.value;
                if (size) {
                  (editor?.chain().focus() as unknown as Record<string, (s: string) => { run(): void }>).setFontSize(size).run();
                } else {
                  (editor?.chain().focus() as unknown as Record<string, () => { run(): void }>).unsetFontSize().run();
                }
                // Propagate font-size onto the parent <li> directly so the
                // browser's ::marker (the "1." / "•") inherits it. Chain-based
                // updateAttributes was unreliable here – use setNodeMarkup on
                // the listItem ancestor instead.
                if (editor) {
                  const { state, view } = editor;
                  const { $from } = state.selection;
                  let liDepth = -1;
                  for (let d = $from.depth; d > 0; d--) {
                    if ($from.node(d).type.name === "listItem") { liDepth = d; break; }
                  }
                  if (liDepth >= 0) {
                    const liNode = $from.node(liDepth);
                    const liPos = $from.before(liDepth);
                    const curStyle: string = liNode.attrs.style ?? "";
                    const stripped = curStyle.replace(/font-size:[^;]*;?\s*/gi, "").trim();
                    const newStyle = size
                      ? (stripped ? `font-size: ${size}; ${stripped}` : `font-size: ${size}`)
                      : (stripped || null);
                    view.dispatch(
                      state.tr.setNodeMarkup(liPos, undefined, { ...liNode.attrs, style: newStyle })
                    );
                  }
                }
              }}
              title="Velikost písma"
            >
              <option value="">Výchozí</option>
              {[8,9,10,11,12,14,16,18,20,22,24,28,32,36,48,72].map(s => (
                <option key={s} value={`${s}pt`}>{s}</option>
              ))}
            </select>

            {/* Line spacing */}
            <select
              className={styles.toolSelect}
              value={
                editor?.getAttributes("paragraph").lineHeight
                ?? editor?.getAttributes("heading").lineHeight
                ?? ""
              }
              onChange={(e) => {
                e.preventDefault();
                const v = e.target.value;
                if (v) {
                  (editor?.chain().focus() as unknown as Record<string, (s: string) => { run(): void }>).setLineHeight(v).run();
                } else {
                  (editor?.chain().focus() as unknown as Record<string, () => { run(): void }>).unsetLineHeight().run();
                }
              }}
              title="Řádkování"
            >
              <option value="">Řádkování</option>
              <option value="1">1,0</option>
              <option value="1.15">1,15</option>
              <option value="1.5">1,5</option>
              <option value="2">2,0</option>
              <option value="3">3,0</option>
            </select>

            <span className={styles.toolSep} />

            {/* Heading / paragraph */}
            <select
              className={styles.toolSelect}
              value={
                editor?.isActive("heading", { level: 1 }) ? "h1"
                : editor?.isActive("heading", { level: 2 }) ? "h2"
                : editor?.isActive("heading", { level: 3 }) ? "h3"
                : "p"
              }
              onChange={(e) => {
                e.preventDefault();
                const v = e.target.value;
                if (v === "p") editor?.chain().focus().setParagraph().run();
                else editor?.chain().focus().setHeading({ level: Number(v[1]) as 1|2|3 }).run();
              }}
              title="Styl odstavce"
            >
              <option value="p">Odstavec</option>
              <option value="h1">Nadpis 1</option>
              <option value="h2">Nadpis 2</option>
              <option value="h3">Nadpis 3</option>
            </select>

            <span className={styles.toolSep} />

            {/* Bold / Italic / Underline */}
            <button
              className={`${styles.toolBtn} ${editor?.isActive("bold") ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}
              title="Tučné"
            ><b>B</b></button>
            <button
              className={`${styles.toolBtn} ${editor?.isActive("italic") ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}
              title="Kurzíva"
            ><i>I</i></button>
            <button
              className={`${styles.toolBtn} ${editor?.isActive("underline") ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run(); }}
              title="Podtržení"
            ><u>U</u></button>

            <span className={styles.toolSep} />

            {/* Alignment */}
            <button
              className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "left" }) ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("left").run(); }}
              title="Zarovnat vlevo"
            >⬅</button>
            <button
              className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "center" }) ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("center").run(); }}
              title="Na střed"
            >↔</button>
            <button
              className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "right" }) ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("right").run(); }}
              title="Zarovnat vpravo"
            >➡</button>
            <button
              className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "justify" }) ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("justify").run(); }}
              title="Zarovnat do bloku"
            >☰</button>

            <span className={styles.toolSep} />

            {/* Lists */}
            <button
              className={`${styles.toolBtn} ${editor?.isActive("bulletList") ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}
              title="Odrážkový seznam"
            >≡</button>
            <button
              className={`${styles.toolBtn} ${editor?.isActive("orderedList") ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); }}
              title="Číslovaný seznam"
            >1.</button>
            <button
              className={styles.toolBtn}
              disabled={!editor?.can().sinkListItem("listItem")}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().sinkListItem("listItem").run(); }}
              title="Vnořit položku seznamu"
            >→]</button>
            <button
              className={styles.toolBtn}
              disabled={!editor?.can().liftListItem("listItem")}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().liftListItem("listItem").run(); }}
              title="Vynořit položku seznamu"
            >[←</button>

            <span className={styles.toolSep} />

            {/* Color */}
            <label className={styles.toolColorLabel} title="Barva textu">
              A
              <input
                type="color"
                className={styles.toolColorInput}
                value={editor?.getAttributes("textStyle").color ?? "#000000"}
                onInput={(e) => {
                  editor?.chain().focus().setColor((e.target as HTMLInputElement).value).run();
                }}
              />
            </label>

            <span className={styles.toolSep} />

            {/* HR */}
            <button
              className={styles.toolBtn}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setHorizontalRule().run(); }}
              title="Vodorovná čára"
            >–</button>

            <span className={styles.toolSep} />

            {/* Table */}
            <button
              className={styles.toolBtn}
              onMouseDown={(e) => {
                e.preventDefault();
                editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
              }}
              title="Vložit tabulku 3×3"
            >⊞</button>

            <span className={styles.toolSep} />

            {/* Page break */}
            <button
              className={styles.toolBtn}
              onMouseDown={(e) => {
                e.preventDefault();
                editor?.chain().focus().insertContent({ type: "pageBreak" }).run();
              }}
              title="Konec stránky (force page break in PDF)"
            >↧</button>

            {/* Page margins */}
            <button
              className={`${styles.toolBtn} ${marginsOpen ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => { e.preventDefault(); setMarginsOpen((v) => !v); }}
              title="Okraje stránky"
            >⊟</button>

            {/* Find & Replace */}
            <button
              className={`${styles.toolBtn} ${findOpen ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setFindOpen((v) => !v);
                if (!findOpen) setTimeout(() => findInputRef.current?.focus(), 0);
              }}
              title="Najít a nahradit (Ctrl+F)"
            >🔍</button>

            {/* Náhled – render with sample data so the {{…}} markers stop
                distorting the line and tab stops can actually be judged. */}
            <button
              className={`${styles.toolBtn} ${previewOpen ? styles.toolBtnActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (previewOpen) setPreviewOpen(false);
                else openPreview();
              }}
              title="Náhled s ukázkovými daty (bez proměnných a podmínek)"
            >👁</button>

            <span className={styles.toolSep} />

            {/* Image upload */}
            <button
              className={styles.toolBtn}
              onMouseDown={(e) => { e.preventDefault(); imageInputRef.current?.click(); }}
              title="Vložit obrázek"
            >🖼</button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImageFile}
            />
          </div>
          )}
          {canManage && (editor?.isActive("table") || editor?.isActive("image")) && (
            <div className={styles.toolbarSecondary}>
              {editor?.isActive("table") && (
                <>
                  <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().addRowAfter().run(); }} title="Přidat řádek pod">+R</button>
                  <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().addColumnAfter().run(); }} title="Přidat sloupec vpravo">+C</button>
                  <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().deleteRow().run(); }} title="Smazat řádek">−R</button>
                  <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().deleteColumn().run(); }} title="Smazat sloupec">−C</button>
                  <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().deleteTable().run(); }} title="Smazat tabulku">×T</button>
                  <button
                    className={`${styles.toolBtn} ${editor?.getAttributes("table").borderless ? styles.toolBtnActive : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!editor) return;
                      const { state, view } = editor;
                      const { $from } = state.selection;
                      let tableDepth = -1;
                      for (let d = $from.depth; d > 0; d--) {
                        if ($from.node(d).type.name === "table") { tableDepth = d; break; }
                      }
                      if (tableDepth < 0) return;
                      const tableNode = $from.node(tableDepth);
                      const tablePos = $from.before(tableDepth);
                      const cur = !!tableNode.attrs.borderless;
                      view.dispatch(
                        state.tr.setNodeMarkup(tablePos, undefined, { ...tableNode.attrs, borderless: !cur })
                      );
                    }}
                    title="Skrýt / zobrazit okraje tabulky"
                  >▦</button>
                </>
              )}
              {editor?.isActive("image") && (
                <>
                  {IMAGE_WIDTH_PRESETS.map((p) => {
                    const cur = editor?.getAttributes("image").width;
                    const active = cur === p.value;
                    return (
                      <button
                        key={p.value}
                        className={`${styles.toolBtn} ${active ? styles.toolBtnActive : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          editor?.chain().focus().updateAttributes("image", { width: p.value }).run();
                        }}
                        title={`Šířka obrázku ${p.label}`}
                      >{p.label}</button>
                    );
                  })}
                  <button
                    className={styles.toolBtn}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editor?.chain().focus().updateAttributes("image", { width: null }).run();
                    }}
                    title="Původní velikost"
                  >⤢</button>
                  {(["left", "center", "right"] as const).map((a) => {
                    const cur = editor?.getAttributes("image").align;
                    const active = cur === a;
                    const glyph = a === "left" ? "⬅" : a === "center" ? "↔" : "➡";
                    const label = a === "left" ? "Vlevo" : a === "center" ? "Na střed" : "Vpravo";
                    return (
                      <button
                        key={a}
                        className={`${styles.toolBtn} ${active ? styles.toolBtnActive : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          editor?.chain().focus().updateAttributes("image", { align: a }).run();
                        }}
                        title={label}
                      >{glyph}</button>
                    );
                  })}
                </>
              )}
            </div>
          )}
          {canManage && marginsOpen && (
            <div className={styles.marginsBar}>
              {MARGIN_PRESETS.map((p) => {
                const active = marginsEqual(margins, p.value);
                return (
                  <button
                    key={p.key}
                    className={`${styles.marginsPreset} ${active ? styles.marginsPresetActive : ""}`}
                    onClick={() => { setMargins(p.value); setIsDirty(true); }}
                    type="button"
                  >{p.label}</button>
                );
              })}
              {(["top", "bottom", "left", "right"] as const).map((side) => {
                const label = side === "top" ? "Nahoře" : side === "bottom" ? "Dole" : side === "left" ? "Vlevo" : "Vpravo";
                return (
                  <label key={side} className={styles.marginsField}>
                    {label}
                    <input
                      className={styles.marginsInput}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={margins[side]}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setMargins((m) => ({ ...m, [side]: Math.max(0, Math.min(100, n)) }));
                        setIsDirty(true);
                      }}
                    />
                    mm
                  </label>
                );
              })}
              <button
                className={styles.findClose}
                onClick={() => setMarginsOpen(false)}
                title="Zavřít"
                aria-label="Zavřít okraje"
                type="button"
              >✕</button>
            </div>
          )}
          {canManage && findOpen && (
            <div className={styles.findBar}>
              <input
                ref={findInputRef}
                className={styles.findInput}
                placeholder="Najít…"
                value={findQuery}
                onChange={(e) => { setFindQuery(e.target.value); applySearch(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); findNext(); }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setFindOpen(false); setFindQuery(""); setReplaceQuery(""); applySearch("");
                  }
                }}
              />
              <input
                className={styles.findInput}
                placeholder="Nahradit za…"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); } }}
              />
              <button className={styles.findBtn} onClick={findNext} disabled={!findQuery}>Najít další</button>
              <button className={styles.findBtn} onClick={replaceCurrent} disabled={!findQuery}>Nahradit</button>
              <button className={styles.findBtn} onClick={replaceAll} disabled={!findQuery}>Nahradit vše</button>
              <button
                className={styles.findClose}
                onClick={() => { setFindOpen(false); setFindQuery(""); setReplaceQuery(""); applySearch(""); }}
                title="Zavřít"
                aria-label="Zavřít vyhledávání"
              >✕</button>
            </div>
          )}
          {/* Náhled: which branch of each conditional to render. Only the
              conditionals this template actually uses are listed. */}
          {previewOpen && (
            <div className={styles.previewBar}>
              <span className={styles.previewBarTitle}>Náhled s ukázkovými daty</span>
              {previewConditionals.length === 0 && previewOperands.length === 0 ? (
                <span className={styles.previewBarHint}>
                  Tato šablona nepoužívá žádné podmínkové proměnné.
                </span>
              ) : (
                previewConditionals.map((key) => (
                  <label key={key} className={styles.previewToggle}>
                    <input
                      type="checkbox"
                      checked={previewBools[key] ?? true}
                      onChange={(e) =>
                        setPreviewBools((p) => ({ ...p, [key]: e.target.checked }))
                      }
                    />
                    {CONDITIONAL_LABELS[key] ?? variableDefs[key]?.label ?? key}
                  </label>
                ))
              )}
              {/* Editable operand values so a derived condition can be driven in
                  the preview (e.g. push a date past a cutoff and watch it flip). */}
              {previewOperands.map((op) => (
                <label
                  key={op.key}
                  className={styles.previewToggle}
                  title="Hodnota pro vyhodnocení podmínky v náhledu"
                >
                  {op.label}:
                  <input
                    type={op.type === "date" ? "date" : "number"}
                    value={previewRaw[op.key] ?? ""}
                    onChange={(e) => setPreviewRaw((p) => ({ ...p, [op.key]: e.target.value }))}
                    style={{
                      marginLeft: 4,
                      padding: "2px 4px",
                      fontSize: "0.8125rem",
                      border: "1px solid var(--color-border)",
                      borderRadius: 4,
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      width: op.type === "date" ? 130 : 80,
                    }}
                  />
                </label>
              ))}
              {canPreviewPdf && (
                <button
                  type="button"
                  className={styles.findBtn}
                  onClick={handlePdfPreview}
                  disabled={pdfPreviewLoading}
                  title="Vykreslí PDF stejným způsobem jako skutečnou smlouvu – přesné zalomení stránek i tabulátory"
                >
                  {pdfPreviewLoading ? "Generuji…" : "Náhled PDF"}
                </button>
              )}
              <button
                className={styles.findClose}
                onClick={() => setPreviewOpen(false)}
                title="Zpět k úpravám"
                aria-label="Zavřít náhled"
                type="button"
              >✕</button>
            </div>
          )}

          <div className={styles.editor}>
            <div
              className={styles.a4Page}
              style={{
                paddingTop: `${margins.top}mm`,
                paddingBottom: `${margins.bottom}mm`,
                paddingLeft: `${margins.left}mm`,
                paddingRight: `${margins.right}mm`,
              }}
            >
              {previewOpen ? (
                // Same .a4Page box, same margins, same ProseMirror content styles –
                // only the source differs – so the preview lays out exactly like the
                // editor does, minus the {{…}} markers.
                <div
                  className={styles.previewContent}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <EditorContent editor={editor} />
              )}
            </div>
          </div>
        </div>

        {/* Right: variable picker */}
        {canManage && (
        <aside className={styles.varPanel}>
          <p className={styles.varPanelTitle}>Proměnné</p>
          <p className={styles.varPanelHint}>Kliknutím vložíte do dokumentu</p>
          {VARIABLE_GROUPS.map((group) => (
            <div key={group.group} className={styles.varGroup}>
              <p className={styles.varGroupLabel}>{group.group}</p>
              {group.vars.map((v) => (
                <button
                  key={v.key}
                  className={styles.varBtn}
                  onClick={() => insertVariable(v.key, v.kind)}
                  title={v.kind === "if" ? `{{#if ${v.key}}}{{/if}}` : `{{${v.key}}}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          ))}

          {/* Ten free slots this template configures itself (CONTRACT_SLOT_KEYS –
              NOT the engine's 25-slot ceiling). A slot shows its configured label
              once it has one, otherwise the bare {{varN}}. */}
          <div className={styles.varGroup}>
            <p className={styles.varGroupLabel}>Vlastní proměnné</p>
            {CONTRACT_SLOT_KEYS.map((key) => {
              const def = variableDefs[key];
              return (
                <button
                  key={key}
                  className={styles.varBtn}
                  onClick={() => insertVariable(key)}
                  title={`{{${key}}}`}
                >
                  {def?.label ? `${def.label} (${key})` : key}
                </button>
              );
            })}
            <button
              className={styles.varBtn}
              onClick={openCaseModal}
              title="Vložit přepínač {{#case varN = hodnota}}…{{/case}}"
            >
              ⇄ Přepínač…
            </button>
            <button
              className={styles.varBtn}
              onClick={() => setCustomVarsOpen(true)}
              title="Nastavit název a typ použitých vlastních proměnných"
            >
              ⚙ Nastavit…
            </button>
          </div>
        </aside>
        )}
      </div>

      {canManage && customVarsOpen && editor && (() => {
        // Which slots this template actually uses, read straight from the live
        // editor content — so a slot appears here the moment it is inserted and
        // disappears when deleted, with no bookkeeping.
        //
        // Restricted to the slots a contract template actually offers: the engine
        // recognises {{var11}}+ so that a stray one can be SEEN (customVarWarning
        // flags it), but it must not get a configuration row here — the server
        // would drop the def and the author would never learn why.
        const allUsed = usedCustomVars(editor.getHTML());
        const used = allUsed.filter((k) => CONTRACT_SLOT_SET.has(k));
        const overLimit = allUsed.filter((k) => !CONTRACT_SLOT_SET.has(k));
        // Slots configured earlier whose placeholder is no longer in the text.
        // Their config is kept (harmless, and lets an accidental deletion be
        // undone) but flagged, so the list can't quietly rot.
        const orphaned = Object.keys(variableDefs).filter((k) => !used.includes(k));

        // Running total across EVERY image slot, orphaned ones included: they
        // are all stored on the same template document, so they all count
        // against the same 1 MiB ceiling whether the text still uses them or not.
        const allImages = Object.values(variableDefs).flatMap((d) => d.images ?? []);
        const imageTotalChars = allImages.reduce((sum, o) => sum + (o.src?.length ?? 0), 0);
        const imageTotalKb = allImages.reduce((sum, o) => sum + dataUriKb(o.src ?? ""), 0);
        const imagesOverBudget = imageTotalChars > IMAGE_TOTAL_WARN_CHARS;

        const setDef = (
          key: string,
          patch: Partial<{
            label: string;
            type: CustomVarType;
            default: CustomVarDefault | undefined;
            condition: CustomVarCondition | undefined;
            optional: boolean;
            options: string[] | undefined;
            formula: string | undefined;
            decimals: number | undefined;
            images: CustomVarImageOption[] | undefined;
          }>
        ) => {
          setVariableDefs((prev) => {
            const prevDef = prev[key];
            const nextTypeVal = patch.type ?? prevDef?.type ?? "text";
            // Changing the type can invalidate an existing default (a literal date
            // for a now-number slot), so drop it unless the same patch re-supplies
            // one. A COMPUTED slot never has a default at all – its value is
            // derived, so a pre-filled input would be a lie.
            const typeChanged = patch.type !== undefined && patch.type !== prevDef?.type;
            const nextDefault =
              "default" in patch
                ? patch.default
                : typeChanged || isComputedVarType(nextTypeVal)
                  ? undefined
                  : prevDef?.default;
            // Each of the three type-specific configs is kept only while its own
            // type is selected, and dropped the moment the slot becomes something
            // else — otherwise a slot switched away and back would silently
            // resurrect a comparison / formula / choice list the author had
            // replaced, which on a contract is a wrong clause, not a cosmetic bug.
            const nextCondition =
              "condition" in patch
                ? patch.condition
                : nextTypeVal === "condition" ? prevDef?.condition : undefined;
            const nextFormula =
              "formula" in patch
                ? patch.formula
                : nextTypeVal === "math" ? prevDef?.formula : undefined;
            const nextDecimals =
              "decimals" in patch
                ? patch.decimals
                : nextTypeVal === "math" ? prevDef?.decimals : undefined;
            const nextOptions =
              "options" in patch
                ? patch.options
                : nextTypeVal === "list" ? prevDef?.options : undefined;
            // Same rule for the pictures, with an extra reason of its own: they
            // are by far the heaviest thing on the document, so keeping them on
            // a slot that is no longer an image would spend the 1 MiB budget on
            // data nothing can render.
            const nextImages =
              "images" in patch
                ? patch.images
                : nextTypeVal === "image" ? prevDef?.images : undefined;
            // Unlike the above, `optional` survives a type change: a plain
            // boolean can't become invalid for the new type, only inapplicable
            // (bool/condition/math ignore it), so the author's intent is kept if
            // they switch back.
            const nextOptional = "optional" in patch ? patch.optional : prevDef?.optional;
            return {
              ...prev,
              [key]: {
                label: patch.label ?? prevDef?.label ?? "",
                type: nextTypeVal,
                // Omit when absent so we never persist `default/condition: undefined`
                // (or a no-op `optional: false`).
                ...(nextDefault ? { default: nextDefault } : {}),
                ...(nextCondition ? { condition: nextCondition } : {}),
                ...(nextOptional ? { optional: true } : {}),
                ...(nextOptions && nextOptions.length > 0 ? { options: nextOptions } : {}),
                ...(nextImages && nextImages.length > 0 ? { images: nextImages } : {}),
                ...(nextFormula ? { formula: nextFormula } : {}),
                // 0 is a real precision (whole crowns), so test for undefined –
                // a falsy check would silently drop it.
                ...(nextDecimals !== undefined ? { decimals: nextDecimals } : {}),
              },
            };
          });
          setIsDirty(true);
        };

        // ── Condition operands ──────────────────────────────────────────────
        // Two sources, kept visually apart in their own <optgroup>s: the
        // employee/contract BUILT-INS (COMPARABLE_VARS, the only source until
        // v5.2.0) and this template's OTHER custom slots. The built-in path is
        // untouched — a stored condition over built-ins resolves, renders and
        // evaluates exactly as before; custom slots are purely additional.

        /** The raw type an operand compares on, whichever source it comes from. */
        const operandType = (opKey: string): ComparableType | null =>
          COMPARABLE_VARS.find((v) => v.key === opKey)?.type ??
          (isCustomVarKey(opKey) ? comparableTypeOfCustom(variableDefs[opKey]?.type) : null);
        /** Built-in comparables of one raw type. */
        const comparableOf = (t: ComparableType) => COMPARABLE_VARS.filter((v) => v.type === t);
        /**
         * This template's custom slots usable as an operand. `t` narrows to one
         * raw type (right-hand operand); omit it to list every comparable slot
         * (left-hand operand). `exclude` drops the slot being configured — a
         * condition comparing itself is a cycle. Slots typed "condition" never
         * appear: comparableTypeOfCustom returns null for them, for the same reason.
         */
        const customComparables = (exclude: string, t?: ComparableType) =>
          used
            .filter((k) => k !== exclude)
            .map((k) => ({
              key: k,
              label: variableDefs[k]?.label?.trim()
                ? `${variableDefs[k]!.label} (${k})`
                : k,
              type: operandType(k),
            }))
            .filter(
              (v): v is { key: string; label: string; type: ComparableType } =>
                v.type !== null && (t === undefined || v.type === t)
            );
        const leftType = (cond: CustomVarCondition | undefined): ComparableType =>
          (cond ? operandType(cond.leftKey) : null) ?? "date";
        // A starter condition when a slot is switched to type "condition".
        const starterCondition = (): CustomVarCondition => ({
          leftKey: COMPARABLE_VARS[0].key,
          op: "lt",
          right: { kind: "literal", value: "" },
        });
        // Render the comparison builder for a "condition" slot.
        const renderConditionBuilder = (key: string, cond: CustomVarCondition | undefined) => {
          const c = cond ?? starterCondition();
          const lt = leftType(c);
          // Operators that make sense for this left operand. For date/number this
          // is the full list the dropdown always showed, so nothing changes for an
          // existing condition; only the new "text" operands are narrowed (see
          // OPS_FOR_COMPARABLE — ordering free text answers no real question).
          const ops = OPS_FOR_COMPARABLE[lt];
          // Unary operators (je prázdné / není prázdné) compare nothing on the right.
          const needsRight = c.op !== "empty" && c.op !== "notEmpty";
          const setCond = (next: CustomVarCondition) => setDef(key, { condition: next });
          const opt = (v: { key: string; label: string }) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          );
          /**
           * Keep a STORED operand selected even when its slot is no longer in
           * the template's text. The condition still resolves at generation
           * (requiredCustomVars walks condition operands transitively), so a
           * <select> silently falling back to its first option would misreport
           * the comparison — and the next edit to any other field would then
           * write that wrong operand back onto a contract template.
           */
          const withStored = <T extends { key: string; label: string }>(
            list: T[],
            storedKey: string | undefined
          ): { key: string; label: string }[] =>
            storedKey && isCustomVarKey(storedKey) && !list.some((v) => v.key === storedKey)
              ? [...list, { key: storedKey, label: `${storedKey} (v textu nepoužita)` }]
              : list;
          const customLeft = withStored(customComparables(key), c.leftKey);
          const customRight = withStored(
            customComparables(key, lt),
            c.right.kind === "var" ? c.right.key : undefined
          );
          const builtinRight = comparableOf(lt).filter((v) => v.key !== c.leftKey);
          // nowrap: the operands stay on the slot's single table row – the modal
          // is sized for it and the table scrolls horizontally if the viewport is
          // too narrow, rather than wrapping the row in two.
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
              <select
                style={{ ...fieldStyle, width: "auto", flex: "1 1 130px", minWidth: 0 }}
                value={c.leftKey}
                onChange={(e) => {
                  const newLeft = e.target.value;
                  const newType = operandType(newLeft) ?? "date";
                  // Keep the right operand only if it stays type-compatible; a now
                  // mismatched variable operand resets to an empty literal.
                  const rightVarKey = c.right.kind === "var" ? c.right.key : null;
                  const rightStillOk =
                    rightVarKey === null || operandType(rightVarKey) === newType;
                  // The operator has to stay legal for the new left type – picking
                  // a text slot while "<" is selected would otherwise leave a
                  // comparison that silently evaluates to false forever.
                  const newOps = OPS_FOR_COMPARABLE[newType];
                  setCond({
                    leftKey: newLeft,
                    op: newOps.includes(c.op) ? c.op : newOps[0],
                    right: rightStillOk ? c.right : { kind: "literal", value: "" },
                  });
                }}
              >
                <optgroup label="Zabudované proměnné">
                  {COMPARABLE_VARS.map(opt)}
                </optgroup>
                {customLeft.length > 0 && (
                  <optgroup label="Vlastní proměnné">
                    {customLeft.map(opt)}
                  </optgroup>
                )}
              </select>
              <select
                style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                value={c.op}
                onChange={(e) => setCond({ ...c, op: e.target.value as CompareOp })}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>{COMPARE_OP_LABELS[op]}</option>
                ))}
              </select>
              {needsRight && (
                <>
                  <select
                    style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                    value={c.right.kind}
                    onChange={(e) => {
                      const kind = e.target.value as "var" | "literal";
                      if (kind === "var") {
                        const first = builtinRight[0] ?? customRight[0];
                        setCond({ ...c, right: { kind: "var", key: first?.key ?? "" } });
                      } else {
                        setCond({ ...c, right: { kind: "literal", value: "" } });
                      }
                    }}
                  >
                    <option value="literal">Hodnota</option>
                    <option value="var">Proměnná</option>
                  </select>
                  {c.right.kind === "var" ? (
                    <select
                      style={{ ...fieldStyle, width: "auto", flex: "1 1 130px", minWidth: 0 }}
                      value={c.right.key}
                      onChange={(e) => setCond({ ...c, right: { kind: "var", key: e.target.value } })}
                    >
                      {builtinRight.length > 0 && (
                        <optgroup label="Zabudované proměnné">{builtinRight.map(opt)}</optgroup>
                      )}
                      {customRight.length > 0 && (
                        <optgroup label="Vlastní proměnné">{customRight.map(opt)}</optgroup>
                      )}
                    </select>
                  ) : (
                    <input
                      type={lt === "date" ? "date" : lt === "number" ? "number" : "text"}
                      style={{ ...fieldStyle, width: "auto", flex: "1 1 110px", minWidth: 0 }}
                      value={c.right.value}
                      placeholder={lt === "text" ? "Porovnávaná hodnota" : undefined}
                      onChange={(e) => setCond({ ...c, right: { kind: "literal", value: e.target.value } })}
                    />
                  )}
                </>
              )}
            </div>
          );
        };

        // Built-in variables offered as a default source, split by kind so a
        // bool slot only lists the {{#if}} booleans and other slots list the rest.
        const fixedVarOptions = (type: CustomVarType) => {
          const wantIf = type === "bool";
          return VARIABLE_GROUPS.flatMap((g) => g.vars).filter((v) => (v.kind === "if") === wantIf);
        };
        /**
         * Editor for a "list" slot's choices: one input per value plus an add
         * button. Edited in place rather than as one comma-separated field,
         * because a choice may legitimately contain a comma ("Praha, Karlín").
         */
        const renderOptionsEditor = (key: string) => {
          const options = variableDefs[key]?.options ?? [];
          const write = (next: string[]) =>
            setDef(key, { options: next.length > 0 ? next : undefined });
          const atLimit = options.length >= CUSTOM_VAR_MAX_OPTIONS;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                Možnosti k výběru {options.length > 0 && `(${options.length})`}
              </span>
              {options.map((opt, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text"
                    style={{ ...fieldStyle, flex: "1 1 auto", minWidth: 0 }}
                    value={opt}
                    maxLength={100}
                    placeholder={`Možnost ${i + 1}`}
                    aria-label={`Možnost ${i + 1}`}
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = e.target.value;
                      write(next);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.optionRemoveBtn}
                    aria-label={`Odebrat možnost ${i + 1}`}
                    title="Odebrat možnost"
                    onClick={() => write(options.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={atLimit}
                  title={atLimit ? `Nejvýše ${CUSTOM_VAR_MAX_OPTIONS} možností` : undefined}
                  onClick={() => write([...options, ""])}
                >
                  + Přidat možnost
                </Button>
              </div>
            </div>
          );
        };

        /**
         * Editor for an "Obrázek" slot's choices. Shaped like the "Seznam"
         * editor above, because an image slot IS a list – the value picked at
         * generation is the choice's NAME, and the picture is what that name
         * substitutes into the document. Each choice therefore carries its own
         * width and alignment: the point of the type is that different answers
         * print different pictures, and those pictures rarely share a size.
         */
        const renderImagesEditor = (key: string) => {
          const images = variableDefs[key]?.images ?? [];
          const write = (next: CustomVarImageOption[]) =>
            setDef(key, { images: next.length > 0 ? next : undefined });
          const patch = (i: number, p: Partial<CustomVarImageOption>) =>
            write(
              images.map((o, j) => {
                if (j !== i) return o;
                const next: CustomVarImageOption = { ...o, ...p };
                // "No width" means the picture's natural size and "no alignment"
                // means inline – neither is the same as an empty string, which
                // renderCustomImage would have to guess at.
                if (!next.width) delete next.width;
                if (!next.align) delete next.align;
                return next;
              })
            );
          /**
           * Remove one choice, shifting the "was downscaled" notes down with it.
           * Those are keyed by position, so without the shift the note would move
           * to whichever picture inherited the index and claim something about it
           * that isn't true.
           */
          const removeAt = (i: number) => {
            write(images.filter((_, j) => j !== i));
            setVarImageShrunk((prev) => {
              const next: Record<string, boolean> = {};
              for (const [k, v] of Object.entries(prev)) {
                const [slot, idxStr] = k.split(":");
                const idx = Number(idxStr);
                if (slot !== key) next[k] = v;
                else if (idx < i) next[k] = v;
                else if (idx > i) next[`${slot}:${idx - 1}`] = v;
              }
              return next;
            });
          };
          const atLimit = images.length >= CUSTOM_VAR_MAX_IMAGES;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                Obrázky k výběru {images.length > 0 && `(${images.length})`}
              </span>
              {images.map((opt, i) => {
                const shrunk = varImageShrunk[`${key}:${i}`];
                return (
                  <div
                    key={i}
                    style={{ display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap" }}
                  >
                    <input
                      type="text"
                      style={{ ...fieldStyle, flex: "1 1 160px", minWidth: 0 }}
                      value={opt.label}
                      maxLength={100}
                      placeholder={`Název možnosti ${i + 1}`}
                      aria-label={`Název obrázku ${i + 1}`}
                      onChange={(e) => patch(i, { label: e.target.value })}
                    />
                    {/* The thumbnail doubles as the "is anything uploaded"
                        readout – a name with no picture prints nothing. */}
                    {opt.src ? (
                      <img
                        src={opt.src}
                        alt=""
                        style={{
                          flex: "0 0 auto",
                          height: 36,
                          maxWidth: 90,
                          objectFit: "contain",
                          border: "1px solid var(--color-border)",
                          borderRadius: 4,
                          background: "var(--color-surface)",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          flex: "0 0 auto",
                          fontSize: "0.72rem",
                          color: "var(--color-text-muted)",
                          alignSelf: "center",
                        }}
                      >
                        bez obrázku
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setVarImageTarget({ key, index: i });
                        varImageInputRef.current?.click();
                      }}
                    >
                      {opt.src ? "Nahradit…" : "Nahrát…"}
                    </Button>
                    <select
                      style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                      value={opt.width ?? ""}
                      aria-label={`Šířka obrázku ${i + 1}`}
                      onChange={(e) => patch(i, { width: e.target.value })}
                    >
                      <option value="">Původní šířka</option>
                      {CUSTOM_VAR_IMAGE_WIDTHS.map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>
                    <select
                      style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                      value={opt.align ?? ""}
                      aria-label={`Zarovnání obrázku ${i + 1}`}
                      onChange={(e) =>
                        patch(i, { align: e.target.value as CustomVarImageAlign })
                      }
                    >
                      <option value="">V textu</option>
                      {CUSTOM_VAR_IMAGE_ALIGNS.map((a) => (
                        <option key={a} value={a}>{CUSTOM_VAR_IMAGE_ALIGN_LABELS[a]}</option>
                      ))}
                    </select>
                    {opt.src && (
                      <span
                        style={{
                          flex: "0 0 auto",
                          alignSelf: "center",
                          fontSize: "0.72rem",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {dataUriKb(opt.src)} kB
                        {shrunk && " – automaticky zmenšeno"}
                      </span>
                    )}
                    <button
                      type="button"
                      className={styles.optionRemoveBtn}
                      aria-label={`Odebrat obrázek ${i + 1}`}
                      title="Odebrat obrázek"
                      onClick={() => removeAt(i)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={atLimit}
                  title={atLimit ? `Nejvýše ${CUSTOM_VAR_MAX_IMAGES} obrázků` : undefined}
                  onClick={() => write([...images, { label: "", src: "" }])}
                >
                  + Přidat obrázek
                </Button>
              </div>
            </div>
          );
        };

        // Render the literal-value input matching a slot's type.
        const renderLiteralDefault = (key: string, type: CustomVarType, value: string) => {
          const set = (v: string) => setDef(key, { default: { kind: "literal", value: v } });
          if (type === "list" || type === "image") {
            // A list slot's default has to BE one of its choices – and so does
            // an image slot's, whose raw value is likewise a choice's name. A
            // free-text default would match no picture and print nothing.
            const opts =
              type === "image"
                ? (variableDefs[key]?.images ?? [])
                    .filter((o) => o.label.trim())
                    .map((o) => o.label)
                : variableDefs[key]?.options ?? [];
            return (
              <select style={fieldStyle} value={value} onChange={(e) => set(e.target.value)}>
                <option value="">– vyberte –</option>
                {opts.map((o, i) => (
                  <option key={`${o}-${i}`} value={o}>{o}</option>
                ))}
              </select>
            );
          }
          if (type === "bool") {
            return (
              <select style={fieldStyle} value={value} onChange={(e) => set(e.target.value)}>
                <option value="">Ne</option>
                <option value="true">Ano</option>
              </select>
            );
          }
          if (type === "longtext") {
            // A "Dlouhý text" default is prose with line breaks; a single-line
            // <input> would hide everything past the first line and swallow the
            // Enter key, which is the whole point of the type.
            return (
              <textarea
                style={{ ...fieldStyle, resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
                rows={3}
                value={value}
                placeholder="Výchozí hodnota"
                onChange={(e) => set(e.target.value)}
              />
            );
          }
          return (
            <input
              type={type === "date" ? "date" : type === "number" ? "number" : "text"}
              style={fieldStyle}
              value={value}
              placeholder="Výchozí hodnota"
              onChange={(e) => set(e.target.value)}
            />
          );
        };

        /**
         * Editor for a "math" slot: the formula plus the precision its result
         * prints at. Both live hints exist because a formula fails SILENTLY —
         * evalMathFormula returns null for a malformed expression and the document
         * simply prints nothing, with no field anywhere to notice the gap in.
         */
        const renderFormulaEditor = (key: string) => {
          const def = variableDefs[key];
          const formula = def?.formula ?? "";
          const deps = formulaDependencies(formula);
          // Probe the parser with a distinct dummy value per operand, so a
          // syntax error is told apart from operands that simply have no value
          // yet. Distinct rather than all-1 because "var1 - var2" would then be
          // zero and a division by it would read as a parse failure.
          const probe: Record<string, number> = {};
          deps.forEach((d, i) => { probe[d] = i + 1; });
          const parseOk = !formula.trim() || evalMathFormula(formula, probe) !== null;
          const depLabel = (d: string) =>
            variableDefs[d]?.label?.trim() ? `${variableDefs[d]!.label} (${d})` : d;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                <input
                  type="text"
                  style={{ ...fieldStyle, flex: "1 1 auto", minWidth: 0, fontFamily: "monospace" }}
                  value={formula}
                  maxLength={CUSTOM_VAR_FORMULA_MAX}
                  placeholder="var1 + var2"
                  aria-label={`Vzorec pro ${def?.label || key}`}
                  onChange={(e) => setDef(key, { formula: e.target.value })}
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    flex: "0 0 auto",
                    fontSize: "0.72rem",
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Desetinná místa
                  <select
                    style={{ ...fieldStyle, width: "auto" }}
                    value={String(def?.decimals ?? 0)}
                    onChange={(e) => setDef(key, { decimals: Number(e.target.value) })}
                  >
                    {Array.from({ length: CUSTOM_VAR_DECIMALS_MAX + 1 }, (_, i) => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </label>
              </div>
              {!parseOk && (
                <span style={{ fontSize: "0.72rem", color: "var(--color-danger-text-strong)" }}>
                  Vzorci nerozumím – zkontrolujte závorky a operátory (+ − * / a čísla).
                </span>
              )}
              {parseOk && deps.length > 0 && (
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                  Počítá z: {deps.map(depLabel).join(", ")}
                </span>
              )}
              {parseOk && formula.trim() && deps.length === 0 && (
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                  Vzorec neodkazuje na žádnou vlastní proměnnou – výsledek bude
                  u každého dokumentu stejný.
                </span>
              )}
            </div>
          );
        };

        const hintStyle = {
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
          margin: "0 0 10px",
        } as const;
        const fieldStyle = {
          width: "100%",
          padding: "6px 8px",
          fontSize: "0.8125rem",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          background: "var(--color-surface)",
          color: "var(--color-text)",
        } as const;

        return (
          <div className={modalStyles.overlay}>
            {/* Wider than the usual modal: one slot must fit on ONE table row,
                and a "condition" slot's row carries four controls (left operand,
                operator, right kind, right value) beside the name/type/optional
                columns. Below this width they used to wrap onto a second line. */}
            <div
              className={`${modalStyles.modal} ${styles.varModal}`}
              style={{ width: "min(1100px, 96vw)", maxWidth: "96vw" }}
            >
              <div className={modalStyles.header}>
                <h2 className={modalStyles.title}>Vlastní proměnné</h2>
              </div>

              <div className={`${modalStyles.body} ${styles.varModalBody}`}>
                <p style={hintStyle}>
                  Název se zobrazí při vyplňování hodnot během generování dokumentu.
                  Nastavení platí jen pro tuto šablonu – stejná proměnná může mít
                  v jiné šabloně jiný význam. Uloží se spolu se šablonou.
                </p>
                <p style={hintStyle}>
                  <strong>Výchozí hodnota</strong> se předvyplní (a lze ji upravit)
                  při generování dokumentu a zobrazí se i v náhledu. Může to být
                  pevná hodnota, nebo některá ze zabudovaných proměnných (např. Jméno).
                </p>
                <p style={hintStyle}>
                  <strong>Nepovinná</strong> proměnná se při generování nemusí
                  vyplnit – v dokumentu se pak nevypíše nic. Bez zaškrtnutí je
                  vyplnění povinné a generování bez hodnoty neproběhne. Typy
                  Ano/Ne, Podmínka a Výpočet vyplnění nevyžadují nikdy.
                </p>
                <p style={hintStyle}>
                  Typ <strong>Podmínka</strong> proměnnou nevyplňujete – její hodnota
                  (Ano/Ne) se <strong>vypočítá</strong> z porovnání dvou hodnot
                  (např. <em>Datum podpisu &lt; Datum nástupu</em>). Porovnávat lze
                  zabudované proměnné i ostatní vlastní proměnné této šablony.
                  Používá se stejně jako Ano/Ne v blocích{" "}
                  <code>{"{{#if var1}}…{{/if}}"}</code> /{" "}
                  <code>{"{{#unless var1}}…{{/unless}}"}</code>.
                </p>
                <p style={hintStyle}>
                  Typ <strong>Výpočet</strong> se také nevyplňuje – spočítá se ze
                  vzorce nad ostatními vlastními proměnnými, např.{" "}
                  {/* ASCII operators on purpose: the tokenizer accepts "-" but
                      not the typographic minus, and an example is what people copy. */}
                  <code>var1 * var2</code> nebo <code>(var1 - var2) / 3</code>.
                  Povolené jsou jen <code>+ - * /</code>, závorky, čísla, vlastní
                  proměnné <code>var1</code>…<code>var{CONTRACT_VAR_COUNT}</code> a
                  číselné zabudované proměnné (např. <code>salary</code>{" "}
                  nebo <code>hoursPerWeek</code>) – takže <code>salary * 0,15</code>{" "}
                  spočítá provizi ze mzdy. Desetinná místa určují, na kolik míst se
                  výsledek vypíše.
                </p>
                <p style={hintStyle}>
                  <strong>Přepínač</strong> <code>{"{{#case var1 = Praha}}…{{/case}}"}</code>{" "}
                  vypíše svůj obsah jen tehdy, když má proměnná právě tuto hodnotu;{" "}
                  <code>{"{{#case var1 != Praha}}"}</code> naopak když ji nemá. Porovnává
                  se bez ohledu na velikost písmen a mezery. Blok vložíte tlačítkem
                  <strong> ⇄ Přepínač…</strong> v panelu vpravo – u typu Seznam si tam
                  hodnotu vyberete, takže se nemůžete přepsat.
                </p>

                <p style={hintStyle}>
                  Typ <strong>Obrázek</strong> je seznam, jehož každá možnost nese
                  vlastní obrázek: při generování vyberete název možnosti a do
                  dokumentu se vloží její obrázek v nastavené šířce a zarovnání.
                  Obrázky se ukládají přímo do šablony, proto jich je nejvýše{" "}
                  {CUSTOM_VAR_MAX_IMAGES} a velké se automaticky zmenší.
                </p>

                {/* One hidden input for every upload button in the dialog – the
                    button sets which choice the pick belongs to, then clicks it. */}
                <input
                  ref={varImageInputRef}
                  type="file"
                  accept={IMAGE_MIME_TYPES.join(",")}
                  style={{ display: "none" }}
                  onChange={handleVarImageFile}
                />

                {used.length === 0 ? (
                  <p style={hintStyle}>
                    V šabloně zatím není použita žádná vlastní proměnná. Vložte ji
                    kliknutím v panelu vpravo (např. <code>{"{{var1}}"}</code>).
                  </p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    {/* Each slot occupies exactly one row; on a viewport too narrow
                        for that the table scrolls sideways instead of wrapping. */}
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 6px 4px 0", whiteSpace: "nowrap" }}>Proměnná</th>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 6px 4px 0", whiteSpace: "nowrap" }}>Název (co se zobrazí)</th>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 10px 4px 0", whiteSpace: "nowrap" }}>Typ</th>
                        <th style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 10px 4px 0", whiteSpace: "nowrap" }}>Nepovinná</th>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 0 4px 0", whiteSpace: "nowrap" }}>Výchozí hodnota / podmínka / vzorec</th>
                      </tr>
                    </thead>
                    <tbody>
                      {used.map((key) => {
                        const def = variableDefs[key];
                        const type = def?.type ?? "text";
                        const dflt = def?.default;
                        const source = dflt?.kind ?? "none";
                        return (
                          <Fragment key={key}>
                          <tr>
                            <td style={{ padding: "3px 10px 3px 0", whiteSpace: "nowrap" }}>
                              <code style={{ fontSize: "0.75rem" }}>{`{{${key}}}`}</code>
                            </td>
                            <td style={{ padding: "3px 10px 3px 0" }}>
                              <input
                                type="text"
                                style={fieldStyle}
                                value={def?.label ?? ""}
                                placeholder="např. Výše pokuty"
                                maxLength={60}
                                onChange={(e) => setDef(key, { label: e.target.value })}
                              />
                            </td>
                            <td style={{ padding: "3px 10px 3px 0", whiteSpace: "nowrap" }}>
                              <select
                                style={{ ...fieldStyle, width: "auto" }}
                                value={type}
                                onChange={(e) => {
                                  const t = e.target.value as CustomVarType;
                                  setDef(key, t === "condition" ? { type: t, condition: starterCondition() } : { type: t });
                                }}
                              >
                                {(Object.keys(CUSTOM_VAR_TYPE_LABELS) as CustomVarType[]).map((t) => (
                                  <option key={t} value={t}>{CUSTOM_VAR_TYPE_LABELS[t]}</option>
                                ))}
                              </select>
                            </td>
                            {/* "Nepovinná" only applies to slots that are typed in
                                at generation. bool + the computed types (Podmínka,
                                Výpočet) never block it anyway (see
                                missingCustomVars), so they show a dash rather than
                                a checkbox that does nothing. */}
                            <td style={{ padding: "3px 10px 3px 0", textAlign: "center" }}>
                              {type === "bool" || isComputedVarType(type) ? (
                                <span style={{ color: "var(--color-text-muted)" }}>–</span>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={!!def?.optional}
                                  aria-label={`Proměnná ${def?.label || key} je nepovinná`}
                                  onChange={(e) => setDef(key, { optional: e.target.checked })}
                                />
                              )}
                            </td>
                            {/* The computed types show how they are computed – a
                                "condition" its comparison builder, a "math" its
                                formula. Every other type shows its default-value
                                control (pre-filled + editable at generation, shown
                                in the preview); a computed slot has no default,
                                because nobody ever fills it in. */}
                            <td style={{ padding: "3px 0" }}>
                              {type === "condition" ? (
                                renderConditionBuilder(key, def?.condition)
                              ) : type === "math" ? (
                                renderFormulaEditor(key)
                              ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <select
                                    style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                                    value={source}
                                    onChange={(e) => {
                                      const s = e.target.value;
                                      if (s === "literal") setDef(key, { default: { kind: "literal", value: "" } });
                                      else if (s === "fixedVar") {
                                        const opts = fixedVarOptions(type);
                                        setDef(key, { default: { kind: "fixedVar", key: opts[0]?.key ?? "" } });
                                      } else setDef(key, { default: undefined });
                                    }}
                                  >
                                    <option value="none">Žádná</option>
                                    <option value="literal">Pevná hodnota</option>
                                    {/* A list slot's default must be one of its own
                                        choices, so sourcing it from a built-in
                                        variable is not offered. An image slot is
                                        the same case, and worse: a built-in
                                        resolves to text like "Jana", which names
                                        no picture, so the default would silently
                                        print nothing. */}
                                    {type !== "list" && type !== "image" && (
                                      <option value="fixedVar">Z proměnné</option>
                                    )}
                                  </select>
                                  {source === "literal" && (
                                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                                      {renderLiteralDefault(key, type, dflt?.kind === "literal" ? dflt.value : "")}
                                    </div>
                                  )}
                                  {source === "fixedVar" && (
                                    <select
                                      style={{ ...fieldStyle, width: "auto", flex: "1 1 auto", minWidth: 0 }}
                                      value={dflt?.kind === "fixedVar" ? dflt.key : ""}
                                      onChange={(e) => setDef(key, { default: { kind: "fixedVar", key: e.target.value } })}
                                    >
                                      {fixedVarOptions(type).map((v) => (
                                        <option key={v.key} value={v.key}>{v.label}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                          {/* Choices get their own row: a variable-length list
                              would blow up the fixed column widths above. */}
                          {type === "list" && (
                            <tr>
                              <td />
                              <td colSpan={4} style={{ padding: "0 0 10px 0" }}>
                                {renderOptionsEditor(key)}
                              </td>
                            </tr>
                          )}
                          {/* Same reasoning as the choices row above, only more
                              so: a picture row carries a name, a thumbnail, a
                              width, an alignment and a size readout. */}
                          {type === "image" && (
                            <tr>
                              <td />
                              <td colSpan={4} style={{ padding: "0 0 10px 0" }}>
                                {renderImagesEditor(key)}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}

                {/* The wall has to be visible BEFORE a save fails: the pictures
                    and the document's text share one Firestore document, and
                    the save that exceeds 1 MiB is rejected whole. */}
                {allImages.length > 0 && (
                  <p
                    style={{
                      ...hintStyle,
                      marginTop: 10,
                      marginBottom: 0,
                      ...(imagesOverBudget
                        ? { color: "var(--color-danger-text-strong)" }
                        : {}),
                    }}
                  >
                    Obrázky celkem: {imageTotalKb} kB.{" "}
                    {imagesOverBudget
                      ? "Šablona se blíží limitu 1 MB na dokument – další obrázky už nemusí jít uložit. Odeberte prosím některý z nich, nebo použijte menší soubory."
                      : "Obrázky se ukládají do šablony spolu s textem, celkem se vejde asi 1 MB."}
                  </p>
                )}

                {orphaned.length > 0 && (
                  <p style={{ ...hintStyle, marginTop: 10, marginBottom: 0 }}>
                    Nastavené, ale v textu nepoužité: {orphaned.join(", ")}. Nastavení
                    zůstává uložené pro případ, že proměnnou vrátíte zpět.
                  </p>
                )}

                {/* Slots past this page's limit cannot be configured here at all –
                    the server refuses to store a def for them – so they are named
                    plainly instead of silently missing from the table above. */}
                {overLimit.length > 0 && (
                  <p style={{ ...hintStyle, marginTop: 10, marginBottom: 0 }}>
                    V textu je použito {overLimit.join(", ")}, ale šablony smluv
                    nabízejí jen {CONTRACT_VAR_COUNT} vlastních proměnných
                    (var1–var{CONTRACT_VAR_COUNT}). Název ani typ jim nastavit
                    nelze – při generování se objeví jako nepojmenované textové
                    pole. Nahraďte je prosím některou z proměnných výše.
                  </p>
                )}
              </div>

              <div className={modalStyles.footer}>
                <Button
                  variant="primary"
                  onClick={() => {
                    // Re-evaluate against what was just entered, so naming the
                    // last slot clears the warning immediately.
                    setVarWarning(customVarWarning(editor.getHTML(), variableDefs));
                    setCustomVarsOpen(false);
                  }}
                >
                  Hotovo
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* "Přepínač" – assembles a {{#case}} block. Top level (not inside the
          Vlastní proměnné modal) so it keeps its own state and can be opened
          straight from the variable panel. Closes only via its buttons. */}
      {canManage && caseModalOpen && (() => {
        const slots = caseSlotKeys();
        const def = variableDefs[caseKey];
        // An image slot's raw value is the chosen picture's NAME, so a switch
        // branches on exactly the same strings a list's does – offer them the
        // same way rather than making the author retype one.
        const listChoices =
          def?.type === "list"
            ? (def.options ?? []).filter((o) => o.trim())
            : def?.type === "image"
              ? (def.images ?? []).map((o) => o.label).filter((o) => o.trim())
              : [];
        const labelStyle = {
          display: "block",
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: 4,
        } as const;
        const controlStyle = {
          width: "100%",
          padding: "8px 10px",
          fontSize: "0.875rem",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          background: "var(--color-surface)",
          color: "var(--color-text)",
        } as const;
        return (
          <div className={modalStyles.overlay}>
            <div className={modalStyles.modal}>
              <div className={modalStyles.header}>
                <h2 className={modalStyles.title}>Vložit přepínač</h2>
              </div>
              <div className={modalStyles.body}>
                {slots.length === 0 ? (
                  <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: 0 }}>
                    Přepínač porovnává hodnotu vlastní proměnné, ale v šabloně
                    zatím žádná není. Vložte ji nejdřív kliknutím v panelu vpravo
                    (např. <code>{"{{var1}}"}</code>).
                  </p>
                ) : (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Proměnná</label>
                      <select
                        style={controlStyle}
                        value={caseKey}
                        onChange={(e) => { setCaseKey(e.target.value); setCaseValue(""); }}
                      >
                        {slots.map((k) => (
                          <option key={k} value={k}>
                            {variableDefs[k]?.label?.trim() ? `${variableDefs[k]!.label} (${k})` : k}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Porovnání</label>
                      <select
                        style={controlStyle}
                        value={caseOp}
                        onChange={(e) => setCaseOp(e.target.value as "=" | "!=")}
                      >
                        <option value="=">= (rovná se)</option>
                        <option value="!=">≠ (nerovná se)</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Hodnota</label>
                      {/* A list slot's choices are picked, never retyped: retyping
                          the value is the main way a switch silently stops
                          matching, and the mismatch is invisible in the editor. */}
                      {listChoices.length > 0 ? (
                        <select
                          style={controlStyle}
                          value={caseValue}
                          onChange={(e) => setCaseValue(e.target.value)}
                        >
                          <option value="">– vyberte –</option>
                          {listChoices.map((o, i) => (
                            <option key={`${o}-${i}`} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          style={controlStyle}
                          value={caseValue}
                          maxLength={100}
                          placeholder="např. Praha"
                          onChange={(e) => setCaseValue(e.target.value)}
                        />
                      )}
                      <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "6px 0 0" }}>
                        Vloží se <code>{`{{#case ${caseKey || "var1"} ${caseOp} ${caseValue.trim() || "hodnota"}}}`}</code>
                        {" … "}<code>{"{{/case}}"}</code> a kurzor se postaví dovnitř.
                        Porovnává se bez ohledu na velikost písmen a mezery.
                        Hodnota nesmí obsahovat <code>{"}"}</code>.
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className={modalStyles.footer}>
                <Button variant="secondary" onClick={() => setCaseModalOpen(false)}>Zrušit</Button>
                <Button
                  variant="primary"
                  disabled={slots.length === 0}
                  onClick={insertCaseBlock}
                >
                  Vložit
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {canManage && createModalOpen && (
        <div className={modalStyles.overlay}>
          <div className={modalStyles.modal}>
            <div className={modalStyles.header}>
              <h2 className={modalStyles.title}>Nová šablona</h2>
            </div>
            <div className={modalStyles.body}>
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    color: "var(--color-text-secondary)",
                    marginBottom: 4,
                  }}
                >
                  ID (slug)
                </label>
                <input
                  type="text"
                  value={createIdDraft}
                  onChange={(e) => setCreateIdDraft(e.target.value)}
                  placeholder="napr. nova_smlouva"
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: "0.875rem",
                    border: "1px solid var(--color-border)",
                    borderRadius: "6px",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                    fontFamily: "monospace",
                  }}
                />
                <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                  Malá písmena, číslice a podtržítka. Začíná písmenem.
                </p>
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    color: "var(--color-text-secondary)",
                    marginBottom: 4,
                  }}
                >
                  Název
                </label>
                <input
                  type="text"
                  value={createNameDraft}
                  onChange={(e) => setCreateNameDraft(e.target.value)}
                  placeholder="napr. Nová smlouva"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: "0.875rem",
                    border: "1px solid var(--color-border)",
                    borderRadius: "6px",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                  }}
                />
              </div>
              {createError && (
                <p style={{ fontSize: "0.8125rem", color: "var(--color-danger-text-strong)", marginTop: 10 }}>
                  {createError}
                </p>
              )}
            </div>
            <div className={modalStyles.footer}>
              <Button
                variant="secondary"
                onClick={() => setCreateModalOpen(false)}
                disabled={createSaving}
              >
                Zrušit
              </Button>
              <Button
                variant="primary"
                disabled={createSaving || !createIdDraft.trim() || !createNameDraft.trim()}
                onClick={async () => {
                  if (!user) return;
                  setCreateSaving(true);
                  setCreateError(null);
                  try {
                    const token = await user.getIdToken();
                    const resp = await fetch("/api/contractTemplates", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        id: createIdDraft.trim(),
                        name: createNameDraft.trim(),
                      }),
                    });
                    if (!resp.ok) {
                      const body = await resp.json().catch(() => ({}));
                      setCreateError(body.error ?? "Chyba při vytváření šablony.");
                      return;
                    }
                    const created = await resp.json();
                    setCreateModalOpen(false);
                    await fetchTemplates();
                    setSelected(created.id);
                  } catch (e) {
                    setCreateError((e as Error).message ?? "Chyba při vytváření šablony.");
                  } finally {
                    setCreateSaving(false);
                  }
                }}
              >
                {createSaving ? "Vytvářím…" : "Vytvořit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingSwitch && (
        <ConfirmModal
          title="Neuložené změny"
          message="V aktuální šabloně máte neuložené změny. Co s nimi?"
          confirmLabel="Uložit a pokračovat"
          tertiary={{
            label: "Zahodit změny",
            onClick: handleDiscardAndSwitch,
            variant: "danger",
          }}
          cancelLabel="Zrušit"
          onConfirm={handleSaveAndSwitch}
          onCancel={() => setPendingSwitch(null)}
        />
      )}

      {actionConfirm && (
        <ConfirmModal
          title={actionConfirm.title}
          message={actionConfirm.message}
          confirmLabel={actionConfirm.confirmLabel}
          danger={actionConfirm.danger}
          onConfirm={actionConfirm.onConfirm}
          onCancel={() => setActionConfirm(null)}
        />
      )}

      {errorModal && (
        <ConfirmModal
          title="Chyba"
          message={errorModal}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setErrorModal(null)}
          onCancel={() => setErrorModal(null)}
        />
      )}
    </div>
  );
}
