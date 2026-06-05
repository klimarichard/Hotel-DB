import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import type { Permission } from "@/lib/permissions/catalog";
import { resolveOrderByPermission } from "@/lib/menuItems";
import LoginPage from "@/pages/LoginPage";
import Layout from "@/components/Layout";
import EmployeesPage from "@/pages/EmployeesPage";
import EmployeeDetailPage from "@/pages/EmployeeDetailPage";
import EmployeeSelfPage from "@/pages/EmployeeSelfPage";
import EmployeeFormPage from "@/pages/EmployeeFormPage";
import SettingsPage from "@/pages/SettingsPage";
import PayrollPage from "@/pages/PayrollPage";
import AlertsPage from "@/pages/AlertsPage";
import ContractTemplatesPage from "@/pages/ContractTemplatesPage";
import ShiftPlannerPage from "@/pages/ShiftPlannerPage";
import VacationPage from "@/pages/VacationPage";
import OverviewPage from "@/pages/OverviewPage";
import AuditLogPage from "@/pages/AuditLogPage";
import HelpPage from "@/pages/HelpPage";
import TourDemoProfile from "@/pages/TourDemoProfile";
import { AlertsProvider } from "@/context/AlertsContext";
import { ShiftOverridesProvider } from "@/context/ShiftOverridesContext";
import { ShiftChangeRequestsProvider } from "@/context/ShiftChangeRequestsContext";
import { EmployeeChangeRequestsProvider } from "@/context/EmployeeChangeRequestsContext";
import { VacationProvider } from "@/context/VacationContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TimeOverrideProvider } from "@/context/TimeOverrideContext";
import { OnboardingProvider } from "@/context/OnboardingContext";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Permission-gated route. Passes if the caller has ANY of the listed
// permissions (system.admin satisfies all via can()). Mirrors the backend
// requirePermission gate; the backend still enforces independently.
function RequirePermission({ allow, children }: { allow: ReadonlyArray<Permission>; children: React.ReactNode }) {
  const { can, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;
  if (!allow.some((p) => can(p))) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Permission-aware landing: send the user to the first page they can actually
// see (their first visible menu item). The fallback must itself be a page the
// user can open, otherwise the landing → guard → "/" bounce becomes an
// infinite redirect loop. Every role holds nav.dashboard.view, so /prehled is
// a safe fallback.
function DefaultRedirect() {
  const { can } = useAuth();
  const target = resolveOrderByPermission(can, null)[0]?.path ?? "/prehled";
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
            <OnboardingProvider>
              <TimeOverrideProvider>
                <AlertsProvider>
                  <ShiftOverridesProvider>
                    <ShiftChangeRequestsProvider>
                      <EmployeeChangeRequestsProvider>
                        <VacationProvider>
                          <Layout />
                        </VacationProvider>
                      </EmployeeChangeRequestsProvider>
                    </ShiftChangeRequestsProvider>
                  </ShiftOverridesProvider>
                </AlertsProvider>
              </TimeOverrideProvider>
            </OnboardingProvider>
          </RequireAuth>
        }
      >
        <Route index element={<DefaultRedirect />} />
        <Route path="prehled" element={<RequirePermission allow={["nav.dashboard.view"]}><OverviewPage /></RequirePermission>} />
        <Route path="smeny" element={<RequirePermission allow={["nav.shifts.view"]}><ShiftPlannerPage /></RequirePermission>} />
        <Route path="dovolena" element={<RequirePermission allow={["nav.vacation.view"]}><VacationPage /></RequirePermission>} />
        <Route path="zamestnanci" element={<RequirePermission allow={["nav.employees.view"]}><EmployeesPage /></RequirePermission>} />
        <Route path="zamestnanci/novy" element={<RequirePermission allow={["employees.create"]}><EmployeeFormPage /></RequirePermission>} />
        <Route path="zamestnanci/:id" element={<RequirePermission allow={["nav.employees.view"]}><EmployeeDetailPage /></RequirePermission>} />
        <Route path="zamestnanci/:id/upravit" element={<RequirePermission allow={["employees.edit"]}><EmployeeFormPage /></RequirePermission>} />
        <Route path="muj-profil" element={<RequirePermission allow={["nav.profile.view"]}><EmployeeSelfPage /></RequirePermission>} />
        <Route path="mzdy" element={<RequirePermission allow={["nav.payroll.view"]}><PayrollPage /></RequirePermission>} />
        <Route path="smlouvy" element={<RequirePermission allow={["nav.contractTemplates.view"]}><ContractTemplatesPage /></RequirePermission>} />
        <Route path="upozorneni" element={<RequirePermission allow={["nav.alerts.view"]}><AlertsPage /></RequirePermission>} />
        <Route path="nastaveni" element={<RequirePermission allow={["nav.settings.view"]}><SettingsPage /></RequirePermission>} />
        <Route path="audit" element={<RequirePermission allow={["nav.audit.view"]}><AuditLogPage /></RequirePermission>} />
        {/* Help is available to every authenticated user — no permission gate. */}
        <Route path="napoveda" element={<HelpPage />} />
        {/* Tour-only demo profile (inert dummy data) — no permission gate. */}
        <Route path="napoveda/ukazka" element={<TourDemoProfile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ThemeProvider>
  );
}
