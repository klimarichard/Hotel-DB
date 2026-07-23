import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsPhone } from "@/hooks/useIsPhone";
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
import DokumentyPage from "@/pages/DokumentyPage";
import FakturyPage from "@/pages/FakturyPage";
import ShiftPlannerPage from "@/pages/ShiftPlannerPage";
import VacationPage from "@/pages/VacationPage";
import RecepcePage from "@/pages/RecepcePage";
import TabulkyPage from "@/pages/TabulkyPage";
import RecepceSummaryPage from "@/pages/RecepceSummaryPage";
import RecepceSummaryAdminPage from "@/pages/RecepceSummaryAdminPage";
import RecepceDemoPage from "@/pages/RecepceDemoPage";
import OverviewPage from "@/pages/OverviewPage";
import AuditLogPage from "@/pages/AuditLogPage";
import GuidesPage from "@/pages/GuidesPage";
import HelpPage from "@/pages/HelpPage";
import TourDemoRoute from "@/pages/TourDemoRoute";
import { AlertsProvider } from "@/context/AlertsContext";
import { ShiftOverridesProvider } from "@/context/ShiftOverridesContext";
import { ShiftChangeRequestsProvider } from "@/context/ShiftChangeRequestsContext";
import { EmployeeChangeRequestsProvider } from "@/context/EmployeeChangeRequestsContext";
import { SelfDocAlertsProvider } from "@/context/SelfDocAlertsContext";
import { VacationProvider } from "@/context/VacationContext";
import { HandoverWarningsProvider } from "@/context/HandoverWarningsContext";
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
function RequirePermission({
  allow,
  mobileAllow,
  children,
}: {
  allow: ReadonlyArray<Permission>;
  /** Extra permission required only on a phone (ANDed with `allow`). Desktop is
   *  unaffected. Redirects home on a phone when the user lacks it. */
  mobileAllow?: Permission;
  children: React.ReactNode;
}) {
  const { can, loading } = useAuth();
  const isPhone = useIsPhone();
  if (loading) return <div style={{ padding: "2rem" }}>Načítám...</div>;
  if (!allow.some((p) => can(p))) return <Navigate to="/" replace />;
  if (isPhone && mobileAllow && !can(mobileAllow)) return <Navigate to="/" replace />;
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
                        <SelfDocAlertsProvider>
                          <VacationProvider>
                            <HandoverWarningsProvider>
                              <Layout />
                            </HandoverWarningsProvider>
                          </VacationProvider>
                        </SelfDocAlertsProvider>
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
        <Route path="recepce" element={<RequirePermission allow={["nav.recepce.view"]} mobileAllow="recepce.mobile.view"><RecepcePage /></RequirePermission>} />
        <Route path="recepce/:hotel" element={<RequirePermission allow={["nav.recepce.view"]} mobileAllow="recepce.mobile.view"><RecepcePage /></RequirePermission>} />
        <Route path="recepce/:hotel/:tab" element={<RequirePermission allow={["nav.recepce.view"]} mobileAllow="recepce.mobile.view"><RecepcePage /></RequirePermission>} />
        {/* Tabulky – one Route per URL arity, same as Recepce above. */}
        <Route path="tabulky" element={<RequirePermission allow={["nav.tabulky.view"]}><TabulkyPage /></RequirePermission>} />
        <Route path="tabulky/:tab" element={<RequirePermission allow={["nav.tabulky.view"]}><TabulkyPage /></RequirePermission>} />
        {/* Unlisted (no sidebar entry) – reachable only by typing the address.
            Still gated by recepce.summary.view; obscurity is not the gate.
            `/4d/admin` sets the pass-key (kept off the Settings page so no tab
            hints at the page's existence); it is intentionally NOT behind the
            pass-key itself, or the first key could never be set. */}
        <Route path="4d" element={<RequirePermission allow={["recepce.summary.view"]}><RecepceSummaryPage /></RequirePermission>} />
        <Route path="4d/admin" element={<RequirePermission allow={["recepce.summary.view"]}><RecepceSummaryAdminPage /></RequirePermission>} />
        <Route path="zamestnanci" element={<RequirePermission allow={["nav.employees.view"]}><EmployeesPage /></RequirePermission>} />
        <Route path="zamestnanci/novy" element={<RequirePermission allow={["employees.create"]}><EmployeeFormPage /></RequirePermission>} />
        <Route path="zamestnanci/:id" element={<RequirePermission allow={["nav.employees.view"]}><EmployeeDetailPage /></RequirePermission>} />
        <Route path="zamestnanci/:id/upravit" element={<RequirePermission allow={["employees.edit"]}><EmployeeFormPage /></RequirePermission>} />
        <Route path="muj-profil" element={<RequirePermission allow={["nav.profile.view"]}><EmployeeSelfPage /></RequirePermission>} />
        <Route path="mzdy" element={<RequirePermission allow={["nav.payroll.view"]}><PayrollPage /></RequirePermission>} />
        <Route path="smlouvy" element={<RequirePermission allow={["nav.contractTemplates.view"]}><ContractTemplatesPage /></RequirePermission>} />
        <Route path="dokumenty" element={<RequirePermission allow={["nav.dokumenty.view"]}><DokumentyPage /></RequirePermission>} />
        <Route path="faktury" element={<RequirePermission allow={["nav.faktury.view"]}><FakturyPage /></RequirePermission>} />
        <Route path="upozorneni" element={<RequirePermission allow={["nav.alerts.view"]}><AlertsPage /></RequirePermission>} />
        <Route path="nastaveni" element={<RequirePermission allow={["nav.settings.view"]}><SettingsPage /></RequirePermission>} />
        <Route path="audit" element={<RequirePermission allow={["nav.audit.view"]}><AuditLogPage /></RequirePermission>} />
        <Route path="navody" element={<RequirePermission allow={["nav.guides.view"]}><GuidesPage /></RequirePermission>} />
        {/* Help is available to every authenticated user – no permission gate. */}
        <Route path="napoveda" element={<HelpPage />} />
        {/* Tour-only demo routes – REAL pages fed by mock data (no backend).
            The employee-detail demo reuses the real /zamestnanci/:id route with
            the sentinel id "tour-demo" (no separate route needed). */}
        {/* `key` forces a remount (and thus a re-fetch of the mock data) when the
            tour navigates between demo routes that render the same page component
            – e.g. shifts opened → published, or payroll period → empty. Without it
            React reuses the instance and the page keeps its first-loaded state. */}
        <Route path="napoveda/ukazka-profil" element={<TourDemoRoute scenario="self"><EmployeeSelfPage key="demo-self" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-mzdy" element={<TourDemoRoute scenario="payroll"><PayrollPage key="demo-payroll" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-mzdy-prazdne" element={<TourDemoRoute scenario="payroll-empty"><PayrollPage key="demo-payroll-empty" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-smeny" element={<TourDemoRoute scenario="shifts"><ShiftPlannerPage key="demo-shifts" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-smeny-prazdne" element={<TourDemoRoute scenario="shifts-empty"><ShiftPlannerPage key="demo-shifts-empty" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-smeny-vytvoreny" element={<TourDemoRoute scenario="shifts-created"><ShiftPlannerPage key="demo-shifts-created" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-smeny-publikovane" element={<TourDemoRoute scenario="shifts-published"><ShiftPlannerPage key="demo-shifts-published" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-smeny-zadost" element={<TourDemoRoute scenario="shifts-change-request"><ShiftPlannerPage key="demo-shifts-change-request" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-protokol" element={<TourDemoRoute scenario="protokol"><RecepceDemoPage tab="protokol" key="demo-protokol" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-protokol-prazdne" element={<TourDemoRoute scenario="protokol-empty"><RecepceDemoPage tab="protokol" key="demo-protokol-empty" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-protokol-podepsany" element={<TourDemoRoute scenario="protokol-signed"><RecepceDemoPage tab="protokol" key="demo-protokol-signed" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-walkiny" element={<TourDemoRoute scenario="walkiny"><RecepceDemoPage tab="walkiny" key="demo-walkiny" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-taxi" element={<TourDemoRoute scenario="taxi"><RecepceDemoPage tab="taxi" key="demo-taxi" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-lobby-bar" element={<TourDemoRoute scenario="lobby-bar"><RecepceDemoPage tab="lobbyBar" key="demo-lobby-bar" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-terminal" element={<TourDemoRoute scenario="terminal"><RecepceDemoPage tab="terminal" key="demo-terminal" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-odvody" element={<TourDemoRoute scenario="odvody"><RecepceDemoPage tab="odvody" key="demo-odvody" /></TourDemoRoute>} />
        <Route path="napoveda/ukazka-navody" element={<TourDemoRoute scenario="guides"><GuidesPage key="demo-guides" /></TourDemoRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ThemeProvider>
  );
}
