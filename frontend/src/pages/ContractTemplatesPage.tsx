import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import { useAuth } from "@/hooks/useAuth";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  VARIABLE_GROUPS,
} from "@/lib/contractVariables";
import styles from "./ContractTemplatesPage.module.css";

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

function formatTs(ts: { seconds?: number; _seconds?: number } | null | undefined): string {
  if (!ts) return "–";
  const secs = ts.seconds ?? ts._seconds;
  if (secs == null) return "–";
  return new Date(secs * 1000).toLocaleDateString("cs-CZ");
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

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontFamily,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: styles.editorContent,
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

  // Load the selected template's content into the editor
  useEffect(() => {
    if (!editor || !user) return;

    const existing = templates[selected];
    if (!existing) {
      editor.commands.setContent("<p></p>");
      return;
    }

    (async () => {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/contractTemplates/${existing.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const doc: TemplateDoc = await resp.json();
      editor.commands.setContent(doc.htmlContent || "<p></p>");
    })();
  }, [selected, editor, user]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit šablonu"}
          </button>
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
                        {formatTs(meta.updatedAt)}
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
          <EditorContent editor={editor} className={styles.editor} />
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
