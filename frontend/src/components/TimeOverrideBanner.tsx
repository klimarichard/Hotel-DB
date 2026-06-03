import { useEffect, useState } from "react";
import { useTimeOverride } from "@/context/TimeOverrideContext";
import { useAuth } from "@/hooks/useAuth";
import { now as clockNow } from "@/lib/clock";

function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Always-visible bar shown whenever a test-clock override is active, so it's
 * impossible to forget the app is running on a faked clock. Ticks every
 * second (offset mode keeps advancing). Admins get a one-click clear.
 *
 * The amber bar carries its own colours, so it reads correctly in both themes.
 * Renders nothing when no override is active (the normal case, and always in
 * production).
 */
export default function TimeOverrideBanner() {
  const { enabled, clearOverride } = useTimeOverride();
  const { can } = useAuth();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
        background: "#f59e0b",
        color: "#1f2937",
        padding: "0.4rem 1rem",
        fontSize: "0.85rem",
        fontWeight: 500,
        borderBottom: "1px solid #b45309",
      }}
    >
      <span>
        🕒 <strong>Testovací čas:</strong> {fmt(clockNow())}
      </span>
      <span style={{ opacity: 0.75 }}>(reálně {fmt(new Date())})</span>
      {can("system.timeOverride") && (
        <button
          onClick={() => clearOverride()}
          style={{
            marginLeft: "auto",
            background: "#1f2937",
            color: "#f59e0b",
            border: "none",
            borderRadius: "4px",
            padding: "0.2rem 0.6rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Zrušit
        </button>
      )}
    </div>
  );
}
