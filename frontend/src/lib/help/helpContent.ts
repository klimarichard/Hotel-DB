import type { UserRole } from "@/hooks/useAuth";

export interface HelpSection {
  /** Czech section heading. */
  title: string;
  /** Czech body paragraphs; each string is rendered as its own <p>. */
  body: string[];
}

// ── Sections common to every user ────────────────────────────────────────────

export const commonSections: HelpSection[] = [
  {
    title: "Co je HPM Intranet",
    body: [
      "HPM Intranet je interní HR systém společností Special Tours Prague (STP) a Hotel Property Management (HPM). Nahrazuje papírové a excelové přehledy pro plán směn, dovolenou a správu zaměstnaneckých údajů.",
      "Aplikace běží v prohlížeči — není třeba nic instalovat. Přihlašujete se e-mailem a heslem. Pokud heslo zapomenete, klikněte na Zapomenuté heslo? na přihlašovací obrazovce a na váš e-mail přijde odkaz pro obnovení.",
    ],
  },
  {
    title: "Jak se v aplikaci pohybovat",
    body: [
      "Hlavní navigace je postranní nabídka na levé straně obrazovky. Položky nabídky odpovídají jednotlivým sekcím aplikace — například Přehled, Směny nebo Dovolená. Kliknutím na položku se okamžitě přesunete na příslušnou stránku.",
      "Vlevo dole vidíte jméno přihlášeného uživatele a přepínač světlého a tmavého režimu. Tlačítkem Odhlásit ukončíte přihlášenou relaci. V horní liště je tlačítko ? (otazník), které otevře tuto nápovědu nebo umožní znovu spustit průvodce.",
    ],
  },
  {
    title: "Jak znovu spustit průvodce",
    body: [
      "Úvodní průvodce aplikací si můžete kdykoliv přehrát znovu. Klikněte na tlačítko ? v horní liště — otevře se stránka Nápověda. Na ní najdete tlačítko Spustit průvodce, které průvodce spustí od začátku.",
      "Průvodce vás provede přesně stejnými kroky jako při prvním přihlášení. Během průvodce se můžete kdykoliv vrátit o krok zpět nebo průvodce ukončit tlačítkem Přeskočit.",
    ],
  },
  {
    title: "Koho kontaktovat při potížích",
    body: [
      "Pokud se setkáte s technickým problémem nebo vám v aplikaci něco chybí, obraťte se na správce systému (administrátora). Kontakt na administrátora vám sdělí váš nadřízený nebo vedení.",
      "Nezkoušejte řešit technické potíže sami úpravou dat — mohlo by dojít k nechtěným změnám, které by ovlivnily výpočty mezd nebo plánování směn.",
    ],
  },
];

// ── Role-specific sections ────────────────────────────────────────────────────

export const helpContent: Partial<Record<UserRole, HelpSection[]>> = {
  employee: [
    {
      title: "Přehled",
      body: [
        "Stránka Přehled je vaše úvodní obrazovka po přihlášení. Zobrazuje aktuální provozní situaci: kdo má dnes směnu na recepci a na portýrské pozici, kdo je MOD (vedoucí směny) a kteří kolegové mají dovolenou.",
        "Dlaždice Moje směny vás přenese do měsíčního plánu. Ostatní dlaždice slouží jako zkratky k nejčastějším akcím — jsou jen pro pohodlí, vše dostupné i přes postranní nabídku.",
      ],
    },
    {
      title: "Směny — zobrazení vlastního plánu",
      body: [
        "Na stránce Směny vidíte měsíční plán směn. Šipkami vlevo a vpravo přecházíte mezi měsíci; tlačítko Dnes vás vrátí na aktuální měsíc. Každé políčko v tabulce odpovídá jednomu dni a obsahuje kód směny nebo volna — například DA (denní), NS (noční) nebo X (volno). Pod tabulkou je legenda vysvětlující všechny kódy.",
        "Jako zaměstnanec vidíte publikovaný plán. Přímou úpravou políček si můžete sami zadávat nebo mazat volno (X). Platí přitom limity: u HPP smlouvy nejvýše 8 volných dní za měsíc, u PPP 13 a u DPP neomezeně — a nikdy ne více než 6 volných dní v řadě.",
      ],
    },
    {
      title: "Směny — žádosti o změnu a volné směny",
      body: [
        "Pokud chcete požádat o změnu směny v již hotovém plánu, dvakrát klikněte na příslušnou buňku v tabulce. Otevře se formulář, kde popíšete požadovanou změnu. Žádost schvaluje administrátor; stav vidíte v sekci Moje žádosti pod tabulkou.",
        "Pod plánem portýrů se zobrazují volné (neobsazené) směny — dny označené barevným štítkem ještě nemají obsazeného pracovníka. Dvojklikem na takový štítek podáte žádost o převzetí směny (důvod není potřeba). Pokud administrátor žádost schválí, směna se vám automaticky zapíše do plánu; ostatní žádosti o stejnou směnu budou zamítnuty.",
        "Všechny odeslané žádosti — o změnu i o volné směny — najdete v sekci Moje žádosti. Každá žádost ukazuje svůj aktuální stav: čeká na schválení, schváleno nebo zamítnuto.",
      ],
    },
    {
      title: "Dovolená — podání žádosti",
      body: [
        "Na stránce Dovolená podáte novou žádost o dovolenou: vyplníte termín (datum od — do) a napíšete stručný důvod. Žádost odešlete tlačítkem Odeslat žádost. Systém ji předá administrátorovi ke schválení.",
        "Pokud vámi zvolený termín koliduje s již naplánovanou směnou, aplikace vás na to upozorní a žádost zablokuje. Nejdříve je nutné vyřešit kolizi se směnou (požádejte nadřízeného o úpravu plánu) a teprve poté dovolenou podat.",
      ],
    },
    {
      title: "Dovolená — správa žádostí a přehled kolegů",
      body: [
        "V sekci Moje žádosti vidíte všechny své odeslané žádosti o dovolenou a jejich stav. Schválenou žádost lze upravit — navrhovaná změna termínu čeká na nové schválení, přičemž původně schválený termín platí až do rozhodnutí administrátora.",
        "Sekce Schválené dovolené (všichni zaměstnanci) ukazuje termíny schválených dovolených kolegů. Pomáhá vám vybrat termín vlastní dovolené tak, aby nekryl dobu, kdy jsou klíčoví kolegové nepřítomni.",
      ],
    },
    {
      title: "Můj profil — zobrazení a úprava údajů",
      body: [
        "Na stránce Můj profil vidíte svoji kartu zaměstnance: osobní údaje, kontakt, doklady a historii pracovního poměru. Stránka je jen pro čtení — data přímo měnit nelze.",
        "Chcete-li navrhnout opravu nebo doplnění svých údajů, klikněte na tlačítko Navrhnout úpravu. Vyplněný formulář se odešle ke schválení administrátorovi nebo řediteli. Vaše stávající údaje zůstávají beze změny až do okamžiku, kdy administrátor návrh schválí. Stav svých návrhů vidíte v sekci Vaše návrhy na změnu na téže stránce.",
      ],
    },
    {
      title: "Citlivé údaje a ikona oka",
      body: [
        "Některá pole (například rodné číslo nebo číslo průkazu totožnosti) jsou z bezpečnostních důvodů skryta a nahrazena hvězdičkami. Kliknutím na ikonu oka vedle pole jej dočasně zobrazíte.",
        "Každé zobrazení citlivého údaje je zaznamenáno v systémovém logu. Tato funkce slouží výhradně k ověření vlastních dat — sdílení zobrazených údajů s neoprávněnými osobami je nepřípustné.",
      ],
    },
  ],

  manager: [
    {
      title: "Přehled",
      body: [
        "Stránka Přehled zobrazuje aktuální provozní situaci: kdo má dnes směnu (recepce i portýři), kdo je MOD (vedoucí směny), kteří FOM jsou nepřítomni a rychlé statistiky personálu. Jako FOM vidíte kompletnější pohled než řadový zaměstnanec.",
        "Dlaždice Moje směny vás přenese do měsíčního plánu. Ostatní dlaždice jsou zkratky k nejčastějším akcím.",
      ],
    },
    {
      title: "Směny — vyplňování plánu (FOM)",
      body: [
        "Jako FOM (Front Office Manager) můžete v otevřeném plánu přímo upravovat směny: kliknutím do políčka zapíšete kód směny (např. DA, NS, X) nebo existující záznam přepíšete. Pod tabulkou je legenda s vysvětlením všech kódů, typů hotelů a pravidel přestávek.",
        "Plán prochází stavy Vytvořený, Otevřený, Uzavřený a Publikovaný. Upravovat směny lze pouze ve stavu Otevřený. Přechody mezi stavy (otevření, uzavření, publikování) a vytváření nového plánu provádí výhradně administrátor nebo ředitel — tato tlačítka jako FOM neuvidíte.",
        "Platí limity volna (X): HPP nejvýše 8 za měsíc, PPP 13, DPP neomezeně, a nikdy více než 6 X v řadě. Jako FOM tyto limity dodržujte při vyplňování plánu ručně. U vašeho jména v plánu se zobrazuje písmeno MOD a počty FOM směn.",
      ],
    },
    {
      title: "Směny — žádosti a volné směny",
      body: [
        "Stejně jako zaměstnanci i vy můžete podávat žádosti o změnu směny dvojklikem na buňku v hotovém plánu, a žádat o volné směny portýrů dvojklikem na barevný štítek pod tabulkou. Stav svých žádostí sledujete v sekci Moje žádosti.",
      ],
    },
    {
      title: "Dovolená — vlastní žádosti a přehled",
      body: [
        "Žádost o dovolenou podáváte stejně jako zaměstnanci: vyplníte termín a důvod a odešlete formulář. Stav žádosti vidíte v sekci Moje žádosti.",
        "Sekce Schválené dovolené (všichni zaměstnanci) zobrazuje schválené dovolené řadových zaměstnanců. Pokud má váš uživatelský typ přiděleno oprávnění Zobrazit všechny žádosti, uvidíte navíc veškeré žádosti o dovolenou všech uživatelů včetně vedení. Toto oprávnění nastavuje administrátor — pokud jej nevidíte, na vašem účtu není aktivní.",
      ],
    },
    {
      title: "Můj profil — zobrazení a úprava údajů",
      body: [
        "Stránka Můj profil zobrazuje vaši kartu zaměstnance ve stejném formátu jako detail zaměstnance (osobní údaje, kontakt, doklady, pracovní poměr). Data přímo měnit nelze.",
        "Návrh změny odešlete tlačítkem Navrhnout úpravu. Citlivá pole se při vyplňování formuláře dočasně zobrazí, abyste viděli, co měníte — zobrazení se loguje. Stav návrhů sledujete v sekci Vaše návrhy na změnu.",
      ],
    },
  ],
};

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns the full list of help sections for a given role:
 * the common sections first, then any role-specific sections.
 * Pass null (unauthenticated / unknown role) to get only the common sections.
 */
export const helpSectionsForRole = (role: UserRole | null): HelpSection[] => [
  ...commonSections,
  ...(role ? (helpContent[role] ?? []) : []),
];
