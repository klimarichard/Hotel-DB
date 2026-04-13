import { useEffect, useRef, useMemo, useState } from "react";
import { parseShiftExpression, SHIFT_COLORS, SHIFT_TEXT_COLORS } from "../lib/shiftConstants";

interface Props {
  rawInput: string;
  hoursComputed: number;
  readOnly: boolean;
  onSave: (raw: string) => Promise<void>;
}

export default function ShiftCell({ rawInput, hoursComputed, readOnly, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const draftParsed = useMemo(() => parseShiftExpression(draft), [draft]);
  const displayParsed = useMemo(() => parseShiftExpression(rawInput), [rawInput]);

  useEffect(() => {
    if (editing) {
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
  }, [editing]);

  function startEdit() {
    if (readOnly || saving) return;
    setDraft(rawInput);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }

  async function commitEdit() {
    if (draft === rawInput) {
      setEditing(false);
      return;
    }
    // If invalid (and non-empty), stay in edit mode
    if (draft.trim() !== "" && !draftParsed.isValid) {
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  if (editing) {
    const isInvalid = draft.trim() !== "" && !draftParsed.isValid;
    return (
      <input
        ref={inputRef}
        style={{
          width: "100%",
          height: "100%",
          minHeight: "2rem",
          border: isInvalid ? "2px solid #dc2626" : "1px solid #3b82f6",
          borderRadius: "3px",
          padding: "2px 4px",
          fontSize: "0.8125rem",
          fontFamily: "monospace",
          background: isInvalid ? "#fef2f2" : "#fff",
          outline: "none",
          boxSizing: "border-box",
          display: "block",
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
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
  const firstCode = displayParsed.segments[0]?.code ?? "";
  const bgColor = firstCode ? (SHIFT_COLORS[firstCode] ?? "transparent") : "transparent";
  const textColor = firstCode ? (SHIFT_TEXT_COLORS[firstCode] ?? "#374151") : "#374151";

  return (
    <div
      style={{
        width: "100%",
        minHeight: "2rem",
        background: bgColor,
        color: textColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.8rem",
        fontWeight: 500,
        cursor: readOnly ? "default" : "pointer",
        borderRadius: "2px",
        userSelect: "none",
        padding: "2px",
        fontFamily: "monospace",
      }}
      title={rawInput ? `${rawInput} — ${hoursComputed}h` : undefined}
      onClick={startEdit}
    >
      {rawInput || null}
    </div>
  );
}
