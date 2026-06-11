import type { TourStep, TourDefinition } from "./types";

/**
 * Master, permission-driven tour step list.
 *
 * There is ONE tour. It contains a step for every permission in the catalog
 * (functions/src/auth/permissions.ts ↔ frontend/src/lib/permissions/catalog.ts).
 * At runtime the OnboardingContext filters this list down to the steps the
 * current user actually holds (`can(step.permission)`); steps with no
 * `permission` (welcome / outro) are always shown.
 *
 * Anchoring: each step spotlights the ACTUAL control for its permission.
 *  - `route` navigates to the page first (set on every step that needs it, so
 *    steps survive filtering independently).
 *  - `reveal` clicks tab/expander anchors to mount controls hidden behind tabs.
 *  - Person-record controls (reveal sensitive, employment, contracts, documents,
 *    benefits, edit/delete, and the Můj profil controls) point at the tour-only
 *    demo profile at /napoveda/ukazka — a fully-populated INERT dummy record, so
 *    every anchor (e.g. the sensitive-data eye) always exists and no real data
 *    is shown. See pages/TourDemoProfile.tsx.
 *  - State-gated controls (shift plan controls, payroll period buttons) only
 *    exist in certain app states; when absent the overlay falls back to a
 *    centered card, so the step still appears and advances.
 *
 * NOTE: keep this list complete. When a new permission is added to the catalog,
 * add a matching step here (and the permission matrix per the project rule).
 */

// Tour demo routes: the REAL pages rendered with mock data (lib/tours/demoData).
const DEMO_SELF = "/napoveda/ukazka-profil"; // real Můj profil page
const DEMO_EMP = "/zamestnanci/tour-demo"; // real employee-detail page (sentinel id)
const DEMO_PAYROLL = "/napoveda/ukazka-mzdy"; // real Mzdy page, populated period
const DEMO_PAYROLL_EMPTY = "/napoveda/ukazka-mzdy-prazdne"; // real Mzdy page, no period → create
const DEMO_SHIFTS = "/napoveda/ukazka-smeny"; // real Směny page, populated "opened" plan
const DEMO_SHIFTS_EMPTY = "/napoveda/ukazka-smeny-prazdne"; // real Směny page, no plan → create
const DEMO_SHIFTS_CREATED = "/napoveda/ukazka-smeny-vytvoreny"; // created (not opened) plan → Smazat plán
const DEMO_SHIFTS_PUBLISHED = "/napoveda/ukazka-smeny-publikovane"; // published plan → Volné směny section

/**
 * Section labels for the "Předchozí/Další sekce" jump buttons. Set `section` only
 * on the FIRST step of each group below; buildAppTour carries it forward to the
 * rest of the group, so the labels survive permission filtering.
 */
const SECTIONS = {
  intro: "Úvod",
  overview: "Přehled",
  shifts: "Směny",
  vacation: "Dovolená",
  // Zaměstnanci spans the list + the employee card (no separate "Karta" section).
  employees: "Zaměstnanci",
  profile: "Můj profil",
  templates: "Šablony smluv",
  payroll: "Mzdy",
  alerts: "Upozornění",
  audit: "Log změn",
  // Nastavení spans uživatelé/oprávnění + číselníky + systém as one section.
  settings: "Nastavení",
  outro: "Závěr",
} as const;

export const APP_TOUR_STEPS: TourStep[] = [
  // ── Welcome ───────────────────────────────────────────────────────────────
  {
    section: SECTIONS.intro,
    anchor: null,
    title: "Vítejte v HPM Intranetu",
    body: "Tento průvodce vás provede částmi aplikace, ke kterým máte přístup. Obsah se přizpůsobuje vašim oprávněním, takže uvidíte přesně to, co můžete používat. Průvodce můžete kdykoliv ukončit tlačítkem Přeskočit a později znovu spustit z Nápovědy vlevo dole.",
  },

  // ── Úvod: přihlášený uživatel + režim zobrazení (vždy zobrazeno) ─────────────
  { anchor: "menu-footer", title: "Přihlášený uživatel", body: "V levém dolním rohu vidíte, kdo je právě přihlášen do aplikace.", placement: "right" },
  { anchor: "theme-toggle", title: "Světlý/tmavý režim", body: "Můžete si zvolit zobrazení ve světlém, nebo tmavém režimu. Aplikace si bude vaši volbu pamatovat i při příštím přihlášení.", placement: "right" },

  // ── Přehled (/prehled) ──────────────────────────────────────────────────────
  { section: SECTIONS.overview, permission: "nav.dashboard.view", anchor: "nav-prehled", title: "Přehled", body: "Přehled je vaše úvodní obrazovka se shrnutím nejdůležitějších údajů.", placement: "right" },
  // Date header — two variants: WITH the denní/noční badge (users with shift
  // access) and WITHOUT it (stats-only viewers like the účetní, whose header
  // shows no shift badge). The inverse gate keeps shift users on the first only.
  { permission: ["shifts.view.all", "shifts.view.self"], anchor: "overview-date-header", route: "/prehled", title: "Přehled - dnešní datum", body: "Titulek nahoře vždy ukazuje dnešní datum a právě probíhající směnu (denní/noční).", placement: "bottom" },
  { permission: "dashboard.view", excludeIfPermission: ["shifts.view.all", "shifts.view.self"], anchor: "overview-date-header", route: "/prehled", title: "Přehled - dnešní datum", body: "Titulek nahoře vždy ukazuje dnešní datum.", placement: "bottom" },
  { permission: "dashboard.staffing.view", anchor: "overview-staffing", route: "/prehled", title: "Dnešní a zítřejší přehled", body: "Sekce Dnes a Zítra zobrazují zaměstnance, kteří mají naplánované směny, MOD a manažery, kteří mají dovolenou.", placement: "bottom" },
  { permission: ["shifts.view.all", "shifts.view.self"], requiresEmployee: true, anchor: "overview-my-shifts", route: "/prehled", title: "Moje směny", body: "Tato dlaždice zobrazuje vaše nejbližší směny. Kliknutím se dostanete do tabulky směn.", placement: "bottom" },
  { permission: "dashboard.tasks.view", anchor: "overview-task-tiles", route: "/prehled", title: "Úkoly ke schválení", body: "Dlaždice úkolů upozorňují na položky čekající na vaše schválení. Kliknutím přejdete k vyřízení.", placement: "bottom" },
  { permission: "dashboard.stats.view", anchor: "overview-stats", route: "/prehled", title: "Statistiky", body: "Na těchto dlaždicích vidíte různé statistiky zaměstnanců.", placement: "top" },

  // ── Směny (/smeny) ──────────────────────────────────────────────────────────
  { section: SECTIONS.shifts, permission: "nav.shifts.view", anchor: "nav-smeny", title: "Směny", body: "V sekci Směny najdete měsíční plán směn.", placement: "right" },
  { permission: ["shifts.view.all", "shifts.view.self"], anchor: "shift-month-nav", route: DEMO_SHIFTS, title: "Výběr měsíce", body: "Šipkami přecházíte mezi měsíci. Pokud jste v jiném než aktuálním měsíci, objeví se tlačítko DNES, kterým se vrátíte na aktuální měsíc.", placement: "bottom" },
  { permission: "shifts.view.all", anchor: "shift-rows", route: DEMO_SHIFTS, title: "Celý plán směn", body: "Tabulka zobrazuje měsíční plán směn pro recepci. Kódy (DA, NS, X…) označují typ směny nebo volno. Legenda je pod tabulkou.", placement: "bottom" },
  { permission: "shifts.counterTable.view", anchor: "shift-counter", route: DEMO_SHIFTS, title: "Tabulka obsazenosti", body: "Pod plánem je souhrnná tabulka obsazenosti - počty lidí na jednotlivých pozicích pro každý den.", placement: "bottom" },
  { permission: "shifts.cells.editOwnX", excludeIfPermission: "shifts.cells.edit", anchor: "shift-rows", route: DEMO_SHIFTS, title: "Zadání vlastního volna (X)", body: "Do svého řádku můžete po vytvoření plánu směn na další měsíc přímo zapsat volno (X). Maximální počet pro zaměstnance na plný úvazek je 8 X, pro poloviční úvazek 13 X. Pokud potřebujete více dní, můžete požádat o výjimku (po zadání devátého/čtrnáctého X se vám automaticky zobrazí okno s žádostí o X navíc, kam napíšete odůvodnění). Admin poté žádost schválí, nebo zamítne (také s odůvodněním). Pokud potřebujete zadat 7 a více dní volna v kuse, požádejte o dovolenou.", placement: "bottom" },
  { permission: "shifts.cells.edit", anchor: "shift-rows", route: DEMO_SHIFTS, title: "Vyplňování plánu", body: "V tabulce směn můžete kliknutím do buňky upravovat směny všech zaměstnanců.", placement: "bottom" },
  { permission: "shifts.mod.manage", anchor: "shift-mod-row", route: DEMO_SHIFTS, title: "MOD", body: "V tomto řádku můžete přiřadit manažerům MOD pro daný den.", placement: "bottom" },
  { permission: "shifts.changeRequest.submit", excludeIfPermission: "shifts.plan.transition", anchor: "shift-my-requests-btn", route: DEMO_SHIFTS, title: "Žádost o změnu směny", body: "Když je plán směn již hotový, žádost o změnu podáte dvojklikem na danou buňku. Popište, o jakou změnu jde (stačí např. „vyměnit s …“, „NS“ apod.). Admin změny schvaluje nebo zamítá. Stav žádosti vidíte po rozkliknutí tlačítka Moje žádosti.", placement: "bottom" },
  { permission: "shifts.freeShift.claim", excludeIfPermission: "shifts.freeShift.manage", anchor: "shift-free", route: DEMO_SHIFTS_PUBLISHED, title: "Žádost o volnou směnu", body: "Volné portýrské směny jsou zobrazeny pod rozpisem směn. Můžete o ně požádat dvojklikem na danou volnou směnu.", placement: "top" },
  { permission: "shifts.changeRequest.review", anchor: "shift-change-requests", route: DEMO_SHIFTS, title: "Schvalování žádostí o změnu", body: "Tlačítkem Žádosti o změny otevřete panel se žádostmi zaměstnanců ke schválení nebo zamítnutí.", placement: "bottom" },
  // Note: shifts.override.submit ("Žádost o výjimku") folded into the X-limit step above (the 9th-X dialog).
  { permission: "shifts.override.review", anchor: "shift-overrides", route: DEMO_SHIFTS, title: "Schvalování výjimek", body: "Tlačítkem Výjimky otevřete panel žádostí o výjimky z pravidel plánu ke schválení.", placement: "bottom" },
  { permission: "shifts.planEmployees.manage", anchor: "shift-add-employee", route: DEMO_SHIFTS, title: "Přidání zaměstnance", body: "Tlačítkem Přidat zaměstnance určujete, kdo se v plánu zobrazuje.", placement: "bottom" },
  { permission: "shifts.xAllowance.manage", anchor: "shift-x-badge", route: DEMO_SHIFTS, title: "Limit X", body: "Můžete nastavit maximální počet volných dnů pro každého zaměstnance v plánu.", placement: "bottom" },
  { permission: "shifts.freeShift.manage", anchor: "shift-free", route: DEMO_SHIFTS_PUBLISHED, title: "Správa volných DPA směn", body: "DPQ, NPQ a NPA směny se jako volné zobrazují automaticky, pokud nejsou nikomu přiřazeny. Pro DPA směny můžete označit dny, o které si mohou zaměstnanci zažádat.", placement: "bottom" },
  { permission: "shifts.export", anchor: "shift-export", route: DEMO_SHIFTS, title: "Export plánu", body: "Tabulku směn můžete exportovat do CSV nebo PDF.", placement: "bottom" },
  { permission: "shifts.plan.create", anchor: "shift-create", route: DEMO_SHIFTS_EMPTY, title: "Vytvoření plánu", body: "Tlačítkem Vytvořit plán založíte nový měsíční plán směn.", placement: "bottom" },
  { permission: "shifts.plan.edit", anchor: "shift-edit-deadlines", route: DEMO_SHIFTS, title: "Automatizace plánování", body: "Zde nastavíte termíny plánu (otevření, uzávěrka, publikování).", placement: "bottom" },
  { permission: "shifts.plan.transition", anchor: "shift-transitions", route: DEMO_SHIFTS, title: "Změna stavu plánu", body: "Tímto tlačítkem změníte stav tabulky směn (posloupnost stavů je Vytvořený → Otevřený → Uzavřený → Publikovaný). Stav plánu určuje, kdo do něj smí zapisovat.", placement: "bottom" },
  { permission: "shifts.plan.revert", anchor: "shift-revert", route: DEMO_SHIFTS, title: "Vrácení plánu zpět", body: "Tlačítkem Vrátit zpět vrátíte plán do předchozího stavu.", placement: "bottom" },
  { permission: "shifts.plan.delete", anchor: "shift-delete", route: DEMO_SHIFTS_CREATED, title: "Smazání plánu", body: "Tlačítkem Smazat plán nevratně odstraníte celý měsíční plán (aplikace se zeptá na potvrzení).", placement: "bottom" },

  // ── Dovolená (/dovolena) ─────────────────────────────────────────────────────
  { section: SECTIONS.vacation, permission: "nav.vacation.view", anchor: "nav-dovolena", title: "Dovolená", body: "Sekce Dovolená slouží k podávání a sledování žádostí o dovolenou.", placement: "right" },
  { permission: "vacation.request.self", anchor: "vacation-request-form", route: "/dovolena", title: "Nová žádost o dovolenou", body: "Zadejte termín a důvod dovolené (důvod můžete nechat i prázdný). Odesláním žádosti ji předáte ke schválení řediteli nebo adminovi. Pokud máte v daném termínu už naplánovanou nějakou směnu, aplikace vás na to upozorní.", placement: "right" },
  // Two variants of the all-requests panel: reviewers also get the approve/reject
  // line; view-only holders (vacation.view.all without vacation.review) see the
  // list described without it. The inverse gate keeps reviewers on the first only.
  { permission: "vacation.review", anchor: "vacation-all-requests", route: "/dovolena", title: "Žádosti o dovolenou", body: "Seznam žádostí všech zaměstnanců se stavem (čeká, schváleno, zamítnuto). Žádosti zde můžete schvalovat nebo zamítat.", placement: "top" },
  { permission: "vacation.view.all", excludeIfPermission: "vacation.review", anchor: "vacation-all-requests", route: "/dovolena", title: "Žádosti o dovolenou", body: "Seznam žádostí všech zaměstnanců se stavem (čeká, schváleno, zamítnuto).", placement: "top" },
  { permission: "vacation.view.approvedUpcoming", excludeIfPermission: "vacation.view.all", anchor: "vacation-approved-colleagues", route: "/dovolena", title: "Schválené dovolené kolegů", body: "Zde vidíte schválené dovolené vašich kolegů. Pokud je to možné, snažte se vyhnout kolizi termínu s někým jiným.", placement: "top" },

  // ── Zaměstnanci — seznam (/zamestnanci) ──────────────────────────────────────
  // Merged: view.all (vedení incl.) + view.nonManagement collapse into one step.
  { section: SECTIONS.employees, permission: "nav.employees.view", anchor: "nav-zamestnanci", title: "Zaměstnanci", body: "Sekce Zaměstnanci obsahuje karty zaměstnanců s údaji, doklady, smlouvami a historií pracovního poměru.", placement: "right" },
  { permission: ["employees.view.all", "employees.view.nonManagement"], anchor: "emp-list", scrollBlock: "start", route: "/zamestnanci", title: "Seznam zaměstnanců", body: "Zde vidíte seznam zaměstnanců. Kliknutím na jméno otevřete zaměstnaneckou kartu.", placement: "bottom" },
  { permission: ["employees.view.all", "employees.view.nonManagement"], anchor: "emp-filters", route: "/zamestnanci", title: "Vyhledávání a filtr", body: "Ve vyhledávacím poli můžete hledat zaměstnance podle jména (i za svobodna), pracovní pozice nebo národnosti. Vyhledávání funguje napříč všemi záložkami. Přepínačem záložek zvolíte, jakou kategorii zaměstnanců zobrazit.", placement: "bottom" },
  { permission: "employees.export", anchor: "emp-export", route: "/zamestnanci", title: "Export seznamu", body: "Seznam zaměstnanců můžete exportovat do CSV.", placement: "bottom" },
  { permission: "employees.create", anchor: "emp-create", route: "/zamestnanci", title: "Vytvoření zaměstnance", body: "Tlačítkem Přidat zaměstnance založíte novou kartu.", placement: "bottom" },

  // ── Zaměstnanec — karta: REAL detail page fed by mock data (/zamestnanci/tour-demo) ──
  // Detail-tab sections are expanded by default; history/docs controls live on
  // their tab, so those steps `reveal` (click) the tab button first.
  { permission: "employees.edit", anchor: "emp-hero-edit", route: DEMO_EMP, title: "Úprava zaměstnance", body: "Tlačítkem Upravit změníte údaje na kartě zaměstnance.", placement: "bottom" },
  { permission: "employees.delete", anchor: "emp-hero-delete", route: DEMO_EMP, title: "Smazání zaměstnance", body: "Tlačítkem Smazat nevratně odstraníte kartu zaměstnance (aplikace se zeptá na potvrzení). Nelze smazat zaměstnance, který má záznamy v tabulce směn.", placement: "bottom" },
  { permission: "sensitive.reveal", anchor: "emp-reveal", route: DEMO_EMP, reveal: ["emp-tab-detail"], title: "Zobrazení citlivých údajů", body: "Ikonou oka dočasně odhalíte citlivé údaje (např. rodné číslo, číslo účtu). Každé zobrazení je zaznamenáno v logu aplikace.", placement: "left" },
  { permission: "benefits.view", anchor: "emp-section-benefits", route: DEMO_EMP, reveal: ["emp-tab-detail"], title: "Benefity", body: "V sekci Benefity vidíte zaměstnanecké výhody, např. Multisport.", placement: "left" },
  { permission: "benefits.edit", anchor: "emp-benefits", route: DEMO_EMP, reveal: ["emp-tab-detail"], title: "Úprava Multisport", body: "Zde můžete upravit Multisport benefity zaměstnance (platnost, doprovodné osoby, atd.).", placement: "left" },
  { permission: "employment.view", anchor: "emp-tab-history", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Historie pracovního poměru", body: "Zde vidíte historii pracovního poměru zaměstnance.", placement: "bottom" },
  { permission: "employment.manage", anchor: "emp-employment-add", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Správa pracovního poměru", body: "Můžete spravovat pracovní poměr zaměstnance (nástup, dodatky, ukončení).", placement: "bottom" },
  // Contracts ordered: generate → view → edit → delete → sign (per user verdict 2026-06-09).
  { permission: "contracts.generate", anchor: "emp-contract-generate", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Generování smlouvy", body: "Z šablony vygenerujete smlouvu nebo dodatek pro zaměstnance.", placement: "left" },
  { permission: "contracts.view", anchor: "emp-contract-view", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Zobrazení smluv", body: "Vygenerované smlouvy a dodatky lze zobrazit a stáhnout.", placement: "left" },
  { permission: "contracts.edit", anchor: "emp-contract-edit", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Úprava smlouvy", body: "Údaje v tomto záznamu můžete upravit. Pokud už jste měli vygenerovanou smlouvu s původními údaji, aplikace vám umožní ji generovat znovu s pozměněnými údaji.", placement: "left" },
  { permission: "contracts.delete", anchor: "emp-contract-delete", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Smazání smlouvy", body: "Tlačítkem Smazat smlouvu odstraníte vygenerovanou smlouvu (aplikace se zeptá na potvrzení).", placement: "left" },
  { permission: "contracts.sign", anchor: "emp-contract-sign", route: DEMO_EMP, reveal: ["emp-tab-history"], title: "Podepsaná smlouva", body: "Tlačítkem Nahrát podepsanou smlouvu označíte smlouvu jako podepsanou a nahrajete naskenovanou podepsanou verzi.", placement: "left" },
  { permission: "documents.view", anchor: "emp-tab-docs", route: DEMO_EMP, reveal: ["emp-tab-docs"], title: "Další dokumenty", body: "Na záložce Další dokumenty vidíte nahrané dokumenty zaměstnance.", placement: "left" },
  { permission: "documents.upload", anchor: "emp-doc-upload", route: DEMO_EMP, reveal: ["emp-tab-docs"], title: "Nahrání dokumentu", body: "Tlačítkem Nahrát dokument přidáte k zaměstnanci další dokument.", placement: "bottom" },
  { permission: "documents.delete", anchor: "emp-doc-delete", route: DEMO_EMP, reveal: ["emp-tab-docs"], title: "Smazání dokumentu", body: "Tlačítkem Smazat odstraníte nahraný dokument (aplikace se zeptá na potvrzení).", placement: "left" },

  // ── Můj profil — REAL self page fed by mock data (/napoveda/ukazka-profil) ──────
  { section: SECTIONS.profile, permission: "nav.profile.view", anchor: "nav-mujProfil", title: "Můj profil", body: "Můj profil zobrazuje vaše zaměstnanecké údaje.", placement: "right" },
  { permission: "self.profile.view", anchor: "selfpage-title", route: DEMO_SELF, title: "Můj profil", body: "Tato stránka zobrazuje vaši kartu zaměstnance — osobní údaje, kontakt, doklady a historii pracovního poměru. Slouží ke čtení. (Ukázková data pouze pro průvodce.)", placement: "bottom" },
  { permission: "self.profile.requestEdit", anchor: "selfpage-edit-btn", route: DEMO_SELF, title: "Navrhnout úpravu", body: "Tlačítkem Navrhnout úpravu můžete upravit svoje údaje a odeslat změny ke schválení. Změněné údaje se objeví až po schválení administrátorem nebo ředitelem.", placement: "left" },
  { permission: "sensitive.reveal.self", anchor: "selfpage-reveal", route: DEMO_SELF, title: "Zobrazení vlastních citlivých údajů", body: "Pole označená ikonou oka (např. rodné číslo) jsou skryta. Kliknutím je dočasně zobrazíte. Každé zobrazení je zaznamenáno v logu aplikace.", placement: "left" },
  { permission: "self.profile.requestEdit", anchor: "selfpage-requests", route: DEMO_SELF, title: "Vaše návrhy na změnu", body: "Zde vidíte odeslané návrhy na úpravu profilu a jejich stav. Změny čekající na schválení jde zrušit.", placement: "top" },

  // ── Šablony smluv (/smlouvy) ──────────────────────────────────────────────────
  { section: SECTIONS.templates, permission: "nav.contractTemplates.view", anchor: "nav-smlouvy", title: "Šablony smluv", body: "Zde se spravují šablony pracovních smluv a dodatků.", placement: "right" },
  { permission: "contractTemplates.view", anchor: "templates-list", route: "/smlouvy", title: "Zobrazení šablon", body: "V seznamu vlevo si vyberete a prohlédnete dostupné šablony.", placement: "right" },
  { permission: "contractTemplates.manage", anchor: "templates-new", route: "/smlouvy", title: "Nová šablona", body: "Tlačítkem Nová šablona vytvoříte šablonu. Její obsah upravíte v editoru a uložíte.", placement: "bottom" },

  // ── Mzdy (/mzdy) ──────────────────────────────────────────────────────────────
  { section: SECTIONS.payroll, permission: "nav.payroll.view", anchor: "nav-mzdy", title: "Mzdy", body: "V sekci Mzdy se vytvářejí a spravují mzdová období a provádějí přepočty mezd.", placement: "right" },
  { permission: "payroll.view", anchor: "payroll-table", route: DEMO_PAYROLL, title: "Zobrazení mezd", body: "Tabulka zobrazuje vypočtené mzdy zaměstnanců pro zvolené období. Mzdy se počítají automaticky z plánu směn a výpočet se aktualizuje každý den.", placement: "top" },
  { permission: "payroll.create", anchor: "payroll-create", route: DEMO_PAYROLL_EMPTY, title: "Vytvoření mzdového období", body: "Tlačítkem Vytvořit mzdy ručně založíte období pro zvolený měsíc. K tomu je nutné, aby existoval publikovaný plán směn na daný měsíc.", placement: "bottom" },
  { permission: "payroll.edit", anchor: "payroll-table", route: DEMO_PAYROLL, title: "Úprava mezd", body: "V odemčeném období upravíte jednotlivé položky dvojklikem na buňku.", placement: "top" },
  { permission: "payroll.notes.manage", anchor: "payroll-notes-col", route: DEMO_PAYROLL, title: "Poznámky ke mzdám", body: "Ve sloupci poznámek přidáváte a spravujete poznámky k jednotlivým mzdám.", placement: "top" },
  { permission: "payroll.recalculate", anchor: "payroll-recalc", route: DEMO_PAYROLL, title: "Přepočítání mezd", body: "Tímto tlačítkem můžete přepočítat mzdy pro tento měsíc. Všechny ruční úpravy zůstanou zachovány.", placement: "bottom" },
  { permission: "payroll.recalculate.hard", anchor: "payroll-recalc-hard", route: DEMO_PAYROLL, title: "Tvrdý přepočet", body: "Tímto tlačítkem můžete přepočítat mzdy „natvrdo“, tzn. ani ruční úpravy nezůstanou zachovány (aplikace se zeptá na potvrzení).", placement: "bottom" },
  { permission: "payroll.lock", anchor: "payroll-lock", route: DEMO_PAYROLL, title: "Uzamčení/odemčení období", body: "Daný měsíc můžete uzamknout pro úpravy. Uzamčený měsíc již není denně automaticky přepočítáván.", placement: "bottom" },
  { permission: "payroll.period.delete", anchor: "payroll-delete", route: DEMO_PAYROLL, title: "Smazání období", body: "Tlačítkem Smazat období nevratně odstraníte celé mzdové období (aplikace se zeptá na potvrzení).", placement: "bottom" },
  { permission: "payroll.export", anchor: "payroll-export", route: DEMO_PAYROLL, title: "Export mezd", body: "Mzdy můžete exportovat do PDF.", placement: "bottom" },

  // ── Upozornění (/upozorneni) ────────────────────────────────────────────────────
  { section: SECTIONS.alerts, permission: "nav.alerts.view", anchor: "nav-upozorneni", title: "Upozornění", body: "Sekce Upozornění shromažďuje důležité termíny a úkoly ke schválení.", placement: "right" },
  { permission: "alerts.view", anchor: "alerts-tabs", route: "/upozorneni", title: "Zobrazení upozornění", body: "Záložky člení upozornění (doklady, zkušební doba, dovolená, výjimky, žádosti).", placement: "bottom" },
  { permission: "alerts.read", anchor: "alerts-mark-read", route: "/upozorneni", title: "Označení jako přečtené", body: "Upozornění označíte jako přečtené jednotlivě nebo hromadně. Tento stav je sdílený pro všechny uživatele, kteří upozornění vidí.", placement: "bottom" },
  { permission: "system.triggers", anchor: "alerts-refresh", route: "/upozorneni", title: "Ruční obnovení", body: "Můžete ručně aktualizovat upozornění.", placement: "bottom" },

  // ── Log změn (/audit) ────────────────────────────────────────────────────────────
  { section: SECTIONS.audit, permission: "nav.audit.view", anchor: "nav-audit", title: "Log změn", body: "Log změn zaznamenává všechny změny dat provedené v aplikaci. V Logu změn dohledáte, kdo a kdy data změnil nebo zobrazil citlivé údaje.", placement: "right" },

  // ── Uživatelé a oprávnění (/nastaveni) — before the číselník tabs ──────────────────
  { section: SECTIONS.settings, permission: "nav.settings.view", anchor: "nav-nastaveni", title: "Nastavení", body: "Nastavení obsahuje seznamy (firem, pracovních pozic apod.), správu uživatelů, uživatelských typů a další konfiguraci.", placement: "right" },
  { permission: "users.view", anchor: "settings-tab-users", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Uživatelé", body: "Na záložce Uživatelé vidíte uživatelské účty.", placement: "bottom" },
  { permission: "users.manage", anchor: "settings-add-user", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Správa uživatelů", body: "Tlačítkem Přidat uživatele zakládáte účty, můžete je upravovat a deaktivovat.", placement: "bottom" },
  { permission: "users.setType", anchor: "settings-user-type", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Přiřazení typu", body: "U každého uživatele zvolíte typ, který určuje jeho výchozí oprávnění.", placement: "left" },
  { permission: "users.permissions.manage", anchor: "settings-user-perms", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Individuální oprávnění", body: "Tlačítkem Oprávnění uživateli nad rámec typu přidáte nebo odeberete konkrétní práva.", placement: "left" },
  { permission: "userTypes.manage", anchor: "settings-tab-userTypes", route: "/nastaveni", reveal: ["settings-tab-userTypes"], title: "Typy uživatelů", body: "Na záložce Uživatelské typy vytváříte a upravujete typy a jejich výchozí oprávnění.", placement: "bottom" },

  // ── Číselníky a nastavení (/nastaveni) ────────────────────────────────────────────
  { permission: "settings.companies.manage", anchor: "settings-tab-companies", route: "/nastaveni", reveal: ["settings-tab-companies"], title: "Správa společností", body: "Na záložce Společnosti přidáváte a upravujete údaje o firmách.", placement: "bottom" },
  { permission: "settings.departments.manage", anchor: "settings-tab-departments", route: "/nastaveni", reveal: ["settings-tab-departments"], title: "Správa oddělení", body: "Na záložce Oddělení spravujete seznam oddělení.", placement: "bottom" },
  { permission: "settings.jobPositions.manage", anchor: "settings-tab-jobPositions", route: "/nastaveni", reveal: ["settings-tab-jobPositions"], title: "Správa pozic", body: "Na záložce Pracovní pozice spravujete seznam pracovních pozic.", placement: "bottom" },
  { permission: "settings.educationLevels.manage", anchor: "settings-tab-education", route: "/nastaveni", reveal: ["settings-tab-education"], title: "Správa vzdělání", body: "Na záložce Vzdělání spravujete úrovně dosaženého vzdělání.", placement: "bottom" },
  { permission: "settings.payroll.manage", anchor: "settings-tab-payroll", route: "/nastaveni", reveal: ["settings-tab-payroll"], title: "Mzdová nastavení", body: "Na záložce Mzdy spravujete různá mzdová nastavení (např. výši minimální mzdy, stravenkový paušál apod.).", placement: "bottom" },
  { permission: "settings.menuOrder.manage", anchor: "settings-tab-menu", route: "/nastaveni", reveal: ["settings-tab-menu"], title: "Pořadí menu", body: "Na záložce Menu můžete nastavit pořadí položek v bočním menu pro jednotlivé uživatelské role.", placement: "bottom" },

  // ── Systém ─────────────────────────────────────────────────────────────────────
  { permission: "system.triggers", anchor: "settings-tab-jobs", route: "/nastaveni", reveal: ["settings-tab-jobs"], title: "Ruční spuštění úloh", body: "Na záložce Úlohy v Nastavení můžete ručně spustit naplánované úlohy (přechody plánů směn, obnova upozornění, přepočet aktuálních údajů). Každé spuštění je zaznamenáno v Logu změn.", placement: "bottom" },
  { permission: "system.timeOverride", anchor: "tour-timeclock", hideInProd: true, title: "Testovací hodiny", body: "Mimo live verzi můžete nastavit testovací „nynější“ čas pro ověřování chování závislého na datu. V live verzi je funkce neaktivní.", placement: "top" },
  { permission: "system.admin", anchor: null, title: "Superadmin", body: "Máte oprávnění superadministrátora — přístup ke všem funkcím bez omezení. Používejte je obezřetně, zejména u nevratných operací.", placement: "bottom" },

  // ── Outro ───────────────────────────────────────────────────────────────────────
  { section: SECTIONS.outro, anchor: "help-button", title: "Průvodce dokončen", body: "To je vše! Průvodce i nápovědu kdykoliv znovu otevřete tlačítkem „? Nápověda“ vlevo dole.", placement: "right" },
];

/**
 * Synthetic lead card for the "what's new" mini-tour (delta mode). NOT part of
 * APP_TOUR_STEPS — buildAppTour prepends it when `sinceVersion` is set and new
 * steps exist, so an incremental tour feels intentional instead of dropping the
 * returning user straight into an unfamiliar feature.
 */
export const WHATS_NEW_INTRO: TourStep = {
  anchor: null,
  title: "Co je nového",
  body: "Od vašeho posledního přihlášení přibyly nové funkce. Tady je jejich krátké představení. Celého průvodce aplikací můžete kdykoliv spustit znovu z Nápovědy vlevo dole.",
};

export const appTour: TourDefinition = {
  id: "app",
  // Highest step `addedInVersion` in the list. Bump it (and stamp the new steps'
  // `addedInVersion`) whenever you add steps for a new feature — returning users
  // then see ONLY those steps; first-time users still get the whole tour.
  version: 6,
  label: "Prohlídka aplikace",
  steps: APP_TOUR_STEPS,
};
