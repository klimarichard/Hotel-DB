import { Fragment, useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
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

import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import modalStyles from "@/components/ConfirmModal.module.css";
import GenerateDocumentModal from "@/components/GenerateDocumentModal";
import {
  DOCUMENT_SECTIONS,
  documentSectionLabel,
  type DocumentSectionId,
} from "@/lib/documentSections";
import { useAuth } from "@/hooks/useAuth";
import { api, errorMessage } from "@/lib/api";
import { formatTimestampCZ } from "@/lib/dateFormat";
// The module is named "contractVariables", but the pieces imported here are the
// domain-free custom-variable engine ({{var1}}..{{var10}}: slot keys, type
// labels, usage scan, placeholder fill). They have zero employee/contract
// coupling – the employee catalogues (VARIABLE_GROUPS, COMPARABLE_VARS) live in
// the same file and are deliberately NOT imported: a document template has
// custom variables only.
import {
  CUSTOM_VAR_KEYS,
  CUSTOM_VAR_TYPE_LABELS,
  CUSTOM_VAR_MAX_OPTIONS,
  usedCustomVars,
  fillTemplate,
  type CustomVarDefs,
  type CustomVarType,
} from "@/lib/contractVariables";
import styles from "./DokumentyPage.module.css";

/**
 * The custom-variable types a DOCUMENT template may use. "condition" is
 * excluded on purpose: a derived condition compares built-in employee/contract
 * variables, and this page has none – there would be nothing to compare.
 */
const DOC_VAR_TYPES = ["text", "date", "number", "bool", "list"] as const;
type DocVarType = Exclude<CustomVarType, "condition">;

/** A literal default value for a slot. Documents never use `fixedVar` defaults
 *  ("Z proměnné"), because there is no built-in variable to source them from. */
type LiteralDefault = { kind: "literal"; value: string };

interface DocumentMeta {
  id: string;
  name: string;
  /** Slot keys the stored HTML uses (computed server-side). */
  variables?: string[];
  /** Absent = active. `false` = deactivated (sorted last, visually muted). */
  active?: boolean;
  /** Section the document is filed under; null = visible to everyone with page
   *  access. Server filters the list by this, so an entry arriving here is one
   *  the caller is allowed to see. */
  section?: DocumentSectionId | null;
  updatedAt?: { seconds: number } | null;
}

interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface DocumentTemplate extends DocumentMeta {
  htmlContent: string;
  margins?: PageMargins;
  variableDefs?: CustomVarDefs;
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
 * Warning text for custom slots the document's text uses but never named.
 * Such a slot still works – it falls back to Text and shows its raw key
 * ("var3") to whoever fills the document in – which is exactly why it needs
 * flagging: it looks like a bug rather than an omission.
 *
 * Returns null when there is nothing to warn about.
 */
function customVarWarning(html: string, defs: CustomVarDefs): string | null {
  const used = usedCustomVars(html);
  const unnamed = used.filter((k) => !defs[k]?.label?.trim());
  // A "list" slot with no choices renders an empty dropdown that can never be
  // satisfied, so the generate form falls back to a free-text box for it. That
  // fallback keeps the document producible, which is precisely why the omission
  // has to be surfaced here instead of being discovered by whoever fills it in.
  const emptyLists = used.filter(
    (k) => defs[k]?.type === "list" && !(defs[k]?.options ?? []).some((o) => o.trim())
  );
  const parts: string[] = [];
  if (unnamed.length > 0) parts.push(`Bez nastavení: ${unnamed.join(", ")} – chybí název a typ.`);
  if (emptyLists.length > 0) parts.push(`Bez možností: ${emptyLists.join(", ")} – seznam nemá žádné hodnoty.`);
  return parts.length > 0 ? parts.join(" ") : null;
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

const createLabelStyle = {
  display: "block",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  marginBottom: 4,
} as const;

const createInputStyle = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "0.875rem",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  background: "var(--color-surface)",
  color: "var(--color-text)",
} as const;

export default function DokumentyPage() {
  const { can, dokumentyDefaultSection } = useAuth();
  /**
   * Local override of the saved default, so the list re-sorts the instant the
   * user picks one instead of waiting for /auth/me to be refetched.
   * `undefined` = no local change yet, use the server value.
   *
   * Read the server value STRAIGHT from useAuth – never mirrored into state via
   * an effect. An effect runs after the render that would read it, so the first
   * render once authLoading clears would sort with a null default and only
   * settle a frame later: fine on a fresh browser, visibly wrong for every
   * returning user. Same trap as the Recepce default hotel.
   */
  const [pendingDefault, setPendingDefault] = useState<DocumentSectionId | null | undefined>(undefined);
  const [savingDefault, setSavingDefault] = useState(false);
  const defaultSection = (pendingDefault !== undefined
    ? pendingDefault
    : (dokumentyDefaultSection as DocumentSectionId | null)) ?? null;

  /**
   * Sections whose documents this user can see. `dokumenty.manage` sees every
   * section (it short-circuits the server-side gate too), so the picker offers
   * all four to an editor.
   */
  const visibleSections = useMemo(
    () =>
      can("dokumenty.manage")
        ? DOCUMENT_SECTIONS
        : DOCUMENT_SECTIONS.filter((sec) => can(sec.viewPerm)),
    [can]
  );

  /** Persist the default. Failure is silent-but-reverted: a view preference is
   *  not worth an error dialog, but the UI must not claim it saved. */
  async function saveDefaultSection(next: DocumentSectionId | null) {
    const previous = defaultSection;
    setPendingDefault(next);
    setSavingDefault(true);
    try {
      await api.put("/auth/me/dokumenty-default", { section: next });
    } catch {
      setPendingDefault(previous);
    } finally {
      setSavingDefault(false);
    }
  }
  // Editing is gated by dokumenty.manage; a view-only user (route permission
  // nav.dokumenty.view) sees the document list plus "Vyplnit a vytisknout" and
  // a read-only rendering – no toolbar, no Save, no create, no variable config.
  const canManage = can("dokumenty.manage");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionConfirm, setActionConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Create dialog
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createIdDraft, setCreateIdDraft] = useState("");
  const [createNameDraft, setCreateNameDraft] = useState("");
  const [createSectionDraft, setCreateSectionDraft] = useState<DocumentSectionId | "">("");
  /** Non-null = the create modal is acting as "duplicate this document". */
  const [duplicateSource, setDuplicateSource] = useState<DocumentMeta | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Editor chrome
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const [marginsOpen, setMarginsOpen] = useState(false);
  const [margins, setMargins] = useState<PageMargins>(DEFAULT_MARGINS);

  // Per-document config of the {{var1}}..{{var10}} slots (label + type +
  // default). Saved with the document; the same slot means different things in
  // different documents.
  const [variableDefs, setVariableDefs] = useState<CustomVarDefs>({});
  const [customVarsOpen, setCustomVarsOpen] = useState(false);
  // Custom slots used in the text that have no name/type yet. Set on load and
  // kept current while editing – it is not a transient toast.
  const [varWarning, setVarWarning] = useState<string | null>(null);

  // The read-only rendering shown to a viewer without dokumenty.manage.
  const [viewHtml, setViewHtml] = useState("");

  // The document the fill-in modal is open for (null = closed).
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Force a rerender on every editor transaction so isActive(...) checks
  // (active toolbar buttons, in-table contextual buttons) reflect selection
  // changes. TipTap React v3 doesn't subscribe to these by default.
  const [, forceRerender] = useReducer((x: number) => x + 1, 0);

  // Unsaved-changes tracking. The loader sets `isLoadingRef` while it pushes
  // content into the editor so the resulting `update` events aren't counted as
  // user edits.
  const [isDirty, setIsDirty] = useState(false);
  const isLoadingRef = useRef(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // The A4 canvas + TipTap toolbars aren't usable on a phone, so an editor gets
  // a "use a larger screen" notice instead. A view-only user keeps the page –
  // the document list and its generate button fit fine (see the CSS media query).
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
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

  const fetchDocs = useCallback(async () => {
    try {
      const list = await api.get<DocumentMeta[]>("/dokumenty");
      setDocs(list);
      // Select the first document (active ones first) on the initial load.
      setSelected((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        const first = [...list].sort(
          (a, b) => Number(b.active !== false) - Number(a.active !== false)
        )[0];
        return first?.id ?? null;
      });
    } catch (e) {
      setErrorModal(errorMessage(e, "Dokumenty se nepodařilo načíst."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => forceRerender();
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Keep the editor's editable state in sync with the permission, which resolves
  // asynchronously after auth loads (and could change on re-auth).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canManage);
  }, [editor, canManage]);

  /**
   * Visually push every page-break node down to the start of the next A4 page
   * (with the template's top margin on the new page). The .a4Page CSS uses a
   * 309 mm cycle (297 mm paper + 12 mm gap), so a break at offset Y is
   * stretched to ((floor(Y/309)+1)*309 + top) - Y mm. Heights reset to 0 first
   * so re-measurement accounts for the cumulative effect of breaks above.
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
      const breaks = Array.from(a4.querySelectorAll<HTMLElement>('[data-page-break="true"]'));
      breaks.forEach((br) => {
        br.style.height = "0px";
      });
      breaks.forEach((br) => {
        const offsetTop = br.getBoundingClientRect().top - a4.getBoundingClientRect().top;
        const offsetMm = offsetTop / pxPerMm;
        const targetMm = (Math.floor(offsetMm / PAGE_CYCLE_MM) + 1) * PAGE_CYCLE_MM + TOP_MARGIN_MM;
        br.style.height = `${Math.max(0, targetMm - offsetMm) * pxPerMm}px`;
      });
    };
    const handler = () => requestAnimationFrame(measure);
    editor.on("transaction", handler);
    handler();
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor, margins]);

  // Load the selected document into the editor (and into the read-only view).
  useEffect(() => {
    if (!editor) return;
    if (!selected) {
      editor.commands.setContent("<p></p>");
      setViewHtml("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const doc = await api.get<DocumentTemplate>(`/dokumenty/${selected}`);
        if (cancelled) return;
        isLoadingRef.current = true;
        editor.commands.setContent(doc.htmlContent || "<p></p>");
        setMargins(doc.margins ?? DEFAULT_MARGINS);
        const defs = doc.variableDefs ?? {};
        setVariableDefs(defs);
        setViewHtml(doc.htmlContent || "");
        // Warn straight away: a document can arrive with unconfigured slots
        // (saved before they were named, or a {{varN}} typed by hand), and the
        // user must not have to make an edit before hearing about it.
        setVarWarning(customVarWarning(doc.htmlContent || "", defs));
        // Release the flag on the next tick so any synchronous `update` events
        // fired by setContent are still counted as load events.
        setTimeout(() => {
          isLoadingRef.current = false;
          setIsDirty(false);
        }, 0);
      } catch (e) {
        if (!cancelled) setErrorModal(errorMessage(e, "Dokument se nepodařilo načíst."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, editor]);

  // Mark dirty on any user-driven editor update.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (isLoadingRef.current) return;
      setIsDirty(true);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // Keep the "unconfigured slot" warning current while editing: inserting
  // {{var4}} should flag it at once, deleting the last {{var2}} should clear it.
  // Debounced, because it reads the whole document on every keystroke.
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
   * Active documents first, deactivated ones last; alphabetical within a group.
   * When the user has picked a default section, the active group splits again:
   * that section's documents float to the top, the rest follow after a divider.
   * With no default (or none of its documents present) `preferred` is empty and
   * the list reads exactly as it did before.
   */
  const sortedDocs = useMemo(() => {
    const activeOf = (d: DocumentMeta) => d.active !== false;
    const byName = (a: DocumentMeta, b: DocumentMeta) => a.name.localeCompare(b.name, "cs");
    const active = docs.filter(activeOf).sort(byName);
    const inactive = docs.filter((d) => !activeOf(d)).sort(byName);
    if (!defaultSection) return { preferred: [], active, inactive };
    return {
      preferred: active.filter((d) => d.section === defaultSection),
      active: active.filter((d) => d.section !== defaultSection),
      inactive,
    };
  }, [docs, defaultSection]);

  /**
   * The read-only rendering: the stored HTML with every custom slot replaced by
   * its configured name in brackets, so a viewer sees "[Výše pokuty]" instead of
   * a bare "{{var1}}". Conditional blocks resolve as "filled in", which is the
   * useful default for a document that is about to be filled in for real.
   */
  const readOnlyHtml = useMemo(() => {
    if (!viewHtml) return "";
    const vars: Record<string, string> = {};
    for (const key of usedCustomVars(viewHtml)) {
      vars[key] = `[${variableDefs[key]?.label?.trim() || key}]`;
    }
    return fillTemplate(viewHtml, vars);
  }, [viewHtml, variableDefs]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function doSetActive(id: string, active: boolean) {
    setActionConfirm(null);
    setBusyId(id);
    try {
      await api.patch(`/dokumenty/${id}`, { active });
      await fetchDocs();
    } catch (e) {
      setErrorModal(errorMessage(e, "Změnu se nepodařilo uložit."));
    } finally {
      setBusyId(null);
    }
  }

  function handleToggleActive(doc: DocumentMeta, currentlyActive: boolean) {
    if (!currentlyActive) {
      // Reactivating is safe / non-destructive – do it immediately, no confirm.
      doSetActive(doc.id, true);
      return;
    }
    setActionConfirm({
      title: "Deaktivovat dokument",
      message: `Dokument „${doc.name}" se skryje z vyplňování a přesune se na konec seznamu. Kdykoli jej můžete znovu aktivovat.`,
      confirmLabel: "Deaktivovat",
      onConfirm: () => doSetActive(doc.id, false),
    });
  }

  async function doDelete(doc: DocumentMeta) {
    setActionConfirm(null);
    setBusyId(doc.id);
    try {
      await api.delete(`/dokumenty/${doc.id}`);
      if (selected === doc.id) setSelected(null);
      await fetchDocs();
    } catch (e) {
      setErrorModal(errorMessage(e, "Dokument se nepodařilo smazat."));
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(doc: DocumentMeta) {
    setActionConfirm({
      title: "Smazat dokument",
      message: `Opravdu chcete smazat dokument „${doc.name}"? Tato akce je nevratná. Již vytištěné dokumenty tím nijak nezmizí – ukládá se pouze šablona.`,
      confirmLabel: "Smazat",
      danger: true,
      onConfirm: () => doDelete(doc),
    });
  }

  async function handleSave() {
    if (!editor || !selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const htmlContent = editor.getHTML();
      const meta = docs.find((d) => d.id === selected);
      const name = meta?.name ?? selected;
      await api.put(`/dokumenty/${selected}`, {
        name,
        htmlContent,
        margins,
        variableDefs,
        // Explicit null clears it; omitting the key would leave the old section.
        section: meta?.section ?? null,
      });
      setSaveMsg("Uloženo");
      setIsDirty(false);
      setViewHtml(htmlContent);
      setVarWarning(customVarWarning(htmlContent, variableDefs));
      await fetchDocs();
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      // Surface the backend's Czech message (notably the 413 "dokument je
      // příliš velký" caused by pasted base64 images) rather than a generic one.
      setSaveMsg(errorMessage(err, "Chyba při ukládání"));
      // Detailed errors need longer to read than the brief success toast.
      setTimeout(() => setSaveMsg(null), 10000);
    } finally {
      setSaving(false);
    }
  }

  function closeCreateModal() {
    setCreateModalOpen(false);
    setDuplicateSource(null);
    setCreateError(null);
  }

  /** Open the modal in duplicate mode, pre-filled from `doc`. */
  function openDuplicate(doc: DocumentMeta) {
    // Suggest a slug, still editable. The 40-char cap is the server's SLUG_RE
    // limit, so a long source id can't produce an id the server would reject.
    setCreateIdDraft(`${doc.id}_kopie`.slice(0, 40));
    setCreateNameDraft(`${doc.name} (kopie)`);
    setCreateSectionDraft(doc.section ?? "");
    setCreateError(null);
    setDuplicateSource(doc);
    setCreateModalOpen(true);
  }

  async function handleCreate() {
    setCreateSaving(true);
    setCreateError(null);
    try {
      const body = {
        id: createIdDraft.trim(),
        name: createNameDraft.trim(),
        section: createSectionDraft || null,
      };
      const created = duplicateSource
        ? await api.post<{ id: string }>(`/dokumenty/${duplicateSource.id}/duplicate`, body)
        : await api.post<{ id: string }>("/dokumenty", body);
      closeCreateModal();
      await fetchDocs();
      // requestSwitch, NOT setSelected: switching straight to the new document
      // would discard unsaved edits in the editor without asking. That was
      // latent for "new document"; duplicating makes it likely, because the
      // document you duplicate is usually the one you have open and are editing.
      requestSwitch(created.id);
    } catch (e) {
      setCreateError(
        errorMessage(e, duplicateSource ? "Chyba při duplikování dokumentu." : "Chyba při vytváření dokumentu.")
      );
    } finally {
      setCreateSaving(false);
    }
  }

  /** Sidebar switch, guarded so unsaved editor changes prompt first. */
  function requestSwitch(id: string) {
    if (id === selected) return;
    if (isDirty && canManage) {
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

  function insertVariable(key: string) {
    editor?.chain().focus().insertContent(`{{${key}}}`).run();
  }

  // ── Find & replace ─────────────────────────────────────────────────────────

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
    const scan = (minPos: number) => {
      state.doc.descendants((node, pos) => {
        if (foundFrom !== -1) return false;
        if (!node.isText || !node.text) return;
        const idx = node.text.toLowerCase().indexOf(lower);
        if (idx !== -1 && pos + idx >= minPos) {
          foundFrom = pos + idx;
          return false;
        }
        return undefined;
      });
    };
    scan(startPos);
    // Wrap-around: search again from the start of the document.
    if (foundFrom === -1) scan(0);
    if (foundFrom === -1) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: foundFrom, to: foundFrom + findQuery.length })
      .run();
    editor.view.dom
      .querySelector(".tt-search-hit.tt-search-active")
      ?.classList.remove("tt-search-active");
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const el = sel?.anchorNode?.parentElement?.closest(".tt-search-hit");
      el?.scrollIntoView({ block: "center" });
    });
  }

  function replaceCurrent() {
    if (!editor || !findQuery) return;
    const { from, to } = editor.view.state.selection;
    const current = editor.view.state.doc.textBetween(from, to);
    if (current.toLowerCase() === findQuery.toLowerCase()) {
      editor.chain().focus().insertContentAt({ from, to }, replaceQuery).run();
    }
    findNext();
  }

  function replaceAll() {
    if (!editor || !findQuery) return;
    const lower = findQuery.toLowerCase();
    // Collect ranges first, then replace back-to-front; replacing in document
    // order would shift every later position.
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

  // ── Variable config ────────────────────────────────────────────────────────

  /**
   * Patch one slot's configuration. Changing the TYPE drops an existing default
   * unless the same patch re-supplies one: a literal date is meaningless on a
   * slot that just became a number, and keeping it would silently print garbage.
   * `optional` survives a type change – a boolean can't become invalid for the
   * new type, only inapplicable (bool ignores it), so the intent is kept.
   */
  function setDef(
    key: string,
    patch: Partial<{
      label: string;
      type: DocVarType;
      default: LiteralDefault | undefined;
      optional: boolean;
      options: string[] | undefined;
    }>
  ) {
    setVariableDefs((prev) => {
      const prevDef = prev[key];
      const typeChanged = patch.type !== undefined && patch.type !== prevDef?.type;
      const nextDefault =
        "default" in patch ? patch.default : typeChanged ? undefined : prevDef?.default;
      const nextOptional = "optional" in patch ? patch.optional : prevDef?.optional;
      // Choices belong to a "list" slot only. Switching the type away discards
      // them for the same reason a stale default is discarded: they would sit
      // invisibly in the stored config and reappear if the author switched back,
      // long after they stopped meaning anything.
      const nextType = patch.type ?? prevDef?.type ?? "text";
      const nextOptions =
        "options" in patch ? patch.options : nextType === "list" ? prevDef?.options : undefined;
      return {
        ...prev,
        [key]: {
          label: patch.label ?? prevDef?.label ?? "",
          type: patch.type ?? prevDef?.type ?? "text",
          // Omitted when absent, so we never persist `default: undefined` or a
          // no-op `optional: false`.
          ...(nextDefault ? { default: nextDefault } : {}),
          ...(nextOptional ? { optional: true } : {}),
          ...(nextOptions && nextOptions.length > 0 ? { options: nextOptions } : {}),
        },
      };
    });
    setIsDirty(true);
  }

  /**
   * Editor for a "list" slot's choices: one input per value, plus a row to add
   * another. Values are edited in place rather than as one comma-separated field
   * because a choice may legitimately contain a comma ("Praha, Karlín").
   */
  function renderOptionsEditor(key: string) {
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
  }

  /** The literal-default input matching a slot's type. */
  function renderLiteralDefault(key: string, type: DocVarType, value: string) {
    const set = (v: string) => setDef(key, { default: { kind: "literal", value: v } });
    if (type === "list") {
      // The default of a list slot has to BE one of its choices, so this is a
      // select over them rather than a free-text box that could hold a value the
      // dropdown never offers.
      const options = variableDefs[key]?.options ?? [];
      return (
        <select style={fieldStyle} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">– vyberte –</option>
          {options.map((o, i) => (
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
    return (
      <input
        type={type === "date" ? "date" : type === "number" ? "number" : "text"}
        style={fieldStyle}
        value={value}
        placeholder="Výchozí hodnota"
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isPhone && canManage) {
    return (
      <div className={styles.phoneNotice}>
        <div className={styles.phoneNoticeIcon} aria-hidden="true">🖥️</div>
        <h1 className={styles.phoneNoticeTitle}>Dokumenty</h1>
        <p className={styles.phoneNoticeText}>
          Editor dokumentů pracuje s celou stránkou formátu A4 a širokým panelem nástrojů,
          které se na telefon nevejdou. Otevřete jej prosím na počítači nebo na tabletu
          na šířku.
        </p>
      </div>
    );
  }

  const th = {
    textAlign: "left" as const,
    fontSize: "0.75rem",
    color: "var(--color-text-muted)",
    padding: "0 10px 4px 0",
    whiteSpace: "nowrap" as const,
  };

  // Which slots the document actually uses, read from the live editor content –
  // so a slot appears the moment it is inserted and disappears when deleted,
  // with no bookkeeping. Falls back to the loaded HTML for a view-only user.
  const usedSlots = usedCustomVars(editor?.getHTML() ?? viewHtml);
  const orphanedSlots = Object.keys(variableDefs).filter((k) => !usedSlots.includes(k));

  const renderItem = (doc: DocumentMeta, isFirst: boolean) => {
    const active = doc.active !== false;
    return (
      <li
        key={doc.id}
        className={`${styles.templateItem} ${selected === doc.id ? styles.templateItemActive : ""} ${
          active ? "" : styles.templateItemInactive
        }`}
        onClick={() => requestSwitch(doc.id)}
      >
        <span className={styles.templateName}>
          {doc.name}
          {selected === doc.id && isDirty && (
            <span className={styles.dirtyDot} title="Neuložené změny">•</span>
          )}
        </span>
        {documentSectionLabel(doc.section) && (
          <span className={styles.sectionBadge}>{documentSectionLabel(doc.section)}</span>
        )}
        <div className={styles.templateItemFooter}>
          <span className={styles.templateDate}>{formatTimestampCZ(doc.updatedAt)}</span>
          {canManage && (
            <div className={styles.templateActions} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.templateActionBtn}
                disabled={busyId === doc.id}
                onClick={() => handleToggleActive(doc, active)}
                title={active ? "Skrýt z vyplňování a přesunout dolů" : "Znovu aktivovat"}
              >
                {active ? "Deaktivovat" : "Aktivovat"}
              </button>
              <button
                type="button"
                className={`${styles.templateActionBtn} ${styles.templateActionDanger}`}
                disabled={busyId === doc.id}
                onClick={() => handleDelete(doc)}
                title="Smazat dokument"
              >
                Smazat
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.generateBtn}
          data-tour={isFirst ? "dokumenty-generate" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            setGeneratingId(doc.id);
          }}
          title="Vyplnit hodnoty a otevřít dokument k tisku"
        >
          Vyplnit a vytisknout
        </button>
      </li>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Dokumenty</h1>
          {canManage && (
            <Button
              variant="primary"
              data-tour="dokumenty-manage"
              onClick={() => {
                setCreateIdDraft("");
                setCreateNameDraft("");
                setCreateError(null);
                setCreateModalOpen(true);
              }}
            >
              + Nový dokument
            </Button>
          )}
        </div>
        {canManage && (
          <div className={styles.headerActions}>
            {/* Refiling a document is a permission change in disguise – moving it
                into a section hides it from everyone without that section's key,
                and clearing the section exposes it to everyone with page access.
                Saved with the document, so it follows the same Uložit as the text. */}
            {selected && (
              <label className={styles.sectionPicker}>
                <span>Sekce</span>
                <select
                  value={docs.find((d) => d.id === selected)?.section ?? ""}
                  onChange={(e) => {
                    const next = (e.target.value || null) as DocumentSectionId | null;
                    setDocs((prev) =>
                      prev.map((d) => (d.id === selected ? { ...d, section: next } : d))
                    );
                    setIsDirty(true);
                  }}
                >
                  <option value="">Bez sekce</option>
                  {DOCUMENT_SECTIONS.map((sec) => (
                    <option key={sec.id} value={sec.id}>{sec.label}</option>
                  ))}
                </select>
              </label>
            )}
            {selected && (
              <Button
                variant="secondary"
                disabled={saving}
                title="Vytvořit kopii tohoto dokumentu pod novým id"
                onClick={() => {
                  const doc = docs.find((d) => d.id === selected);
                  if (doc) openDuplicate(doc);
                }}
              >
                Duplikovat
              </Button>
            )}
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
              <span
                className={`${styles.saveMsg} ${
                  saveMsg === "Uloženo" ? styles.saveMsgOk : styles.saveMsgErr
                }`}
              >
                {saveMsg}
              </span>
            )}
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !isDirty || !selected}
            >
              <span className={styles.saveBtnInner}>
                <SaveIcon />
                {saving ? "Ukládám…" : "Uložit dokument"}
              </span>
            </Button>
          </div>
        )}
      </div>

      <div className={`${styles.workspace} ${canManage ? "" : styles.workspaceView}`}>
        {/* Left: document list */}
        <aside className={styles.sidebar}>
          {/* Only offered when there is something to choose between. With one
              visible section (or none) a default would reorder nothing. */}
          {visibleSections.length > 1 && (
            <label className={styles.defaultPicker}>
              <span>Výchozí sekce</span>
              <select
                value={defaultSection ?? ""}
                disabled={savingDefault}
                title="Dokumenty z této sekce se zobrazí na začátku seznamu."
                onChange={(e) =>
                  saveDefaultSection((e.target.value || null) as DocumentSectionId | null)
                }
              >
                <option value="">Žádná</option>
                {visibleSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>{sec.label}</option>
                ))}
              </select>
            </label>
          )}
          {loading ? (
            <p className={styles.loadingText}>Načítám…</p>
          ) : docs.length === 0 ? (
            <p className={styles.loadingText}>
              Zatím tu není žádný dokument.
              {canManage ? " Vytvořte jej tlačítkem + Nový dokument." : ""}
            </p>
          ) : (
            <ul className={styles.templateList}>
              {/* Default-section documents, then a divider. The tour anchor rides
                  the very first row on screen, wherever that ends up. */}
              {sortedDocs.preferred.map((d, i) => renderItem(d, i === 0))}
              {sortedDocs.preferred.length > 0 && sortedDocs.active.length > 0 && (
                <li key="__preferred_sep__" className={styles.preferredDivider} aria-hidden="true" />
              )}
              {sortedDocs.active.map((d, i) =>
                renderItem(d, sortedDocs.preferred.length === 0 && i === 0)
              )}
              {sortedDocs.inactive.length > 0 && (
                <li key="__inactive_sep__" className={styles.inactiveDivider}>
                  Neaktivní
                </li>
              )}
              {sortedDocs.inactive.map((d, i) =>
                renderItem(
                  d,
                  sortedDocs.preferred.length === 0 && sortedDocs.active.length === 0 && i === 0
                )
              )}
            </ul>
          )}
        </aside>

        {/* Center: editor (manage) or read-only rendering (view-only) */}
        <div className={styles.editorWrapper}>
          {canManage && (
            <div className={styles.toolbar}>
              {/* Undo / Redo (Word convention: leftmost) */}
              <button
                className={styles.toolBtn}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().undo().run();
                }}
                disabled={!editor?.can().undo()}
                title="Zpět (Ctrl+Z)"
              >↶</button>
              <button
                className={styles.toolBtn}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().redo().run();
                }}
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
                    (
                      editor?.chain().focus() as unknown as Record<
                        string,
                        (s: string) => { run(): void }
                      >
                    ).setFontSize(size).run();
                  } else {
                    (
                      editor?.chain().focus() as unknown as Record<string, () => { run(): void }>
                    ).unsetFontSize().run();
                  }
                  // Propagate font-size onto the parent <li> directly so the
                  // browser's ::marker (the "1." / "•") inherits it. Chain-based
                  // updateAttributes is unreliable here – use setNodeMarkup on
                  // the listItem ancestor instead.
                  if (editor) {
                    const { state, view } = editor;
                    const { $from } = state.selection;
                    let liDepth = -1;
                    for (let d = $from.depth; d > 0; d--) {
                      if ($from.node(d).type.name === "listItem") {
                        liDepth = d;
                        break;
                      }
                    }
                    if (liDepth >= 0) {
                      const liNode = $from.node(liDepth);
                      const liPos = $from.before(liDepth);
                      const curStyle: string = liNode.attrs.style ?? "";
                      const stripped = curStyle.replace(/font-size:[^;]*;?\s*/gi, "").trim();
                      const newStyle = size
                        ? stripped
                          ? `font-size: ${size}; ${stripped}`
                          : `font-size: ${size}`
                        : stripped || null;
                      view.dispatch(
                        state.tr.setNodeMarkup(liPos, undefined, { ...liNode.attrs, style: newStyle })
                      );
                    }
                  }
                }}
                title="Velikost písma"
              >
                <option value="">Výchozí</option>
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72].map((s) => (
                  <option key={s} value={`${s}pt`}>{s}</option>
                ))}
              </select>

              {/* Line spacing */}
              <select
                className={styles.toolSelect}
                value={
                  editor?.getAttributes("paragraph").lineHeight ??
                  editor?.getAttributes("heading").lineHeight ??
                  ""
                }
                onChange={(e) => {
                  e.preventDefault();
                  const v = e.target.value;
                  if (v) {
                    (
                      editor?.chain().focus() as unknown as Record<
                        string,
                        (s: string) => { run(): void }
                      >
                    ).setLineHeight(v).run();
                  } else {
                    (
                      editor?.chain().focus() as unknown as Record<string, () => { run(): void }>
                    ).unsetLineHeight().run();
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
                  editor?.isActive("heading", { level: 1 })
                    ? "h1"
                    : editor?.isActive("heading", { level: 2 })
                    ? "h2"
                    : editor?.isActive("heading", { level: 3 })
                    ? "h3"
                    : "p"
                }
                onChange={(e) => {
                  e.preventDefault();
                  const v = e.target.value;
                  if (v === "p") editor?.chain().focus().setParagraph().run();
                  else editor?.chain().focus().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
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
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().toggleBold().run();
                }}
                title="Tučné"
              ><b>B</b></button>
              <button
                className={`${styles.toolBtn} ${editor?.isActive("italic") ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().toggleItalic().run();
                }}
                title="Kurzíva"
              ><i>I</i></button>
              <button
                className={`${styles.toolBtn} ${editor?.isActive("underline") ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().toggleUnderline().run();
                }}
                title="Podtržení"
              ><u>U</u></button>

              <span className={styles.toolSep} />

              {/* Alignment */}
              <button
                className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "left" }) ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().setTextAlign("left").run();
                }}
                title="Zarovnat vlevo"
              >⬅</button>
              <button
                className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "center" }) ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().setTextAlign("center").run();
                }}
                title="Na střed"
              >↔</button>
              <button
                className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "right" }) ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().setTextAlign("right").run();
                }}
                title="Zarovnat vpravo"
              >➡</button>
              <button
                className={`${styles.toolBtn} ${editor?.isActive({ textAlign: "justify" }) ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().setTextAlign("justify").run();
                }}
                title="Zarovnat do bloku"
              >☰</button>

              <span className={styles.toolSep} />

              {/* Lists */}
              <button
                className={`${styles.toolBtn} ${editor?.isActive("bulletList") ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().toggleBulletList().run();
                }}
                title="Odrážkový seznam"
              >≡</button>
              <button
                className={`${styles.toolBtn} ${editor?.isActive("orderedList") ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().toggleOrderedList().run();
                }}
                title="Číslovaný seznam"
              >1.</button>
              <button
                className={styles.toolBtn}
                disabled={!editor?.can().sinkListItem("listItem")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().sinkListItem("listItem").run();
                }}
                title="Vnořit položku seznamu"
              >→]</button>
              <button
                className={styles.toolBtn}
                disabled={!editor?.can().liftListItem("listItem")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().liftListItem("listItem").run();
                }}
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
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().setHorizontalRule().run();
                }}
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
                title="Konec stránky"
              >↧</button>

              {/* Page margins */}
              <button
                className={`${styles.toolBtn} ${marginsOpen ? styles.toolBtnActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setMarginsOpen((v) => !v);
                }}
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

              <span className={styles.toolSep} />

              {/* Image upload */}
              <button
                className={styles.toolBtn}
                onMouseDown={(e) => {
                  e.preventDefault();
                  imageInputRef.current?.click();
                }}
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
                        if ($from.node(d).type.name === "table") {
                          tableDepth = d;
                          break;
                        }
                      }
                      if (tableDepth < 0) return;
                      const tableNode = $from.node(tableDepth);
                      const tablePos = $from.before(tableDepth);
                      const cur = !!tableNode.attrs.borderless;
                      view.dispatch(
                        state.tr.setNodeMarkup(tablePos, undefined, {
                          ...tableNode.attrs,
                          borderless: !cur,
                        })
                      );
                    }}
                    title="Skrýt / zobrazit okraje tabulky"
                  >▦</button>
                </>
              )}
              {editor?.isActive("image") && (
                <>
                  {IMAGE_WIDTH_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      className={`${styles.toolBtn} ${
                        editor?.getAttributes("image").width === p.value ? styles.toolBtnActive : ""
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        editor?.chain().focus().updateAttributes("image", { width: p.value }).run();
                      }}
                      title={`Šířka obrázku ${p.label}`}
                    >{p.label}</button>
                  ))}
                  <button
                    className={styles.toolBtn}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editor?.chain().focus().updateAttributes("image", { width: null }).run();
                    }}
                    title="Původní velikost"
                  >⤢</button>
                  {(["left", "center", "right"] as const).map((a) => {
                    const glyph = a === "left" ? "⬅" : a === "center" ? "↔" : "➡";
                    const label = a === "left" ? "Vlevo" : a === "center" ? "Na střed" : "Vpravo";
                    return (
                      <button
                        key={a}
                        className={`${styles.toolBtn} ${
                          editor?.getAttributes("image").align === a ? styles.toolBtnActive : ""
                        }`}
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
              {MARGIN_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.marginsPreset} ${
                    marginsEqual(margins, p.value) ? styles.marginsPresetActive : ""
                  }`}
                  onClick={() => {
                    setMargins(p.value);
                    setIsDirty(true);
                  }}
                >{p.label}</button>
              ))}
              {(["top", "bottom", "left", "right"] as const).map((side) => {
                const label =
                  side === "top" ? "Nahoře" : side === "bottom" ? "Dole" : side === "left" ? "Vlevo" : "Vpravo";
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
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  applySearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    findNext();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setFindOpen(false);
                    setFindQuery("");
                    setReplaceQuery("");
                    applySearch("");
                  }
                }}
              />
              <input
                className={styles.findInput}
                placeholder="Nahradit za…"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    replaceCurrent();
                  }
                }}
              />
              <button className={styles.findBtn} onClick={findNext} disabled={!findQuery}>Najít další</button>
              <button className={styles.findBtn} onClick={replaceCurrent} disabled={!findQuery}>Nahradit</button>
              <button className={styles.findBtn} onClick={replaceAll} disabled={!findQuery}>Nahradit vše</button>
              <button
                className={styles.findClose}
                onClick={() => {
                  setFindOpen(false);
                  setFindQuery("");
                  setReplaceQuery("");
                  applySearch("");
                }}
                title="Zavřít"
                aria-label="Zavřít vyhledávání"
                type="button"
              >✕</button>
            </div>
          )}

          <div className={styles.editor}>
            {selected ? (
              <div
                className={styles.a4Page}
                style={{
                  paddingTop: `${margins.top}mm`,
                  paddingBottom: `${margins.bottom}mm`,
                  paddingLeft: `${margins.left}mm`,
                  paddingRight: `${margins.right}mm`,
                }}
              >
                {canManage ? (
                  <EditorContent editor={editor} />
                ) : (
                  <div
                    className={styles.previewContent}
                    dangerouslySetInnerHTML={{ __html: readOnlyHtml }}
                  />
                )}
              </div>
            ) : (
              <p className={styles.emptyState}>Vyberte dokument v seznamu vlevo.</p>
            )}
          </div>
        </div>

        {/* Right: custom-variable picker. Document templates have NO built-in
            employee/company variables – only the ten free slots. */}
        {canManage && (
          <aside className={styles.varPanel}>
            <p className={styles.varPanelTitle}>Vlastní proměnné</p>
            <p className={styles.varPanelHint}>Kliknutím vložíte do dokumentu</p>
            <div className={styles.varGroup}>
              {CUSTOM_VAR_KEYS.map((key) => {
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
                onClick={() => setCustomVarsOpen(true)}
                title="Nastavit název a typ použitých vlastních proměnných"
              >
                ⚙ Nastavit…
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Variable-config dialog */}
      {canManage && customVarsOpen && (
        <div className={modalStyles.overlay}>
          <div className={modalStyles.modal} style={{ width: "min(920px, 96vw)", maxWidth: "96vw" }}>
            <div className={`${modalStyles.header} ${styles.modalHeader}`}>
              <h2 className={modalStyles.title}>Vlastní proměnné</h2>
              <IconButton
                aria-label="Zavřít"
                onClick={() => {
                  setVarWarning(customVarWarning(editor?.getHTML() ?? "", variableDefs));
                  setCustomVarsOpen(false);
                }}
              >
                ✕
              </IconButton>
            </div>

            <div className={modalStyles.body}>
              <p style={hintStyle}>
                Název se zobrazí při vyplňování hodnot. Nastavení platí jen pro tento
                dokument – stejná proměnná může mít v jiném dokumentu jiný význam.
                Uloží se spolu s dokumentem.
              </p>
              <p style={hintStyle}>
                <strong>Výchozí hodnota</strong> se předvyplní (a lze ji upravit) při
                vyplňování dokumentu.
              </p>
              <p style={hintStyle}>
                <strong>Nepovinná</strong> proměnná se nemusí vyplnit – v dokumentu se
                pak nevypíše nic. Bez zaškrtnutí je vyplnění povinné. Typ Ano/Ne
                vyplnění nevyžaduje nikdy.
              </p>

              {usedSlots.length === 0 ? (
                <p style={hintStyle}>
                  V dokumentu zatím není použita žádná vlastní proměnná. Vložte ji
                  kliknutím v panelu vpravo (např. <code>{"{{var1}}"}</code>).
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  {/* Each slot occupies exactly one row; on a viewport too narrow
                      for that the table scrolls sideways instead of wrapping. */}
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                    <thead>
                      <tr>
                        <th style={th}>Proměnná</th>
                        <th style={th}>Název (co se zobrazí)</th>
                        <th style={th}>Typ</th>
                        <th style={{ ...th, textAlign: "center" }}>Nepovinná</th>
                        <th style={{ ...th, padding: "0 0 4px 0" }}>Výchozí hodnota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usedSlots.map((key) => {
                        const def = variableDefs[key];
                        const type = (def?.type ?? "text") as DocVarType;
                        // Documents only ever store literal defaults; the
                        // `fixedVar` shape exists in the shared type for
                        // contracts and is never written here.
                        const dflt = def?.default?.kind === "literal" ? def.default : undefined;
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
                                aria-label={`Typ proměnné ${def?.label || key}`}
                                onChange={(e) =>
                                  setDef(key, { type: e.target.value as DocVarType })
                                }
                              >
                                {DOC_VAR_TYPES.map((t) => (
                                  <option key={t} value={t}>{CUSTOM_VAR_TYPE_LABELS[t]}</option>
                                ))}
                              </select>
                            </td>
                            {/* "Nepovinná" only applies to slots that are typed in
                                when the document is filled. A bool is a checkbox –
                                unticked is an answer, not an omission – so it can
                                never be "missing" and shows a dash instead. */}
                            <td style={{ padding: "3px 10px 3px 0", textAlign: "center" }}>
                              {type === "bool" ? (
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
                            <td style={{ padding: "3px 0" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <select
                                  style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                                  value={dflt ? "literal" : "none"}
                                  aria-label={`Výchozí hodnota proměnné ${def?.label || key}`}
                                  onChange={(e) =>
                                    setDef(key, {
                                      default:
                                        e.target.value === "literal"
                                          ? { kind: "literal", value: "" }
                                          : undefined,
                                    })
                                  }
                                >
                                  <option value="none">Žádná</option>
                                  <option value="literal">Pevná hodnota</option>
                                </select>
                                {dflt && (
                                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                                    {renderLiteralDefault(key, type, dflt.value)}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                          {/* Choices live on their own row: they are a variable
                              length list and would blow up the fixed column
                              widths the other four cells rely on. */}
                          {type === "list" && (
                            <tr>
                              <td />
                              <td colSpan={4} style={{ padding: "0 0 10px 0" }}>
                                {renderOptionsEditor(key)}
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

              {orphanedSlots.length > 0 && (
                <p style={{ ...hintStyle, marginTop: 10, marginBottom: 0 }}>
                  Nastavené, ale v textu nepoužité: {orphanedSlots.join(", ")}. Nastavení
                  zůstává uložené pro případ, že proměnnou vrátíte zpět.
                </p>
              )}
            </div>

            <div className={modalStyles.footer}>
              <Button
                variant="primary"
                onClick={() => {
                  // Re-evaluate against what was just entered, so naming the last
                  // slot clears the warning immediately.
                  setVarWarning(customVarWarning(editor?.getHTML() ?? "", variableDefs));
                  setCustomVarsOpen(false);
                }}
              >
                Hotovo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create dialog */}
      {canManage && createModalOpen && (
        <div className={modalStyles.overlay}>
          <div className={modalStyles.modal}>
            <div className={`${modalStyles.header} ${styles.modalHeader}`}>
              <h2 className={modalStyles.title}>
                {duplicateSource ? "Duplikovat dokument" : "Nový dokument"}
              </h2>
              <IconButton
                aria-label="Zavřít"
                disabled={createSaving}
                onClick={closeCreateModal}
              >
                ✕
              </IconButton>
            </div>
            <div className={modalStyles.body}>
              {duplicateSource && (
                <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "0 0 14px" }}>
                  Zkopíruje se obsah dokumentu „{duplicateSource.name}" včetně nastavení
                  vlastních proměnných a okrajů stránky. Zadejte id, název a sekci nového
                  dokumentu.
                  {selected === duplicateSource.id && isDirty && (
                    <>
                      {" "}
                      <strong>Kopíruje se naposledy uložená verze – neuložené změny se do
                      kopie nepřenesou.</strong>
                    </>
                  )}
                </p>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={createLabelStyle}>ID (slug)</label>
                <input
                  type="text"
                  value={createIdDraft}
                  onChange={(e) => setCreateIdDraft(e.target.value)}
                  placeholder="napr. predavaci_protokol"
                  autoFocus
                  style={{ ...createInputStyle, fontFamily: "monospace" }}
                />
                <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                  Malá písmena, číslice a podtržítka. Začíná písmenem.
                </p>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={createLabelStyle}>Název</label>
                <input
                  type="text"
                  value={createNameDraft}
                  onChange={(e) => setCreateNameDraft(e.target.value)}
                  placeholder="napr. Předávací protokol"
                  style={createInputStyle}
                />
              </div>
              <div>
                <label style={createLabelStyle}>Sekce</label>
                <select
                  value={createSectionDraft}
                  onChange={(e) => setCreateSectionDraft(e.target.value as DocumentSectionId | "")}
                  style={createInputStyle}
                >
                  <option value="">Bez sekce – pro všechny</option>
                  {DOCUMENT_SECTIONS.map((sec) => (
                    <option key={sec.id} value={sec.id}>{sec.label}</option>
                  ))}
                </select>
                <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                  Dokument v sekci uvidí jen ti, kdo mají oprávnění pro danou sekci.
                  Bez sekce jej uvidí každý, kdo má přístup do Dokumentů.
                </p>
              </div>
              {createError && (
                <p style={{ fontSize: "0.8125rem", color: "var(--color-danger-text-strong)", marginTop: 10 }}>
                  {createError}
                </p>
              )}
            </div>
            <div className={modalStyles.footer}>
              <Button variant="secondary" onClick={closeCreateModal} disabled={createSaving}>
                Zrušit
              </Button>
              <Button
                variant="primary"
                disabled={createSaving || !createIdDraft.trim() || !createNameDraft.trim()}
                onClick={handleCreate}
              >
                {createSaving
                  ? (duplicateSource ? "Duplikuji…" : "Vytvářím…")
                  : (duplicateSource ? "Duplikovat" : "Vytvořit")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingSwitch && (
        <ConfirmModal
          title="Neuložené změny"
          message="V aktuálním dokumentu máte neuložené změny. Co s nimi?"
          confirmLabel="Uložit a pokračovat"
          tertiary={{ label: "Zahodit změny", onClick: handleDiscardAndSwitch, variant: "danger" }}
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

      {generatingId && (
        <GenerateDocumentModal
          templateId={generatingId}
          onClose={() => setGeneratingId(null)}
        />
      )}
    </div>
  );
}
