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

/** Flag flipped by the self-demo route wrapper to enable /me/* self mocks. */
export const tourDemo = { active: false };

/** Sentinel employee id used in `/employees/tour-demo/*` detail-page paths. */
export const DEMO_EMP_ID = "tour-demo";

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
 * Decide whether the guided-tour demo should serve a mock for this request.
 *
 * - Any path under the sentinel detail employee (`/employees/tour-demo` or
 *   `/employees/tour-demo/...`) is ALWAYS handled: GET returns the matching
 *   fixture; any non-GET returns `{}` (write swallowed).
 * - Otherwise, only when `selfActive` is true and the path is a known self
 *   endpoint (or `/educationLevels`, or under `/audit`): GET returns the
 *   matching fixture; non-GET self paths return `{}`.
 * - Everything else: `{ hit: false }` (let the real request proceed).
 */
export function getDemoResponse(
  method: string,
  path: string,
  selfActive: boolean
): { hit: boolean; value?: unknown } {
  const clean = stripQuery(path);
  const isGet = method.toUpperCase() === "GET";

  // ── Detail sentinel: always handled ──
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
  // also while the self-demo route is mounted.
  if (clean === "/audit" || clean.startsWith("/audit/")) {
    const refsDemo = path.includes(`employeeId=${DEMO_EMP_ID}`);
    if (refsDemo || selfActive) {
      if (!isGet) return { hit: true, value: {} };
      return { hit: true, value: { entries: [] } };
    }
  }

  // ── Self endpoints: only while the self-demo route is mounted ──
  if (selfActive) {
    if (SELF_PATHS.has(clean) || clean.startsWith("/me/")) {
      if (!isGet) return { hit: true, value: {} };
      const fx = selfFixture(clean);
      return { hit: true, value: fx === undefined ? {} : fx };
    }
  }

  return { hit: false };
}
