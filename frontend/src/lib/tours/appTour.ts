import type { TourStep, TourDefinition } from "./types";

/**
 * Master, permission-driven tour step list.
 *
 * There is ONE tour. It contains a step for every permission in the catalog
 * (functions/src/auth/permissions.ts ↔ frontend/src/lib/permissions/catalog.ts).
 * At runtime the OnboardingContext filters this list down to the steps the
 * current user actually holds (`can(step.permission)`); steps with no
 * `permission` (welcome / outro) are always shown. So the tour each user sees
 * matches exactly the rights they have — independent of any "role".
 *
 * Anchoring rules (so a step never strands the user):
 *  - Page-feature steps that have a real `data-tour` anchor carry `route` on
 *    EVERY such step (so they survive filtering even if earlier steps drop).
 *  - All other capabilities spotlight their section's sidebar nav item
 *    (always present, no navigation needed).
 *  - The overlay engine falls back to a centered card if an anchor is missing.
 *
 * Order = a logical walkthrough: navigation → the four self-service pages
 * (Přehled, Směny, Dovolená, Můj profil) → management areas (sidebar-anchored)
 * → system → outro.
 *
 * NOTE: keep this list complete. When a new permission is added to the catalog,
 * add a matching step here (and the permission matrix per the project rule).
 */
export const APP_TOUR_STEPS: TourStep[] = [
  // ── Welcome ───────────────────────────────────────────────────────────────
  {
    anchor: null,
    title: "Vítejte v HPM Intranetu",
    body: "Tento průvodce vás provede částmi aplikace, ke kterým máte přístup. Obsah se přizpůsobuje vašim oprávněním, takže uvidíte přesně to, co můžete používat. Průvodce můžete kdykoliv ukončit tlačítkem Přeskočit a později znovu spustit z Nápovědy.",
  },

  // ── Stránky / navigace (sidebar nav items) ──────────────────────────────────
  {
    permission: "nav.dashboard.view",
    anchor: "nav-prehled",
    title: "Přehled",
    body: "Přehled je vaše úvodní obrazovka se shrnutím dnešního dne. Otevřete ji kdykoliv z bočního menu.",
    placement: "right",
  },
  {
    permission: "nav.shifts.view",
    anchor: "nav-smeny",
    title: "Směny",
    body: "V sekci Směny najdete měsíční plán směn. Zde sledujete, kdy pracujete, a podáváte případné žádosti.",
    placement: "right",
  },
  {
    permission: "nav.vacation.view",
    anchor: "nav-dovolena",
    title: "Dovolená",
    body: "Sekce Dovolená slouží k podávání a sledování žádostí o dovolenou.",
    placement: "right",
  },
  {
    permission: "nav.employees.view",
    anchor: "nav-zamestnanci",
    title: "Zaměstnanci",
    body: "Sekce Zaměstnanci obsahuje karty zaměstnanců s osobními údaji, doklady, smlouvami a historií pracovního poměru.",
    placement: "right",
  },
  {
    permission: "nav.payroll.view",
    anchor: "nav-mzdy",
    title: "Mzdy",
    body: "V sekci Mzdy se vytvářejí a spravují mzdová období a provádějí přepočty.",
    placement: "right",
  },
  {
    permission: "nav.alerts.view",
    anchor: "nav-upozorneni",
    title: "Upozornění",
    body: "Sekce Upozornění shromažďuje důležité termíny a úkoly — končící doklady, zkušební doby, žádosti ke schválení.",
    placement: "right",
  },
  {
    permission: "nav.contractTemplates.view",
    anchor: "nav-smlouvy",
    title: "Šablony smluv",
    body: "Zde se spravují šablony pracovních smluv a dodatků používané při generování dokumentů.",
    placement: "right",
  },
  {
    permission: "nav.audit.view",
    anchor: "nav-audit",
    title: "Log změn",
    body: "Log změn zaznamenává všechny úpravy dat v systému i každé zobrazení citlivých údajů.",
    placement: "right",
  },
  {
    permission: "nav.settings.view",
    anchor: "nav-nastaveni",
    title: "Nastavení",
    body: "Nastavení obsahuje číselníky (společnosti, oddělení, pozice), správu uživatelů a typů uživatelů, pořadí menu a další konfiguraci.",
    placement: "right",
  },
  {
    permission: "nav.profile.view",
    anchor: "nav-mujProfil",
    title: "Můj profil",
    body: "Můj profil zobrazuje vaši vlastní kartu zaměstnance.",
    placement: "right",
  },

  // ── Přehled (/prehled) ──────────────────────────────────────────────────────
  {
    permission: "dashboard.view",
    anchor: "overview-date-header",
    route: "/prehled",
    title: "Přehled — dnešní datum",
    body: "Datum nahoře vždy ukazuje, pro který den jsou zobrazené informace — tedy dnešek.",
    placement: "bottom",
  },
  {
    permission: "dashboard.stats.view",
    anchor: "overview-staffing",
    route: "/prehled",
    title: "Obsazení a statistiky",
    body: "Sekce Dnes zobrazuje aktuální obsazení hotelu — kdo je na recepci, kteří portýři jsou přítomni a kdo má roli MOD — spolu se statistikami personálu.",
    placement: "bottom",
  },
  {
    permission: "dashboard.tasks.view",
    anchor: "overview-task-tiles",
    route: "/prehled",
    title: "Úkoly ke schválení",
    body: "Dlaždice úkolů upozorňují na položky čekající na vaše schválení — žádosti o dovolenou, změny směn nebo úpravy údajů. Kliknutím přejdete přímo k vyřízení.",
    placement: "bottom",
  },

  // ── Směny (/smeny) ──────────────────────────────────────────────────────────
  {
    permission: "shifts.view.self",
    anchor: "shift-month-nav",
    route: "/smeny",
    title: "Výběr měsíce",
    body: "Šipkami vlevo a vpravo přecházíte mezi měsíci. Tlačítkem Dnes se vrátíte na aktuální měsíc. V plánu vidíte své naplánované směny.",
    placement: "bottom",
  },
  {
    permission: "shifts.view.all",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Celý plán směn",
    body: "Tabulka zobrazuje měsíční plán směn všech zaměstnanců. Každé políčko odpovídá jednomu dni; kódy jako DA, NS nebo X označují typ směny nebo volno. Pod tabulkou je legenda všech kódů.",
    placement: "bottom",
  },
  {
    permission: "shifts.counterTable.view",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Tabulka obsazenosti",
    body: "Pod plánem se zobrazuje souhrnná tabulka obsazenosti — počty lidí na jednotlivých pozicích pro každý den. Pomáhá zkontrolovat, že je každý den dostatečně pokrytý.",
    placement: "bottom",
  },
  {
    permission: "shifts.cells.editOwnX",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Zadání vlastního volna (X)",
    body: "Do svého řádku můžete v otevřeném plánu přímo zapsat X (volno). Ostatní typy směn za vás vyplňuje vedoucí.",
    placement: "bottom",
  },
  {
    permission: "shifts.cells.edit",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Vyplňování plánu",
    body: "V otevřeném plánu můžete přímo upravovat směny všech zaměstnanců — kliknutím do buňky zapíšete kód (DA, NS, X), mažete nebo přepisujete záznamy. Plán v uzavřeném či publikovaném stavu je jen pro čtení.",
    placement: "bottom",
  },
  {
    permission: "shifts.changeRequest.submit",
    anchor: "shift-my-requests",
    route: "/smeny",
    title: "Žádost o změnu směny",
    body: "Novou žádost o změnu směny podáte dvojklikem na příslušnou buňku v plánu. V sekci Moje žádosti vlevo nahoře sledujete stav všech svých žádostí.",
    placement: "top",
  },
  {
    permission: "shifts.freeShift.claim",
    anchor: "shift-my-requests",
    route: "/smeny",
    title: "Žádost o volnou směnu",
    body: "Žádost o volnou (neobsazenou) směnu portýrů podáte dvojklikem na barevný štítek pod tabulkou. Stav žádosti uvidíte v sekci Moje žádosti.",
    placement: "top",
  },
  {
    permission: "shifts.changeRequest.review",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Schvalování žádostí o změnu",
    body: "Žádosti zaměstnanců o změnu směny se vám zobrazují ke schválení nebo zamítnutí přímo v plánu a v Upozorněních.",
    placement: "bottom",
  },
  {
    permission: "shifts.override.submit",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Žádost o výjimku",
    body: "Pokud potřebujete překročit limit volných dnů (X) nebo jiné pravidlo, podáte žádost o výjimku, kterou schvaluje nadřízený.",
    placement: "bottom",
  },
  {
    permission: "shifts.override.review",
    anchor: "shift-grid",
    route: "/smeny",
    title: "Schvalování výjimek",
    body: "Žádosti o výjimky z pravidel plánu (např. překročení limitu X) se vám zobrazují ke schválení.",
    placement: "bottom",
  },
  {
    permission: "shifts.plan.create",
    anchor: "nav-smeny",
    title: "Vytvoření plánu",
    body: "Můžete založit nový měsíční plán směn, do kterého se pak zadávají směny zaměstnanců.",
    placement: "right",
  },
  {
    permission: "shifts.plan.edit",
    anchor: "nav-smeny",
    title: "Úprava plánu",
    body: "Můžete upravovat termíny a metadata plánu (např. uzávěrku zadávání).",
    placement: "right",
  },
  {
    permission: "shifts.plan.transition",
    anchor: "nav-smeny",
    title: "Přechody stavu plánu",
    body: "Můžete plán otevírat, zavírat a publikovat. Stav plánu určuje, kdo do něj smí zapisovat.",
    placement: "right",
  },
  {
    permission: "shifts.plan.revert",
    anchor: "nav-smeny",
    title: "Vrácení plánu zpět",
    body: "Můžete vrátit plán do předchozího stavu, pokud je potřeba opravit chybný přechod.",
    placement: "right",
  },
  {
    permission: "shifts.plan.delete",
    anchor: "nav-smeny",
    title: "Smazání plánu",
    body: "Můžete smazat celý měsíční plán. Jde o nevratnou akci, proto je potřeba ji potvrdit.",
    placement: "right",
  },
  {
    permission: "shifts.planEmployees.manage",
    anchor: "nav-smeny",
    title: "Zaměstnanci v plánu",
    body: "Můžete určovat, kteří zaměstnanci se v daném plánu zobrazují.",
    placement: "right",
  },
  {
    permission: "shifts.mod.manage",
    anchor: "nav-smeny",
    title: "Správa MOD",
    body: "Můžete přiřazovat roli MOD (vedoucí směny) jednotlivým dnům plánu.",
    placement: "right",
  },
  {
    permission: "shifts.xAllowance.manage",
    anchor: "nav-smeny",
    title: "Limit volných dnů (X)",
    body: "Můžete nastavit maximální počet volných dnů (X) pro zaměstnance v daném plánu.",
    placement: "right",
  },
  {
    permission: "shifts.freeShift.manage",
    anchor: "nav-smeny",
    title: "Správa volných směn (DPA)",
    body: "Můžete označovat volné (neobsazené) směny portýrů jako DPA dny, o které pak mohou zaměstnanci žádat.",
    placement: "right",
  },
  {
    permission: "shifts.export",
    anchor: "nav-smeny",
    title: "Export plánu",
    body: "Plán směn můžete exportovat do PDF nebo CSV.",
    placement: "right",
  },

  // ── Dovolená (/dovolena) ─────────────────────────────────────────────────────
  {
    permission: "vacation.request.self",
    anchor: "vacation-request-form",
    route: "/dovolena",
    title: "Nová žádost o dovolenou",
    body: "Zde zadáte termín a důvod a tlačítkem Odeslat žádost ji předáte ke schválení. Pokud termín koliduje s naplánovanou směnou, aplikace vás upozorní.",
    placement: "right",
  },
  {
    permission: "vacation.view.all",
    anchor: "vacation-my-requests",
    route: "/dovolena",
    title: "Žádosti o dovolenou",
    body: "Seznam žádostí o dovolenou s jejich stavem (čeká, schváleno, zamítnuto). Vidíte zde žádosti všech zaměstnanců.",
    placement: "top",
  },
  {
    permission: "vacation.review",
    anchor: "vacation-my-requests",
    route: "/dovolena",
    title: "Schvalování dovolené",
    body: "Žádosti o dovolenou můžete schvalovat nebo zamítat. Schválené termíny se promítnou do přehledu nepřítomností.",
    placement: "top",
  },
  {
    permission: "vacation.view.approvedUpcoming",
    anchor: "vacation-approved-colleagues",
    route: "/dovolena",
    title: "Schválené dovolené kolegů",
    body: "Přehled schválených dovolených ostatních zaměstnanců — pomáhá naplánovat vlastní dovolenou bez kolizí.",
    placement: "top",
  },

  // ── Můj profil (/muj-profil) ─────────────────────────────────────────────────
  {
    permission: "self.profile.view",
    anchor: "selfpage-title",
    route: "/muj-profil",
    title: "Můj profil",
    body: "Tato stránka zobrazuje vaši kartu zaměstnance — osobní údaje, kontakt, doklady a historii pracovního poměru. Slouží ke čtení.",
    placement: "bottom",
  },
  {
    permission: "self.profile.requestEdit",
    anchor: "selfpage-edit-btn",
    route: "/muj-profil",
    title: "Navrhnout úpravu",
    body: "Tlačítkem Navrhnout úpravu odešlete návrh na změnu svých údajů. Změna neprojde okamžitě — čeká na schválení, takže stávající údaje platí až do schválení.",
    placement: "left",
  },
  {
    permission: "sensitive.reveal.self",
    anchor: "selfpage-reveal",
    route: "/muj-profil",
    title: "Zobrazení vlastních citlivých údajů",
    body: "Pole označená ikonou oka (např. rodné číslo) jsou skryta z bezpečnostních důvodů. Kliknutím je dočasně zobrazíte; každé zobrazení je zaznamenáno v logu změn.",
    placement: "left",
  },
  {
    permission: "changeRequests.submit.self",
    anchor: "selfpage-requests",
    route: "/muj-profil",
    title: "Vaše návrhy na změnu",
    body: "Zde vidíte všechny odeslané návrhy na úpravu profilu a jejich stav. Čekající návrhy lze stáhnout, dokud nebyly schváleny.",
    placement: "top",
  },

  // ── Zaměstnanci (sidebar-anchored — karty na detailu zaměstnance) ────────────
  {
    permission: "employees.view.all",
    anchor: "nav-zamestnanci",
    title: "Zobrazení všech zaměstnanců",
    body: "Vidíte kompletní seznam zaměstnanců včetně vedení a jejich detailní karty.",
    placement: "right",
  },
  {
    permission: "employees.view.nonManagement",
    anchor: "nav-zamestnanci",
    title: "Zobrazení zaměstnanců (kromě vedení)",
    body: "Vidíte seznam zaměstnanců s výjimkou členů vedení.",
    placement: "right",
  },
  {
    permission: "employees.create",
    anchor: "nav-zamestnanci",
    title: "Vytvoření zaměstnance",
    body: "Můžete zakládat nové karty zaměstnanců tlačítkem Nový zaměstnanec.",
    placement: "right",
  },
  {
    permission: "employees.edit",
    anchor: "nav-zamestnanci",
    title: "Úprava zaměstnance",
    body: "Můžete upravovat údaje na kartě zaměstnance.",
    placement: "right",
  },
  {
    permission: "employees.delete",
    anchor: "nav-zamestnanci",
    title: "Smazání zaměstnance",
    body: "Můžete smazat kartu zaměstnance. Jde o citlivou, nevratnou akci, kterou je nutné potvrdit.",
    placement: "right",
  },
  {
    permission: "employees.export",
    anchor: "nav-zamestnanci",
    title: "Export seznamu (CSV)",
    body: "Seznam zaměstnanců můžete exportovat do CSV.",
    placement: "right",
  },
  {
    permission: "employees.export.sensitive",
    anchor: "nav-zamestnanci",
    title: "Export včetně citlivých údajů",
    body: "Můžete exportovat i citlivé údaje (např. rodná čísla). Každý takový export je zaznamenán v logu změn.",
    placement: "right",
  },
  {
    permission: "sensitive.reveal",
    anchor: "nav-zamestnanci",
    title: "Zobrazení cizích citlivých údajů",
    body: "Na kartách zaměstnanců můžete odhalit citlivá pole (rodné číslo, číslo dokladu). Každé zobrazení je zaznamenáno v logu změn.",
    placement: "right",
  },
  {
    permission: "employment.view",
    anchor: "nav-zamestnanci",
    title: "Historie pracovního poměru",
    body: "Na kartě zaměstnance vidíte historii pracovního poměru — nástupy, dodatky a ukončení.",
    placement: "right",
  },
  {
    permission: "employment.manage",
    anchor: "nav-zamestnanci",
    title: "Správa pracovního poměru",
    body: "Můžete spravovat pracovní poměr — zadávat Nástup, Dodatek (změnu) a Ukončení. Tyto změny ovlivňují i výpočet mezd.",
    placement: "right",
  },

  // ── Smlouvy ──────────────────────────────────────────────────────────────────
  {
    permission: "contracts.view",
    anchor: "nav-zamestnanci",
    title: "Zobrazení smluv",
    body: "Na kartě zaměstnance můžete zobrazit a stáhnout vygenerované smlouvy a dodatky.",
    placement: "right",
  },
  {
    permission: "contracts.generate",
    anchor: "nav-zamestnanci",
    title: "Generování smlouvy",
    body: "Z šablony můžete vygenerovat smlouvu nebo dodatek pro daného zaměstnance.",
    placement: "right",
  },
  {
    permission: "contracts.edit",
    anchor: "nav-zamestnanci",
    title: "Úprava smlouvy",
    body: "Vygenerovanou smlouvu můžete před uložením upravit.",
    placement: "right",
  },
  {
    permission: "contracts.sign",
    anchor: "nav-zamestnanci",
    title: "Podepsaná smlouva",
    body: "Můžete označit smlouvu jako podepsanou a nahrát její podepsanou verzi.",
    placement: "right",
  },
  {
    permission: "contracts.delete",
    anchor: "nav-zamestnanci",
    title: "Smazání smlouvy",
    body: "Můžete smazat vygenerovanou smlouvu. Akci je nutné potvrdit.",
    placement: "right",
  },
  {
    permission: "contractTemplates.view",
    anchor: "nav-smlouvy",
    title: "Zobrazení šablon",
    body: "V sekci Šablony smluv si můžete prohlédnout dostupné šablony.",
    placement: "right",
  },
  {
    permission: "contractTemplates.manage",
    anchor: "nav-smlouvy",
    title: "Správa šablon",
    body: "Můžete vytvářet, upravovat a deaktivovat šablony smluv ve WYSIWYG editoru.",
    placement: "right",
  },

  // ── Další dokumenty ───────────────────────────────────────────────────────────
  {
    permission: "documents.view",
    anchor: "nav-zamestnanci",
    title: "Další dokumenty",
    body: "Na kartě zaměstnance vidíte záložku s dalšími nahranými dokumenty.",
    placement: "right",
  },
  {
    permission: "documents.upload",
    anchor: "nav-zamestnanci",
    title: "Nahrání dokumentu",
    body: "Můžete k zaměstnanci nahrávat další dokumenty.",
    placement: "right",
  },
  {
    permission: "documents.delete",
    anchor: "nav-zamestnanci",
    title: "Smazání dokumentu",
    body: "Můžete mazat nahrané dokumenty. Akci je nutné potvrdit.",
    placement: "right",
  },

  // ── Benefity / Multisport ─────────────────────────────────────────────────────
  {
    permission: "benefits.view",
    anchor: "nav-zamestnanci",
    title: "Benefity",
    body: "Na kartě zaměstnance vidíte jeho benefity včetně Multisportu.",
    placement: "right",
  },
  {
    permission: "benefits.edit",
    anchor: "nav-zamestnanci",
    title: "Úprava benefitů / Multisport",
    body: "Můžete spravovat benefity a Multisport — období, doprovodné osoby a související údaje.",
    placement: "right",
  },

  // ── Mzdy (sidebar-anchored) ───────────────────────────────────────────────────
  {
    permission: "payroll.view",
    anchor: "nav-mzdy",
    title: "Zobrazení mezd",
    body: "Vidíte mzdová období a vypočtené mzdy zaměstnanců.",
    placement: "right",
  },
  {
    permission: "payroll.create",
    anchor: "nav-mzdy",
    title: "Vytvoření mzdového období",
    body: "Můžete založit nové mzdové období pro daný měsíc.",
    placement: "right",
  },
  {
    permission: "payroll.edit",
    anchor: "nav-mzdy",
    title: "Úprava mezd",
    body: "V odemčeném období můžete ručně upravovat jednotlivé mzdové položky.",
    placement: "right",
  },
  {
    permission: "payroll.recalculate",
    anchor: "nav-mzdy",
    title: "Přepočet (měkký)",
    body: "Můžete znovu spočítat mzdy ze zdrojových dat. Měkký přepočet zachová vaše ruční úpravy.",
    placement: "right",
  },
  {
    permission: "payroll.recalculate.hard",
    anchor: "nav-mzdy",
    title: "Tvrdý přepočet",
    body: "Tvrdý přepočet přepíše vše ze zdrojových dat a zahodí ruční úpravy. Jde o destruktivní akci, kterou je nutné potvrdit.",
    placement: "right",
  },
  {
    permission: "payroll.lock",
    anchor: "nav-mzdy",
    title: "Zamknutí období",
    body: "Můžete mzdové období zamknout (uzavřít) a opět odemknout. Zamčené období nelze upravovat.",
    placement: "right",
  },
  {
    permission: "payroll.period.delete",
    anchor: "nav-mzdy",
    title: "Smazání mzdového období",
    body: "Můžete smazat celé mzdové období. Jde o nevratnou akci, kterou je nutné potvrdit.",
    placement: "right",
  },
  {
    permission: "payroll.export",
    anchor: "nav-mzdy",
    title: "Export mezd",
    body: "Mzdy můžete exportovat do PDF nebo CSV.",
    placement: "right",
  },
  {
    permission: "payroll.notes.manage",
    anchor: "nav-mzdy",
    title: "Poznámky ke mzdám",
    body: "Můžete přidávat a spravovat poznámky k jednotlivým mzdám.",
    placement: "right",
  },

  // ── Upozornění (sidebar-anchored) ──────────────────────────────────────────────
  {
    permission: "alerts.view",
    anchor: "nav-upozorneni",
    title: "Zobrazení upozornění",
    body: "Vidíte upozornění na končící doklady, zkušební doby, dovolené, výjimky a žádosti o změny.",
    placement: "right",
  },
  {
    permission: "alerts.read",
    anchor: "nav-upozorneni",
    title: "Označení jako přečtené",
    body: "Upozornění můžete označit jako přečtené; stav je sdílený napříč oprávněnými uživateli.",
    placement: "right",
  },
  {
    permission: "alerts.refresh",
    anchor: "nav-upozorneni",
    title: "Ruční obnovení upozornění",
    body: "Můžete ručně přegenerovat systémová upozornění, aniž byste čekali na naplánovanou úlohu.",
    placement: "right",
  },

  // ── Žádosti o úpravu údajů (review) ─────────────────────────────────────────────
  {
    permission: "changeRequests.review",
    anchor: "nav-upozorneni",
    title: "Schvalování úprav údajů",
    body: "Návrhy zaměstnanců na úpravu vlastních údajů se vám zobrazují ke schválení nebo zamítnutí.",
    placement: "right",
  },

  // ── Log změn ────────────────────────────────────────────────────────────────────
  {
    permission: "audit.view",
    anchor: "nav-audit",
    title: "Log změn",
    body: "V Logu změn dohledáte, kdo a kdy data změnil nebo zobrazil citlivé údaje. Lze filtrovat podle zaměstnance, akce a období.",
    placement: "right",
  },

  // ── Číselníky a nastavení (sidebar-anchored) ──────────────────────────────────────
  {
    permission: "masterData.view",
    anchor: "nav-nastaveni",
    title: "Číselníky",
    body: "Vidíte číselníky — společnosti, oddělení, pracovní pozice a úrovně vzdělání.",
    placement: "right",
  },
  {
    permission: "settings.companies.manage",
    anchor: "nav-nastaveni",
    title: "Správa společností",
    body: "Můžete spravovat seznam společností v Nastavení.",
    placement: "right",
  },
  {
    permission: "settings.departments.manage",
    anchor: "nav-nastaveni",
    title: "Správa oddělení",
    body: "Můžete spravovat seznam oddělení.",
    placement: "right",
  },
  {
    permission: "settings.jobPositions.manage",
    anchor: "nav-nastaveni",
    title: "Správa pracovních pozic",
    body: "Můžete spravovat seznam pracovních pozic.",
    placement: "right",
  },
  {
    permission: "settings.educationLevels.manage",
    anchor: "nav-nastaveni",
    title: "Správa vzdělání",
    body: "Můžete spravovat úrovně vzdělání.",
    placement: "right",
  },
  {
    permission: "settings.payroll.manage",
    anchor: "nav-nastaveni",
    title: "Mzdová nastavení",
    body: "Můžete spravovat mzdová nastavení, např. minimální mzdu a sazby.",
    placement: "right",
  },
  {
    permission: "settings.menuOrder.manage",
    anchor: "nav-nastaveni",
    title: "Pořadí menu",
    body: "Můžete nastavit pořadí položek v bočním menu.",
    placement: "right",
  },

  // ── Uživatelé a oprávnění (sidebar-anchored) ──────────────────────────────────────
  {
    permission: "users.view",
    anchor: "nav-nastaveni",
    title: "Zobrazení uživatelů",
    body: "V Nastavení vidíte seznam uživatelských účtů.",
    placement: "right",
  },
  {
    permission: "users.manage",
    anchor: "nav-nastaveni",
    title: "Správa uživatelů",
    body: "Můžete zakládat, upravovat a deaktivovat uživatelské účty.",
    placement: "right",
  },
  {
    permission: "users.setType",
    anchor: "nav-nastaveni",
    title: "Přiřazení typu uživatele",
    body: "Můžete uživateli přiřadit typ, který určuje jeho výchozí sadu oprávnění.",
    placement: "right",
  },
  {
    permission: "users.permissions.manage",
    anchor: "nav-nastaveni",
    title: "Individuální oprávnění",
    body: "Můžete jednotlivému uživateli nad rámec jeho typu přidat nebo odebrat konkrétní oprávnění.",
    placement: "right",
  },
  {
    permission: "userTypes.manage",
    anchor: "nav-nastaveni",
    title: "Správa typů uživatelů",
    body: "Můžete vytvářet, klonovat, upravovat a mazat typy uživatelů a nastavovat jejich oprávnění v matici. Tato prohlídka se řídí přesně těmito oprávněními.",
    placement: "right",
  },

  // ── Systém ─────────────────────────────────────────────────────────────────────
  {
    permission: "system.timeOverride",
    anchor: "nav-nastaveni",
    title: "Testovací hodiny",
    body: "Mimo produkci můžete nastavit testovací „nynější“ čas pro ověřování chování závislého na datu. V produkci je tato funkce neaktivní.",
    placement: "right",
  },
  {
    permission: "system.triggers",
    anchor: "nav-nastaveni",
    title: "Ruční spuštění úloh",
    body: "Můžete ručně spustit naplánované úlohy (např. přepočet mezd nebo obnovu upozornění). Každé spuštění je zaznamenáno v logu změn.",
    placement: "right",
  },
  {
    permission: "system.admin",
    anchor: null,
    title: "Superadmin",
    body: "Máte oprávnění superadministrátora — přístup ke všem funkcím aplikace bez omezení. Používejte je obezřetně, zejména u nevratných a hromadných operací.",
  },

  // ── Outro ───────────────────────────────────────────────────────────────────────
  {
    anchor: "help-button",
    title: "Průvodce dokončen",
    body: "To je vše! Průvodce i tuto nápovědu si můžete kdykoliv znovu otevřít tlačítkem „? Nápověda“ vlevo dole. Přejeme vám příjemnou práci.",
    placement: "right",
  },
];

export const appTour: TourDefinition = {
  id: "app",
  version: 1,
  label: "Prohlídka aplikace",
  steps: APP_TOUR_STEPS,
};
