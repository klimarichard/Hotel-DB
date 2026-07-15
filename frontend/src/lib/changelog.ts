/**
 * User-facing release notes shown in the changelog modal (opened by clicking the
 * version in the sidebar footer — gated by `system.version.changelog`).
 *
 * Curated Czech summaries, newest first, back to the very first build (v0.1.0).
 * Keep entries short and end-user oriented (what changed for them, not the
 * implementation). **Add a new entry here as part of every staging→prod
 * promotion**, alongside the version bump.
 *
 * The v0.x entries predate the production launch (v1.0.0, 2026-05-21) — they are
 * development milestones that never ran in prod, and the modal renders a divider
 * above them. Every date below is the date of that version's tagged commit.
 */

export interface ChangelogEntry {
  /** "X.Y.Z" — rendered with a leading "v". */
  version: string;
  /**
   * ISO date (YYYY-MM-DD) the version went to production — i.e. the date of its
   * staging→master merge. For the pre-launch v0.x versions, the date the
   * milestone was reached.
   */
  date: string;
  /** Short, user-facing Czech bullets. */
  changes: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "4.10.0",
    date: "2026-07-15",
    changes: [
      "Šablony smluv: nový typ vlastní proměnné „Podmínka“.",
    ],
  },
  {
    version: "4.9.1",
    date: "2026-07-15",
    changes: [
      "Detail zaměstnance – Dovolená: roční nárok se nově zadává jako dvě samostatné hodnoty, Loňská a Letošní.",
    ],
  },
  {
    version: "4.9.0",
    date: "2026-07-15",
    changes: [
      "Detail zaměstnance: nová sekce Dovolená s přehledem nároku, čerpání po měsících a zůstatku dovolené (v hodinách).",
    ],
  },
  {
    version: "4.8.2",
    date: "2026-07-15",
    changes: [
      "Šablony smluv: u vlastních proměnných lze nastavit výchozí hodnotu.",
      "Generování dokumentů je nyní bez mezikroku s prázdným řádkem.",
      "Ukončení pracovního poměru: při generování se automaticky zvolí správná šablona.",
    ],
  },
  {
    version: "4.8.1",
    date: "2026-07-15",
    changes: [
      "Nastavení: společnosti, oddělení, pracovní pozice a vzdělání jsou nyní sdružené na jedné záložce „Seznamy“ v rozbalovacích sekcích.",
      "Nápověda: kliknutím na položku spustíte prohlídku přímo u příslušného kroku.",
    ],
  },
  {
    version: "4.8.0",
    date: "2026-07-14",
    changes: [
      "Šablony smluv: náhled dokumentu s ukázkovými daty a vnořování podmínek.",
    ],
  },
  {
    version: "4.7.2",
    date: "2026-07-14",
    changes: [
      "Karta zaměstnance: oprava zobrazení nabídky u tlačítka Nahrát podepsanou smlouvu.",
    ],
  },
  {
    version: "4.7.1",
    date: "2026-07-14",
    changes: [
      "Směny: Drobné funkční úpravy MOD směn.",
    ],
  },
  {
    version: "4.7.0",
    date: "2026-07-14",
    changes: [
      "Šablony smluv: Nové proměnné a revize starých proměnných.",
    ],
  },
  {
    version: "4.6.0",
    date: "2026-07-14",
    changes: [
      "Karta zaměstnance: samostatné dokumenty se generují na záložce Další dokumenty a zobrazují se rovnou v seznamu; Prohlášení poplatníka najdete v Historii pracovního poměru.",
      "Podepsanou smlouvu lze nahrát jako „Smlouva + prohlášení“ – sken se automaticky rozdělí. Velká PDF se při nahrávání zmenší.",
      "Zobrazované jméno zaměstnance se nyní používá všude v aplikaci.",
    ],
  },
  {
    version: "4.5.0",
    date: "2026-07-13",
    changes: [
      "Šablony smluv: vlastní proměnné (text, datum, číslo, ano/ne), které se vyplňují při generování dokumentu.",
    ],
  },
  {
    version: "4.4.2",
    date: "2026-07-13",
    changes: ["Návody se řadí automaticky podle abecedy."],
  },
  {
    version: "4.4.1",
    date: "2026-07-13",
    changes: ["Drobné úpravy textů v průvodci aplikací."],
  },
  {
    version: "4.4.0",
    date: "2026-07-13",
    changes: [
      "Nová stránka Návody – návody v PDF a odkazy na externí materiály, se štítky a vyhledáváním.",
    ],
  },
  {
    version: "4.3.3",
    date: "2026-07-13",
    changes: [
      "Interní vylepšení a drobné opravy.",
    ],
  },
  {
    version: "4.3.2",
    date: "2026-07-13",
    changes: [
      "Interní vylepšení a drobné opravy.",
    ],
  },
  {
    version: "4.3.1",
    date: "2026-07-12",
    changes: [
      "Interní vylepšení a drobné opravy.",
    ],
  },
  {
    version: "4.3.0",
    date: "2026-07-12",
    changes: [
      "Interní vylepšení a drobné opravy.",
    ],
  },
  {
    version: "4.2.15",
    date: "2026-07-11",
    changes: [
      "Recepce (sdílený účet): u žádosti o změnu směny, o výjimku a u převzetí volné směny se nově vybírá, kdo o ni skutečně žádá (předvyplní se osoba, která má právě službu). Žádost se přiřadí zvolené osobě.",
    ],
  },
  {
    version: "4.2.14",
    date: "2026-07-11",
    changes: [
      "Upozornění – Předávací protokol: k „Nenavazujícím předáním“ přibyla sekce „Pozdní příchody“ (převzetí směny po 7:00 u noční / po 19:00 u denní).",
    ],
  },
  {
    version: "4.2.13",
    date: "2026-07-11",
    changes: [
      "Předávací protokol: uzamčené Poznámky a Účty zůstávají uzamčené i po předání směny a krok zpět/vpřed je u uživatelů bez práva na uzamykání přeskočí.",
    ],
  },
  {
    version: "4.2.12",
    date: "2026-07-11",
    changes: [
      "Předávací protokol – Účty: při přidávání nebo úpravě účtu se ovládací ikony (upravit, smazat, zámek) už nezobrazují mimo rámeček sekce.",
    ],
  },
  {
    version: "4.2.11",
    date: "2026-07-11",
    changes: [
      "Předávací protokol – Účty: uzamčené účty se nyní řadí nad všechny nezamčené a oddělují se od nich vodorovnou čárou.",
      "Předávací protokol – Poznámky: mezi uzamčenými a nezamčenými poznámkami je nově výrazná dělicí čára pro lepší přehlednost.",
    ],
  },
  {
    version: "4.2.10",
    date: "2026-07-11",
    changes: [
      "Recepce: jména zaměstnanců (v tabulkách Walkiny a Lobby bar i ve výběru podepisujícího a mazání podpisu u Předávacího protokolu) se zobrazují jako zobrazované jméno zaměstnance, je-li nastaveno.",
    ],
  },
  {
    version: "4.2.9",
    date: "2026-07-11",
    changes: [
      "Předávací protokol – Poznámky: dlouhé poznámky se nyní zobrazují na více řádků, místo aby se ořízly na konci řádku.",
      "Předávací protokol – Poznámky: zamčené poznámky se řadí nad všechny nezamčené.",
    ],
  },
  {
    version: "4.2.8",
    date: "2026-07-11",
    changes: [
      "Nápověda (prohlídka aplikace): krok pro záložku Terminál se nyní správně zobrazí.",
    ],
  },
  {
    version: "4.2.7",
    date: "2026-07-11",
    changes: [
      "Recepce: při podpisu Předávacího protokolu i ve výběru zaměstnance u Walkinů a Lobby baru se nyní nabízí každý, kdo je v daném měsíčním plánu směn.",
    ],
  },
  {
    version: "4.2.6",
    date: "2026-07-11",
    changes: [
      "Předávací protokol: podepsání směny i odebrání podpisu už funguje – ověření hesla se nově dělá proti skutečnému přihlašovacímu e-mailu účtu.",
    ],
  },
  {
    version: "4.2.5",
    date: "2026-07-10",
    changes: [
      "Na text s verzí aplikace lze kliknout a otevře se přehled změn v jednotlivých verzích.",
    ],
  },
  {
    version: "4.2.4",
    date: "2026-07-10",
    changes: [
      "Dovolená: čekající žádosti a návrhy úprav se v seznamu „Všechny žádosti“ řadí navrch, aby je schvalující viděl hned. Po schválení nebo zamítnutí se žádost vrátí na místo podle data.",
    ],
  },
  {
    version: "4.2.3",
    date: "2026-07-10",
    changes: [
      "Recepce – Walkiny a Lobby bar: pole se zaměstnancem se u nového záznamu předvyplní tím, kdo má právě službu na recepci.",
    ],
  },
  {
    version: "4.2.2",
    date: "2026-07-10",
    changes: [
      "Dovolená: starší schválené žádosti se po skončení správně přesouvají do sekce „Starší žádosti“.",
    ],
  },
  {
    version: "4.2.1",
    date: "2026-07-10",
    changes: [
      "Lobby bar: jedním prodejem lze zapsat více položek najednou.",
      "Lobby bar: v ceníku přibyl sloupec „Prodáno“ a tlačítko „Reset“ pro jeho vynulování (jen pro správce).",
      "Terminál: typy plateb si nyní správci spravují sami.",
    ],
  },
  {
    version: "4.2.0",
    date: "2026-07-10",
    changes: [
      "Recepce: nová záložka „Lobby bar“ (hotel Ambiance) pro evidenci prodejů včetně ceníku a provizí.",
      "Recepce: nová záložka „Terminál“ (hotel Amigo & Alqush) pro evidenci plateb z platebního terminálu.",
    ],
  },
  {
    version: "4.1.0",
    date: "2026-07-10",
    changes: [
      "Recepce: zápisy se přisuzují tomu, kdo má službu, i při přihlášení pod sdíleným účtem recepce.",
      "Recepce: každý uživatel, který má přístup k více hotelům, si může nastavit výchozí hotel, který se mu otevře jako první.",
    ],
  },
  {
    version: "4.0.1",
    date: "2026-07-09",
    changes: ["Drobné úpravy textů v průvodci u Předávacího protokolu."],
  },
  {
    version: "4.0.0",
    date: "2026-07-09",
    changes: [
      "Nová sekce „Recepce“: Předávací protokol s virtuálním předáním a převzetím směny, evidence Walk-in prodejů a Taxi jízd s ceníkem a provizemi.",
      "Předávací protokol: historie změn s vracením kroků, uzamknutí po podpisu a ochrana proti souběžné úpravě.",
      "Plánování směn: pravidla (limity X, pokrytí, 6 dní v řadě) se kontrolují i na serveru.",
    ],
  },
  {
    version: "3.8.4",
    date: "2026-07-05",
    changes: ["Mazání hodnot číselníků (společnosti, oddělení, pozice apod.) nebrání použití položky u ukončených zaměstnanců + upozornění při reaktivaci."],
  },
  {
    version: "3.8.3",
    date: "2026-07-05",
    changes: ["Údržba serverového prostředí (aktualizace běhu funkcí)."],
  },
  {
    version: "3.8.2",
    date: "2026-07-05",
    changes: ["Mazání vlastních šablon a deaktivace vestavěných šablon smluv."],
  },
  {
    version: "3.8.1",
    date: "2026-07-05",
    changes: ["Mobil: sbalitelné položky historie zaměstnání, oprava přiblížení na iOS."],
  },
  {
    version: "3.8.0",
    date: "2026-07-03",
    changes: ["Mobilní responzivita administrátorských a manažerských stránek."],
  },
  {
    version: "3.7.0",
    date: "2026-07-03",
    changes: ["Naplánovaná deaktivace uživatele – okamžitá nebo k zadanému datu."],
  },
  {
    version: "3.6.2",
    date: "2026-07-03",
    changes: ["Odlišná fialová barva odznaku pro rodičovskou dovolenou."],
  },
  {
    version: "3.6.1",
    date: "2026-07-02",
    changes: ["Oprava odhlášení na mobilu (vždy dostupná záložka „Více“)."],
  },
  {
    version: "3.6.0",
    date: "2026-07-01",
    changes: ["Strukturovaná žádost o změnu směny (po schválení se rovnou aplikuje) + dvojklik pro zadání X."],
  },
  {
    version: "3.5.2",
    date: "2026-07-01",
    changes: ["Fialový odznak MOD na dlaždici Moje směny."],
  },
  {
    version: "3.5.1",
    date: "2026-07-01",
    changes: ["Opravy počtu odznaků na stránce Zaměstnanci. Můj profil zobrazuje jen podepsané smlouvy a umožňuje jejich stažení."],
  },
  {
    version: "3.5.0",
    date: "2026-06-30",
    changes: ["Částečné úvazky, kontrola minimální mzdy, souběžné smlouvy a editovatelný konec rodičovské dovolené."],
  },
  {
    version: "3.4.5",
    date: "2026-06-29",
    changes: ["Kliknutí na logo v postranním panelu otevře Přehled."],
  },
  {
    version: "3.4.4",
    date: "2026-06-29",
    changes: ["Barevné odznaky u číselných buněk směn (R/HO/ZD/ZN)."],
  },
  {
    version: "3.4.3",
    date: "2026-06-27",
    changes: ["Automatická úprava spojovníků v názvech adres podle pravidel českého pravopisu."],
  },
  {
    version: "3.4.2",
    date: "2026-06-27",
    changes: ["Označení typu v rohu číselné buňky směny."],
  },
  {
    version: "3.4.1",
    date: "2026-06-27",
    changes: ["Otagovaná číselná buňka pokrývá i volnou směnu."],
  },
  {
    version: "3.4.0",
    date: "2026-06-27",
    changes: ["Přidání typu směny u číselných buněk směn."],
  },
  {
    version: "3.3.1",
    date: "2026-06-25",
    changes: ["Mzdy zaučování před smlouvou zobrazují pouze odpracované hodiny."],
  },
  {
    version: "3.3.0",
    date: "2026-06-25",
    changes: ["Zaučovací směny před nástupem: mzda 0, hodiny se převádějí poznámkou do dalšího měsíce."],
  },
  {
    version: "3.2.1",
    date: "2026-06-25",
    changes: ["Další bezpečnostní vylepšení."],
  },
  {
    version: "3.2.0",
    date: "2026-06-25",
    changes: ["Lišta blížící se expirace vlastních dokladů + odznak na Můj profil."],
  },
  {
    version: "3.1.3",
    date: "2026-06-24",
    changes: ["Audit možných mezer v bezpečnosti kódu. Bezpečnostní vylepšení."],
  },
  {
    version: "3.1.2",
    date: "2026-06-24",
    changes: ["Průvodce aplikací zohledňuje mobil. Manuály „Na mobilu“."],
  },
  {
    version: "3.1.1",
    date: "2026-06-24",
    changes: ["Uživatelské manuály a krok průvodce pro rodičovskou dovolenou."],
  },
  {
    version: "3.1.0",
    date: "2026-06-23",
    changes: ["Vylepšení stránek se zaměstnanci a smlouvami v mobilním zobrazení."],
  },
  {
    version: "3.0.2",
    date: "2026-06-23",
    changes: ["Opravy mřížky směn v mobilním zobrazení."],
  },
  {
    version: "3.0.1",
    date: "2026-06-23",
    changes: ["Navazující mobilní úpravy."],
  },
  {
    version: "3.0.0",
    date: "2026-06-23",
    changes: ["Responzivní zobrazení aplikace na mobilu."],
  },
  {
    version: "2.3.4",
    date: "2026-06-22",
    changes: ["Přesnější umístění průvodce u výběru zaměstnance."],
  },
  {
    version: "2.3.3",
    date: "2026-06-22",
    changes: ["Automatické „R“ u FOM. Odznak „V zácviku“. Admin zadává dovolenou komukoli. Opravy rozvržení."],
  },
  {
    version: "2.3.2",
    date: "2026-06-22",
    changes: ["Opravy Logu změn. Volné směny viditelné i v uzavřených plánech."],
  },
  {
    version: "2.3.1",
    date: "2026-06-20",
    changes: ["Opravy zobrazení Logu změn."],
  },
  {
    version: "2.3.0",
    date: "2026-06-20",
    changes: ["Přepracovaný Log změn – přehlednější události a filtry."],
  },
  {
    version: "2.2.8",
    date: "2026-06-20",
    changes: ["Sloupce data nástupu/ukončení a řazení na stránce Zaměstnanci."],
  },
  {
    version: "2.2.7",
    date: "2026-06-18",
    changes: ["Zobrazení verze aplikace v zápatí."],
  },
  {
    version: "2.2.6",
    date: "2026-06-18",
    changes: ["Skrytí pole Pohlaví na stránce Můj profil a možnost neutrálního zobrazení."],
  },
  {
    version: "2.2.5",
    date: "2026-06-17",
    changes: ["Rozlišení názvů stažených smluv s podobnými parametry."],
  },
  {
    version: "2.2.4",
    date: "2026-06-17",
    changes: ["Aktualizovaná šablona Prohlášení poplatníka."],
  },
  {
    version: "2.2.3",
    date: "2026-06-17",
    changes: ["Noví zaměstnanci bez smlouvy se zobrazují v sekci „Před nástupem“."],
  },
  {
    version: "2.2.2",
    date: "2026-06-12",
    changes: ["Ochrana proti smazání zaměstnance s přidělenými směnami a úklid navázaných záznamů."],
  },
  {
    version: "2.2.1",
    date: "2026-06-12",
    changes: ["Přesun tlačítka pro přidání nové společnosti do záhlaví."],
  },
  {
    version: "2.2.0",
    date: "2026-06-12",
    changes: ["Přepracovaná matice oprávnění – přehlednější, se závislostmi."],
  },
  {
    version: "2.1.4",
    date: "2026-06-12",
    changes: ["Opravy: konec Dodatku, sazba za práci navíc podle pozice, konfigurovatelný stravenkový paušál."],
  },
  {
    version: "2.1.3",
    date: "2026-06-11",
    changes: ["Odznak nepřečtených upozornění sčítá všechny dílčí záložky; obnova při navigaci."],
  },
  {
    version: "2.1.2",
    date: "2026-06-11",
    changes: ["Interní úklid v kódu aplikace a konkretizace chybových hlášek."],
  },
  {
    version: "2.1.1",
    date: "2026-06-11",
    changes: ["Drobné opravy."],
  },
  {
    version: "2.1.0",
    date: "2026-06-11",
    changes: ["Export PDF formulářů zaměstnance (Osobní dotazník + Prohlášení poplatníka)."],
  },
  {
    version: "2.0.2",
    date: "2026-06-11",
    changes: ["Úpravy úvodního průvodce aplikací."],
  },
  {
    version: "2.0.1",
    date: "2026-06-11",
    changes: ["Ochrana proti smazání dat – zaměstnanci s historií a používané společnosti/pozice."],
  },
  {
    version: "2.0.0",
    date: "2026-06-11",
    changes: ["Sjednocení číslování verzí."],
  },
  {
    version: "1.12.0",
    date: "2026-06-10",
    changes: ["Bezpečnostní audit a úpravy stavů zaměstnance (aktivní/ukončený) a přechodů mezi nimi."],
  },
  {
    version: "1.11.0",
    date: "2026-06-09",
    changes: ["Úvodní průvodce aplikací a Nápověda."],
  },
  {
    version: "1.10.0",
    date: "2026-06-03",
    changes: ["Konfigurovatelná oprávnění – vlastní uživatelské typy a matice oprávnění."],
  },
  {
    version: "1.9.0",
    date: "2026-06-02",
    changes: ["Směny: Volné směny."],
  },
  {
    version: "1.8.0",
    date: "2026-05-29",
    changes: ["Přepracovaný Multisport."],
  },
  {
    version: "1.7.0",
    date: "2026-05-29",
    changes: ["Další dokumenty zaměstnance."],
  },
  {
    version: "1.6.0",
    date: "2026-05-28",
    changes: ["Drobné opravy a vylepšení."],
  },
  {
    version: "1.5.0",
    date: "2026-05-27",
    changes: ["Drobné úpravy – uživatelé, smlouvy, opravy."],
  },
  {
    version: "1.4.0",
    date: "2026-05-27",
    changes: ["Nástroje pro přepočet a mazání mezd."],
  },
  {
    version: "1.3.0",
    date: "2026-05-26",
    changes: ["Vylepšení mezd a další úpravy."],
  },
  {
    version: "1.2.0",
    date: "2026-05-22",
    changes: ["Uživatelské typy účetní a HR."],
  },
  {
    version: "1.1.0",
    date: "2026-05-22",
    changes: ["Stránka Můj profil a schvalování navržených úprav."],
  },
  {
    version: "1.0.0",
    date: "2026-05-21",
    changes: ["První produkční spuštění aplikace."],
  },
  {
    version: "0.9.0",
    date: "2026-05-21",
    changes: ["Nové uživatelské typy."],
  },
  {
    version: "0.8.0",
    date: "2026-05-06",
    changes: ["Přepracovaná historie zaměstnání."],
  },
  {
    version: "0.7.0",
    date: "2026-05-04",
    changes: ["Log změn – historie úprav dat."],
  },
  {
    version: "0.6.0",
    date: "2026-04-13",
    changes: ["Dovolené."],
  },
  {
    version: "0.5.0",
    date: "2026-04-13",
    changes: ["Plánovač směn."],
  },
  {
    version: "0.4.0",
    date: "2026-04-09",
    changes: ["Smlouvy a šablony smluv."],
  },
  {
    version: "0.3.0",
    date: "2026-04-09",
    changes: ["Evidence zaměstnanců."],
  },
  {
    version: "0.2.0",
    date: "2026-04-09",
    changes: ["Přihlašování a uživatelské účty."],
  },
  {
    version: "0.1.0",
    date: "2026-04-08",
    changes: ["Základ aplikace – první vývojová verze."],
  },
];
