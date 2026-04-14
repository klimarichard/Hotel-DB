import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import LoginPage from "@/pages/LoginPage";
import Layout from "@/components/Layout";
import EmployeesPage from "@/pages/EmployeesPage";
import EmployeeDetailPage from "@/pages/EmployeeDetailPage";
import EmployeeFormPage from "@/pages/EmployeeFormPage";
import SettingsPage from "@/pages/SettingsPage";
import AlertsPage from "@/pages/AlertsPage";
import ContractTemplatesPage from "@/pages/ContractTemplatesPage";
import ShiftPlannerPage from "@/pages/ShiftPlannerPage";
import VacationPage from "@/pages/VacationPage";
import { AlertsProvider } from "@/context/AlertsContext";
import { ShiftOverridesProvider } from "@/context/ShiftOverridesContext";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading, role } = useAuth();

  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AlertsProvider>
              <ShiftOverridesProvider>
                <Layout />
              </ShiftOverridesProvider>
            </AlertsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to={role === "employee" ? "/smeny" : "/zamestnanci"} replace />} />
        <Route path="zamestnanci" element={<EmployeesPage />} />
        <Route path="zamestnanci/novy" element={<EmployeeFormPage />} />
        <Route path="zamestnanci/:id" element={<EmployeeDetailPage />} />
        <Route path="zamestnanci/:id/upravit" element={<EmployeeFormPage />} />
        <Route path="smlouvy" element={<ContractTemplatesPage />} />
        <Route path="smeny" element={<ShiftPlannerPage />} />
        <Route path="dovolena" element={<VacationPage />} />
        <Route path="mzdy" element={<div>Mzdy — brzy</div>} />
        <Route path="upozorneni" element={<AlertsPage />} />
        <Route path="nastaveni" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
