import { CHANGE_TYPE_TO_CONTRACTS, type ContractType } from "./contractVariables";

/**
 * What a generated / uploaded PDF *is* from the user's point of view.
 *
 * The contract action buttons are shared by every employment-history row and by
 * the ad-hoc documents tab, but "smlouva" is only true on a Nástup row. On a
 * Dodatek row "Generovat smlouvu" names the wrong document, and "Nahrát
 * podepsanou smlouvu" asks for a document that does not exist for that row.
 *
 * `ukonceni` is spelled without diacritics because it is a code-level key, not
 * display text — every user-visible form comes from `docWords()`.
 */
export type ContractDocKind = "smlouva" | "dodatek" | "ukonceni" | "dokument";

/**
 * The kinds that share one employment-history list. A session mixes Nástup,
 * Dodatek and Ukončení rows, so their action buttons are width-aligned against
 * each other (see AlignedLabel). "dokument" is deliberately absent: ad-hoc
 * documents live in their own tab where every row is the same kind already.
 */
export const EMPLOYMENT_DOC_KINDS: readonly ContractDocKind[] = [
  "smlouva",
  "dodatek",
  "ukonceni",
];

/**
 * The inflected forms each label needs.
 *
 * Czech forces this: the four nouns span three genders (smlouva = feminine,
 * dodatek / dokument = masculine inanimate, ukončení = neuter), so every word
 * that agrees with them changes shape too. Storing only the bare noun and
 * concatenating would produce "Nahrát podepsanou dodatek" — visibly broken
 * Czech. Each field below is a form some sentence in the UI actually needs; add
 * a field rather than bending a sentence to fit the ones that exist.
 */
interface DocWords {
  /** Accusative: "Generovat …", "Smazat …". */
  akuzativ: string;
  /** Genitive: "…záznam <čeho>". */
  genitiv: string;
  /** Nominative, capitalised — sentence subject: "… bude trvale smazán…". */
  nominativ: string;
  /** Accusative with the "signed" participle: "Nahrát <co>". */
  podepsanyAkuzativ: string;
  /** Past participle of *smazat*, gender-agreed with `nominativ`. */
  smazan: string;
  /** "vygenerovaný …", gender-agreed — used by the stale-row tooltip. */
  vygenerovany: string;
}

const WORDS: Record<ContractDocKind, DocWords> = {
  smlouva: {
    akuzativ: "smlouvu",
    genitiv: "smlouvy",
    nominativ: "Smlouva",
    podepsanyAkuzativ: "podepsanou smlouvu",
    smazan: "smazána",
    vygenerovany: "vygenerovaná smlouva",
  },
  dodatek: {
    akuzativ: "dodatek",
    genitiv: "dodatku",
    nominativ: "Dodatek",
    podepsanyAkuzativ: "podepsaný dodatek",
    smazan: "smazán",
    vygenerovany: "vygenerovaný dodatek",
  },
  ukonceni: {
    akuzativ: "ukončení",
    genitiv: "ukončení",
    nominativ: "Ukončení",
    podepsanyAkuzativ: "podepsané ukončení",
    smazan: "smazáno",
    vygenerovany: "vygenerované ukončení",
  },
  dokument: {
    akuzativ: "dokument",
    genitiv: "dokumentu",
    nominativ: "Dokument",
    podepsanyAkuzativ: "podepsaný dokument",
    smazan: "smazán",
    vygenerovany: "vygenerovaný dokument",
  },
};

export function docWords(kind: ContractDocKind): DocWords {
  return WORDS[kind];
}

/**
 * Row type → document kind. This is the authoritative direction: the row states
 * what it is, regardless of which template happens to be resolved for it (a
 * Nástup row with a contract type outside HPP/PPP/DPP resolves to no template
 * at all, and must still read "smlouva").
 *
 * Rodičovská never reaches here — `groupBySession()` collects those rows into
 * `session.rodicovska` for header display and keeps them out of `session.rows`,
 * so no parental-leave row ever renders contract actions.
 */
export function docKindForChangeType(changeType: string): ContractDocKind {
  if (changeType === "nástup") return "smlouva";
  if (changeType === "změna smlouvy") return "dodatek";
  if (changeType === "ukončení") return "ukonceni";
  return "dokument";
}

/**
 * Template id → document kind, for the places that have a contract type but no
 * row (the generation modal).
 *
 * Derived from `CHANGE_TYPE_TO_CONTRACTS` instead of re-listing template ids:
 * that map already declares which templates belong to which row type, so a
 * template added there is classified here automatically rather than silently
 * falling through to "dokument". Anything genuinely not row-tied — Multisport,
 * Hmotná odpovědnost, admin-created custom templates — is a document.
 */
const TYPE_TO_KIND: ReadonlyMap<ContractType, ContractDocKind> = (() => {
  const m = new Map<ContractType, ContractDocKind>();
  for (const [changeType, types] of Object.entries(CHANGE_TYPE_TO_CONTRACTS)) {
    const kind = docKindForChangeType(changeType);
    for (const t of types) m.set(t, kind);
  }
  return m;
})();

export function docKindForContractType(type: ContractType): ContractDocKind {
  return TYPE_TO_KIND.get(type) ?? "dokument";
}
