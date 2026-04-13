import { useEffect, useRef, useMemo, useState } from "react";
import { parseShiftExpression, getCellColor } from "../lib/shiftConstants";

interface Props {
  rawInput: string;
  hoursComputed: number;
  readOnly: boolean;
  onSave: (raw: string) => Promise<void>;
  focused: boolean;
  onNavigate: (dir: "up" | "down" | "left" | "right") => void;
  onFocus: () => void;
}

export default function ShiftCell({
  rawInput,
  hoursComputed,
  readOnly,
  onSave,
  focused,
  onNavigate,
  onFocus,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  const draftParsed = useMemo(() => parseShiftExpression(draft), [draft]);
  const displayParsed = useMemo(() => parseShiftExpression(rawInput), [rawInput]);

  // Focus management: when `focused` prop becomes true, focus the cell or input
  useEffect(() => {
    if (!focused) return;
    if (editing) {
      inputRef.current?.focus();
    } else {
      cellRef.current?.focus();
    }
  }, [focused, editing]);

  // When entering edit mode, focus the input
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

  async function commitAndNavigate(dir: "up" | "down" | "left" | "right") {
    if (draft !== rawInput && (draft.trim() === "" || draftParsed.isValid)) {
      setSaving(true);
      try {
        await onSave(draft);
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
    }
    // ArrowLeft/ArrowRight → default behavior (cursor movement in input)
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
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !readOnly) {
      // Start typing directly
      setDraft(e.key);
      setEditing(true);
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
  const { bg: bgColor, text: textColor } = getCellColor(displayParsed);

  return (
    <div
      ref={cellRef}
      tabIndex={0}
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
        outline: focused ? "2px solid #3b82f6" : "none",
        outlineOffset: "-2px",
      }}
      title={rawInput ? `${rawInput} — ${hoursComputed}h` : undefined}
      onClick={startEdit}
      onFocus={onFocus}
      onKeyDown={handleDisplayKeyDown}
    >
      {rawInput || null}
    </div>
  );
}
