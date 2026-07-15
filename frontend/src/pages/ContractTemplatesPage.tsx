import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import Button from "@/components/Button";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import { Table as TableBase } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";

/**
 * Table extended with a `borderless` attribute. The base @tiptap/extension-table
 * registers a NodeView for column resizing that owns the live <table> DOM
 * element, so neither addAttributes' renderHTML nor an extension-level
 * renderHTML override can write a class onto it. Instead, we apply the
 * `hpm-borderless` class via a ProseMirror Decoration that runs on every
 * state update – the decoration writes class on top of whatever NodeView
 * rendered the table, which is exactly what we want.
 *
 * parseHTML on the attribute keeps save/reload round-trips working: when
 * the editor loads HTML containing <table class="hpm-borderless">, the
 * attribute is restored to true.
 */
const Table = TableBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderless: {
        default: false,
        parseHTML: (el) => el.classList.contains("hpm-borderless"),
        renderHTML: (attrs) =>
          attrs.borderless ? { class: "hpm-borderless" } : {},
      },
    };
  },
  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? [];
    return [
      ...parent,
      new Plugin({
        key: new PluginKey("table-borderless-class"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === "table" && node.attrs.borderless) {
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: "hpm-borderless" })
                );
              }
              return undefined;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const styleW = (el as HTMLElement).style.width;
          if (styleW) return styleW;
          return (el as HTMLElement).getAttribute("width") || null;
        },
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}` } : {}),
      },
      align: {
        default: null,
        parseHTML: (el) => {
          const ml = (el as HTMLElement).style.marginLeft;
          const mr = (el as HTMLElement).style.marginRight;
          if (ml === "auto" && mr === "auto") return "center";
          if (ml === "auto" && mr !== "auto") return "right";
          if ((ml === "0px" || ml === "0") && mr === "auto") return "left";
          return null;
        },
        renderHTML: (attrs) => {
          if (!attrs.align) return {};
          if (attrs.align === "center") return { style: "display: block; margin-left: auto; margin-right: auto" };
          if (attrs.align === "right") return { style: "display: block; margin-left: auto; margin-right: 0" };
          if (attrs.align === "left") return { style: "display: block; margin-left: 0; margin-right: auto" };
          return {};
        },
      },
    };
  },
});

const IMAGE_WIDTH_PRESETS: { label: string; value: string }[] = [
  { label: "25%", value: "25%" },
  { label: "50%", value: "50%" },
  { label: "75%", value: "75%" },
  { label: "100%", value: "100%" },
];

const TAB_STOP = 1.27; // cm

/**
 * Adds margin-left indentation to list items on Tab/Shift-Tab.
 * Uses addGlobalAttributes to register the style attribute on listItem,
 * and addKeyboardShortcuts (with high priority) to handle Tab/Shift-Tab
 * using this.editor so TipTap's command system applies the change correctly.
 * handleKeyDown in editorProps returns false for list items so this runs.
 */
const ListItemIndent = Extension.create({
  name: "listItemIndent",
  priority: 200,
  addGlobalAttributes() {
    // Register style attribute on both list types AND listItem so the
    // stored HTML carries the margin-left on the <ul>/<ol> element.
    return [{
      types: ["bulletList", "orderedList"],
      attributes: {
        style: {
          default: null,
          parseHTML: (el) => el.getAttribute("style") || null,
          renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
        },
      },
    }];
  },
  addKeyboardShortcuts() {
    const adjustIndent = (dir: 1 | -1) => (): boolean => {
      const { state, view } = this.editor;
      const { $from } = state.selection;

      // Find the nearest bulletList or orderedList ancestor.
      // Indenting the <ul>/<ol> moves the entire list (bullets + text)
      // because both live inside that element.
      let listDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === "bulletList" || name === "orderedList") { listDepth = d; break; }
      }
      if (listDepth < 0) return false;

      const node = $from.node(listDepth);
      const pos = $from.before(listDepth);
      const currentStyle: string = node.attrs.style ?? "";
      const match = currentStyle.match(/margin-left:\s*([\d.]+)cm/);
      const current = match ? parseFloat(match[1]) : 0;
      const next = Math.max(0, +(current + dir * TAB_STOP).toFixed(4));
      const stripped = currentStyle.replace(/margin-left:[^;]*;?\s*/g, "").trim();
      const newStyle = next > 0
        ? `margin-left:${next}cm${stripped ? "; " + stripped : ""}`
        : stripped || null;

      view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, style: newStyle }));
      return true;
    };

    // Tab inside a list item with the caret past the start of the row inserts
    // a literal \t character into the paragraph, leaving the bullet/number and
    // any text to the left of the caret in place. The paragraph already has
    // `tab-size: 1.27cm` from TabParagraph so the tab paints the same gap as
    // outside lists.
    const insertTabOrIndent = (): boolean => {
      const { state, view } = this.editor;
      const { $from, empty } = state.selection;
      let listItemDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "listItem") { listItemDepth = d; break; }
      }
      const atRowStart =
        listItemDepth >= 0 &&
        empty &&
        $from.parentOffset === 0 &&
        $from.index(listItemDepth) === 0;
      if (atRowStart) return adjustIndent(1)();
      if (listItemDepth >= 0) {
        view.dispatch(state.tr.insertText("\t").scrollIntoView());
        return true;
      }
      return false;
    };

    return {
      Tab: insertTabOrIndent,
      "Shift-Tab": adjustIndent(-1),
    };
  },
});

/**
 * Ctrl+Shift+Space inserts a non-breaking space (U+00A0). Matches the MS
 * Word keybind. Czech typography uses nbsp after one-letter prepositions
 * (v, k, z, s, o, u) and between number + unit; templates need it
 * frequently.
 */
const NbspKeybind = Extension.create({
  name: "nbspKeybind",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-Space": () => {
        const { state, view } = this.editor;
        view.dispatch(state.tr.insertText(" ").scrollIntoView());
        return true;
      },
    };
  },
});

/** Line-height attribute on TextStyle – toolbar select offers 1.0/1.15/1.5/2.0/3.0. */
const LineHeight = Extension.create({
  name: "lineHeight",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => el.style.lineHeight || null,
          renderHTML: (attrs) => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setLineHeight: (value: string) => ({ chain }: any) =>
        chain().updateAttributes("paragraph", { lineHeight: value })
          .updateAttributes("heading", { lineHeight: value })
          .run(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unsetLineHeight: () => ({ chain }: any) =>
        chain().updateAttributes("paragraph", { lineHeight: null })
          .updateAttributes("heading", { lineHeight: null })
          .run(),
    };
  },
});

/**
 * Page-break block node. Renders as a dashed divider in the editor and as
 * a div with `page-break-before: always` in the saved HTML so html2pdf
 * forces a new page at this point during PDF generation.
 */
const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-break": "true",
        // Only the structural bits live in the saved HTML so the PDF
        // renderer doesn't paint a dashed line on the page. The visual
        // dashed divider is added by editor-only CSS (see
        // `.a4Page [data-page-break]` in ContractTemplatesPage.module.css).
        style: "page-break-before: always; height: 0;",
        "aria-label": "Konec stránky",
      }),
    ];
  },
});

/**
 * Strip Microsoft Word noise from clipboard HTML: <o:p>, MsoNormal classes,
 * and `mso-*` inline styles. Without this, pasting from Word brings in
 * fragments like <p class="MsoNormal" style="mso-margin-top-alt:auto;…">
 * that bloat the document and bias subsequent edits.
 */
const PasteCleanup = Extension.create({
  name: "pasteCleanup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("paste-cleanup"),
        props: {
          transformPastedHTML(html: string) {
            if (!/MsoNormal|mso-|<o:p|class="?Mso/i.test(html)) return html;
            return html
              // Drop Word's empty <o:p> tags entirely.
              .replace(/<o:p>[\s\S]*?<\/o:p>/g, "")
              .replace(/<\/?o:p[^>]*>/g, "")
              // Strip mso-* declarations from inline styles.
              .replace(/(style="[^"]*?)mso-[^:]+:[^;"]+;?\s*/gi, "$1")
              .replace(/style=""/gi, "")
              // Strip MsoNormal/MsoListParagraph etc. class names.
              .replace(/class="?Mso[A-Za-z0-9]*"?/gi, "")
              // Word often wraps in <html><body><!--StartFragment-->.
              .replace(/<!--StartFragment-->|<!--EndFragment-->/g, "")
              // Drop <font> tags Word's clipboard inserts (preserving text).
              .replace(/<\/?font[^>]*>/gi, "");
          },
        },
      }),
    ];
  },
});

/** PluginKey shared between the SearchHighlight extension and the toolbar. */
const searchPluginKey = new PluginKey<SearchState>("search-highlight");
interface SearchState {
  query: string;
  decorations: DecorationSet;
}

/**
 * Decorates all matches of a search query in the doc. The toolbar mutates
 * the plugin state via meta transactions ({ search: "needle" }). Replace
 * is implemented in the toolbar handler using the editor's command system.
 */
const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: () => ({ query: "", decorations: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(searchPluginKey) as { query?: string } | undefined;
            const query = meta?.query ?? prev.query;
            if (!query) return { query, decorations: DecorationSet.empty };
            // Re-decorate when doc changed, query changed, or selection moved over a match
            const decorations: Decoration[] = [];
            const lower = query.toLowerCase();
            tr.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              const text = node.text.toLowerCase();
              let from = 0;
              while (true) {
                const idx = text.indexOf(lower, from);
                if (idx === -1) break;
                decorations.push(
                  Decoration.inline(pos + idx, pos + idx + query.length, {
                    class: "tt-search-hit",
                  })
                );
                from = idx + query.length;
              }
            });
            return { query, decorations: DecorationSet.create(tr.doc, decorations) };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

/**
 * Adds a `style` attribute to `listItem` so we can persist `font-size`
 * directly on the <li>. The browser renders `::marker` (the "1." / "•")
 * using the LI's font-size, not the inline marks inside the paragraph,
 * so without this the marker stays at the editor default no matter how
 * the user formats the item's text. The FontSize dropdown handler updates
 * this attribute alongside the textStyle mark when the cursor is in a list.
 */
const ListItemStyle = Extension.create({
  name: "listItemStyle",
  addGlobalAttributes() {
    return [{
      types: ["listItem"],
      attributes: {
        style: {
          default: null,
          parseHTML: (el) => el.getAttribute("style") || null,
          renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
        },
      },
    }];
  },
});

/** Custom FontSize extension – adds fontSize attribute to TextStyle marks. */
const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize || null,
          renderHTML: (attrs) => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark("textStyle", { fontSize: size }).run(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unsetFontSize: () => ({ chain }: any) =>
        chain().setMark("textStyle", { fontSize: null }).run(),
    };
  },
});
import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "@/components/ConfirmModal";
import modalStyles from "@/components/ConfirmModal.module.css";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  VARIABLE_GROUPS,
  CUSTOM_VAR_KEYS,
  CUSTOM_VAR_TYPE_LABELS,
  usedCustomVars,
  fillTemplate,
  COMPARABLE_VARS,
  COMPARE_OP_LABELS,
  type CustomVarDefs,
  type CustomVarType,
  type CustomVarDefault,
  type CompareOp,
  type CustomVarCondition,
} from "@/lib/contractVariables";
import {
  buildPreviewVars,
  defaultBools,
  usedConditionals,
  usedConditionOperands,
  PREVIEW_RAW_DEFAULTS,
  CONDITIONAL_LABELS,
} from "@/lib/templatePreview";
import { formatTimestampCZ } from "@/lib/dateFormat";
import styles from "./ContractTemplatesPage.module.css";

/**
 * Custom Paragraph that renders with CSS tab stops (white-space: pre-wrap +
 * tab-size: 1.27cm). This bakes the styles into every <p> in the stored HTML
 * so tabs align correctly in both the editor and the html2pdf PDF output.
 * Tab stops are at every 1.27 cm from the left edge (Word's default), so a
 * tab at any position always jumps to the next fixed mark on the line.
 */
const TabParagraph = Paragraph.extend({
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, {
      style: "white-space:pre-wrap;tab-size:1.27cm;",
    }), 0];
  },
});

const ALL_TYPES = Object.keys(CONTRACT_TYPE_LABELS) as ContractType[];

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
  const unnamed = usedCustomVars(html).filter((k) => !defs[k]?.label?.trim());
  if (unnamed.length === 0) return null;
  // One line — the fuller explanation lives in the button's tooltip.
  return `Bez nastavení: ${unnamed.join(", ")} – chybí název a typ.`;
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
    return fillTemplate(html, buildPreviewVars(html, variableDefs, previewBools, previewRaw));
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
      const filled = fillTemplate(html, buildPreviewVars(html, variableDefs, previewBools, previewRaw));
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
            <Button variant="primary" onClick={handleSave} disabled={saving || !isDirty}>
              <span className={styles.saveBtnInner}>
                <SaveIcon />
                {saving ? "Ukládám…" : "Uložit šablonu"}
              </span>
            </Button>
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

          {/* Ten free slots this template configures itself. A slot shows its
              configured label once it has one, otherwise the bare {{varN}}. */}
          <div className={styles.varGroup}>
            <p className={styles.varGroupLabel}>Vlastní proměnné</p>
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

      {canManage && customVarsOpen && editor && (() => {
        // Which slots this template actually uses, read straight from the live
        // editor content — so a slot appears here the moment it is inserted and
        // disappears when deleted, with no bookkeeping.
        const used = usedCustomVars(editor.getHTML());
        // Slots configured earlier whose placeholder is no longer in the text.
        // Their config is kept (harmless, and lets an accidental deletion be
        // undone) but flagged, so the list can't quietly rot.
        const orphaned = Object.keys(variableDefs).filter((k) => !used.includes(k));

        const setDef = (
          key: string,
          patch: Partial<{
            label: string;
            type: CustomVarType;
            default: CustomVarDefault | undefined;
            condition: CustomVarCondition | undefined;
          }>
        ) => {
          setVariableDefs((prev) => {
            const prevDef = prev[key];
            // Changing the type can invalidate an existing default/condition (a
            // literal date for a now-number slot, a condition on a text slot), so
            // drop both unless the same patch re-supplies them.
            const typeChanged = patch.type !== undefined && patch.type !== prevDef?.type;
            const nextDefault =
              "default" in patch ? patch.default : typeChanged ? undefined : prevDef?.default;
            const nextCondition =
              "condition" in patch ? patch.condition : typeChanged ? undefined : prevDef?.condition;
            return {
              ...prev,
              [key]: {
                label: patch.label ?? prevDef?.label ?? "",
                type: patch.type ?? prevDef?.type ?? "text",
                // Omit when absent so we never persist `default/condition: undefined`.
                ...(nextDefault ? { default: nextDefault } : {}),
                ...(nextCondition ? { condition: nextCondition } : {}),
              },
            };
          });
          setIsDirty(true);
        };

        // Comparable variables of a given raw type (date / number), for the
        // condition builder's operand dropdowns.
        const comparableOf = (t: "date" | "number") => COMPARABLE_VARS.filter((v) => v.type === t);
        const leftType = (cond: CustomVarCondition | undefined) =>
          COMPARABLE_VARS.find((v) => v.key === cond?.leftKey)?.type ?? "date";
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
          const setCond = (next: CustomVarCondition) => setDef(key, { condition: next });
          const opt = (v: { key: string; label: string }) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          );
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <select
                style={{ ...fieldStyle, width: "auto", flex: "1 1 130px", minWidth: 0 }}
                value={c.leftKey}
                onChange={(e) => {
                  const newLeft = e.target.value;
                  const newType = COMPARABLE_VARS.find((v) => v.key === newLeft)?.type ?? "date";
                  // Keep the right operand only if it stays type-compatible; a now
                  // mismatched variable operand resets to an empty literal.
                  const rightVarKey = c.right.kind === "var" ? c.right.key : null;
                  const rightStillOk =
                    rightVarKey === null ||
                    COMPARABLE_VARS.find((v) => v.key === rightVarKey)?.type === newType;
                  setCond({
                    leftKey: newLeft,
                    op: c.op,
                    right: rightStillOk ? c.right : { kind: "literal", value: "" },
                  });
                }}
              >
                {COMPARABLE_VARS.map(opt)}
              </select>
              <select
                style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                value={c.op}
                onChange={(e) => setCond({ ...c, op: e.target.value as CompareOp })}
              >
                {(Object.keys(COMPARE_OP_LABELS) as CompareOp[]).map((op) => (
                  <option key={op} value={op}>{COMPARE_OP_LABELS[op]}</option>
                ))}
              </select>
              <select
                style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
                value={c.right.kind}
                onChange={(e) => {
                  const kind = e.target.value as "var" | "literal";
                  if (kind === "var") {
                    const first = comparableOf(lt).find((v) => v.key !== c.leftKey) ?? comparableOf(lt)[0];
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
                  {comparableOf(lt).filter((v) => v.key !== c.leftKey).map(opt)}
                </select>
              ) : (
                <input
                  type={lt === "date" ? "date" : "number"}
                  style={{ ...fieldStyle, width: "auto", flex: "1 1 110px", minWidth: 0 }}
                  value={c.right.value}
                  onChange={(e) => setCond({ ...c, right: { kind: "literal", value: e.target.value } })}
                />
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
        // Render the literal-value input matching a slot's type.
        const renderLiteralDefault = (key: string, type: CustomVarType, value: string) => {
          const set = (v: string) => setDef(key, { default: { kind: "literal", value: v } });
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
            <div className={modalStyles.modal} style={{ width: "min(880px, 96vw)", maxWidth: "96vw" }}>
              <div className={modalStyles.header}>
                <h2 className={modalStyles.title}>Vlastní proměnné</h2>
              </div>

              <div className={modalStyles.body}>
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
                  Typ <strong>Podmínka</strong> proměnnou nevyplňujete – její hodnota
                  (Ano/Ne) se <strong>vypočítá</strong> z porovnání dvou hodnot
                  (např. <em>Datum podpisu &lt; Datum nástupu</em>). Používá se stejně
                  jako Ano/Ne v blocích <code>{"{{#if var1}}…{{/if}}"}</code> /{" "}
                  <code>{"{{#unless var1}}…{{/unless}}"}</code>.
                </p>

                {used.length === 0 ? (
                  <p style={hintStyle}>
                    V šabloně zatím není použita žádná vlastní proměnná. Vložte ji
                    kliknutím v panelu vpravo (např. <code>{"{{var1}}"}</code>).
                  </p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 6px 4px 0" }}>Proměnná</th>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 6px 4px 0" }}>Název (co se zobrazí)</th>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 10px 4px 0" }}>Typ</th>
                        <th style={{ textAlign: "left", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 0 4px 0" }}>Výchozí hodnota / podmínka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {used.map((key) => {
                        const def = variableDefs[key];
                        const type = def?.type ?? "text";
                        const dflt = def?.default;
                        const source = dflt?.kind ?? "none";
                        return (
                          <tr key={key}>
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
                            {/* A "condition" slot shows the comparison builder;
                                every other type shows its default-value control
                                (pre-filled + editable at generation, shown in the
                                preview). */}
                            <td style={{ padding: "3px 0" }}>
                              {type === "condition" ? (
                                renderConditionBuilder(key, def?.condition)
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
                                    <option value="fixedVar">Z proměnné</option>
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
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {orphaned.length > 0 && (
                  <p style={{ ...hintStyle, marginTop: 10, marginBottom: 0 }}>
                    Nastavené, ale v textu nepoužité: {orphaned.join(", ")}. Nastavení
                    zůstává uložené pro případ, že proměnnou vrátíte zpět.
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
