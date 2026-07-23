import { now as clockNow } from "@/lib/clock";

/**
 * Guided-tour demo fixtures.
 *
 * Purpose: let the REAL `EmployeeSelfPage` and `EmployeeDetailPage` (plus their
 * sub-components: EmploymentSessionCard / EmploymentRowItem / ContractActionButtons,
 * MultisportEditor, OtherDocumentsTab, the audit history) render fully-populated
 * with dummy data and WITHOUT hitting the backend or Firestore – so a first-login
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
 * empty object `{}` – it is swallowed, never persisted – so the tour can't write
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
  | "shifts-change-request"
  | "payroll"
  | "payroll-empty"
  | "protokol"
  | "protokol-empty"
  | "protokol-signed"
  | "walkiny"
  | "taxi"
  | "lobby-bar"
  | "terminal"
  | "odvody"
  | "guides";
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

// Self vacation ledger (read-only "Dovolená" section on Můj profil). Shape mirrors
// readLedger() — Nárok/Čerpáno/Zůstatek are derived server-side, so they are
// stated here rather than computed: 40 + 160 = 200 nárok, 96 čerpáno, 104 zůstatek.
// Without this the section still renders (months falls back to {}), but every
// figure would be a dash on the tour's profile page.
const selfVacationLedger: unknown = {
  year: 2026,
  priorYearHours: 40,
  currentYearHours: 160,
  entitlementHours: 200,
  paidOutHours: null,
  months: {
    "1": { hours: 8, source: "payroll-lock" },
    "2": { hours: 0, source: "payroll-lock" },
    "3": { hours: 16, source: "payroll-lock" },
    "4": { hours: 0, source: "payroll-lock" },
    "5": { hours: 40, source: "payroll-lock" },
    "6": { hours: 32, source: "payroll-lock" },
  },
  consumedHours: 96,
  remainingHours: 104,
};

// Self contact SubDoc – same fields the self-page reads via SELF_EDIT_FIELDS.
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

// Self benefits SubDoc – sensitive insuranceNumber/bankAccount as MASK.
const selfBenefits: unknown = {
  insuranceNumber: MASK,
  insuranceCompany: "VZP",
  bankAccount: MASK,
};

// Self employment history – reuse the same rows; the self-page renders them
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

// ─── Seznamy catalogues for the /zamestnanci/tour-demo detail page ────────────
// The real employee-detail page validates the demo employee's CURRENT company /
// department / position / education against the live lists and shows a
// "neplatné údaje – už nejsou v číselníku" banner on any mismatch. These demo
// lists mirror detailEmployee's `current*` / `education` values exactly (company
// matched by id; department & position by name; education by the "code - name"
// label), so on the demo route the referenced entries always exist and the
// banner never fires. `Junior recepční` is included for the history session.
const demoCompanies: unknown[] = [
  { id: "HPM", abbreviation: "HPM", name: "Hotel Property Management s.r.o.", address: "", ic: "", dic: "", fileNo: "" },
];
const demoDepartments: unknown[] = [
  { id: "demo-dep-recepce", name: "Recepce" },
];
const demoJobPositions: unknown[] = [
  { id: "demo-pos-recepcni", name: "Recepční", departmentId: "demo-dep-recepce" },
  { id: "demo-pos-junior-recepcni", name: "Junior recepční", departmentId: "demo-dep-recepce" },
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
    scenario === "shifts-published" || scenario === "shifts-change-request"
      ? "published"
      : scenario === "shifts-created"
      ? "created"
      : "opened";
  // Plan list – drives whether the page lands on a plan or the empty state.
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
  // Previous-month gap badge. Unreachable today – no scenario above yields a
  // "closed" plan, and the page only calls this for one. Declared anyway so the
  // shape is right rather than falling through to the `[]` default below; if a
  // closed-plan scenario is ever added, put demo values here or the tour will
  // show N/A on every row.
  if (clean.startsWith("/shifts/prev-month-gap")) {
    return { hit: true, value: { available: false, values: {} } };
  }
  // Any other GET under /shifts/* → empty list (safe default, no backend call).
  return { hit: true, value: [] };
}

// ─── Recepce-demo fixtures (`/recepce/*` tabs via /napoveda/ukazka-protokol|…) ─
//
// The REAL HandoverTab / WalkinsTab / TaxiTab (rendered by pages/RecepceDemoPage)
// fed with mock data – no backend, no Firestore – so a first-login tour can walk
// the reception workflow against a safe sandbox. Every non-GET is swallowed.

/** Epoch-seconds "now" for demo timestamps (real wall clock – the handover editor
 *  keys off the real date/shift, NOT the test clock, so we must match it). */
function demoNowSec(): number {
  return Math.floor(new Date().getTime() / 1000);
}
/** Real wall-clock date (sv-SE = YYYY-MM-DD) – matches HandoverTab.todayLocal(). */
function realTodayIso(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}
/** Real day/night split – matches HandoverTab.defaultShiftForNow(). */
function realShiftNow(): "den" | "noc" {
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "den" : "noc";
}
/** The handover doc id the ProtocolEditor requests for "now" (`<date>_<shift>`). */
function primaryHandoverId(): string {
  return `${realTodayIso()}_${realShiftNow()}`;
}

function demoStamp(uid: string, displayName: string, email: string, secondsAgo: number): unknown {
  return { uid, displayName, email, at: { seconds: demoNowSec() - secondsAgo } };
}

/** A populated protocol (optionally signed). Full cash/účty/sm/notes so every
 *  control renders; sm trezor + wata are non-zero so their rows always show. */
function buildDemoHandover(signed: boolean): unknown {
  return {
    id: primaryHandoverId(),
    shiftDate: realTodayIso(),
    shiftType: realShiftNow(),
    notes: [
      { id: "demo-note-1", text: "Předat noční recepci klíč od trezoru", done: false, locked: false },
      { id: "demo-note-2", text: "Vyřídit reklamaci – pokoj 214", done: true, locked: false },
    ],
    cashCounts: {
      kasaCZK: { "5000": 3, "1000": 5, "500": 4, "200": 6, "100": 8 },
      trezorCZK: { "5000": 10, "2000": 5 },
      kasaEUR: { "50": 4, "20": 6, "10": 5 },
      trezorEUR: { "100": 3 },
    },
    accounts: [
      // The locked row a saved odvod leaves behind. Present so the protokol demo
      // can show the "Provést odvod" button (see odvodyPendingFixture) — the
      // button renders only on the row whose id the server names as pending.
      { id: DEMO_ODVOD_LINE_ID, name: "odvod + účty", amount: 150000, locked: true },
      { id: "demo-acc-1", name: "Květiny", amount: 1200, locked: false },
      { id: "demo-acc-2", name: "Room service", amount: 3450, locked: true },
    ],
    smCounts: [2, 1, 3],
    smTrezor: 5000,
    wata: -250,
    predal: signed ? demoStamp("demo-p", "Jan Novák", "jan.novak@example.com", 3600) : null,
    prevzal: signed ? demoStamp("demo-q", "Petr Svoboda", "petr.svoboda@example.com", 60) : null,
    updatedBy: "demo",
    // FIXED (not time-based): the editor's concurrency poll compares updatedAt
    // against its base; a changing demo timestamp would false-fire the "edited by
    // someone else" banner mid-tour. A constant keeps every mocked GET identical.
    updatedAt: { seconds: 1751500000 },
  };
}

/** Signer pool + scheduled defaults so the Předat/Převzít dropdowns are enabled. */
const demoSigners: unknown = {
  signers: [
    { uid: "demo-p", name: "jan.novak", label: "Jan Novák" },
    { uid: "demo-q", name: "petr.svoboda", label: "Petr Svoboda" },
  ],
  scheduled: { predal: "demo-p", prevzal: "demo-q" },
};

function buildDemoHistory(signed: boolean): unknown {
  const s = demoNowSec();
  return {
    entries: [
      { seq: 1, at: { seconds: s - 900 }, label: "Změna hotovosti (KASA CZK)", by: "Jan Novák", undone: false, applied: true },
      { seq: 2, at: { seconds: s - 600 }, label: "Přidán účet Květiny", by: "Jan Novák", undone: false, applied: true },
      { seq: 3, at: { seconds: s - 300 }, label: "Změna poznámky", by: "Jan Novák", undone: false, applied: true },
    ],
    // Frozen once signed → undo/redo locked.
    canUndo: !signed,
    canRedo: false,
  };
}

/** Id of the locked „odvod + účty" row in the demo protokol. */
const DEMO_ODVOD_LINE_ID = "demo-acc-odvod";

/**
 * Registers + default split weights per hotel, mirroring ODVOD_REGISTERS /
 * DEFAULT_SPLIT_WEIGHTS on the server. Amigo & Alqush is the two-register case,
 * so the tour shows the split ratio for whoever manages that hotel.
 */
function demoOdvodRegisters(slug: string): {
  registers: Array<{ key: string; label: string }>;
  weights: Record<string, number>;
} {
  if (slug === "amigo-alqush") {
    return {
      registers: [
        { key: "amigo", label: "Amigo" },
        { key: "alqush", label: "Alqush" },
      ],
      weights: { amigo: 70, alqush: 24 },
    };
  }
  const label = slug === "ambiance" ? "Ambiance" : slug === "superior" ? "Superior" : "Ankora";
  return { registers: [{ key: slug, label }], weights: { [slug]: 1 } };
}

/**
 * Serve `/odvody/{slug}/pending` inside the PROTOKOL demos, so the locked
 * „odvod + účty" row carries its "Provést odvod" button. Separate from
 * odvodyFixture because it belongs to a different scenario.
 */
function odvodyPendingFixture(clean: string): { hit: boolean; value?: unknown } | null {
  if (!clean.startsWith("/odvody/")) return null;
  if (!clean.endsWith("/pending")) return { hit: true, value: {} };
  return {
    hit: true,
    value: {
      pending: {
        month: realTodayIso().slice(0, 7),
        lineId: DEMO_ODVOD_LINE_ID,
        lineAmount: 150000,
        eurTotal: 2260,
      },
    },
  };
}

/** Serve mocks for /odvody/* while the odvody demo is active. */
function odvodyFixture(isGet: boolean, clean: string): { hit: boolean; value?: unknown } | null {
  if (clean !== "/odvody" && !clean.startsWith("/odvody/")) return null;
  // PUT (save) / DELETE → swallow; the tab reloads via the GET below.
  if (!isGet) return { hit: true, value: { ok: true } };
  const m = clean.match(/^\/odvody\/([^/]+)\/(\d{4}-\d{2})$/);
  if (!m) return { hit: true, value: {} };
  const [, slug, month] = m;
  const { registers, weights } = demoOdvodRegisters(slug);
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7));
  const lastDay = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
  return {
    hit: true,
    value: {
      month,
      lastDay,
      registers,
      defaultWeights: weights,
      // Nothing saved yet → the tab shows the "Zadat odvod" entry point, which
      // is what the tour points at.
      saved: null,
      target: {
        shiftDate: realTodayIso(),
        shiftType: realShiftNow(),
        exists: true,
        signed: false,
        blocked: null,
      },
      accounts: [
        { id: "demo-acc-1", name: "Květiny", amount: 1200, locked: false },
        { id: "demo-acc-2", name: "Room service", amount: 3450, locked: true },
      ],
      trezorCZK: { "5000": 10, "2000": 5 },
      trezorEUR: { "100": 3 },
    },
  };
}

/** Serve mocks for /handovers/* while a protokol demo scenario is active. */
function handoverFixture(
  isGet: boolean,
  clean: string,
  scenario: TourScenario
): { hit: boolean; value?: unknown; status?: number } | null {
  if (clean !== "/handovers" && !clean.startsWith("/handovers/")) return null;
  const signed = scenario === "protokol-signed";

  // Global sm rates (GET + PUT echo).
  if (clean === "/handovers/sm/rates") return { hit: true, value: { rates: [500, 200, 100] } };

  const m = clean.match(/^\/handovers\/([^/]+)\/(.+)$/);
  if (m) {
    const rest = m[2];
    if (rest === "signers") return { hit: true, value: demoSigners };
    if (rest === "revokers" || rest.startsWith("revokers")) return { hit: true, value: [] };
    if (rest.endsWith("/history")) return { hit: true, value: buildDemoHistory(signed) };
    // POST actions (undo/redo/predal/prevzal/revert/sm-transfer/sm-trezor/wata) → swallow.
    if (!isGet) return { hit: true, value: {} };
    // Bare doc GET: rest === "<date>_<shift>".
    if (scenario === "protokol-empty") return { hit: true, status: 404 };
    if (signed) {
      // Signed doc for the current shift; the "next shift" probe must 404 so the
      // "Vytvořit protokol pro další směnu" button appears.
      return rest === primaryHandoverId()
        ? { hit: true, value: buildDemoHandover(true) }
        : { hit: true, status: 404 };
    }
    return { hit: true, value: buildDemoHandover(false) };
  }
  // PUT/POST directly on /handovers/{slug} (create/save) → return a doc.
  if (!isGet) return { hit: true, value: buildDemoHandover(false) };
  return { hit: true, value: {} };
}

/** Current-month prefix + a couple of in-month dates for the walkiny/taxi tables. */
function demoMonthDates(): { ym: string; d05: string; d11: string; today: string } {
  const today = realTodayIso();
  const ym = today.slice(0, 7);
  return { ym, d05: `${ym}-05`, d11: `${ym}-11`, today };
}

/** Serve mocks for /walkins/* while the walkiny demo is active. */
function walkinsFixture(
  isGet: boolean,
  clean: string
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/walkins" && !clean.startsWith("/walkins/")) return null;
  if (!isGet) return { hit: true, value: {} };
  const { d05, d11, today } = demoMonthDates();
  if (clean.endsWith("/range")) return { hit: true, value: { from: `${today.slice(0, 7)}-01`, to: today } };
  if (clean.endsWith("/employees")) {
    return {
      hit: true,
      value: {
        employees: [
          { employeeId: "demo-e1", name: "Nováková Jana" },
          { employeeId: "demo-e2", name: "Svoboda Petr" },
        ],
        onShiftEmployeeId: "demo-e1",
      },
    };
  }
  // List: /walkins/{slug}
  return {
    hit: true,
    value: [
      { id: "dw1", date: d05, employeeId: "demo-e1", employeeName: "Nováková Jana", resNo: "1465199", amount: 2500, currency: "CZK" },
      { id: "dw2", date: d11, employeeId: "demo-e2", employeeName: "Svoboda Petr", resNo: "1465233", amount: 180, currency: "EUR" },
      { id: "dw3", date: today, employeeId: "demo-e1", employeeName: "Nováková Jana", resNo: "1465301", amount: 3200, currency: "CZK" },
    ],
  };
}

const demoTaxiRoutes: unknown = [
  { id: "r1", name: "Letiště T1", price: 750, provision: 150, roundtrip: false },
  { id: "r2", name: "Letiště T2", price: 750, provision: 150, roundtrip: false },
  { id: "r3", name: "Centrum – Staré Město", price: 350, provision: 70, roundtrip: false },
  { id: "r4", name: "Kongresové centrum (zpáteční)", price: 600, provision: 120, roundtrip: true },
];

/** Serve mocks for /taxi/* while the taxi demo is active. */
function taxiFixture(
  isGet: boolean,
  clean: string
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/taxi" && !clean.startsWith("/taxi/")) return null;
  // Global routes ceník (GET + PUT echo).
  if (clean === "/taxi/routes") return { hit: true, value: { routes: demoTaxiRoutes } };
  if (!isGet) return { hit: true, value: {} };
  const { d05, d11, today } = demoMonthDates();
  if (clean.endsWith("/range")) return { hit: true, value: { from: `${today.slice(0, 7)}-01`, to: today } };
  // List: /taxi/{slug}
  return {
    hit: true,
    value: [
      { id: "t1", date: d05, time: "08:30", room: "307", pax: 2, routeName: "Letiště T1", amount: 750, provision: 150, note: "" },
      { id: "t2", date: d11, time: "14:10", room: "212", pax: 1, routeName: "Centrum – Staré Město", amount: 350, provision: 70, note: "" },
      { id: "t3", date: today, time: "19:45", room: "401", pax: 3, routeName: "", amount: 900, provision: 180, note: "Přání hosta – mimo ceník" },
    ],
  };
}

const demoLobbyBarItems: unknown = [
  { id: "i1", name: "voda", priceCZK: 50, priceEUR: 2 },
  { id: "i2", name: "Cola", priceCZK: 50, priceEUR: 2 },
  { id: "i3", name: "pivo", priceCZK: 70, priceEUR: 3 },
  { id: "i4", name: "víno", priceCZK: 90, priceEUR: 4 },
];

/** Serve mocks for /lobby-bar/* while the lobby-bar demo is active. */
function lobbyBarFixture(
  isGet: boolean,
  clean: string
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/lobby-bar" && !clean.startsWith("/lobby-bar/")) return null;
  if (clean.endsWith("/items")) {
    return { hit: true, value: { items: demoLobbyBarItems, provisionCZK: 20, provisionEUR: 1 } };
  }
  if (!isGet) return { hit: true, value: {} };
  const { d05, d11, today } = demoMonthDates();
  if (clean.endsWith("/range")) return { hit: true, value: { from: `${today.slice(0, 7)}-01`, to: today } };
  if (clean.endsWith("/employees")) {
    return {
      hit: true,
      value: {
        employees: [
          { employeeId: "demo-e1", name: "Nováková Jana" },
          { employeeId: "demo-e2", name: "Svoboda Petr" },
        ],
        onShiftEmployeeId: "demo-e1",
      },
    };
  }
  // List: /lobby-bar/{slug}. Money mirrors the server: price = qty·unit,
  // provision = qty·rate, doSpolecne = price − provision, per currency.
  return {
    hit: true,
    value: [
      { id: "lb1", date: d05, itemId: "i3", itemName: "pivo", quantity: 2, currency: "CZK", employeeId: "demo-e1", employeeName: "Nováková Jana", unitPrice: 70, price: 140, provision: 40, doSpolecne: 100 },
      { id: "lb2", date: d11, itemId: "i2", itemName: "Cola", quantity: 1, currency: "EUR", employeeId: "demo-e2", employeeName: "Svoboda Petr", unitPrice: 2, price: 2, provision: 1, doSpolecne: 1 },
      { id: "lb3", date: today, itemId: "i4", itemName: "víno", quantity: 3, currency: "CZK", employeeId: "demo-e1", employeeName: "Nováková Jana", unitPrice: 90, price: 270, provision: 60, doSpolecne: 210 },
    ],
  };
}

/** Serve mocks for /terminal/* while the terminál demo is active. */
function terminalFixture(
  isGet: boolean,
  clean: string
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/terminal" && !clean.startsWith("/terminal/")) return null;
  if (!isGet) return { hit: true, value: {} };
  const { d05, d11, today } = demoMonthDates();
  if (clean.endsWith("/range")) return { hit: true, value: { from: `${today.slice(0, 7)}-01`, to: today } };
  // Types catalogue: TerminalTab reads `{ types }` from here and spreads it into
  // the Typ dropdown — without this branch it fell through to the payments-array
  // return below, so `typesRes.types` was undefined and `[...types]` crashed the
  // whole tour page. The built-in "Jiné…" is appended client-side, not listed here.
  if (clean.endsWith("/types")) {
    return {
      hit: true,
      value: { types: [
        { id: "late-co", label: "late C/O" },
        { id: "laundry", label: "laundry" },
      ] },
    };
  }
  // List: /terminal/{slug} — one settled, one not, and one "Jiné…" with a note.
  return {
    hit: true,
    value: [
      { id: "tp1", date: d05, amount: 500, type: "late-co", note: "", settled: true, settledBy: null, settledAt: null },
      { id: "tp2", date: d11, amount: 840, type: "laundry", note: "", settled: false, settledBy: null, settledAt: null },
      { id: "tp3", date: today, amount: 600, type: "other", note: "hračka", settled: false, settledBy: null, settledAt: null },
    ],
  };
}

// ─── Návody-demo fixtures (`/guides` via /napoveda/ukazka-navody) ─────────────
//
// The REAL GuidesPage fed with mock data. Its ONLY mount endpoint is
// `GET /guides` ({ guides, tags }) – a missing branch here would leave the tour
// page blank. Opening a PDF (`GET /guides/:id/file`) is a RAW fetch that bypasses
// lib/api, so it can't be mocked; the tour therefore only shows the list and
// never opens a guide.
//
// Guides carry several tags each – that overlap is the whole point of tags, so
// the demo data has to show it (a guide that is both "Recepce" and "Protel").

const demoGuides: unknown[] = [
  {
    id: "g1",
    title: "Předávací protokol krok za krokem",
    description: "Jak správně vyplnit a podepsat předávací protokol na konci směny.",
    tags: ["Recepce", "Směny"],
    kind: "pdf",
    url: "",
    fileName: "predavaci-protokol.pdf",
  },
  {
    id: "g2",
    title: "Check-in hosta v Protelu",
    description: "Postup ubytování hosta včetně walk-inů.",
    tags: ["Recepce", "Protel"],
    kind: "pdf",
    url: "",
    fileName: "check-in-protel.pdf",
  },
  {
    id: "g3",
    title: "Manuál k systému Protel (web)",
    description: "Oficiální dokumentace dodavatele.",
    tags: ["Protel", "Školení"],
    kind: "link",
    url: "https://example.com/protel",
    fileName: "",
  },
  {
    id: "g4",
    title: "Jak číst mzdový výměr",
    description: "Vysvětlení jednotlivých položek ve výplatní pásce.",
    tags: ["Mzdy"],
    kind: "pdf",
    url: "",
    fileName: "mzdovy-vymer.pdf",
  },
];

/** Tag vocabulary the real backend derives from the guides; mirrored here. */
const demoGuideTags = ["Mzdy", "Protel", "Recepce", "Směny", "Školení"];

/** Serve mocks for /guides/* while the návody demo is active. */
function guidesFixture(
  isGet: boolean,
  clean: string
): { hit: boolean; value?: unknown } | null {
  if (clean !== "/guides" && !clean.startsWith("/guides/")) return null;
  if (!isGet) return { hit: true, value: {} };
  // Mount endpoint: the whole page (guides + tag vocabulary) comes from here.
  if (clean === "/guides") {
    return { hit: true, value: { guides: demoGuides, tags: demoGuideTags } };
  }
  return { hit: true, value: {} };
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
    case "/me/employee/vacation-ledger":
      return selfVacationLedger;
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
 * actually remount + refetch on such transitions – see App.tsx.)
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
    case "/napoveda/ukazka-smeny-zadost": return "shifts-change-request";
    case "/napoveda/ukazka-protokol": return "protokol";
    case "/napoveda/ukazka-protokol-prazdne": return "protokol-empty";
    case "/napoveda/ukazka-protokol-podepsany": return "protokol-signed";
    case "/napoveda/ukazka-walkiny": return "walkiny";
    case "/napoveda/ukazka-taxi": return "taxi";
    case "/napoveda/ukazka-lobby-bar": return "lobby-bar";
    case "/napoveda/ukazka-terminal": return "terminal";
    case "/napoveda/ukazka-odvody": return "odvody";
    case "/napoveda/ukazka-navody": return "guides";
    default: return null;
  }
}

/** The employee-detail demo route: the REAL detail page fed by the sentinel
 * fixture (see DEMO_EMP_ID). Unlike the /napoveda/ukazka-* demos it has no
 * TourDemoRoute wrapper / active scenario, so endpoint interception for it keys
 * off this exact pathname. */
const DEMO_EMP_ROUTE = "/zamestnanci/tour-demo";
function onDemoDetailRoute(): boolean {
  return typeof window !== "undefined" && window.location.pathname === DEMO_EMP_ROUTE;
}

/** Seznamy list endpoints the detail-demo page validates the demo employee
 * against (company / department / position / education). */
const DEMO_CATALOG_PATHS = new Set([
  "/companies",
  "/departments",
  "/jobPositions",
  "/educationLevels",
]);
function demoCatalogFixture(clean: string): unknown {
  switch (clean) {
    case "/companies": return demoCompanies;
    case "/departments": return demoDepartments;
    case "/jobPositions": return demoJobPositions;
    case "/educationLevels": return educationLevels;
    default: return [];
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
): { hit: boolean; value?: unknown; status?: number } {
  const clean = stripQuery(path);
  const isGet = method.toUpperCase() === "GET";

  // ── Detail sentinel: always handled (independent of the active flag) ──
  const sentinelBase = `/employees/${DEMO_EMP_ID}`;
  if (clean === sentinelBase || clean.startsWith(`${sentinelBase}/`)) {
    if (!isGet) return { hit: true, value: {} };
    const subpath = clean.slice(sentinelBase.length); // "" or "/employment" etc.
    return { hit: true, value: detailFixture(subpath) };
  }

  // ── Seznamy catalogues for the detail sentinel page ──
  // The employee-detail page (route /zamestnanci/tour-demo, sentinel id) loads
  // the live company/department/position/education lists and validates the demo
  // employee against them. There's no active scenario on that route, so serve
  // matching demo catalogues here — otherwise these hit the real backend and, if
  // the tenant renamed/removed the demo's values, the page shows the "neplatné
  // údaje v číselníku" banner. Gated on the exact detail-demo pathname so real
  // pages that fetch the same endpoints are never intercepted.
  if (onDemoDetailRoute() && DEMO_CATALOG_PATHS.has(clean)) {
    if (!isGet) return { hit: true, value: {} };
    return { hit: true, value: demoCatalogFixture(clean) };
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
    case "shifts-change-request":
      return shiftsFixture(isGet, clean, scenario) ?? { hit: false };
    // ── Recepce demos (protokol populated/empty/signed, walkiny, taxi) ──
    case "protokol":
    case "protokol-empty":
    case "protokol-signed":
      // The protokol tab also asks whether a month-end odvod is pending on this
      // shift; without the second fixture that call escapes to the real API.
      return handoverFixture(isGet, clean, scenario) ?? odvodyPendingFixture(clean) ?? { hit: false };
    case "walkiny":
      return walkinsFixture(isGet, clean) ?? { hit: false };
    case "taxi":
      return taxiFixture(isGet, clean) ?? { hit: false };
    case "lobby-bar":
      return lobbyBarFixture(isGet, clean) ?? { hit: false };
    case "terminal":
      return terminalFixture(isGet, clean) ?? { hit: false };
    case "odvody":
      return odvodyFixture(isGet, clean) ?? { hit: false };
    // ── Návody demo (list of PDF/link guides with tags) ──
    case "guides":
      return guidesFixture(isGet, clean) ?? { hit: false };
    default:
      return { hit: false };
  }
}
