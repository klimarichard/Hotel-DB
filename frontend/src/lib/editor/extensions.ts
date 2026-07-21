/**
 * Shared TipTap extensions for the app's WYSIWYG document editors.
 *
 * Extracted verbatim from `ContractTemplatesPage.tsx` when the Dokumenty page
 * gained a second editor of the same kind. Both pages configure their own
 * `useEditor(...)` call — only the extension definitions are shared, because
 * they are the part that is genuinely identical and the part where a fix
 * applied to one page but not the other would silently diverge the two
 * editors' output HTML (and therefore their PDFs).
 *
 * Nothing in here knows about contracts, documents, or employees.
 */
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import Image from "@tiptap/extension-image";
import { Table as TableBase } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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
export const Table = TableBase.extend({
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

export const ResizableImage = Image.extend({
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

export const IMAGE_WIDTH_PRESETS: { label: string; value: string }[] = [
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
export const ListItemIndent = Extension.create({
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
export const NbspKeybind = Extension.create({
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
export const LineHeight = Extension.create({
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
 * a div with `page-break-before: always` in the saved HTML so the PDF
 * renderer forces a new page at this point during generation.
 */
export const PageBreak = Node.create({
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
        // `.a4Page [data-page-break]` in the page's module.css).
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
export const PasteCleanup = Extension.create({
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

export interface SearchState {
  query: string;
  decorations: DecorationSet;
}

/** PluginKey shared between the SearchHighlight extension and the toolbar. */
export const searchPluginKey = new PluginKey<SearchState>("search-highlight");

/**
 * Decorates all matches of a search query in the doc. The toolbar mutates
 * the plugin state via meta transactions ({ search: "needle" }). Replace
 * is implemented in the toolbar handler using the editor's command system.
 */
export const SearchHighlight = Extension.create({
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
export const ListItemStyle = Extension.create({
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
export const FontSize = Extension.create({
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

/**
 * Custom Paragraph that renders with CSS tab stops (white-space: pre-wrap +
 * tab-size: 1.27cm). This bakes the styles into every <p> in the stored HTML
 * so tabs align correctly in both the editor and the PDF output.
 * Tab stops are at every 1.27 cm from the left edge (Word's default), so a
 * tab at any position always jumps to the next fixed mark on the line.
 */
export const TabParagraph = Paragraph.extend({
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, {
      style: "white-space:pre-wrap;tab-size:1.27cm;",
    }), 0];
  },
});
