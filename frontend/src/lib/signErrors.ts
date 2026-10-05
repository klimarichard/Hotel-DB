/**
 * Password-check failures in the signing dialogs (Předat / Převzít, signature
 * revert, shared-terminal logout) – code → Czech message, plus the precedence
 * used when one person has several linked accounts and each attempt failed for a
 * different reason.
 *
 * Kept free of any firebase import so the change-log renderer can reuse the same
 * wording for the logged `errorCode` without pulling the auth SDK into its chunk.
 *
 * Every Firebase failure used to collapse into "Neplatné jméno nebo heslo.", which
 * hid a lockout, a broken account link and a stale token behind the same words
 * (two real incidents, 2026-10).
 */

export const SIGN_ERROR_MESSAGES: Record<string, string> = {
  "auth/network-request-failed":
    "Nelze se připojit k serveru. Zkontrolujte připojení k internetu a zkuste to znovu.",
  "auth/too-many-requests":
    "Příliš mnoho neúspěšných pokusů. Účet je dočasně zablokován – zkuste to za několik minut, nebo si obnovte heslo.",
  "auth/user-disabled": "Tento účet je zablokován. Kontaktujte administrátora.",
  "auth/invalid-credential": "Nesprávné heslo.",
  "auth/wrong-password": "Nesprávné heslo.",
  "auth/invalid-login-credentials": "Nesprávné heslo.",
  "auth/user-not-found":
    "Účet tohoto uživatele nelze ověřit (chybí platný přihlašovací e-mail). Kontaktujte administrátora.",
  "auth/invalid-email":
    "Účet tohoto uživatele nelze ověřit (chybí platný přihlašovací e-mail). Kontaktujte administrátora.",
  "auth/missing-email":
    "Účet tohoto uživatele nelze ověřit (chybí platný přihlašovací e-mail). Kontaktujte administrátora.",
};

/**
 * Which failure to report when every linked account failed. A connection
 * problem means nothing was really checked; a lockout tells the person to WAIT
 * rather than retype; a disabled account needs an admin; only then "wrong
 * password"; a missing/invalid login loses to all of them (one dead test link
 * must not mask the real account's verdict).
 */
const PRECEDENCE = [
  "auth/network-request-failed",
  "auth/too-many-requests",
  "auth/user-disabled",
  "auth/invalid-credential",
  "auth/wrong-password",
  "auth/invalid-login-credentials",
  "auth/user-not-found",
  "auth/invalid-email",
  "auth/missing-email",
];

/** The most informative of several failure codes. */
export function pickSignErrorCode(codes: readonly string[]): string {
  let best: string | undefined;
  let bestRank = Infinity;
  for (const c of codes) {
    const rank = PRECEDENCE.indexOf(c);
    const r = rank === -1 ? PRECEDENCE.length : rank;
    if (r < bestRank) {
      best = c;
      bestRank = r;
    }
  }
  return best ?? "unknown";
}

/** Czech message for a failure code; unknown codes keep the code for support. */
export function signErrorMessage(code: string): string {
  return SIGN_ERROR_MESSAGES[code] ?? `Ověření se nezdařilo (kód: ${code}).`;
}
