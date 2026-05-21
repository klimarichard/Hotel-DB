import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, type UserRole } from "@/hooks/useAuth";
import { resolveOrderForRole } from "@/lib/menuItems";
import LoginPage from "@/pages/LoginPage";
import Layout from "@/components/Layout";
import EmployeesPage from "@/pages/EmployeesPage";
import EmployeeDetailPage from "@/pages/EmployeeDetailPage";
import EmployeeFormPage from "@/pages/EmployeeFormPage";
import SettingsPage from "@/pages/SettingsPage";
import PayrollPage from "@/pages/PayrollPage";
import AlertsPage from "@/pages/AlertsPage";
import ContractTemplatesPage from "@/pages/ContractTemplatesPage";
import ShiftPlannerPage from "@/pages/ShiftPlannerPage";
import VacationPage from "@/pages/VacationPage";
import OverviewPage from "@/pages/OverviewPage";
import AuditLogPage from "@/pages/AuditLogPage";
import { AlertsProvider } from "@/context/AlertsContext";
import { ShiftOverridesProvider } from "@/context/ShiftOverridesContext";
import { ShiftChangeRequestsProvider } from "@/context/ShiftChangeRequestsContext";
import { VacationProvider } from "@/context/VacationContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TimeOverrideProvider } from "@/context/TimeOverrideContext";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ allow, children }: { allow: ReadonlyArray<UserRole>; children: React.ReactNode }) {
  const { role, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;
  if (!role || !allow.includes(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Role-aware landing: send each role to the first page it can actually see.
// accountant has no dashboard, so it lands on Zaměstnanci. The fallback must
// itself be a page the role can open, otherwise the landing → guard → "/"
// bounce becomes an infinite redirect loop.
function DefaultRedirect() {
  const { role } = useAuth();
  const target =
    role === "accountant"
      ? "/zamestnanci"
      : (role ? resolveOrderForRole(role, null)[0]?.path : null) ?? "/prehled";
  return <Navigate to={target} replace />;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;

  return (
    <ThemeProvider>
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <TimeOverrideProvider>
              <AlertsProvider>
                <ShiftOverridesProvider>
                  <ShiftChangeRequestsProvider>
                    <VacationProvider>
                      <Layout />
                    </VacationProvider>
                  </ShiftChangeRequestsProvider>
                </ShiftOverridesProvider>
              </AlertsProvider>
            </TimeOverrideProvider>
          </RequireAuth>
        }
      >
        <Route index element={<DefaultRedirect />} />
        <Route path="prehled" element={<RequireRole allow={["admin", "director", "manager", "employee", "hr"]}><OverviewPage /></RequireRole>} />
        <Route path="smeny" element={<RequireRole allow={["admin", "director", "manager", "employee", "hr"]}><ShiftPlannerPage /></RequireRole>} />
        <Route path="dovolena" element={<RequireRole allow={["admin", "director", "manager", "employee", "hr"]}><VacationPage /></RequireRole>} />
        <Route path="zamestnanci" element={<RequireRole allow={["admin", "director", "accountant", "hr"]}><EmployeesPage /></RequireRole>} />
        <Route path="zamestnanci/novy" element={<RequireRole allow={["admin", "director", "hr"]}><EmployeeFormPage /></RequireRole>} />
        <Route path="zamestnanci/:id" element={<RequireRole allow={["admin", "director", "accountant", "hr"]}><EmployeeDetailPage /></RequireRole>} />
        <Route path="zamestnanci/:id/upravit" element={<RequireRole allow={["admin", "director", "hr"]}><EmployeeFormPage /></RequireRole>} />
        <Route path="mzdy" element={<RequireRole allow={["admin", "director"]}><PayrollPage /></RequireRole>} />
        <Route path="smlouvy" element={<RequireRole allow={["admin", "director"]}><ContractTemplatesPage /></RequireRole>} />
        <Route path="upozorneni" element={<RequireRole allow={["admin", "director"]}><AlertsPage /></RequireRole>} />
        <Route path="nastaveni" element={<RequireRole allow={["admin"]}><SettingsPage /></RequireRole>} />
        <Route path="audit" element={<RequireRole allow={["admin", "director"]}><AuditLogPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ThemeProvider>
  );
}
