import { useEffect, useRef, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { parseShiftExpression, getCellColor, SHIFT_TYPE_TAGS, isPureNumericExpression } from "../lib/shiftConstants";
import { useTheme } from "../context/ThemeContext";

interface Props {
  rawInput: string;
  hoursComputed: number;
  readOnly: boolean;
  onSave: (raw: string) => Promise<void>;
  focused: boolean;
  onNavigate: (dir: "up" | "down" | "left" | "right") => void;
  onFocus: () => void;
  onRequestChange?: () => void;
  /** #29: current shift-type tag on a numeric cell (tally-only). */
  typeTag?: string | null;
  /** #29: set/clear the tag. Undefined → tagging disabled for this cell. */
  onSaveTypeTag?: (typeTag: string | null) => Promise<void>;
}

export default function ShiftCell({
  rawInput,
  hoursComputed,
  readOnly,
  onSave,
  focused,
  onNavigate,
  onFocus,
  onRequestChange,
  typeTag,
  onSaveTypeTag,
}: Props) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  // Normalise before parsing so "DA2" → "DA²" is treated as valid while typing
  const draftNormalized = useMemo(() => draft.replace(/([A-Za-z])2/g, '$1\u00B2'), [draft]);
  const draftParsed = useMemo(() => parseShiftExpression(draftNormalized), [draftNormalized]);
  const displayParsed = useMemo(() => parseShiftExpression(rawInput), [rawInput]);

  // Focus management: when `focused` prop becomes true, focus the cell or input.
  // Intentionally excludes `editing` from deps — adding it would cause the input
  // to be focused synchronously during the keydown→keypress sequence, making the
  // first typed character appear twice.
  useEffect(() => {
    if (!focused) return;
    if (editing) {
      inputRef.current?.focus();
    } else {
      cellRef.current?.focus();
    }
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  // When entering edit mode, focus the input
  useEffect(() => {
    if (editing) {
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
  }, [editing]);

  function startEdit() {
    if (readOnly || saving) return;
    setDraft(rawInput.toUpperCase());
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }

  async function commitEdit() {
    if (draftNormalized === rawInput) {
      setEditing(false);
      return;
    }
    if (draftNormalized.trim() !== "" && !draftParsed.isValid) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draftNormalized);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Chyba při ukládání");
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  async function commitAndNavigate(dir: "up" | "down" | "left" | "right") {
    if (draftNormalized !== rawInput && (draftNormalized.trim() === "" || draftParsed.isValid)) {
      setSaving(true);
      setSaveError(null);
      try {
        await onSave(draftNormalized);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Chyba při ukládání");
      } finally {
        setSaving(false);
        setEditing(false);
      }
    } else {
      setEditing(false);
    }
    onNavigate(dir);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      commitAndNavigate("up");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      commitAndNavigate("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitAndNavigate(e.shiftKey ? "left" : "right");
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      commitAndNavigate("left");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      commitAndNavigate("right");
    }
  }

  function handleDisplayKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit();
    } else if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight"
    ) {
      e.preventDefault();
      const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      onNavigate(dirMap[e.key]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onNavigate(e.shiftKey ? "left" : "right");
    } else if ((e.key === "Delete" || e.key === "Backspace") && !readOnly && rawInput) {
      e.preventDefault();
      setSaving(true);
      setSaveError(null);
      onSave("").catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Chyba při mazání");
      }).finally(() => setSaving(false));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !readOnly) {
      // Start typing directly
      setDraft(e.key.toUpperCase());
      setEditing(true);
    }
  }

  if (editing) {
    const isInvalid = draftNormalized.trim() !== "" && !draftParsed.isValid;
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
          fontSize: "0.85rem",
          fontWeight: 700,
          fontFamily: "monospace",
          background: isInvalid ? (dark ? "#450a0a" : "#fef2f2") : (dark ? "#0f172a" : "#fff"),
          color: dark ? "#f1f5f9" : "#111827",
          outline: "none",
          boxSizing: "border-box",
          display: "block",
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onKeyDown={handleEditKeyDown}
        onBlur={commitEdit}
        title={
          isInvalid
            ? (draftParsed.error ?? "Neplatný výraz")
            : draftParsed.hoursComputed > 0
            ? `${draftParsed.hoursComputed}h`
            : undefined
        }
        disabled={saving}
      />
    );
  }

  // Display mode
  const { bg: bgColor, text: textColor } = getCellColor(displayParsed, dark);

  // Shrink the (monospace) code to fit the ~40px column so long entries like
  // "DPQ+2" never widen the column. ~4 chars fit at 0.85rem; scale down beyond that.
  const displayText = saveError ? "!" : (rawInput || "");
  const fitFontSize = `${Math.max(0.5, Math.min(0.85, 3.4 / (displayText.length || 1))).toFixed(3)}rem`;

  // #29: a numeric "worked hours" cell can be tagged with the shift type it was
  // worked as (counts toward that type in the tally; no pay effect). The tag
  // affordance is shown ONLY to users who can edit shifts in every plan state —
  // i.e. full editors (onSaveTypeTag is passed only to them and readOnly is then
  // false in all states). Read-only viewers and self-service users see nothing.
  const isNumericCell = isPureNumericExpression(displayParsed);
  const tagEditable = !readOnly && !!onSaveTypeTag && isNumericCell;
  const showTag = tagEditable;

  function openTagMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (!tagEditable) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Clamp so the ~184px menu stays on screen.
    const x = Math.min(r.left, window.innerWidth - 192);
    setTagMenu({ x: Math.max(4, x), y: r.bottom + 2 });
  }

  async function pickTag(tag: string | null) {
    setTagMenu(null);
    if (!onSaveTypeTag || tag === (typeTag ?? null)) return;
    try {
      await onSaveTypeTag(tag);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Chyba při ukládání");
    }
  }

  return (
    <div
      ref={cellRef}
      tabIndex={0}
      style={{
        position: "relative",
        width: "100%",
        minHeight: "1.75rem",
        background: saveError ? "#fef2f2" : bgColor,
        color: saveError ? "#dc2626" : textColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        fontSize: fitFontSize,
        fontWeight: 700,
        cursor: readOnly ? (onRequestChange ? "pointer" : "default") : "pointer",
        borderRadius: "2px",
        userSelect: "none",
        padding: "2px",
        fontFamily: "monospace",
        outline: saveError ? "2px solid #dc2626" : focused ? "2px solid #3b82f6" : "none",
        outlineOffset: "-2px",
      }}
      title={saveError ?? (rawInput ? `${rawInput} — ${hoursComputed}h${typeTag ? ` (${typeTag})` : ""}` : undefined)}
      onClick={() => {
        if (readOnly) return;
        setSaveError(null);
        startEdit();
      }}
      onDoubleClick={() => {
        if (readOnly && onRequestChange) {
          onRequestChange();
        }
      }}
      onFocus={onFocus}
      onKeyDown={handleDisplayKeyDown}
    >
      {saveError ? "!" : (rawInput || null)}
      {!saveError && showTag && (
        // Absolutely-positioned corner badge — out of normal flow so the tag
        // never adds to the cell's content width (the 40px column stays fixed
        // regardless of number length, e.g. "10.5", or a 3-letter tag "NPQ").
        <span
          onClick={openTagMenu}
          title={typeTag ? `Typ směny: ${typeTag} — kliknutím změníte` : "Přiřadit typ směny"}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            maxWidth: "100%",
            overflow: "hidden",
            fontSize: "0.5rem",
            fontWeight: 700,
            lineHeight: 1,
            padding: "1px 1px 1px 2px",
            cursor: "pointer",
            opacity: typeTag ? 1 : 0.45,
            color: textColor,
            background: typeTag
              ? (dark ? "rgba(15,23,42,0.72)" : "rgba(255,255,255,0.78)")
              : "transparent",
            borderBottomLeftRadius: "3px",
          }}
        >
          {typeTag ?? "+"}
        </span>
      )}
      {tagMenu &&
        createPortal(
          <>
            <div
              onClick={(e) => { e.stopPropagation(); setTagMenu(null); }}
              style={{ position: "fixed", inset: 0, zIndex: 1200 }}
            />
            <div
              // Portal children bubble React events through the component tree, so
              // without this a click inside the menu would reach the cell's onClick
              // and open the number editor. Keep all menu clicks contained here.
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                left: tagMenu.x,
                top: tagMenu.y,
                zIndex: 1201,
                background: dark ? "#1e293b" : "#fff",
                border: `1px solid ${dark ? "#334155" : "#cbd5e1"}`,
                borderRadius: "6px",
                boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                padding: "6px",
                width: "184px",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "3px" }}>
                {SHIFT_TYPE_TAGS.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => pickTag(t.label)}
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      fontFamily: "monospace",
                      padding: "3px 0",
                      borderRadius: "4px",
                      cursor: "pointer",
                      border: t.label === typeTag ? "1px solid #3b82f6" : `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
                      background: t.label === typeTag ? "#3b82f6" : (dark ? "#0f172a" : "#f8fafc"),
                      color: t.label === typeTag ? "#fff" : (dark ? "#e2e8f0" : "#111827"),
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => pickTag(null)}
                style={{
                  marginTop: "5px",
                  width: "100%",
                  fontSize: "0.7rem",
                  padding: "4px 0",
                  borderRadius: "4px",
                  cursor: "pointer",
                  border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
                  background: dark ? "#0f172a" : "#f8fafc",
                  color: dark ? "#cbd5e1" : "#334155",
                }}
              >
                Bez typu
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
