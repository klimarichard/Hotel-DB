/**
 * Who a Recepce write is attributed to.
 *
 * The front desk runs on a shared terminal: one generic login stays signed in
 * for the whole day and every receptionist uses it. Attributing history and
 * audit entries to that account records nothing useful — "recepce" edited the
 * protokol tells you nobody edited it.
 *
 * The person actually on shift is already known, though: they proved their
 * identity with a password when they signed **Převzal** on the *previous*
 * shift's protocol. That signature is the handover — "I take this desk over" —
 * so it names whoever is standing at it now. This module resolves that person
 * and hands back an actor to stamp onto history + audit entries in their place.
 *
 * The substitution only happens for user types flagged `sharedTerminal` in
 * Settings → Typy uživatelů. A manager or admin who opens the Recepce page from
 * their own account is attributed to themselves, as everywhere else in the app.
 * When the on-shift person cannot be resolved — no previous protocol, unsigned,
 * or a stale chain — the session account is used and nothing is blocked.
 *
 * `viaUid` / `viaEmail` on the returned actor preserve the session account, so
 * the audit trail never loses the fact that the write came through a terminal.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { AuthRequest } from "../middleware/auth";
import { isSharedTerminalType } from "../auth/permissions";
import { AuditContext } from "./auditLog";
import { HotelSlug } from "./hotels";
import { HandoverDoc, ShiftType, docId, handoverCol, previousShift } from "./handoverShared";
import * as clock from "./clock";

const db = () => admin.firestore();

/**
 * How stale the last Převzal may be before we stop believing it identifies the
 * person at the desk. Covers a long shift plus a chain left unsigned overnight;
 * beyond that the terminal is attributed to its own account rather than to
 * someone who went home two days ago.
 */
const ON_DUTY_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** An actor for history entries (`HistoryActor`) and audit entries alike. */
export interface RecepceActor {
  uid: string;
  email: string;
  roleType: string;
  /** The shared-terminal session this write came through, when substituted. */
  viaUid?: string;
  viaEmail?: string;
}

/** The logged-in account — what every non-terminal write uses. */
function sessionActor(req: AuthRequest): RecepceActor {
  return { uid: req.uid ?? "", email: req.userEmail ?? "", roleType: req.roleType ?? "" };
}

/** Adapt an actor to the audit layer. Shape-compatible with `ctxFromReq`. */
export function actorCtx(actor: RecepceActor): AuditContext {
  return {
    uid: actor.uid,
    email: actor.email,
    roleType: actor.roleType,
    ...(actor.viaUid ? { viaUid: actor.viaUid, viaEmail: actor.viaEmail ?? "" } : {}),
  };
}

/** The resolved person's own user type, for the audit entry's `userRole`. */
async function roleTypeOf(uid: string): Promise<string> {
  try {
    const snap = await db().collection("users").doc(uid).get();
    const rt = snap.exists ? (snap.data() as { roleType?: unknown }).roleType : undefined;
    return typeof rt === "string" ? rt : "";
  } catch {
    return "";
  }
}

/** Build the substituted actor from a Převzal stamp. */
async function actorFromSignature(
  req: AuthRequest,
  signer: { uid?: unknown; email?: unknown }
): Promise<RecepceActor | null> {
  const uid = typeof signer.uid === "string" ? signer.uid : "";
  if (uid === "") return null;
  return {
    uid,
    email: typeof signer.email === "string" ? signer.email : "",
    roleType: await roleTypeOf(uid),
    viaUid: req.uid ?? "",
    viaEmail: req.userEmail ?? "",
  };
}

/**
 * Attribution for a write against ONE named protocol: the person who signed
 * Převzal on the shift immediately before it. Exact by construction — no clock
 * involved, because the protocol being edited says which shift it belongs to.
 */
export async function resolveRecepceActor(
  req: AuthRequest,
  hotel: HotelSlug,
  shiftDate: string,
  shiftType: ShiftType
): Promise<RecepceActor> {
  if (!(await isSharedTerminalType(req.roleType))) return sessionActor(req);
  try {
    const prev = previousShift(shiftDate, shiftType);
    const snap = await handoverCol(hotel).doc(docId(prev.date, prev.shift)).get();
    const prevzal = snap.exists ? (snap.data() as HandoverDoc).prevzal : null;
    if (!prevzal) return sessionActor(req);
    return (await actorFromSignature(req, prevzal)) ?? sessionActor(req);
  } catch {
    return sessionActor(req);
  }
}

/**
 * Attribution for walkiny / taxi, which are filed against a date but not a
 * shift. Whoever most recently signed Převzal at this hotel is the one holding
 * the desk, so the newest signature across the hotel's protocols identifies
 * them — unless it is too old to be believed (see ON_DUTY_MAX_AGE_MS).
 *
 * `prevzal.at` is a scalar subfield, so Firestore's automatic single-field index
 * serves this query; docs with no Převzal are simply absent from that index.
 */
export async function resolveOnDutyActor(req: AuthRequest, hotel: HotelSlug): Promise<RecepceActor> {
  if (!(await isSharedTerminalType(req.roleType))) return sessionActor(req);
  try {
    const snap = await handoverCol(hotel).orderBy("prevzal.at", "desc").limit(1).get();
    if (snap.empty) return sessionActor(req);
    const prevzal = (snap.docs[0].data() as HandoverDoc).prevzal;
    if (!prevzal?.at) return sessionActor(req);
    const age = clock.now().getTime() - (prevzal.at as Timestamp).toMillis();
    if (age > ON_DUTY_MAX_AGE_MS) return sessionActor(req);
    return (await actorFromSignature(req, prevzal)) ?? sessionActor(req);
  } catch {
    return sessionActor(req);
  }
}
