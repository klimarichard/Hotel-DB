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

const DEMO = "/napoveda/ukazka";

export const APP_TOUR_STEPS: TourStep[] = [
  // ── Welcome ───────────────────────────────────────────────────────────────
  {
    anchor: null,
    title: "Vítejte v HPM Intranetu",
    body: "Tento průvodce vás provede částmi aplikace, ke kterým máte přístup. Obsah se přizpůsobuje vašim oprávněním, takže uvidíte přesně to, co můžete používat. Průvodce můžete kdykoliv ukončit tlačítkem Přeskočit a později znovu spustit z Nápovědy.",
  },

  // ── Stránky / navigace (sidebar nav items) ──────────────────────────────────
  { permission: "nav.dashboard.view", anchor: "nav-prehled", title: "Přehled", body: "Přehled je vaše úvodní obrazovka se shrnutím dnešního dne. Otevřete ji kdykoliv z bočního menu.", placement: "right" },
  { permission: "nav.shifts.view", anchor: "nav-smeny", title: "Směny", body: "V sekci Směny najdete měsíční plán směn.", placement: "right" },
  { permission: "nav.vacation.view", anchor: "nav-dovolena", title: "Dovolená", body: "Sekce Dovolená slouží k podávání a sledování žádostí o dovolenou.", placement: "right" },
  { permission: "nav.employees.view", anchor: "nav-zamestnanci", title: "Zaměstnanci", body: "Sekce Zaměstnanci obsahuje karty zaměstnanců s údaji, doklady, smlouvami a historií poměru.", placement: "right" },
  { permission: "nav.payroll.view", anchor: "nav-mzdy", title: "Mzdy", body: "V sekci Mzdy se vytvářejí a spravují mzdová období a provádějí přepočty.", placement: "right" },
  { permission: "nav.alerts.view", anchor: "nav-upozorneni", title: "Upozornění", body: "Sekce Upozornění shromažďuje důležité termíny a úkoly ke schválení.", placement: "right" },
  { permission: "nav.contractTemplates.view", anchor: "nav-smlouvy", title: "Šablony smluv", body: "Zde se spravují šablony pracovních smluv a dodatků.", placement: "right" },
  { permission: "nav.audit.view", anchor: "nav-audit", title: "Log změn", body: "Log změn zaznamenává všechny úpravy dat i každé zobrazení citlivých údajů.", placement: "right" },
  { permission: "nav.settings.view", anchor: "nav-nastaveni", title: "Nastavení", body: "Nastavení obsahuje číselníky, správu uživatelů a typů, pořadí menu a další konfiguraci.", placement: "right" },
  { permission: "nav.profile.view", anchor: "nav-mujProfil", title: "Můj profil", body: "Můj profil zobrazuje vaši vlastní kartu zaměstnance.", placement: "right" },

  // ── Přehled (/prehled) ──────────────────────────────────────────────────────
  { permission: "dashboard.view", anchor: "overview-date-header", route: "/prehled", title: "Přehled — dnešní datum", body: "Datum nahoře vždy ukazuje, pro který den jsou zobrazené informace — tedy dnešek.", placement: "bottom" },
  { permission: "dashboard.stats.view", anchor: "overview-staffing", route: "/prehled", title: "Obsazení a statistiky", body: "Sekce Dnes zobrazuje aktuální obsazení hotelu spolu se statistikami personálu.", placement: "bottom" },
  { permission: "dashboard.tasks.view", anchor: "overview-task-tiles", route: "/prehled", title: "Úkoly ke schválení", body: "Dlaždice úkolů upozorňují na položky čekající na vaše schválení. Kliknutím přejdete k vyřízení.", placement: "bottom" },

  // ── Směny (/smeny) ──────────────────────────────────────────────────────────
  { permission: "shifts.view.self", anchor: "shift-month-nav", route: "/smeny", title: "Výběr měsíce", body: "Šipkami přecházíte mezi měsíci, tlačítkem Dnes zpět na aktuální. V plánu vidíte své směny.", placement: "bottom" },
  { permission: "shifts.view.all", anchor: "shift-grid", route: "/smeny", title: "Celý plán směn", body: "Tabulka zobrazuje měsíční plán všech zaměstnanců. Kódy (DA, NS, X…) označují typ směny nebo volno; legenda je pod tabulkou.", placement: "bottom" },
  { permission: "shifts.counterTable.view", anchor: "shift-grid", route: "/smeny", title: "Tabulka obsazenosti", body: "Pod plánem je souhrnná tabulka obsazenosti — počty lidí na pozicích pro každý den.", placement: "bottom" },
  { permission: "shifts.cells.editOwnX", anchor: "shift-grid", route: "/smeny", title: "Zadání vlastního volna (X)", body: "Do svého řádku můžete v otevřeném plánu přímo zapsat X (volno).", placement: "bottom" },
  { permission: "shifts.cells.edit", anchor: "shift-grid", route: "/smeny", title: "Vyplňování plánu", body: "V otevřeném plánu můžete kliknutím do buňky upravovat směny všech zaměstnanců.", placement: "bottom" },
  { permission: "shifts.changeRequest.submit", anchor: "shift-my-requests", route: "/smeny", title: "Žádost o změnu směny", body: "Žádost podáte dvojklikem na buňku v plánu; stav sledujete v sekci Moje žádosti.", placement: "top" },
  { permission: "shifts.freeShift.claim", anchor: "shift-my-requests", route: "/smeny", title: "Žádost o volnou směnu", body: "O volnou směnu portýrů zažádáte dvojklikem na barevný štítek pod tabulkou.", placement: "top" },
  { permission: "shifts.changeRequest.review", anchor: "shift-change-requests", route: "/smeny", title: "Schvalování žádostí o změnu", body: "Tlačítkem Žádosti o změny otevřete panel se žádostmi zaměstnanců ke schválení nebo zamítnutí.", placement: "bottom" },
  { permission: "shifts.override.submit", anchor: "shift-grid", route: "/smeny", title: "Žádost o výjimku", body: "Při překročení limitu (např. volných dnů) podáte přímo v plánu žádost o výjimku.", placement: "bottom" },
  { permission: "shifts.override.review", anchor: "shift-overrides", route: "/smeny", title: "Schvalování výjimek", body: "Tlačítkem Výjimky otevřete panel žádostí o výjimky z pravidel plánu ke schválení.", placement: "bottom" },
  { permission: "shifts.plan.create", anchor: "shift-create", route: "/smeny", title: "Vytvoření plánu", body: "Tlačítkem Vytvořit plán založíte nový měsíční plán směn.", placement: "bottom" },
  { permission: "shifts.plan.edit", anchor: "shift-edit-deadlines", route: "/smeny", title: "Úprava plánu", body: "Zde nastavíte termíny plánu (otevření, uzávěrka, publikování).", placement: "bottom" },
  { permission: "shifts.plan.transition", anchor: "shift-transitions", route: "/smeny", title: "Přechody stavu plánu", body: "Těmito tlačítky plán otevíráte, zavíráte a publikujete. Stav určuje, kdo smí zapisovat.", placement: "bottom" },
  { permission: "shifts.plan.revert", anchor: "shift-revert", route: "/smeny", title: "Vrácení plánu zpět", body: "Tlačítkem Vrátit zpět vrátíte plán do předchozího stavu.", placement: "bottom" },
  { permission: "shifts.plan.delete", anchor: "shift-delete", route: "/smeny", title: "Smazání plánu", body: "Tlačítkem Smazat plán nevratně odstraníte celý měsíční plán (s potvrzením).", placement: "bottom" },
  { permission: "shifts.planEmployees.manage", anchor: "shift-add-employee", route: "/smeny", title: "Zaměstnanci v plánu", body: "Tlačítkem Přidat zaměstnance určujete, kdo se v plánu zobrazuje.", placement: "bottom" },
  { permission: "shifts.mod.manage", anchor: "shift-grid", route: "/smeny", title: "Správa MOD", body: "V plánu přiřazujete roli MOD (vedoucí směny) jednotlivým dnům.", placement: "bottom" },
  { permission: "shifts.xAllowance.manage", anchor: "shift-grid", route: "/smeny", title: "Limit volných dnů (X)", body: "Nastavujete maximální počet volných dnů (X) pro zaměstnance v plánu.", placement: "bottom" },
  { permission: "shifts.freeShift.manage", anchor: "shift-grid", route: "/smeny", title: "Správa volných směn (DPA)", body: "Označujete volné směny portýrů jako DPA dny, o které pak zaměstnanci žádají.", placement: "bottom" },
  { permission: "shifts.export", anchor: "shift-export", route: "/smeny", title: "Export plánu", body: "Tlačítkem Exportovat uložíte plán do PDF nebo CSV.", placement: "bottom" },

  // ── Dovolená (/dovolena) ─────────────────────────────────────────────────────
  { permission: "vacation.request.self", anchor: "vacation-request-form", route: "/dovolena", title: "Nová žádost o dovolenou", body: "Zadáte termín a důvod a tlačítkem Odeslat žádost ji předáte ke schválení. Kolize se směnou aplikace ohlásí.", placement: "right" },
  { permission: "vacation.view.all", anchor: "vacation-my-requests", route: "/dovolena", title: "Žádosti o dovolenou", body: "Seznam žádostí se stavem (čeká, schváleno, zamítnuto) — vidíte žádosti všech zaměstnanců.", placement: "top" },
  { permission: "vacation.review", anchor: "vacation-my-requests", route: "/dovolena", title: "Schvalování dovolené", body: "Žádosti o dovolenou můžete schvalovat nebo zamítat.", placement: "top" },
  { permission: "vacation.view.approvedUpcoming", anchor: "vacation-approved-colleagues", route: "/dovolena", title: "Schválené dovolené kolegů", body: "Přehled schválených dovolených ostatních pomáhá plánovat bez kolizí.", placement: "top" },

  // ── Zaměstnanci — seznam (/zamestnanci) ──────────────────────────────────────
  { permission: "employees.view.all", anchor: "emp-list", route: "/zamestnanci", title: "Seznam zaměstnanců", body: "Vidíte kompletní seznam zaměstnanců včetně vedení; kliknutím na jméno otevřete kartu.", placement: "top" },
  { permission: "employees.view.nonManagement", anchor: "emp-list", route: "/zamestnanci", title: "Seznam zaměstnanců", body: "Vidíte seznam zaměstnanců s výjimkou členů vedení.", placement: "top" },
  { permission: "employees.create", anchor: "emp-create", route: "/zamestnanci", title: "Vytvoření zaměstnance", body: "Tlačítkem Přidat zaměstnance založíte novou kartu.", placement: "bottom" },
  { permission: "employees.export", anchor: "emp-export", route: "/zamestnanci", title: "Export seznamu", body: "Tlačítkem Exportovat CSV stáhnete seznam zaměstnanců.", placement: "bottom" },
  { permission: "employees.export.sensitive", anchor: "emp-export", route: "/zamestnanci", title: "Export citlivých údajů", body: "V dialogu exportu lze zahrnout i citlivé údaje (např. rodná čísla). Každý takový export je zaznamenán v logu změn.", placement: "bottom" },

  // ── Zaměstnanec — karta (tour demo profile /napoveda/ukazka) ──────────────────
  { permission: "self.profile.view", anchor: "demo-title", route: DEMO, title: "Karta zaměstnance / Můj profil", body: "Karta zobrazuje osobní údaje, kontakt, doklady, smlouvy a historii poměru. (Toto je ukázkový profil pouze pro průvodce.)", placement: "bottom" },
  { permission: "self.profile.requestEdit", anchor: "demo-self-edit", route: DEMO, title: "Navrhnout úpravu", body: "Tlačítkem Navrhnout úpravu odešlete návrh na změnu svých údajů — projde až po schválení.", placement: "bottom" },
  { permission: "changeRequests.submit.self", anchor: "demo-self-requests", route: DEMO, title: "Vaše návrhy na změnu", body: "Zde vidíte odeslané návrhy na úpravu profilu a jejich stav; čekající lze stáhnout.", placement: "top" },
  { permission: "employees.edit", anchor: "demo-hero-edit", route: DEMO, title: "Úprava zaměstnance", body: "Tlačítkem Upravit změníte údaje na kartě zaměstnance.", placement: "bottom" },
  { permission: "employees.delete", anchor: "demo-hero-delete", route: DEMO, title: "Smazání zaměstnance", body: "Tlačítkem Smazat nevratně odstraníte kartu zaměstnance (s potvrzením).", placement: "bottom" },
  { permission: "sensitive.reveal", anchor: "demo-reveal", route: DEMO, reveal: ["demo-tab-detail"], title: "Zobrazení cizích citlivých údajů", body: "Ikonou oka odhalíte citlivé pole (rodné číslo, číslo dokladu). Každé zobrazení je zaznamenáno v logu změn.", placement: "left" },
  { permission: "sensitive.reveal.self", anchor: "demo-reveal", route: DEMO, reveal: ["demo-tab-detail"], title: "Zobrazení vlastních citlivých údajů", body: "Svá citlivá pole zobrazíte kliknutím na ikonu oka; každé zobrazení je zaznamenáno v logu změn.", placement: "left" },
  { permission: "benefits.view", anchor: "demo-benefits", route: DEMO, reveal: ["demo-tab-detail"], title: "Benefity", body: "V sekci Benefity vidíte benefity zaměstnance včetně Multisportu.", placement: "left" },
  { permission: "benefits.edit", anchor: "demo-benefits", route: DEMO, reveal: ["demo-tab-detail"], title: "Úprava benefitů / Multisport", body: "Tlačítkem Spravovat upravíte benefity a Multisport (období, doprovodné osoby).", placement: "left" },
  { permission: "employment.view", anchor: "demo-employment", route: DEMO, reveal: ["demo-tab-history"], title: "Historie pracovního poměru", body: "Na záložce Historie vidíte nástupy, dodatky a ukončení pracovního poměru.", placement: "bottom" },
  { permission: "employment.manage", anchor: "demo-employment", route: DEMO, reveal: ["demo-tab-history"], title: "Správa pracovního poměru", body: "Spravujete poměr — Nástup, Dodatek (změna) a Ukončení. Tyto změny ovlivňují i výpočet mezd.", placement: "bottom" },
  { permission: "contracts.view", anchor: "demo-contract-view", route: DEMO, reveal: ["demo-tab-history"], title: "Zobrazení smluv", body: "Vygenerované smlouvy a dodatky lze zobrazit a stáhnout.", placement: "left" },
  { permission: "contracts.generate", anchor: "demo-contract-generate", route: DEMO, reveal: ["demo-tab-history"], title: "Generování smlouvy", body: "Z šablony vygenerujete smlouvu nebo dodatek pro zaměstnance.", placement: "left" },
  { permission: "contracts.edit", anchor: "demo-contract-edit", route: DEMO, reveal: ["demo-tab-history"], title: "Úprava smlouvy", body: "Vygenerovanou smlouvu lze před uložením upravit.", placement: "left" },
  { permission: "contracts.sign", anchor: "demo-contract-sign", route: DEMO, reveal: ["demo-tab-history"], title: "Podepsaná smlouva", body: "Tlačítkem Nahrát podepsanou smlouvu označíte smlouvu jako podepsanou a nahrajete její verzi.", placement: "left" },
  { permission: "contracts.delete", anchor: "demo-contract-delete", route: DEMO, reveal: ["demo-tab-history"], title: "Smazání smlouvy", body: "Tlačítkem Smazat smlouvu odstraníte vygenerovanou smlouvu (s potvrzením).", placement: "left" },
  { permission: "documents.view", anchor: "demo-doc-view", route: DEMO, reveal: ["demo-tab-docs"], title: "Další dokumenty", body: "Na záložce Další dokumenty vidíte nahrané dokumenty zaměstnance.", placement: "left" },
  { permission: "documents.upload", anchor: "demo-doc-upload", route: DEMO, reveal: ["demo-tab-docs"], title: "Nahrání dokumentu", body: "Tlačítkem Nahrát dokument přidáte k zaměstnanci další dokument.", placement: "bottom" },
  { permission: "documents.delete", anchor: "demo-doc-delete", route: DEMO, reveal: ["demo-tab-docs"], title: "Smazání dokumentu", body: "Tlačítkem Smazat odstraníte nahraný dokument (s potvrzením).", placement: "left" },

  // ── Šablony smluv (/smlouvy) ──────────────────────────────────────────────────
  { permission: "contractTemplates.view", anchor: "templates-list", route: "/smlouvy", title: "Zobrazení šablon", body: "V seznamu vlevo si vyberete a prohlédnete dostupné šablony.", placement: "right" },
  { permission: "contractTemplates.manage", anchor: "templates-new", route: "/smlouvy", title: "Správa šablon", body: "Tlačítkem Nová šablona vytvoříte šablonu; obsah upravíte v editoru a uložíte.", placement: "bottom" },

  // ── Mzdy (/mzdy) ──────────────────────────────────────────────────────────────
  { permission: "payroll.view", anchor: "payroll-table", route: "/mzdy", title: "Zobrazení mezd", body: "Tabulka zobrazuje vypočtené mzdy zaměstnanců pro zvolené období.", placement: "top" },
  { permission: "payroll.create", anchor: "payroll-create", route: "/mzdy", title: "Vytvoření mzdového období", body: "Tlačítkem Vytvořit mzdy ručně založíte období pro zvolený měsíc.", placement: "bottom" },
  { permission: "payroll.edit", anchor: "payroll-table", route: "/mzdy", title: "Úprava mezd", body: "V odemčeném období upravíte jednotlivé položky dvojklikem na buňku.", placement: "top" },
  { permission: "payroll.recalculate", anchor: "payroll-recalc", route: "/mzdy", title: "Přepočet (měkký)", body: "Tlačítkem Přepočítat spočítáte mzdy znovu; měkký přepočet zachová ruční úpravy.", placement: "bottom" },
  { permission: "payroll.recalculate.hard", anchor: "payroll-recalc-hard", route: "/mzdy", title: "Tvrdý přepočet", body: "Tvrdý přepočet přepíše vše ze zdrojových dat a zahodí ruční úpravy (s potvrzením).", placement: "bottom" },
  { permission: "payroll.lock", anchor: "payroll-lock", route: "/mzdy", title: "Zamknutí období", body: "Tlačítkem Uzamknout / Odemknout uzavřete nebo otevřete období pro úpravy.", placement: "bottom" },
  { permission: "payroll.period.delete", anchor: "payroll-delete", route: "/mzdy", title: "Smazání období", body: "Tlačítkem Smazat období nevratně odstraníte celé mzdové období (s potvrzením).", placement: "bottom" },
  { permission: "payroll.export", anchor: "payroll-export", route: "/mzdy", title: "Export mezd", body: "Tlačítkem Exportovat PDF stáhnete mzdy.", placement: "bottom" },
  { permission: "payroll.notes.manage", anchor: "payroll-table", route: "/mzdy", title: "Poznámky ke mzdám", body: "Ve sloupci poznámek přidáváte a spravujete poznámky k jednotlivým mzdám.", placement: "top" },

  // ── Upozornění (/upozorneni) ────────────────────────────────────────────────────
  { permission: "alerts.view", anchor: "alerts-tabs", route: "/upozorneni", title: "Zobrazení upozornění", body: "Záložky člení upozornění (doklady, zkušební doba, dovolená, výjimky, žádosti).", placement: "bottom" },
  { permission: "alerts.read", anchor: "alerts-mark-read", route: "/upozorneni", title: "Označení jako přečtené", body: "Upozornění označíte jako přečtené jednotlivě nebo hromadně; stav je sdílený.", placement: "bottom" },
  { permission: "alerts.refresh", anchor: "alerts-refresh", route: "/upozorneni", title: "Ruční obnovení", body: "Tlačítkem obnovení ručně přegenerujete systémová upozornění.", placement: "bottom" },
  { permission: "changeRequests.review", anchor: "alerts-tab-uprava", route: "/upozorneni", reveal: ["alerts-tab-uprava"], title: "Schvalování úprav údajů", body: "Na záložce Žádosti o úpravu údajů schvalujete nebo zamítáte návrhy zaměstnanců.", placement: "bottom" },

  // ── Log změn ────────────────────────────────────────────────────────────────────
  { permission: "audit.view", anchor: "nav-audit", title: "Log změn", body: "V Logu změn dohledáte, kdo a kdy data změnil nebo zobrazil citlivé údaje; lze filtrovat.", placement: "right" },

  // ── Číselníky a nastavení (/nastaveni) ────────────────────────────────────────────
  { permission: "masterData.view", anchor: null, title: "Číselníky", body: "Číselníky (společnosti, oddělení, pozice, vzdělání) se nabízejí v rozbalovacích polích formulářů. Spravují se v Nastavení.", placement: "bottom" },
  { permission: "settings.companies.manage", anchor: "settings-add-company", route: "/nastaveni", reveal: ["settings-tab-companies"], title: "Správa společností", body: "Na záložce Společnosti přidáváte a upravujete společnosti.", placement: "bottom" },
  { permission: "settings.departments.manage", anchor: "settings-add-department", route: "/nastaveni", reveal: ["settings-tab-departments"], title: "Správa oddělení", body: "Na záložce Oddělení spravujete seznam oddělení.", placement: "bottom" },
  { permission: "settings.jobPositions.manage", anchor: "settings-add-position", route: "/nastaveni", reveal: ["settings-tab-jobPositions"], title: "Správa pozic", body: "Na záložce Pracovní pozice spravujete seznam pozic.", placement: "bottom" },
  { permission: "settings.educationLevels.manage", anchor: "settings-add-education", route: "/nastaveni", reveal: ["settings-tab-education"], title: "Správa vzdělání", body: "Na záložce Vzdělání spravujete úrovně vzdělání.", placement: "bottom" },
  { permission: "settings.payroll.manage", anchor: "settings-tab-payroll", route: "/nastaveni", reveal: ["settings-tab-payroll"], title: "Mzdová nastavení", body: "Na záložce Mzdy spravujete mzdová nastavení (např. minimální mzdu a sazby).", placement: "bottom" },
  { permission: "settings.menuOrder.manage", anchor: "settings-tab-menu", route: "/nastaveni", reveal: ["settings-tab-menu"], title: "Pořadí menu", body: "Na záložce Menu nastavíte pořadí položek v bočním menu.", placement: "bottom" },

  // ── Uživatelé a oprávnění (/nastaveni) ────────────────────────────────────────────
  { permission: "users.view", anchor: "settings-tab-users", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Uživatelé", body: "Na záložce Uživatelé vidíte uživatelské účty.", placement: "bottom" },
  { permission: "users.manage", anchor: "settings-add-user", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Správa uživatelů", body: "Tlačítkem Přidat uživatele zakládáte účty; lze je upravovat a deaktivovat.", placement: "bottom" },
  { permission: "users.setType", anchor: "settings-user-type", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Přiřazení typu", body: "U každého uživatele zvolíte typ, který určuje jeho výchozí oprávnění.", placement: "left" },
  { permission: "users.permissions.manage", anchor: "settings-user-perms", route: "/nastaveni", reveal: ["settings-tab-users"], title: "Individuální oprávnění", body: "Tlačítkem Oprávnění uživateli nad rámec typu přidáte nebo odeberete konkrétní práva.", placement: "left" },
  { permission: "userTypes.manage", anchor: "settings-tab-userTypes", route: "/nastaveni", reveal: ["settings-tab-userTypes"], title: "Typy uživatelů", body: "Na záložce Uživatelské typy vytváříte a upravujete typy a jejich oprávnění v matici. Tato prohlídka se řídí přesně těmito oprávněními.", placement: "bottom" },

  // ── Systém ─────────────────────────────────────────────────────────────────────
  { permission: "system.timeOverride", anchor: "tour-timeclock", title: "Testovací hodiny", body: "Mimo produkci zde nastavíte testovací „nynější“ čas pro ověřování chování závislého na datu. V produkci je funkce neaktivní.", placement: "top" },
  { permission: "system.triggers", anchor: null, title: "Ruční spuštění úloh", body: "Můžete ručně spustit naplánované úlohy (přepočet mezd, obnova upozornění). Každé spuštění je zaznamenáno v logu změn.", placement: "bottom" },
  { permission: "system.admin", anchor: null, title: "Superadmin", body: "Máte oprávnění superadministrátora — přístup ke všem funkcím bez omezení. Používejte je obezřetně, zejména u nevratných operací.", placement: "bottom" },

  // ── Outro ───────────────────────────────────────────────────────────────────────
  { anchor: "help-button", title: "Průvodce dokončen", body: "To je vše! Průvodce i nápovědu kdykoliv znovu otevřete tlačítkem „? Nápověda“ vlevo dole.", placement: "right" },
];

export const appTour: TourDefinition = {
  id: "app",
  version: 2,
  label: "Prohlídka aplikace",
  steps: APP_TOUR_STEPS,
};
