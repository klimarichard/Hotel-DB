import { useEffect, useRef, useState } from "react";
import { MOD_PERSONS } from "../lib/shiftConstants";
import { useTheme } from "../context/ThemeContext";

const VALID_CODES = Object.keys(MOD_PERSONS);

interface Props {
  code: string;
  readOnly: boolean;
  onSave: (code: string) => Promise<void>;
  focused: boolean;
  onNavigate: (dir: "up" | "down" | "left" | "right") => void;
  onFocus: () => void;
}

export default function ModCell({ code, readOnly, onSave, focused, onNavigate, onFocus }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  // Intentionally excludes `editing` from deps — see ShiftCell for explanation.
  useEffect(() => {
    if (!focused) return;
    if (editing) inputRef.current?.focus();
    else cellRef.current?.focus();
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editing) {
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
  }, [editing]);

  function startEdit() {
    if (readOnly || saving) return;
    setDraft(code);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }

  function isValidDraft(d: string) {
    return d.trim() === "" || VALID_CODES.includes(d.trim().toUpperCase());
  }

  async function commit(value: string) {
    const normalized = value.trim().toUpperCase();
    if (normalized === code) { setEditing(false); return; }
    if (!isValidDraft(normalized)) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(normalized);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Chyba při ukládání");
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  async function commitAndNavigate(value: string, dir: "up" | "down" | "left" | "right") {
    await commit(value);
    onNavigate(dir);
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commit(draft); }
    else if (e.key === "Escape") cancelEdit();
    else if (e.key === "ArrowUp") { e.preventDefault(); commitAndNavigate(draft, "up"); }
    else if (e.key === "ArrowDown") { e.preventDefault(); commitAndNavigate(draft, "down"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); commitAndNavigate(draft, "left"); }
    else if (e.key === "ArrowRight") { e.preventDefault(); commitAndNavigate(draft, "right"); }
    else if (e.key === "Tab") { e.preventDefault(); commitAndNavigate(draft, e.shiftKey ? "left" : "right"); }
  }

  function handleDisplayKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const m: Record<string, "up"|"down"|"left"|"right"> = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right" };
      onNavigate(m[e.key]);
    } else if (e.key === "Tab") { e.preventDefault(); onNavigate(e.shiftKey ? "left" : "right"); }
    else if ((e.key === "Delete" || e.key === "Backspace") && !readOnly && code) {
      e.preventDefault();
      setSaving(true);
      setSaveError(null);
      onSave("").catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Chyba při mazání");
      }).finally(() => setSaving(false));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !readOnly) {
      setDraft(e.key.toUpperCase());
      setEditing(true);
    }
  }

  const { theme } = useTheme();
  const dark = theme === "dark";
  const isInvalid = draft.trim() !== "" && !isValidDraft(draft);

  if (editing) {
    return (
      <input
        ref={inputRef}
        style={{
          width: "100%",
          height: "100%",
          minHeight: "1.75rem",
          border: isInvalid ? "2px solid #dc2626" : "1px solid #3b82f6",
          borderRadius: "3px",
          padding: "2px 4px",
          fontSize: "0.75rem",
          fontFamily: "monospace",
          background: isInvalid ? (dark ? "#450a0a" : "#fef2f2") : (dark ? "#0f172a" : "#fff"),
          color: dark ? "#f1f5f9" : "#111827",
          outline: "none",
          boxSizing: "border-box",
          display: "block",
          textTransform: "uppercase",
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onKeyDown={handleEditKeyDown}
        onBlur={() => commit(draft)}
        title={isInvalid ? `Platné kódy: ${VALID_CODES.join(", ")}` : undefined}
        maxLength={1}
        disabled={saving}
      />
    );
  }

  return (
    <div
      ref={cellRef}
      tabIndex={0}
      style={{
        width: "100%",
        minHeight: "1.75rem",
        background: saveError ? (dark ? "#450a0a" : "#fef2f2") : "transparent",
        color: saveError ? (dark ? "#fca5a5" : "#dc2626") : (dark ? "#c084fc" : "#111827"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.725rem",
        fontWeight: 700,
        cursor: readOnly ? "default" : "pointer",
        borderRadius: "2px",
        userSelect: "none",
        fontFamily: "monospace",
        outline: saveError ? "2px solid #dc2626" : focused ? "2px solid #3b82f6" : "none",
        outlineOffset: "-2px",
      }}
      title={saveError ?? (code ? `${code} — ${MOD_PERSONS[code] ?? ""}` : undefined)}
      onClick={() => { setSaveError(null); startEdit(); }}
      onFocus={onFocus}
      onKeyDown={handleDisplayKeyDown}
    >
      {saveError ? "!" : (code || null)}
    </div>
  );
}
