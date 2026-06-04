import type { TourStep, TourDefinition } from "./types";

/**
 * Base steps shared by both the employee tour and (via import) the manager tour.
 * Each step spotlights one data-tour anchor; route is set only on the first step
 * of each page so the runner navigates once and then stays put.
 */
export const employeeBaseSteps: TourStep[] = [
  // ── Welcome ─────────────────────────────────────────────────────────────
  {
    anchor: null,
    route: "/prehled",
    title: "Vítejte v HPM Intranetu",
    body: "Tento krátký průvodce vás provede hlavními částmi aplikace. Ukáže vám, kde najdete svůj plán směn, dovolenou i vlastní profil. Průvodce trvá přibližně dvě minuty a kdykoliv jej můžete ukončit tlačítkem Přeskočit.",
  },

  // ── Přehled ─────────────────────────────────────────────────────────────
  {
    anchor: "overview-date-header",
    title: "Přehled — dnešní datum",
    body: "Stránka Přehled je vaše úvodní obrazovka. Datum nahoře vždy ukazuje, pro který den jsou zobrazené informace — tedy dnešek.",
    placement: "bottom",
  },
  {
    anchor: "overview-staffing",
    title: "Kdo je dnes na směně",
    body: "Sekce Dnes zobrazuje aktuální obsazení hotelu: kdo pracuje na recepci, kteří portýři jsou přítomni a kdo vykonává roli MOD (vedoucí směny). Pomáhá vám rychle zjistit, s kým dnes spolupracujete.",
    placement: "bottom",
  },
  {
    anchor: "overview-my-shifts",
    title: "Moje směny",
    body: "Dlaždice Moje směny vás přenese přímo do měsíčního plánu, kde uvidíte své naplánované směny. Kliknutím se dostanete na stránku Směny.",
    placement: "right",
  },
  {
    anchor: "overview-task-tiles",
    title: "Rychlé akce",
    body: "Ostatní dlaždice nabízejí zkratky k nejčastějším úkolům — například podání žádosti o dovolenou nebo zobrazení vlastního profilu. Slouží jen pro pohodlnější navigaci; vše najdete i v postranní nabídce.",
    placement: "top",
  },

  // ── Směny ───────────────────────────────────────────────────────────────
  {
    anchor: "shift-month-nav",
    route: "/smeny",
    title: "Výběr měsíce",
    body: "Šipkami vlevo a vpravo přecházíte mezi měsíci. Tlačítkem Dnes se okamžitě vrátíte na aktuální měsíc.",
    placement: "bottom",
  },
  {
    anchor: "shift-grid",
    title: "Plán směn",
    body: "Tabulka zobrazuje váš měsíční plán směn. Každé políčko odpovídá jednomu dni; kódy jako DA, NS nebo X označují typ směny nebo volno. Pod tabulkou je legenda vysvětlující všechny kódy. Jako zaměstnanec vidíte publikovaný plán a do políček s volnem (X) můžete přímo klikat.",
    placement: "bottom",
  },
  {
    anchor: "shift-my-requests",
    title: "Moje žádosti o změnu",
    body: "V sekci Moje žádosti vidíte všechny podané žádosti o změnu směny i o volné směny a jejich aktuální stav (čeká na schválení, schváleno, zamítnuto). Novou žádost o změnu podáte dvojklikem na příslušnou buňku v plánu; žádost o volnou (neobsazenou) směnu portýrů podáte dvojklikem na barevný štítek pod tabulkou.",
    placement: "top",
  },

  // ── Dovolená ────────────────────────────────────────────────────────────
  {
    anchor: "vacation-request-form",
    route: "/dovolena",
    title: "Nová žádost o dovolenou",
    body: "Zde zadáváte novou žádost o dovolenou: vyberete termín a napíšete důvod. Žádost odeslíte tlačítkem Odeslat žádost a systém ji předá ke schválení administrátorovi. Pokud termín koliduje s naplánovanou směnou, aplikace vás na to upozorní.",
    placement: "right",
  },
  {
    anchor: "vacation-my-requests",
    title: "Moje žádosti o dovolenou",
    body: "Seznam všech vašich žádostí o dovolenou s jejich stavem. Schválenou žádost můžete upravit — změna bude čekat na nové schválení, přičemž původní termín platí až do té doby.",
    placement: "top",
  },
  {
    anchor: "vacation-approved-colleagues",
    title: "Schválené dovolené kolegů",
    body: "Přehled schválených dovolených ostatních zaměstnanců. Pomáhá vám naplánovat vlastní dovolenou tak, aby nekryla termíny, kdy jsou nepřítomni kolegové.",
    placement: "top",
  },

  // ── Můj profil ──────────────────────────────────────────────────────────
  {
    anchor: "selfpage-title",
    route: "/muj-profil",
    title: "Můj profil",
    body: "Tato stránka zobrazuje vaši kartu zaměstnance — osobní údaje, kontakt, doklady a historii pracovního poměru. Slouží jen ke čtení; ke změnám slouží tlačítko Navrhnout úpravu níže.",
    placement: "bottom",
  },
  {
    anchor: "selfpage-edit-btn",
    title: "Navrhnout úpravu",
    body: "Tlačítkem Navrhnout úpravu odešlete návrh na změnu svých osobních údajů. Změna neprojde okamžitě — čeká na schválení administrátorem nebo ředitelem, takže vaše stávající údaje zůstávají platné až do schválení.",
    placement: "left",
  },
  {
    anchor: "selfpage-reveal",
    title: "Zobrazení citlivých údajů",
    body: "Pole označená ikonou oka (například rodné číslo nebo číslo dokladu) jsou skryta z bezpečnostních důvodů. Kliknutím na ikonu pole dočasně zobrazíte. Každé zobrazení je zaznamenáno v systémovém logu.",
    placement: "left",
  },
  {
    anchor: "selfpage-requests",
    title: "Vaše návrhy na změnu",
    body: "Zde vidíte všechny vaše odeslané návrhy na úpravu profilu a jejich aktuální stav. Čekající návrhy lze stáhnout, dokud ještě nebyly schváleny.",
    placement: "top",
  },

  // ── Outro ───────────────────────────────────────────────────────────────
  {
    anchor: "help-button",
    title: "Průvodce dokončen",
    body: "To je vše! Průvodce si můžete kdykoliv znovu spustit kliknutím na tlačítko ? v horní liště — tam najdete i nápovědu k jednotlivým částem aplikace. Přejeme vám příjemnou práci.",
    placement: "bottom",
  },
];

export const employeeTour: TourDefinition = {
  id: "employee",
  version: 1,
  label: "Prohlídka pro zaměstnance",
  steps: employeeBaseSteps,
};
