/**
 * User-facing release notes shown in the changelog modal (opened by clicking the
 * version in the sidebar footer — gated by `system.version.changelog`).
 *
 * Curated Czech summaries, newest first, back to the first production launch
 * (v1.0.0). Keep entries short and end-user oriented (what changed for them, not
 * the implementation). **Add a new entry here as part of every staging→prod
 * promotion**, alongside the version bump.
 */

export interface ChangelogEntry {
  /** "X.Y.Z" — rendered with a leading "v". */
  version: string;
  /** ISO date (YYYY-MM-DD) the version went to production. */
  date: string;
  /** Short, user-facing Czech bullets. */
  changes: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "4.2.12",
    date: "2026-07-11",
    changes: [
      "Předávací protokol – Účty: při přidávání nebo úpravě účtu se ovládací ikony (upravit, smazat, zámek) už nevejdou mimo rámeček sekce. Pole Název je nyní širší než pole Částka (poměr 2:1).",
    ],
  },
  {
    version: "4.2.11",
    date: "2026-07-11",
    changes: [
      "Předávací protokol – Účty: uzamčené účty se nyní řadí nad všechny nezamčené (pod třemi speciálními řádky) a oddělují se od nich vodorovnou čárou. Stejné chování jako u Poznámek.",
      "Předávací protokol – Poznámky: mezi uzamčenými a nezamčenými poznámkami je nově výrazná dělicí čára pro lepší přehlednost.",
    ],
  },
  {
    version: "4.2.10",
    date: "2026-07-11",
    changes: [
      "Recepce: jména zaměstnanců (v tabulkách Walkiny a Lobby bar i ve výběru podepisujícího a mazání podpisu u Předávacího protokolu) se zobrazují jako zobrazované jméno zaměstnance, je-li nastaveno; jinak jako Jméno Příjmení. Změna se projeví i u dříve zapsaných záznamů.",
    ],
  },
  {
    version: "4.2.9",
    date: "2026-07-11",
    changes: [
      "Předávací protokol – Poznámky: dlouhé poznámky se nyní zobrazují na více řádků (celý text), místo aby se ořízly třemi tečkami.",
      "Předávací protokol – Poznámky: zamčené poznámky se řadí nad všechny nezamčené.",
    ],
  },
  {
    version: "4.2.8",
    date: "2026-07-11",
    changes: [
      "Nápověda (prohlídka aplikace): krok pro záložku Terminál se nyní správně zobrazí. Dříve se ukázková stránka nenačetla a z prohlídky nešlo odejít.",
    ],
  },
  {
    version: "4.2.7",
    date: "2026-07-11",
    changes: [
      "Recepce: při podpisu Předávacího protokolu (Předat/Převzít) i ve výběru zaměstnance u Walkinů a Lobby baru se nově nabízí každý, kdo je v daném měsíčním plánu směn – i když má v plánu skrytý řádek. Dříve takový zaměstnanec v nabídce chyběl, přestože měl na daný měsíc směny.",
    ],
  },
  {
    version: "4.2.6",
    date: "2026-07-11",
    changes: [
      "Předávací protokol: podepsání směny (Předat/Převzít) i odebrání podpisu už funguje – ověření hesla se nově dělá proti skutečnému přihlašovacímu e-mailu účtu. Dříve to u všech účtů hlásilo „Neplatné jméno nebo heslo“.",
    ],
  },
  {
    version: "4.2.5",
    date: "2026-07-10",
    changes: [
      "Verze aplikace vlevo dole je nově klikací (na počítači) a otevře přehled změn v jednotlivých verzích – pro uživatele s oprávněním „Zobrazit změny verzí“.",
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
      "Recepce – Walkiny a Lobby bar: pole se zaměstnancem se u nového záznamu předvyplní tím, kdo má právě službu na recepci. Lze změnit.",
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
      "Lobby bar: jedním prodejem lze zapsat více položek najednou, měna se volí u každé položky zvlášť.",
      "Lobby bar: v ceníku přibyl sloupec „Prodáno“ a tlačítko „Reset“ pro jeho vynulování (jen pro správce).",
      "Terminál: typy plateb si nyní správci sami spravují (přidání, přejmenování, mazání, řazení).",
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
      "Recepce: každý uživatel si může nastavit výchozí hotel, který se mu otevře jako první.",
    ],
  },
  {
    version: "4.0.1",
    date: "2026-07-09",
    changes: ["Drobné úpravy textů v průvodci Předávacího protokolu."],
  },
  {
    version: "4.0.0",
    date: "2026-07-09",
    changes: [
      "Nová sekce „Recepce“: Předávací protokol s virtuálním předáním a převzetím směny, evidence Walk-in prodejů a Taxi jízd s ceníkem a provizemi.",
      "Předávací protokol: historie změn s vracením kroků, uzamčení po podpisu a ochrana proti souběžné úpravě.",
      "Plánování směn: pravidla (limity X, pokrytí, 6 dní v řadě) se kontrolují i na serveru.",
    ],
  },
  {
    version: "3.8.4",
    date: "2026-07-05",
    changes: ["Mazání číselníků nebrání u ukončených zaměstnanců; upozornění při reaktivaci."],
  },
  {
    version: "3.8.3",
    date: "2026-07-05",
    changes: ["Údržba serverového prostředí (aktualizace běhu funkcí)."],
  },
  {
    version: "3.8.2",
    date: "2026-07-05",
    changes: ["Mazání vlastních a deaktivace vestavěných šablon smluv."],
  },
  {
    version: "3.8.1",
    date: "2026-07-05",
    changes: ["Mobil: sbalitelné položky historie zaměstnání; oprava přiblížení na iOS."],
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
    changes: ["Odlišná fialová barva odznaku Rodičovská."],
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
    changes: ["Opravy počtů odznaků; Můj profil zobrazuje jen podepsané smlouvy a umožňuje jejich stažení."],
  },
  {
    version: "3.5.0",
    date: "2026-06-30",
    changes: [
      "Částečné úvazky, kontrola minimální mzdy, souběžné smlouvy a editovatelný konec rodičovské dovolené.",
    ],
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
    changes: ["Automatická úprava spojovníků v názvech adres."],
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
    changes: ["Označení typu u číselných buněk směn (jen do souhrnu)."],
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
    changes: ["Bezpečnostní vylepšení."],
  },
  {
    version: "3.2.0",
    date: "2026-06-25",
    changes: ["Lišta blížící se expirace vlastních dokladů + odznak na Můj profil."],
  },
  {
    version: "3.1.3",
    date: "2026-06-24",
    changes: ["Bezpečnostní vylepšení."],
  },
  {
    version: "3.1.2",
    date: "2026-06-24",
    changes: ["Průvodce aplikací zohledňuje mobil; manuály „Na mobilu“."],
  },
  {
    version: "3.1.1",
    date: "2026-06-24",
    changes: ["Uživatelské manuály a krok průvodce pro Rodičovskou."],
  },
  {
    version: "3.1.0",
    date: "2026-06-23",
    changes: ["Vylepšení kolem zaměstnanců a smluv."],
  },
  {
    version: "3.0.2",
    date: "2026-06-23",
    changes: ["Opravy mřížky směn."],
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
    changes: ["Automatické „R“ u FOM; odznak „V zácviku“; admin zadává dovolenou komukoli; opravy rozvržení."],
  },
  {
    version: "2.3.2",
    date: "2026-06-22",
    changes: ["Opravy Logu změn; Volné směny viditelné i v uzavřených plánech."],
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
    changes: ["Skrytí pole Pohlaví na Můj profil a neutrální zobrazení."],
  },
  {
    version: "2.2.5",
    date: "2026-06-17",
    changes: ["Rozlišení názvů stažených smluv; řízení práv po řádcích."],
  },
  {
    version: "2.2.4",
    date: "2026-06-17",
    changes: ["Aktualizovaná šablona Prohlášení poplatníka."],
  },
  {
    version: "2.2.3",
    date: "2026-06-17",
    changes: ["Zaměstnanci jen se jménem se zobrazují v „Před nástupem“."],
  },
  {
    version: "2.2.2",
    date: "2026-06-12",
    changes: ["Ochrana proti smazání zaměstnance s buňkami ve směnách; úklid navázaných záznamů."],
  },
  {
    version: "2.2.1",
    date: "2026-06-12",
    changes: ["Přesun tlačítka pro přidání společnosti do záhlaví."],
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
    changes: ["Odznak Upozornění sčítá všechny fronty ke schválení; obnova při navigaci."],
  },
  {
    version: "2.1.2",
    date: "2026-06-11",
    changes: ["Interní úklid a zpevnění chybových hlášek."],
  },
  {
    version: "2.1.1",
    date: "2026-06-11",
    changes: ["Oprava: kontrola smluv už neblokuje zápisy běžných zaměstnanců."],
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
    changes: ["Ochrana mazání – zaměstnanci s historií a používané společnosti/pozice."],
  },
  {
    version: "2.0.0",
    date: "2026-06-11",
    changes: ["Sjednocení číslování verzí."],
  },
  {
    version: "1.12.0",
    date: "2026-06-11",
    changes: ["Bezpečnostní audit a úpravy životního cyklu zaměstnance."],
  },
  {
    version: "1.11.0",
    date: "2026-06-11",
    changes: ["Úvodní průvodce aplikací a Nápověda."],
  },
  {
    version: "1.10.0",
    date: "2026-06-11",
    changes: ["Konfigurovatelná oprávnění – vlastní uživatelské typy."],
  },
  {
    version: "1.9.0",
    date: "2026-06-11",
    changes: ["Směny: Volné směny."],
  },
  {
    version: "1.8.0",
    date: "2026-06-11",
    changes: ["Přepracovaný Multisport."],
  },
  {
    version: "1.7.0",
    date: "2026-06-11",
    changes: ["Další dokumenty zaměstnance."],
  },
  {
    version: "1.6.0",
    date: "2026-06-11",
    changes: ["Dávka oprav a vylepšení."],
  },
  {
    version: "1.5.0",
    date: "2026-06-11",
    changes: ["Dávka úprav – uživatelé, smlouvy, opravy."],
  },
  {
    version: "1.4.0",
    date: "2026-06-11",
    changes: ["Nástroje pro přepočet a mazání mezd."],
  },
  {
    version: "1.3.0",
    date: "2026-06-11",
    changes: ["Vylepšení mezd a další úpravy."],
  },
  {
    version: "1.2.0",
    date: "2026-06-11",
    changes: ["Uživatelské typy účetní a HR."],
  },
  {
    version: "1.1.0",
    date: "2026-06-11",
    changes: ["Samoobsluha zaměstnance – Můj profil a schvalování navržených úprav."],
  },
  {
    version: "1.0.0",
    date: "2026-06-11",
    changes: ["První produkční spuštění aplikace."],
  },
];
