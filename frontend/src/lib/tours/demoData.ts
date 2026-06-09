import { now as clockNow } from "@/lib/clock";

/**
 * Guided-tour demo fixtures.
 *
 * Purpose: let the REAL `EmployeeSelfPage` and `EmployeeDetailPage` (plus their
 * sub-components: EmploymentSessionCard / EmploymentRowItem / ContractActionButtons,
 * MultisportEditor, OtherDocumentsTab, the audit history) render fully-populated
 * with dummy data and WITHOUT hitting the backend or Firestore — so a first-login
 * onboarding tour can walk a user through these screens against a safe sandbox.
 *
 * Wiring: `lib/api.ts` calls `getDemoResponse(method, path, tourDemo.active)`
 * before every fetch. When it returns `{ hit: true }`, the mock `value` is
 * returned and no network request is made.
 *   - The DETAIL page is driven by the sentinel employee id `DEMO_EMP_ID`
 *     ("tour-demo"): any path under `/employees/tour-demo/...` is always mocked,
 *     regardless of the `tourDemo.active` flag. The self-demo route navigates to
 *     `/zamestnanci/tour-demo` to show the detail page on demo data.
 *   - The SELF page calls `/me/*` endpoints that aren't id-scoped, so those are
 *     only mocked while `tourDemo.active === true` (toggled by the self-demo
 *     route wrapper, which flips it on mount and off on unmount).
 *
 * Safety: every NON-GET request (POST/PUT/PATCH/DELETE) that we "hit" returns an
 * empty object `{}` — it is swallowed, never persisted — so the tour can't write
 * to the database even if the user clicks a save/submit button.
 *
 * The fixtures are typed loosely (`unknown` / `as` casts) on purpose; what
 * matters is that the runtime DATA shape matches what each component reads, so
 * the pages render without crashing or stalling on "Načítám…".
 *
 * The dummy person is "Jan Novák", recepční, HPP. The employment history is
 * crafted so the full set of controls surface:
 *   - an ACTIVE session (so "+ Dodatek" and "Ukončit smlouvu" render) whose
 *     Nástup row has NO matching contract (so "Generovat smlouvu" renders);
 *   - an older session WITH a generated + signed contract on its Nástup row
 *     (so "Stáhnout" / "Zobrazit" and "Smazat smlouvu" render).
 * One OtherDocument is provided so its view/download/delete buttons render, and
 * benefits carry an active Multisport period + a companion.
 */

/**
 * Tour-demo state. `active` is flipped on by the demo route wrappers
 * (pages/TourDemoRoute); `scenario` selects which page's fixtures
 * getDemoResponse serves while active. The sentinel-employee detail mocks are
 * independent of this flag (keyed off the id in the request path).
 */
export type TourScenario =
  | "self"
  | "shifts"
  | "shifts-empty"
  | "shifts-created"
  | "shifts-published"
  | "payroll"
  | "payroll-empty";
export const tourDemo: { active: boolean; scenario: TourScenario | null } = {
  active: false,
  scenario: null,
};

/** Sentinel employee id used in `/employees/tour-demo/*` detail-page paths. */
export const DEMO_EMP_ID = "tour-demo";

/** Sentinel plan id for the shift-plan demo (GET /shifts/plans/<id>). */
const DEMO_SHIFT_PLAN_ID = "demo-shift-plan";

// The redacted placeholder the pages use to decide whether a sensitive field
// "has data" (and thus should render the reveal eye). Must match the MASK
// constants in EmployeeSelfPage / EmployeeDetailPage.
const MASK = "••••••••";

// A plausible decrypted value returned by the mocked reveal endpoints.
const REVEALED_BIRTH_NUMBER = "900101/1234";

// ─── Detail-page fixtures (`/employees/tour-demo/...`) ─────────────────────────

// EmployeeDetailPage `Employee` root. Czech nationality → only the OP document
// subsection shows (idCardNumber). Sensitive birthNumber is set to MASK so the
// reveal eye renders.
const detailEmployee: unknown = {
  id: DEMO_EMP_ID,
  firstName: "Jan",
  lastName: "Novák",
  displayName: "",
  dateOfBirth: "1990-01-01",
  gender: "m",
  birthSurname: "Novák",
  birthNumber: MASK,
  maritalStatus: "ženatý/vdaná",
  education: "M - Střední vzdělání s maturitní zkouškou",
  nationality: "CZE",
  placeOfBirth: "Praha",
  status: "active",
  currentJobTitle: "Recepční",
  currentDepartment: "Recepce",
  currentContractType: "HPP",
  currentCompanyId: "HPM",
};

// Two employment sessions. groupBySession() walks rows in startDate-asc order,
// so the OLD (terminated) session sorts first and the ACTIVE one last. Each
// Nástup row id anchors a session; the active Nástup has NO contract.
const ROW_ACTIVE_NASTUP = "demo-row-active-nastup";
const ROW_ACTIVE_DODATEK = "demo-row-active-dodatek";
const ROW_OLD_NASTUP = "demo-row-old-nastup";

const detailEmployment: unknown[] = [
  // ── Active session (no Ukončení, no past endDate → not terminated) ──
  {
    id: ROW_ACTIVE_NASTUP,
    companyId: "HPM",
    contractType: "HPP",
    jobTitle: "Recepční",
    department: "Recepce",
    startDate: "2024-03-01",
    endDate: null,
    changeType: "nástup",
    salary: 38000,
    hourlyRate: null,
    workLocation: "Praha",
    probationPeriod: "3 měsíce",
    signingDate: "2024-02-25",
  },
  {
    id: ROW_ACTIVE_DODATEK,
    companyId: "HPM",
    contractType: "HPP",
    jobTitle: "Recepční",
    department: "Recepce",
    startDate: "2025-01-01",
    endDate: null,
    changeType: "změna smlouvy",
    signingDate: "2024-12-20",
    changes: [{ changeKind: "mzda", value: "42000" }],
  },
  // ── Older session, terminated (has an Ukončení row), Nástup has a contract ──
  {
    id: ROW_OLD_NASTUP,
    companyId: "HPM",
    contractType: "HPP",
    jobTitle: "Junior recepční",
    department: "Recepce",
    startDate: "2022-06-01",
    endDate: null,
    changeType: "nástup",
    salary: 32000,
    hourlyRate: null,
    workLocation: "Praha",
    probationPeriod: "3 měsíce",
    signingDate: "2022-05-28",
  },
  {
    id: "demo-row-old-ukonceni",
    companyId: "HPM",
    contractType: "HPP",
    jobTitle: "Junior recepční",
    department: "Recepce",
    startDate: "2024-02-29",
    endDate: null,
    changeType: "ukončení",
    signingDate: "2024-02-15",
  },
];

// Contracts. mapContractsToRows() matches by employmentRowId + expected type
// (nástup HPP → "nastup_hpp"). The old Nástup carries a generated + signed
// contract so "Zobrazit / Stáhnout" and "Smazat smlouvu" render; signed
// contracts are never treated as stale. The active Nástup deliberately has NO
// contract so "Generovat smlouvu" renders there. rowSnapshot mirrors the row's
// SNAPSHOT_FIELDS so the unsigned path wouldn't show stale even if it weren't
// signed.
const detailContracts: unknown[] = [
  {
    id: "demo-contract-old-nastup",
    type: "nastup_hpp",
    status: "signed",
    employmentRowId: ROW_OLD_NASTUP,
    displayName: "Pracovní smlouva – Jan Novák",
    unsignedStoragePath: "demo/unsigned/old-nastup.pdf",
    signedStoragePath: "demo/signed/old-nastup.pdf",
    generatedAt: { seconds: 1654070400 },
    signedAt: { seconds: 1654156800 },
    rowSnapshot: {
      companyId: "HPM",
      contractType: "HPP",
      jobTitle: "Junior recepční",
      department: "Recepce",
      startDate: "2022-06-01",
      endDate: null,
      salary: 32000,
      hourlyRate: null,
      agreedReward: null,
      workLocation: "Praha",
      probationPeriod: "3 měsíce",
      agreedWorkScope: null,
      signingDate: "2022-05-28",
    },
  },
];

// No expiry alerts in the demo (banner simply doesn't render).
const detailAlerts: unknown[] = [];

const detailContact: unknown = {
  phone: "+420 777 123 456",
  email: "jan.novak@example.com",
  permanentAddress: "Václavské náměstí 1, 110 00 Praha 1",
  contactAddressSameAsPermanent: false,
  contactAddress: "Náměstí Míru 5, 120 00 Praha 2",
};

// Czech nationality → only OP fields are read; idCardNumber is MASK so the
// reveal eye renders.
const detailDocuments: unknown = {
  idCardNumber: MASK,
  passportNumber: "",
  passportIssueDate: "",
  passportExpiry: "",
  passportAuthority: "",
  visaNumber: "",
  visaType: "",
  visaIssueDate: "",
  visaExpiry: "",
};

// Benefits object that satisfies BOTH readers:
//   - EmployeeDetailPage `AdditionalData` (insuranceNumber/bankAccount as MASK so
//     their reveal eyes render; insuranceCompany, homeOffice, allowances, the
//     multisport boolean + multisportFrom/To for the termination reminder hook);
//   - MultisportEditor `BenefitsDoc` (multisport flag + multisportPeriods +
//     multisportCompanions; readPeriods() also tolerates the legacy
//     multisportFrom/To single-window form).
const detailBenefits: unknown = {
  insuranceNumber: MASK,
  insuranceCompany: "VZP",
  bankAccount: MASK,
  multisport: true,
  multisportFrom: "2024-09-01",
  multisportTo: null,
  multisportPeriods: [{ from: "2024-09-01", to: null }],
  multisportCompanions: [
    { id: "demo-companion-1", name: "Eva Nováková", from: "2024-10-01", to: null, price: 1290 },
  ],
  homeOffice: 2,
  allowances: true,
  nepodepiseProhlaseni: false,
};

const detailOtherDocuments: unknown[] = [
  {
    id: "demo-other-doc-1",
    name: "Mzdový výměr 2025",
    uploadedAt: { seconds: 1735689600 },
    uploadedBy: "admin@example.com",
  },
];

// ─── Self-page fixtures (`/me/*`, only while tourDemo.active) ──────────────────

// EmployeeSelfPage `EmployeeRoot`. Sensitive fields are read out of the
// section sub-docs (root/contact/documents/benefits), so root only needs the
// denormalized display fields; the sensitive birthNumber lives here as MASK so
// renderReadValue shows the reveal eye.
const selfEmployee: unknown = {
  id: DEMO_EMP_ID,
  firstName: "Jan",
  lastName: "Novák",
  dateOfBirth: "1990-01-01",
  gender: "m",
  birthSurname: "Novák",
  maritalStatus: "ženatý/vdaná",
  education: "M - Střední vzdělání s maturitní zkouškou",
  nationality: "CZE",
  placeOfBirth: "Praha",
  birthNumber: MASK,
  currentJobTitle: "Recepční",
  currentDepartment: "Recepce",
  currentContractType: "HPP",
};

// Self contact SubDoc — same fields the self-page reads via SELF_EDIT_FIELDS.
const selfContact: unknown = {
  phone: "+420 777 123 456",
  email: "jan.novak@example.com",
  permanentAddress: "Václavské náměstí 1, 110 00 Praha 1",
  contactAddressSameAsPermanent: false,
  contactAddress: "Náměstí Míru 5, 120 00 Praha 2",
};

// Self documents SubDoc. idCardNumber is MASK (reveal eye); foreign-doc fields
// are hidden for Czech nationality so they need not be populated.
const selfDocuments: unknown = {
  idCardNumber: MASK,
};

// Self benefits SubDoc — sensitive insuranceNumber/bankAccount as MASK.
const selfBenefits: unknown = {
  insuranceNumber: MASK,
  insuranceCompany: "VZP",
  bankAccount: MASK,
};

// Self employment history — reuse the same rows; the self-page renders them
// read-only via EmploymentSessionCard with no-op callbacks.
const selfEmployment: unknown[] = detailEmployment;

// One pending change request so the "Moje žádosti o úpravu" section is populated.
const selfChangeRequests: unknown[] = [
  {
    id: "demo-change-request-1",
    status: "pending",
    requestedAt: { seconds: 1735689600 },
    rejectionReason: null,
    changes: [
      {
        field: "phone",
        label: "Telefon",
        sensitive: false,
        oldValue: "+420 777 123 456",
        newValue: "+420 777 999 888",
      },
    ],
  },
];

// Education catalogue for the self-page edit dropdown.
const educationLevels: unknown[] = [
  { code: "Z", name: "Základní vzdělání" },
  { code: "H", name: "Střední vzdělání s výučním listem" },
  { code: "M", name: "Střední vzdělání s maturitní zkouškou" },
  { code: "R", name: "Vyšší odborné vzdělání" },
  { code: "T", name: "Vysokoškolské vzdělání" },
];

// ─── Payroll-demo fixtures (`/mzdy` via /napoveda/ukazka-mzdy[-prazdne]) ───────

/** Epoch-seconds Firestore-style timestamp for a Y-M-D (UTC, deterministic). */
function demoTs(year: number, month: number, day: number): { seconds: number } {
  return { seconds: Math.floor(Date.UTC(year, month - 1, day) / 1000) };
}

/**
 * A fully-populated payroll period for the requested month, so the REAL
 * PayrollPage renders its table + every action button (recalc / hard-recalc /
 * lock / delete / export) and the Poznámky column. `locked: false` so the
 * unlock-gated buttons show. 3 entries spanning both display sections (FOM +
 * Recepce/portýři); the first carries a note so the Poznámky cell is populated.
 */
function buildDemoPayrollPeriod(year: number, month: number): unknown {
  const base = {
    sickLeaveHours: 0,
    totalHours: 160,
    reportHours: 160,
    vacationHours: 0,
    nightHours: 0,
    holidayHours: 0,
    weekendHours: 0,
    extraHours: 0,
    extraPay: 0,
    workingDays: 21,
    foodVouchers: 21,
    dppAmount: null,
    salary: null as number | null,
    hourlyRate: null as number | null,
    overrides: {},
    autoOverrides: {},
    multisportActive: false,
    notes: [] as unknown[],
  };
  return {
    id: `demo-period-${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    baseHours: 160,
    maxNightHours: 36,
    maxHolidayHours: 18,
    foodVoucherRate: 96.9,
    locked: false,
    entries: [
      {
        ...base,
        id: "demo-pe-1",
        firstName: "Jana",
        lastName: "Dvořáková",
        contractType: "HPP",
        salary: 45000,
        jobTitle: "Vedoucí recepce",
        section: "vedoucí",
        nightHours: 8,
        holidayHours: 4,
        weekendHours: 12,
        extraHours: 6,
        extraPay: 3000,
        multisportActive: true,
        notes: [
          {
            id: "demo-note-1",
            sourceNoteId: "demo-note-1",
            text: "Dovolená 16.–20.",
            carryForward: false,
            createdBy: "demo-admin",
            createdByName: "Admin",
            createdAt: demoTs(year, month, 3),
            auto: false,
          },
        ],
      },
      {
        ...base,
        id: "demo-pe-2",
        firstName: "Petr",
        lastName: "Novák",
        contractType: "HPP",
        salary: 38000,
        jobTitle: "Recepční",
        section: "recepce",
        nightHours: 24,
        weekendHours: 16,
        foodVouchers: 20,
      },
      {
        ...base,
        id: "demo-pe-3",
        firstName: "Karel",
        lastName: "Svoboda",
        contractType: "DPP",
        hourlyRate: 200,
        jobTitle: "Portýr",
        section: "portýři",
        totalHours: 60,
        reportHours: 60,
        workingDays: 8,
        foodVouchers: 0,
        dppAmount: 12000,
        overrides: { dppAmount: 12000 },
      },
    ],
  };
}

/**
 * Serve mocks for the payroll page while a payroll demo scenario is active.
 * Returns null when the path isn't a payroll path (let the caller continue).
 *  - scenario "payroll":       by-month period fetch returns the populated period.
 *  - scenario "payroll-empty": by-month returns null → the "Vytvořit mzdy ručně"
 *                              (payroll-create) empty state renders.
 * Every non-GET (create/recalc/lock/delete/notes) is swallowed with `{}`.
 */
function payrollFixture(
  isGet: boolean,
  clean: string,
  scenario: TourScenario
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/payroll" && !clean.startsWith("/payroll/")) return null;
  if (!isGet) return { hit: true, value: {} };
  const m = clean.match(/^\/payroll\/periods\/by-month\/(\d+)\/(\d+)$/);
  if (m) {
    if (scenario === "payroll-empty") return { hit: true, value: null };
    return { hit: true, value: buildDemoPayrollPeriod(Number(m[1]), Number(m[2])) };
  }
  return { hit: true, value: {} };
}

// ─── Shifts-demo fixtures (`/smeny` via /napoveda/ukazka-smeny[-prazdne]) ──────

/** Current year/month, honouring the test clock (so the demo plan matches the
 *  month the page lands on, which defaults to clock.now()). */
function currentYM(): { year: number; month: number } {
  const d = clockNow();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function demoPlanEmployee(
  employeeId: string,
  firstName: string,
  lastName: string,
  section: string,
  primaryShiftType: string,
  primaryHotel: string | null,
  displayOrder: number
): unknown {
  return {
    id: `pe-${employeeId}`,
    employeeId,
    firstName,
    lastName,
    displayName: "",
    section,
    primaryShiftType,
    primaryHotel,
    displayOrder,
    active: true,
    contractType: "HPP",
    xLimitOverride: null,
  };
}

/**
 * A populated shift plan for the current month (status passed in), so the REAL
 * ShiftPlannerPage + ShiftGrid render. The "opened" variant exposes the toolbar
 * buttons (transitions / revert / add-employee / edit-deadlines / export) plus
 * the grid's shift-rows and counter ("Přehled obsazení") sections; the
 * "published" variant additionally renders the Volné směny (free porter shift)
 * section. delete (needs "created") keeps the centered fallback.
 */
function buildDemoShiftPlan(status: string): unknown {
  const { year, month } = currentYM();
  const ymd = (day: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const shift = (employeeId: string, day: number, rawInput: string, hours: number) => ({
    id: `${employeeId}_${ymd(day)}`,
    employeeId,
    date: ymd(day),
    rawInput,
    hoursComputed: hours,
    isDouble: false,
    status: "assigned",
    source: null,
  });
  return {
    id: DEMO_SHIFT_PLAN_ID,
    month,
    year,
    status,
    createdBy: "demo",
    openedAt: null,
    closedAt: null,
    publishedAt: null,
    modPersons: { A: "demo-ved-1" },
    // Published plans surface the Volné směny section; mark a couple of DPA days
    // so the "pick porter shift" row has claimable cells to spotlight.
    freeShiftDpaDays: status === "published" ? [ymd(10), ymd(11)] : [],
    employees: [
      demoPlanEmployee("demo-ved-1", "Tomáš", "Veselý", "vedoucí", "R", null, 0),
      demoPlanEmployee("demo-rec-1", "Jana", "Dvořáková", "recepce", "D", "A", 1),
      demoPlanEmployee("demo-rec-2", "Petr", "Novák", "recepce", "N", "A", 2),
      demoPlanEmployee("demo-por-1", "Karel", "Svoboda", "portýři", "DP", "A", 3),
    ],
    shifts: [
      shift("demo-rec-1", 1, "DA", 11.5),
      shift("demo-rec-1", 2, "DA", 11.5),
      shift("demo-rec-1", 5, "X", 0),
      shift("demo-rec-2", 1, "NA", 11.5),
      shift("demo-rec-2", 3, "NA", 11.5),
      shift("demo-por-1", 1, "DPA", 11.5),
    ],
    modShifts: [
      { id: ymd(1), date: ymd(1), code: "A" },
      { id: ymd(2), date: ymd(2), code: "A" },
    ],
  };
}

/**
 * Serve mocks for the shifts page while a shift demo scenario is active. Returns
 * null when the path isn't a shifts path (let the caller continue).
 *  - scenario "shifts":       a populated "opened" plan for the current month.
 *  - scenario "shifts-empty": an empty plan list → no plan for the month → the
 *                             "Vytvořit plán" (shift-create) state renders.
 * Every non-GET (cell/plan/mod/request writes) is swallowed with `{}`.
 */
function shiftsFixture(
  isGet: boolean,
  clean: string,
  scenario: TourScenario
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/shifts" && !clean.startsWith("/shifts/")) return null;
  if (!isGet) return { hit: true, value: {} };

  const planStatus =
    scenario === "shifts-published" ? "published" : scenario === "shifts-created" ? "created" : "opened";
  // Plan list — drives whether the page lands on a plan or the empty state.
  if (clean === "/shifts/plans") {
    if (scenario === "shifts-empty") return { hit: true, value: [] };
    const { year, month } = currentYM();
    return { hit: true, value: [{ id: DEMO_SHIFT_PLAN_ID, month, year, status: planStatus }] };
  }
  // Full plan detail.
  if (clean === `/shifts/plans/${DEMO_SHIFT_PLAN_ID}`) {
    return { hit: true, value: buildDemoShiftPlan(planStatus) };
  }
  // Global pending-count badges (override/change-request reviewers).
  if (
    clean === "/shifts/overrides/pending-count" ||
    clean === "/shifts/changeRequests/pending-count"
  ) {
    return { hit: true, value: { count: 0 } };
  }
  // Per-plan sub-resources (shiftOverrides / shiftChangeRequests lists) → empty.
  if (clean.startsWith(`/shifts/plans/${DEMO_SHIFT_PLAN_ID}/`)) {
    return { hit: true, value: [] };
  }
  // Any other GET under /shifts/* → empty list (safe default, no backend call).
  return { hit: true, value: [] };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/** Strip a query string (and any trailing slash noise) for matching. */
function stripQuery(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

/** Detail-page subpath → fixture. `subpath` is the part after `/employees/tour-demo`. */
function detailFixture(subpath: string): unknown {
  switch (subpath) {
    case "":
      return detailEmployee;
    case "/employment":
      return detailEmployment;
    case "/alerts":
      return detailAlerts;
    case "/contracts":
      return detailContracts;
    case "/contact":
      return detailContact;
    case "/documents":
      return detailDocuments;
    case "/benefits":
      return detailBenefits;
    case "/other-documents":
      return detailOtherDocuments;
    case "/linked-user":
      return null;
    case "/reveal":
      return { value: REVEALED_BIRTH_NUMBER };
    default:
      // Unknown subpath under the sentinel id: return an empty object so the
      // page never falls through to a real network call.
      return {};
  }
}

/** Self-endpoint path → fixture (GET only). Returns `undefined` for non-self paths. */
function selfFixture(path: string): unknown {
  switch (path) {
    case "/me/employee":
      return selfEmployee;
    case "/me/employee/contact":
      return selfContact;
    case "/me/employee/documents":
      return selfDocuments;
    case "/me/employee/benefits":
      return selfBenefits;
    case "/me/employee/employment":
      return selfEmployment;
    case "/me/change-requests":
      return selfChangeRequests;
    case "/me/employee/reveal":
      return { value: REVEALED_BIRTH_NUMBER };
    case "/educationLevels":
      return educationLevels;
    default:
      return undefined;
  }
}

// Paths the self-demo handles (GET-served fixtures + the non-GET endpoints it
// must swallow). Used to decide whether a /me/* path is "ours".
const SELF_PATHS = new Set<string>([
  "/me/employee",
  "/me/employee/contact",
  "/me/employee/documents",
  "/me/employee/benefits",
  "/me/employee/employment",
  "/me/change-requests",
  "/me/employee/reveal",
  "/educationLevels",
]);

/**
 * Active demo scenario, derived from the URL rather than a mutable flag. This is
 * race-proof: when the tour navigates between two demo routes that render the
 * SAME page component (e.g. shifts opened → published), React reuses the page
 * instance and its remount-time fetch can fire while the route wrapper's effect
 * cleanup has momentarily reset a flag. The URL, by contrast, is always current
 * by the time any fetch runs. (Pages are also given a per-route `key` so they
 * actually remount + refetch on such transitions — see App.tsx.)
 */
function activeScenario(): TourScenario | null {
  const p = typeof window !== "undefined" ? window.location.pathname : "";
  switch (p) {
    case "/napoveda/ukazka-profil": return "self";
    case "/napoveda/ukazka-mzdy": return "payroll";
    case "/napoveda/ukazka-mzdy-prazdne": return "payroll-empty";
    case "/napoveda/ukazka-smeny": return "shifts";
    case "/napoveda/ukazka-smeny-prazdne": return "shifts-empty";
    case "/napoveda/ukazka-smeny-vytvoreny": return "shifts-created";
    case "/napoveda/ukazka-smeny-publikovane": return "shifts-published";
    default: return null;
  }
}

/**
 * Decide whether the guided-tour demo should serve a mock for this request.
 *
 * - Any path under the sentinel detail employee (`/employees/tour-demo` or
 *   `/employees/tour-demo/...`) is ALWAYS handled: GET returns the matching
 *   fixture; any non-GET returns `{}` (write swallowed).
 * - Otherwise, only while a demo route is mounted (`tourDemo.active`), the
 *   active `tourDemo.scenario` selects which page's fixtures to serve (self /
 *   payroll / shifts). GET returns the fixture; non-GET returns `{}`.
 * - Everything else: `{ hit: false }` (let the real request proceed).
 */
export function getDemoResponse(
  method: string,
  path: string
): { hit: boolean; value?: unknown } {
  const clean = stripQuery(path);
  const isGet = method.toUpperCase() === "GET";

  // ── Detail sentinel: always handled (independent of the active flag) ──
  const sentinelBase = `/employees/${DEMO_EMP_ID}`;
  if (clean === sentinelBase || clean.startsWith(`${sentinelBase}/`)) {
    if (!isGet) return { hit: true, value: {} };
    const subpath = clean.slice(sentinelBase.length); // "" or "/employment" etc.
    return { hit: true, value: detailFixture(subpath) };
  }

  // ── Audit history ──
  // The employee-detail "Historie změn" section fetches `/audit?employeeId=…`
  // (the id isn't in the path, so it doesn't match the sentinel block above).
  // Serve an empty audit list when the query targets the demo employee, and
  // also while any demo route is mounted.
  if (clean === "/audit" || clean.startsWith("/audit/")) {
    const refsDemo = path.includes(`employeeId=${DEMO_EMP_ID}`);
    if (refsDemo || activeScenario() !== null) {
      if (!isGet) return { hit: true, value: {} };
      return { hit: true, value: { entries: [] } };
    }
  }

  const scenario = activeScenario();
  if (!scenario) return { hit: false };

  switch (scenario) {
    // ── Self endpoints (Můj profil demo) ──
    case "self": {
      if (SELF_PATHS.has(clean) || clean.startsWith("/me/")) {
        if (!isGet) return { hit: true, value: {} };
        const fx = selfFixture(clean);
        return { hit: true, value: fx === undefined ? {} : fx };
      }
      return { hit: false };
    }
    // ── Payroll demo (populated period or empty "create" state) ──
    case "payroll":
    case "payroll-empty":
      return payrollFixture(isGet, clean, scenario) ?? { hit: false };
    // ── Shifts demo (opened / empty-create / published) ──
    case "shifts":
    case "shifts-empty":
    case "shifts-created":
    case "shifts-published":
      return shiftsFixture(isGet, clean, scenario) ?? { hit: false };
    default:
      return { hit: false };
  }
}
