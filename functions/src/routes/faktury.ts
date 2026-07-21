/**
 * Faktury — visual reproduction of hotel guest invoices.
 *
 * ⚠️ READ THIS BEFORE JUDGING THE AUDIT COVERAGE BELOW.
 *
 * This app is NOT the issuer of these invoices — Protel is. The hotel PMS
 * occasionally produces an invoice it can then no longer display, and a
 * receptionist re-types it here purely so it can be printed to look like the
 * original. Everything in this router is therefore *reconstruction*, never
 * allocation:
 *
 *  - `invoiceNo` is a user-typed INPUT. There is no counter, no sequence
 *    allocation, and no uniqueness check — two drafts may legitimately carry
 *    the same number (e.g. a corrected retype of the same Protel document).
 *  - A saved draft is a scratch pad, not an accounting record. Draft CRUD
 *    (`POST /`, `PUT /:id`, `DELETE /:id`) writes **NO audit-log entries** and
 *    there is **no soft-delete**. This is deliberate, not an oversight: every
 *    other write endpoint in this codebase is audit-instrumented, so without
 *    this comment the next reader would "fix" it. Auditing a scratch pad would
 *    bury the log in noise while implying these documents have a legal weight
 *    they do not have.
 *  - The **config** endpoint (`PUT /config`) DOES audit — that is shared
 *    configuration (VAT buckets, posting catalogue, agencies, hotel headers)
 *    which every reproduction depends on, and a bad edit there is worth
 *    tracing.
 *
 * All types, seed defaults and the arithmetic live in
 * `services/invoiceTypes.ts`; the print layout lives in `services/invoiceHtml.ts`.
 */
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logUpdate } from "../services/auditLog";
import { renderPdf } from "../services/pdfRenderer";
import {
  DEFAULT_FAKTURY_CONFIG,
  computeTotals,
  Agency,
  BankBlock,
  BillTo,
  CatalogItem,
  FakturyConfig,
  InvoiceDraft,
  InvoiceHotel,
  InvoiceLine,
  LineGroup,
  PartyAddress,
  VatBlock,
  VatRate,
} from "../services/invoiceTypes";
import {
  INVOICE_CSS,
  INVOICE_MARGINS,
  buildInvoiceHtml,
  CompanyInfo,
} from "../services/invoiceHtml";

export const fakturyRouter = Router();

const db = () => admin.firestore();

const COLLECTION = "invoiceDrafts";
const CONFIG_DOC = () => db().collection("settings").doc("fakturyConfig");

const VIEW_PERM = "nav.faktury.view";
const MANAGE_PERM = "faktury.manage";

/** A fresh Firestore auto-id (no write) — same trick as taxi.ts `newId()`. */
function newId(): string {
  return db().collection("_ids").doc().id;
}

/* ------------------------------------------------------------------ */
/* Primitive validators                                                */
/* ------------------------------------------------------------------ */

const STR_MAX = 200;

/** Trim + cap. Anything that isn't a string becomes "". */
function str(v: unknown, max = STR_MAX): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function bool(v: unknown): boolean {
  return v === true;
}

function num(v: unknown, limit = 10_000_000): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (Math.abs(v) > limit) return null;
  return v;
}

/** Integer or null (book numbers). */
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.trunc(v);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// `issuedAt` may carry a time component (the reproduction copies Protel's
// printed timestamp verbatim); the pure date fields must not.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;

function isDateish(v: unknown, allowTime = false): v is string {
  if (typeof v !== "string") return false;
  if (v === "") return true;
  return (allowTime ? DATETIME_RE : DATE_RE).test(v);
}

const LINE_GROUPS = new Set<LineGroup>(["item", "payment", "transfer"]);
const VAT_BLOCKS = new Set<VatBlock>(["normal", "advance"]);

const MAX_LINES = 200;

/**
 * A logo is inlined as a data: URI because the renderer blocks every remote
 * fetch (see pdfRenderer's SSRF guard). Only the three raster formats the
 * headless Chromium reliably prints are accepted.
 */
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const LOGO_MAX = 150_000;
const FOOTER_MAX = 500;

/* ------------------------------------------------------------------ */
/* Draft sanitizer                                                     */
/* ------------------------------------------------------------------ */

class BadRequest extends Error {}

function fail(msg: string): never {
  throw new BadRequest(msg);
}

function sanitizeAddress(raw: Record<string, unknown>): PartyAddress {
  return {
    street1: str(raw.street1),
    street2: str(raw.street2),
    street3: str(raw.street3),
    zip: str(raw.zip),
    city: str(raw.city),
    country: str(raw.country),
    ic: str(raw.ic),
    dic: str(raw.dic),
  };
}

function sanitizeBillTo(raw: unknown): BillTo {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (b.kind === "agency") {
    return { kind: "agency", agencyId: str(b.agencyId) };
  }
  // Anything that isn't explicitly an agency is a free-typed person — the
  // safe default, since a person carries its own address and cannot dangle.
  return { kind: "person", name: str(b.name), ...sanitizeAddress(b) };
}

function sanitizeLine(raw: unknown): InvoiceLine {
  const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const units = num(l.units);
  if (units === null) fail("Neplatný počet jednotek na řádku.");
  const unitPrice = num(l.unitPrice);
  if (unitPrice === null) fail("Neplatná jednotková cena na řádku.");
  if (!isDateish(l.date)) fail("Neplatné datum na řádku (očekává se YYYY-MM-DD).");

  const group = LINE_GROUPS.has(l.group as LineGroup) ? (l.group as LineGroup) : null;
  if (!group) fail("Neplatný typ řádku (item|payment|transfer).");

  // Deliberately NOT checked against the config's rate list: the catalogue is
  // admin-editable, so an older draft may point at a rate that has since been
  // deleted. That must degrade gracefully (the recap simply omits the bucket),
  // not 400 and make the draft unopenable.
  const vatRateId =
    typeof l.vatRateId === "string" && l.vatRateId !== "" ? l.vatRateId.slice(0, STR_MAX) : null;

  return {
    id: typeof l.id === "string" && l.id !== "" ? l.id.slice(0, STR_MAX) : newId(),
    date: l.date as string,
    units,
    description: str(l.description),
    detail: str(l.detail),
    unitPrice,
    vatRateId,
    group,
  };
}

/**
 * The supplier reference used to be one free-text field; it is now two
 * ("Cislo v AvailPro" / "Cislo rezervace partnera"). Drafts saved before the
 * split still carry the combined `supplierResNo`, so read it and cut on the
 * first slash rather than silently dropping data the user typed.
 */
function splitSupplierRef(d: Record<string, unknown>): {
  availProNo: string;
  partnerResNo: string;
} {
  if (d.availProNo !== undefined || d.partnerResNo !== undefined) {
    return { availProNo: str(d.availProNo), partnerResNo: str(d.partnerResNo) };
  }
  const legacy = str(d.supplierResNo);
  if (!legacy) return { availProNo: "", partnerResNo: "" };
  const at = legacy.indexOf("/");
  if (at < 0) return { availProNo: legacy, partnerResNo: "" };
  return {
    availProNo: legacy.slice(0, at).trim(),
    partnerResNo: legacy.slice(at + 1).trim(),
  };
}

/** Whole-draft replace. Unknown fields are dropped — the body is never spread. */
function sanitizeDraft(raw: unknown): InvoiceDraft {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const rawLines = d.lines;
  if (rawLines !== undefined && !Array.isArray(rawLines)) fail("lines musí být pole.");
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length > MAX_LINES) fail(`Faktura může mít nejvýše ${MAX_LINES} řádků.`);

  for (const [key, allowTime] of [
    ["arrival", false],
    ["departure", false],
    ["issuedAt", true],
  ] as const) {
    if (d[key] !== undefined && !isDateish(d[key], allowTime)) {
      fail(`Neplatné datum v poli ${key} (očekává se YYYY-MM-DD).`);
    }
  }

  const eurRate = num(d.eurRate ?? 0);
  if (eurRate === null || eurRate < 0) fail("Neplatný kurz EUR.");

  return {
    invoiceNo: str(d.invoiceNo),
    hotelId: str(d.hotelId),
    deposit: bool(d.deposit),
    guestName: str(d.guestName),
    roomNo: str(d.roomNo),
    arrival: (d.arrival as string) ?? "",
    departure: (d.departure as string) ?? "",
    reservationNo: str(d.reservationNo),
    ...splitSupplierRef(d),
    issuedAt: (d.issuedAt as string) ?? "",
    billTo: sanitizeBillTo(d.billTo),
    lines: lines.map(sanitizeLine),
    eurRate,
    issuedBy: str(d.issuedBy),
    // Free note, printed in italics under the invoice number. Allowed more
    // room than the 200-char default — it is prose, not an identifier.
    note: str(d.note, 500),
  };
}

/* ------------------------------------------------------------------ */
/* Config sanitizer                                                    */
/* ------------------------------------------------------------------ */

const MAX_VAT_RATES = 40;
const MAX_ITEMS = 400;
const MAX_AGENCIES = 300;
const MAX_HOTELS = 20;

function idOf(raw: Record<string, unknown>, seen: Set<string>): string {
  let id = typeof raw.id === "string" ? raw.id.trim().slice(0, STR_MAX) : "";
  if (id === "" || seen.has(id)) id = newId();
  seen.add(id);
  return id;
}

function arrayOf(v: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(`${label} musí být pole.`);
  const arr = v as unknown[];
  if (arr.length > max) fail(`${label}: nejvýše ${max} položek.`);
  return arr;
}

function sanitizeBank(raw: unknown): BankBlock {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { account: str(b.account), swift: str(b.swift), iban: str(b.iban) };
}

function sanitizeConfig(raw: unknown): FakturyConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const rateIds = new Set<string>();
  const vatRates: VatRate[] = arrayOf(c.vatRates, "vatRates", MAX_VAT_RATES).map((entry) => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const percent = num(e.percent, 100);
    if (percent === null || percent < 0) fail("Neplatná sazba DPH (percent).");
    return {
      id: idOf(e, rateIds),
      label: str(e.label),
      percent,
      block: VAT_BLOCKS.has(e.block as VatBlock) ? (e.block as VatBlock) : "normal",
      active: e.active !== false,
    };
  });

  const itemIds = new Set<string>();
  const items: CatalogItem[] = arrayOf(c.items, "items", MAX_ITEMS).map((entry) => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      id: idOf(e, itemIds),
      description: str(e.description),
      vatRateId:
        typeof e.vatRateId === "string" && e.vatRateId !== "" ? e.vatRateId.slice(0, STR_MAX) : null,
      group: LINE_GROUPS.has(e.group as LineGroup) ? (e.group as LineGroup) : "item",
      active: e.active !== false,
    };
  });

  const agencyIds = new Set<string>();
  const agencies: Agency[] = arrayOf(c.agencies, "agencies", MAX_AGENCIES).map((entry) => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      id: idOf(e, agencyIds),
      name: str(e.name),
      ...sanitizeAddress(e),
      active: e.active !== false,
    };
  });

  const hotelIds = new Set<string>();
  const hotels: InvoiceHotel[] = arrayOf(c.hotels, "hotels", MAX_HOTELS).map((entry) => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const logo = typeof e.logoDataUri === "string" ? e.logoDataUri.trim() : "";
    if (logo !== "") {
      if (logo.length > LOGO_MAX) {
        fail("Logo je příliš velké (max. 150 kB v zakódované podobě). Zmenšete obrázek.");
      }
      if (!LOGO_RE.test(logo)) {
        fail("Logo musí být obrázek PNG, JPEG nebo WEBP vložený jako data: URI.");
      }
    }
    return {
      id: idOf(e, hotelIds),
      name: str(e.name),
      bookNo: intOrNull(e.bookNo),
      depositBookNo: intOrNull(e.depositBookNo),
      companyId:
        typeof e.companyId === "string" && e.companyId !== "" ? e.companyId.slice(0, STR_MAX) : null,
      logoDataUri: logo,
      // Newlines are meaningful here (the footer prints as a block), so this
      // one is length-capped but not collapsed.
      footer: typeof e.footer === "string" ? e.footer.slice(0, FOOTER_MAX) : "",
      bankName: str(e.bankName),
      bankEur: sanitizeBank(e.bankEur),
      bankCzk: sanitizeBank(e.bankCzk),
      active: e.active !== false,
    };
  });

  return { vatRates, items, agencies, hotels };
}

/* ------------------------------------------------------------------ */
/* Shared reads                                                        */
/* ------------------------------------------------------------------ */

/**
 * Current config, or the shipped defaults when the doc has never been written.
 * Lazily seeded on purpose: a GET must not write. The defaults only become a
 * real document the first time an admin saves the settings.
 */
async function readConfig(): Promise<FakturyConfig> {
  const snap = await CONFIG_DOC().get();
  if (!snap.exists) return DEFAULT_FAKTURY_CONFIG;
  const data = snap.data() as Record<string, unknown>;
  return {
    vatRates: Array.isArray(data.vatRates) ? (data.vatRates as VatRate[]) : [],
    items: Array.isArray(data.items) ? (data.items as CatalogItem[]) : [],
    agencies: Array.isArray(data.agencies) ? (data.agencies as Agency[]) : [],
    hotels: Array.isArray(data.hotels) ? (data.hotels as InvoiceHotel[]) : [],
  };
}

/** Who the invoice is addressed to, for the list view. */
function billToName(billTo: BillTo | undefined, config: FakturyConfig): string {
  if (!billTo) return "";
  if (billTo.kind === "agency") {
    return config.agencies.find((a) => a.id === billTo.agencyId)?.name ?? "";
  }
  return billTo.name ?? "";
}

/* ------------------------------------------------------------------ */
/* Config endpoints (registered before /:id so they aren't read as ids) */
/* ------------------------------------------------------------------ */

/**
 * GET /api/faktury/config
 * Shared configuration: VAT buckets, posting catalogue, agencies, hotels.
 * Readable by anyone who can see the page — the invoice form is unusable
 * without it.
 */
fakturyRouter.get(
  "/config",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (_req: AuthRequest, res: Response) => {
    res.json(await readConfig());
  }
);

/**
 * PUT /api/faktury/config
 * Whole-document replace. Audited (unlike the drafts below) — this is shared
 * configuration every reproduction depends on.
 */
fakturyRouter.put(
  "/config",
  requireAuth,
  requirePermission(MANAGE_PERM),
  async (req: AuthRequest, res: Response) => {
    let config: FakturyConfig;
    try {
      config = sanitizeConfig(req.body);
    } catch (e) {
      if (e instanceof BadRequest) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }

    // Firestore caps a document at 1 MiB. Five hotel logos inlined as base64
    // are the only thing here that can approach that — which is exactly why
    // LOGO_MAX exists. Reject with a clear message rather than letting the
    // Firestore write fail with an opaque 500.
    const bytes = Buffer.byteLength(JSON.stringify(config), "utf8");
    if (bytes > 900_000) {
      res.status(413).json({
        error:
          "Nastavení je příliš velké (limit 1 MB). Nejčastější příčinou jsou vložená loga hotelů — zmenšete je a uložte znovu.",
      });
      return;
    }

    const beforeSnap = await CONFIG_DOC().get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await CONFIG_DOC().set({
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    });

    // The arrays are verbose, so log counts rather than dumping every entry.
    await logUpdate(ctxFromReq(req), {
      collection: "settings",
      resourceId: "fakturyConfig",
      before: {
        vatRates: Array.isArray(before.vatRates) ? before.vatRates.length : 0,
        items: Array.isArray(before.items) ? before.items.length : 0,
        agencies: Array.isArray(before.agencies) ? before.agencies.length : 0,
        hotels: Array.isArray(before.hotels) ? before.hotels.length : 0,
      },
      after: {
        vatRates: config.vatRates.length,
        items: config.items.length,
        agencies: config.agencies.length,
        hotels: config.hotels.length,
      },
    });

    res.json({ ok: true });
  }
);

/**
 * POST /api/faktury/render-pdf
 * Body: { draft }. Renders the invoice through the shared Puppeteer service and
 * streams the PDF straight back. Nothing is persisted, so nothing is audited —
 * same contract as `POST /dokumenty/render-pdf`.
 *
 * The draft in the body need not be saved: the page renders whatever is on
 * screen, which is the whole point of a reproduction tool.
 */
fakturyRouter.post(
  "/render-pdf",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as { draft?: unknown };
    let draft: InvoiceDraft;
    try {
      draft = sanitizeDraft(body.draft);
    } catch (e) {
      if (e instanceof BadRequest) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }

    const config = await readConfig();

    // The issuer footer line comes from the `companies` doc the invoice hotel
    // points at. A missing/unset company is NOT an error — the layout simply
    // omits that line, and the hotel's own `footer` block still prints.
    const hotel = config.hotels.find((h) => h.id === draft.hotelId);
    const company = await loadIssuer(hotel?.companyId ?? null);

    try {
      const html = buildInvoiceHtml(draft, config, company);
      const pdf = await renderPdf(html, INVOICE_MARGINS, {
        extraCss: INVOICE_CSS,
        // The invoice header is part of the fixed layout, not a flowing logo
        // image — measuring it would silently inflate the top margin of every
        // page after the first.
        logoOffset: false,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", pdf.length.toString());
      res.send(pdf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      res.status(500).json({ error: `PDF se nepodařilo vytvořit: ${msg}` });
    }
  }
);

/* ------------------------------------------------------------------ */
/* Draft CRUD — NOT audited, hard delete. See the file header.         */
/* ------------------------------------------------------------------ */

/**
 * GET /api/faktury
 * Saved drafts, newest first. Returns summaries only — no `lines`, no
 * addresses; the list view needs neither and both are bulky.
 */
fakturyRouter.get(
  "/",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (_req: AuthRequest, res: Response) => {
    const [snap, config] = await Promise.all([db().collection(COLLECTION).get(), readConfig()]);
    const list = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const lines = Array.isArray(data.lines) ? (data.lines as InvoiceLine[]) : [];
      return {
        id: d.id,
        invoiceNo: (data.invoiceNo as string) ?? "",
        hotelId: (data.hotelId as string) ?? "",
        deposit: data.deposit === true,
        guestName: (data.guestName as string) ?? "",
        billToName: billToName(data.billTo as BillTo | undefined, config),
        total: computeTotals(lines, config.vatRates).total,
        // ISO string, never the raw Firestore Timestamp. `InvoiceSummary`
        // declares `string | null` and the client formats it as a date; a
        // Timestamp serialises to `{_seconds,_nanoseconds}`, which the
        // formatter passes straight through, and React then throws
        // "Objects are not valid as a React child" and blanks the page.
        updatedAt: tsToIso(data.updatedAt),
        updatedBy: data.updatedByName ?? data.updatedBy ?? "",
      };
    });
    // Sorted in memory rather than via orderBy: a legacy doc without
    // `updatedAt` would be silently dropped by Firestore's missing-field
    // exclusion, and losing a saved invoice from the list is worse than an
    // in-memory sort of a small collection.
    list.sort((a, b) => tsMillis(b.updatedAt) - tsMillis(a.updatedAt));
    // Wrapped in an object, NOT returned as a bare array — the client reads
    // `list.invoices`. `api.get<T>()` is an unchecked cast over `res.json()`,
    // so a shape mismatch here type-checks on both sides and surfaces only as
    // a permanently empty list at runtime.
    res.json({ invoices: list });
  }
);

function toCompanyInfo(c: Record<string, unknown>): CompanyInfo {
  return {
    name: typeof c.name === "string" ? c.name : "",
    address: typeof c.address === "string" ? c.address : "",
    ic: typeof c.ic === "string" ? c.ic : "",
    dic: typeof c.dic === "string" ? c.dic : "",
    fileNo: typeof c.fileNo === "string" ? c.fileNo : "",
  };
}

/**
 * The issuing legal entity for the footer line.
 *
 * Falls back to HPM when the hotel has no `companyId` — which is the state
 * every hotel ships in, since the seeded registry cannot know the auto-ids of
 * the `companies` docs. The fallback is not a guess: the source workbook's
 * Hotel Details sheet lists "Hotel Property Management s.r.o." as the issuer
 * for all five hotels. Setting a company on the hotel overrides it, which is
 * what STP-issued invoices would need.
 */
async function loadIssuer(companyId: string | null): Promise<CompanyInfo | null> {
  if (companyId) {
    const snap = await db().collection("companies").doc(companyId).get();
    if (snap.exists) return toCompanyInfo(snap.data() as Record<string, unknown>);
  }
  const fallback = await db()
    .collection("companies")
    .where("abbreviation", "==", "HPM")
    .limit(1)
    .get();
  if (!fallback.empty) {
    return toCompanyInfo(fallback.docs[0].data() as Record<string, unknown>);
  }
  return null;
}

/** Firestore Timestamp → ISO string, matching `exchange.ts`'s `tsToIso`. */
function tsToIso(v: unknown): string | null {
  if (v && typeof v === "object" && typeof (v as { toDate?: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof v === "string" ? v : null;
}

function tsMillis(v: unknown): number {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/**
 * POST /api/faktury
 * Save a new draft. Firestore auto-id — the invoice number is user input and
 * carries no uniqueness guarantee, so it can never be the document id.
 *
 * Gated on the view permission, not a manage one: retyping an invoice IS the
 * job of everyone who can open this page.
 */
fakturyRouter.post(
  "/",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (req: AuthRequest, res: Response) => {
    let draft: InvoiceDraft;
    try {
      draft = sanitizeDraft(req.body);
    } catch (e) {
      if (e instanceof BadRequest) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
    const name = await userName(req.uid);
    const ref = await db().collection(COLLECTION).add({
      ...draft,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
      createdByName: name,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
      updatedByName: name,
    });
    res.status(201).json({ id: ref.id });
  }
);

/** GET /api/faktury/:id — the full draft. */
fakturyRouter.get(
  "/:id",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (req: AuthRequest, res: Response) => {
    const snap = await db().collection(COLLECTION).doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: "Faktura neexistuje." });
      return;
    }
    // Same Timestamp hazard as the list endpoint: the audit fields would go
    // out as `{_seconds,_nanoseconds}` objects, ride along in the draft the
    // editor holds, and be rendered or posted back as junk. Normalise them.
    const data = snap.data() ?? {};
    res.json({
      ...data,
      id: snap.id,
      createdAt: tsToIso(data.createdAt),
      updatedAt: tsToIso(data.updatedAt),
    });
  }
);

/**
 * PUT /api/faktury/:id
 * Whole-draft replace (not a merge): the client always holds the complete
 * document, and a merge would leave orphaned fields behind after an edit that
 * clears something.
 */
fakturyRouter.put(
  "/:id",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (req: AuthRequest, res: Response) => {
    let draft: InvoiceDraft;
    try {
      draft = sanitizeDraft(req.body);
    } catch (e) {
      if (e instanceof BadRequest) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
    const ref = db().collection(COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Faktura neexistuje." });
      return;
    }
    const before = snap.data() as Record<string, unknown>;
    await ref.set({
      ...draft,
      // Preserved across the whole-doc replace — the creator is history, not
      // part of the editable draft.
      createdAt: before.createdAt ?? FieldValue.serverTimestamp(),
      createdBy: before.createdBy ?? req.uid,
      createdByName: before.createdByName ?? "",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
      updatedByName: await userName(req.uid),
    });
    res.json({ id: req.params.id });
  }
);

/**
 * DELETE /api/faktury/:id
 * Hard delete — no soft-delete tombstone. A draft is a scratch pad; the real
 * invoice lives in Protel and is unaffected by anything here.
 */
fakturyRouter.delete(
  "/:id",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (req: AuthRequest, res: Response) => {
    const ref = db().collection(COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Faktura neexistuje." });
      return;
    }
    await ref.delete();
    res.json({ id: req.params.id, deleted: true });
  }
);

/** Display name of the acting user, "" when unknown. */
async function userName(uid: string | undefined): Promise<string> {
  if (!uid) return "";
  const snap = await db().collection("users").doc(uid).get();
  const name = snap.exists ? (snap.data() as Record<string, unknown>).name : undefined;
  return typeof name === "string" ? name : "";
}
