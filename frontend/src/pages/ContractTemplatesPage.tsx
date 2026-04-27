import { useState, useEffect, useCallback, useRef, useReducer } from "react";
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
 * state update — the decoration writes class on top of whatever NodeView
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
    return {
      Tab: adjustIndent(1),
      "Shift-Tab": adjustIndent(-1),
    };
  },
});

/** Line-height attribute on TextStyle — toolbar select offers 1.0/1.15/1.5/2.0/3.0. */
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
        style: "page-break-before: always; border-top: 2px dashed #999; margin: 1cm 0; height: 0;",
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

/** Custom FontSize extension — adds fontSize attribute to TextStyle marks. */
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
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  VARIABLE_GROUPS,
} from "@/lib/contractVariables";
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
  variables: string[];
  updatedAt?: { seconds: number } | null;
}

interface TemplateDoc extends TemplateMeta {
  htmlContent: string;
}

export default function ContractTemplatesPage() {
  const { user } = useAuth();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<Record<ContractType, TemplateMeta | null>>(
    {} as Record<ContractType, TemplateMeta | null>
  );
  const [selected, setSelected] = useState<ContractType>(ALL_TYPES[0]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  // Force a rerender on every editor transaction so isActive(...) checks
  // (active toolbar buttons, in-table contextual buttons, etc.) reflect
  // selection changes. TipTap React v3 doesn't subscribe to these by default.
  const [, forceRerender] = useReducer((x: number) => x + 1, 0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      TabParagraph,
      ListItemIndent,
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      LineHeight,
      ListItemStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PageBreak,
      PasteCleanup,
      SearchHighlight,
    ],
    content: "",
    editorProps: {
      attributes: { class: styles.editorContent },
      handleKeyDown(view, event) {
        if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
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

  const fetchTemplates = useCallback(async () => {
    if (!user) return;
    const token = await user.getIdToken();
    const resp = await fetch("/api/contractTemplates", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return;
    const list: TemplateMeta[] = await resp.json();
    const map: Record<ContractType, TemplateMeta | null> = {} as Record<ContractType, TemplateMeta | null>;
    for (const t of ALL_TYPES) map[t] = null;
    for (const t of list) map[t.type] = t;
    setTemplates(map);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => forceRerender();
    editor.on("transaction", handler);
    return () => { editor.off("transaction", handler); };
  }, [editor]);

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
      editor.commands.setContent(doc.htmlContent || "<p></p>");
    })();
  }, [selectedTemplateId, editor, user]);

  function insertVariable(key: string) {
    if (!editor) return;
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
          name: CONTRACT_TYPE_LABELS[selected],
          htmlContent,
        }),
      });

      if (!resp.ok) throw new Error("Save failed");
      setSaveMsg("Uloženo");
      await fetchTemplates();
    } catch {
      setSaveMsg("Chyba při ukládání");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Šablony smluv</h1>
        <div className={styles.headerActions}>
          {saveMsg && (
            <span className={`${styles.saveMsg} ${saveMsg === "Uloženo" ? styles.saveMsgOk : styles.saveMsgErr}`}>
              {saveMsg}
            </span>
          )}
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit šablonu"}
          </Button>
        </div>
      </div>

      <div className={styles.workspace}>
        {/* Left: template list */}
        <aside className={styles.sidebar}>
          {loading ? (
            <p className={styles.loadingText}>Načítám…</p>
          ) : (
            <ul className={styles.templateList}>
              {ALL_TYPES.map((type) => {
                const meta = templates[type];
                return (
                  <li
                    key={type}
                    className={`${styles.templateItem} ${selected === type ? styles.templateItemActive : ""}`}
                    onClick={() => setSelected(type)}
                  >
                    <span className={styles.templateName}>{CONTRACT_TYPE_LABELS[type]}</span>
                    {meta ? (
                      <span className={styles.templateDate}>
                        {formatTimestampCZ(meta.updatedAt)}
                      </span>
                    ) : (
                      <span className={styles.templateEmpty}>Prázdná</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Center: TipTap editor */}
        <div className={styles.editorWrapper}>
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
                // updateAttributes was unreliable here — use setNodeMarkup on
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
            >—</button>

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
          {findOpen && (
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
          <div className={styles.editor}>
            <div className={styles.a4Page}>
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        {/* Right: variable picker */}
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
                  onClick={() => insertVariable(v.key)}
                  title={`{{${v.key}}}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
