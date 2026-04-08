import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function SettingsPage() {
  const { role } = useAuth();

  if (role !== "admin") return <Navigate to="/" replace />;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.4rem", fontWeight: 700 }}>
        Nastavení
      </h1>
      <p style={{ color: "#6b7280" }}>
        Správa uživatelů, firem a pracovních pozic — bude implementováno v dalším kroku.
      </p>
    </div>
  );
}
