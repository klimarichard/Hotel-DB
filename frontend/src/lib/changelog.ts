/**
 * User-facing release notes shown in the changelog modal (opened by clicking the
 * version in the sidebar footer — gated by `system.version.changelog`).
 *
 * Curated Czech summaries, newest first. Keep entries short and end-user oriented
 * (what changed for them, not the implementation). **Add a new entry here as part
 * of every staging→prod promotion**, alongside the version bump.
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
    version: "4.2.4",
    date: "2026-07-10",
    changes: [
      "Dovolená: čekající žádosti a návrhy úprav se v seznamu „Všechny žádosti“ řadí navrch, aby je schvalující viděl hned. Po schválení nebo zamítnutí se žádost vrátí na své místo podle data.",
    ],
  },
  {
    version: "4.2.3",
    date: "2026-07-10",
    changes: [
      "Recepce – Walkiny a Lobby bar: pole se zaměstnancem se u nového záznamu předvyplní tím, kdo má právě službu na recepci (stejně jako podpis v Předávacím protokolu). Lze změnit.",
    ],
  },
  {
    version: "4.2.2",
    date: "2026-07-10",
    changes: [
      "Dovolená: starší schválené žádosti se po skončení správně přesouvají do sekce „Starší žádosti“ (dříve některé zůstávaly v hlavním seznamu).",
    ],
  },
  {
    version: "4.2.1",
    date: "2026-07-10",
    changes: [
      "Lobby bar: jedním prodejem lze zapsat více položek najednou, měna se volí u každé položky zvlášť.",
      "Lobby bar: v ceníku přibyl sloupec „Prodáno“ (počet prodaných kusů) a tlačítko „Reset“ pro jeho vynulování (jen pro správce).",
      "Terminál: typy plateb si nyní správci sami spravují v panelu vpravo (přidání, přejmenování, mazání, řazení).",
    ],
  },
  {
    version: "4.2.0",
    date: "2026-07-10",
    changes: [
      "Recepce: nová záložka „Lobby bar“ (hotel Ambiance) pro evidenci prodejů z lobby baru včetně ceníku a provizí.",
      "Recepce: nová záložka „Terminál“ (hotel Amigo & Alqush) pro evidenci plateb z platebního terminálu.",
    ],
  },
  {
    version: "4.1.0",
    date: "2026-07-10",
    changes: [
      "Recepce: zápisy z Recepce (Walkiny, Taxi, protokol) se přisuzují tomu, kdo má službu, i když jste přihlášeni pod sdíleným účtem recepce.",
      "Recepce: každý uživatel si může nastavit výchozí hotel, který se mu v Recepci otevře jako první.",
      "Recepce: drobná vylepšení historie Předávacího protokolu.",
    ],
  },
  {
    version: "4.0.0",
    date: "2026-07-09",
    changes: [
      "Nová sekce „Recepce“: Předávací protokol s virtuálním předáním a převzetím směny, evidence Walk-in prodejů a Taxi jízd s ceníkem tras a provizemi.",
      "Předávací protokol: historie změn s možností vrácení kroků, uzamčení po podpisu a ochrana proti souběžné úpravě dvěma lidmi.",
      "Plánování směn: pravidla (limity X, pokrytí směn, 6 dní v řadě) se nově kontrolují i na serveru.",
    ],
  },
];
