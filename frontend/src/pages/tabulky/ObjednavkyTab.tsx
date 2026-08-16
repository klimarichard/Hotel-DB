import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import Button from "../../components/Button";
import IconButton from "../../components/IconButton";
import ConfirmModal from "../../components/ConfirmModal";
import {
  EMPTY_OBJEDNAVKY_CONFIG,
  ORDER_UNITS,
  buildOrderHtml,
  buildOrderText,
  companyInvoiceDetails,
  copyOrderEmail,
  itemLabel,
  newRowId,
  resolveBlocks,
  searchItems,
  type ObjednavkyConfig,
  type OrderBlock,
  type OrderCompany,
  type OrderHotel,
  type OrderItem,
  type OrderUnit,
} from "../../lib/objednavky";
import styles from "./ObjednavkyTab.module.css";

/**
 * Tabulky → Objednávky.
 *
 * Composes the supply-order e-mail and puts it on the clipboard. NOTHING about
 * an order is stored: the page opens blank every time and the working state
 * dies with the component, exactly like the Směnárna calculator beside it. The
 * only persisted thing is the číselník (`settings/objednavkyConfig`) — the
 * product catalogue and the four hotels with their delivery and billing
 * details — edited in the panel behind the Číselníky button.
 *
 * The e-mail is copied in TWO flavours at once (see lib/objednavky.ts):
 * text/html so Outlook renders a real table, text/plain so a plain-text target
 * still gets a readable list. The on-screen preview is rendered from the very
 * same HTML string that goes to the clipboard, so it cannot show one thing and
 * paste another.
 */

const byCs = (a: string, b: string) => a.localeCompare(b, "cs");

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
} | null;

export default function ObjednavkyTab() {
  const { can } = useAuth();
  const canManage = can("tabulky.objednavky.manage");

  const [config, setConfig] = useState<ObjednavkyConfig>(EMPTY_OBJEDNAVKY_CONFIG);
  /** `companies/{id}` — the billing identities, owned by Nastavení → Společnosti. */
  const [companies, setCompanies] = useState<OrderCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  /** The order being assembled. Never persisted, never restored. */
  const [blocks, setBlocks] = useState<OrderBlock[]>([]);

  /**
   * The line whose Množství field should take focus. Set when a line is added
   * so the search → quantity hand-off works without the mouse; the field clears
   * it once it has focused, so a re-render cannot steal focus back later.
   */
  const [focusLineId, setFocusLineId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `/companies` is readable by any authenticated user (it populates form
    // dropdowns app-wide), so no extra permission is needed for the billing
    // block — the tab's own key already gates getting this far.
    Promise.all([
      api.get<ObjednavkyConfig>("/objednavky/config"),
      api.get<OrderCompany[]>("/companies"),
    ])
      .then(([c, comps]) => {
        if (cancelled) return;
        setConfig(c);
        setCompanies(comps);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, "Číselník objednávek se nepodařilo načíst."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hotelById = useMemo(
    () => new Map(config.hotels.map((h) => [h.id, h])),
    [config.hotels]
  );

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  /** Active hotels not already in the order, alphabetically. */
  const availableHotels = useMemo(() => {
    const used = new Set(blocks.map((b) => b.hotelId));
    return config.hotels
      .filter((h) => h.active && !used.has(h.id))
      .sort((a, b) => byCs(a.name, b.name));
  }, [config.hotels, blocks]);

  const resolved = useMemo(
    () => resolveBlocks(blocks, config, companies),
    [blocks, config, companies]
  );
  const html = useMemo(() => buildOrderHtml(resolved), [resolved]);
  const text = useMemo(() => buildOrderText(resolved), [resolved]);

  /**
   * Hotels in the order with no delivery address, or whose billing company is
   * unset or no longer exists.
   *
   * This blocks the copy rather than warning beside it: the sentence is built
   * by substitution, so a blank field does not produce a visible gap the user
   * would catch — it produces "s doručením na adresu  a fakturačními údaji .",
   * which reads as a finished sentence and would be sent as one.
   */
  const incompleteHotels = useMemo(
    () =>
      resolved
        .filter((r) => r.deliveryAddress.trim() === "" || r.invoiceDetails.trim() === "")
        .map((r) => r.hotelName),
    [resolved]
  );

  const canCopy = resolved.length > 0 && incompleteHotels.length === 0;

  function addHotel(hotelId: string) {
    if (!hotelId) return;
    setBlocks((prev) => [...prev, { id: newRowId(), hotelId, lines: [] }]);
  }

  function removeBlock(block: OrderBlock) {
    const hotel = hotelById.get(block.hotelId);
    const finish = () => {
      setBlocks((prev) => prev.filter((b) => b.id !== block.id));
      setConfirmState(null);
    };
    // Only worth confirming once there is something to lose.
    if (block.lines.length === 0) {
      finish();
      return;
    }
    setConfirmState({
      title: "Odebrat hotel z objednávky?",
      message: `Objednávka pro ${hotel?.name ?? "tento hotel"} obsahuje ${block.lines.length} položek. Odebráním se ztratí.`,
      confirmLabel: "Odebrat",
      danger: true,
      onConfirm: finish,
    });
  }

  function addLine(blockId: string, itemId: string) {
    // The id is minted HERE rather than inside the updater so it can also be
    // handed to the focus target — an updater may be invoked more than once
    // under StrictMode, which would mint two ids and focus neither line.
    const lineId = newRowId();
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, lines: [...b.lines, { id: lineId, itemId, qty: 1 }] } : b))
    );
    setFocusLineId(lineId);
  }

  function setQty(blockId: string, lineId: string, qty: number) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, lines: b.lines.map((l) => (l.id === lineId ? { ...l, qty } : l)) }
          : b
      )
    );
  }

  function removeLine(blockId: string, lineId: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId ? { ...b, lines: b.lines.filter((l) => l.id !== lineId) } : b
      )
    );
  }

  async function handleCopy() {
    setError(null);
    try {
      const flavour = await copyOrderEmail(html, text);
      setNotice(
        flavour === "rich"
          ? "Zkopírováno. Vložte do nové zprávy v Outlooku."
          : "Zkopírováno jako prostý text – tento prohlížeč neumí vložit tabulku do schránky."
      );
      window.setTimeout(() => setNotice(null), 5000);
    } catch (e) {
      setError(errorMessage(e, "Zkopírovat se nepodařilo."));
    }
  }

  function resetOrder() {
    setConfirmState({
      title: "Vymazat objednávku?",
      message: "Celá rozpracovaná objednávka se smaže a stránka se vrátí do výchozího stavu.",
      confirmLabel: "Vymazat",
      danger: true,
      onConfirm: () => {
        setBlocks([]);
        setConfirmState(null);
      },
    });
  }

  if (loading) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.introRow}>
        <p className={styles.intro}>
          Vyberte hotel, přidejte položky s množstvím a hotový e-mail zkopírujte tlačítkem dole.
          Objednávka se nikde neukládá – po opuštění stránky je pryč.
        </p>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setConfigOpen(true)}>
            Číselníky
          </Button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {/* ── Hotel picker ─────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>Objednávka</h2>
          {blocks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={resetOrder}>
              Vymazat vše
            </Button>
          )}
        </div>

        {availableHotels.length > 0 ? (
          <label className={styles.pickerRow}>
            <span className={styles.fieldLabel}>Přidat hotel</span>
            <select
              className={styles.select}
              value=""
              onChange={(e) => addHotel(e.target.value)}
            >
              <option value="">– vyberte hotel –</option>
              {availableHotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.hintInline}>
            {config.hotels.some((h) => h.active)
              ? "Všechny hotely už jsou v objednávce."
              : "V číselníku není žádný aktivní hotel."}
          </p>
        )}
      </div>

      {blocks.map((block) => {
        const hotel = hotelById.get(block.hotelId);
        if (!hotel) return null;
        // Checked here rather than from `resolved`, which only contains blocks
        // that already have rows — the warning has to show on an empty block too.
        const billingReady = hotel.companyId !== null && companyById.has(hotel.companyId);
        return (
          <HotelBlock
            key={block.id}
            block={block}
            hotel={hotel}
            items={config.items}
            incomplete={hotel.deliveryAddress.trim() === "" || !billingReady}
            focusLineId={focusLineId}
            onFocused={() => setFocusLineId(null)}
            onAddLine={(itemId) => addLine(block.id, itemId)}
            onSetQty={(lineId, qty) => setQty(block.id, lineId, qty)}
            onRemoveLine={(lineId) => removeLine(block.id, lineId)}
            onRemoveBlock={() => removeBlock(block)}
          />
        );
      })}

      {/* ── E-mail ───────────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>E-mail</h2>
          {notice && <span className={styles.noticeInline}>{notice}</span>}
        </div>

        {resolved.length === 0 ? (
          <p className={styles.placeholder}>
            Zatím není co odeslat – přidejte hotel a alespoň jednu položku.
          </p>
        ) : (
          <>
            {incompleteHotels.length > 0 && (
              <p className={styles.warning}>
                Než půjde e-mail zkopírovat, doplňte v číselníku doručovací adresu a společnost:{" "}
                {incompleteHotels.join(", ")}.
              </p>
            )}
            {/* The preview IS the clipboard payload — same string, so the two
                can never disagree. Every interpolated value is escaped at the
                point it is built (lib/objednavky.ts). */}
            <div className={styles.preview} dangerouslySetInnerHTML={{ __html: html }} />
            <div className={styles.copyRow}>
              <Button variant="primary" onClick={handleCopy} disabled={!canCopy}>
                Kopírovat e-mail
              </Button>
            </div>
          </>
        )}
      </div>

      {configOpen && canManage && (
        <ConfigPanel
          config={config}
          companies={companies}
          onSaved={setConfig}
          onClose={() => setConfigOpen(false)}
          onError={setError}
        />
      )}

      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One hotel's section of the order                                    */
/* ------------------------------------------------------------------ */

function HotelBlock({
  block,
  hotel,
  items,
  incomplete,
  focusLineId,
  onFocused,
  onAddLine,
  onSetQty,
  onRemoveLine,
  onRemoveBlock,
}: {
  block: OrderBlock;
  hotel: OrderHotel;
  items: OrderItem[];
  /** Missing delivery address or billing company — computed by the parent. */
  incomplete: boolean;
  focusLineId: string | null;
  onFocused: () => void;
  onAddLine: (itemId: string) => void;
  onSetQty: (lineId: string, qty: number) => void;
  onRemoveLine: (lineId: string) => void;
  onRemoveBlock: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** Highlighted result. See `activeIndex` — this is the raw, unclamped value. */
  const [active, setActive] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /**
   * Items already on this block are filtered OUT of the results rather than
   * added twice. Two rows for the same product in one table is not something
   * a supplier should have to reconcile, and "it is already in the list" is
   * more obvious as an absence from the picker than as a silent quantity bump.
   */
  const results = useMemo(() => {
    const used = new Set(block.lines.map((l) => l.itemId));
    return searchItems(items, query)
      .filter((i) => !used.has(i.id))
      .sort((a, b) => byCs(itemLabel(a), itemLabel(b)));
  }, [items, query, block.lines]);

  /**
   * Clamped at render rather than corrected by an effect. The result set shrinks
   * as you type and as items are added, so a stored index goes stale constantly;
   * deriving the valid one removes the window where it points past the end.
   */
  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1);

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function add(itemId: string) {
    onAddLine(itemId);
    setQuery("");
    setActive(0);
    setOpen(false);
    // Focus is NOT returned to the search box here: the parent moves it to the
    // new line's Množství field, and Tab from there comes back for the next item.
  }

  function handleSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // A closed list opens ON the first row instead of skipping past it.
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive(Math.min(activeIndex + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0) {
        e.preventDefault();
        add(results[activeIndex].id);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.blockHead}>
        <h3 className={styles.h3}>{hotel.name}</h3>
        <IconButton
          variant="close"
          aria-label={`Odebrat ${hotel.name} z objednávky`}
          onClick={onRemoveBlock}
        >
          ✕
        </IconButton>
      </div>

      {incomplete && (
        <p className={styles.warning}>
          Tento hotel nemá v číselníku vyplněnou doručovací adresu nebo přiřazenou společnost.
        </p>
      )}

      <div className={styles.searchWrap}>
        <input
          ref={searchRef}
          className={styles.search}
          type="text"
          value={query}
          placeholder="Hledat položku podle názvu nebo kódu…"
          aria-label={`Přidat položku pro ${hotel.name}`}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`vysledky-${block.id}`}
          aria-activedescendant={
            open && activeIndex >= 0 ? `vysledek-${block.id}-${activeIndex}` : undefined
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleSearchKey}
          // Blur fires before a click on a result, so closing is deferred past
          // the mousedown that picks one.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        {open && (
          <ul className={styles.results} id={`vysledky-${block.id}`} ref={listRef} role="listbox">
            {results.length === 0 ? (
              <li className={styles.resultEmpty}>Nic nenalezeno</li>
            ) : (
              results.map((item, i) => (
                <li
                  key={item.id}
                  id={`vysledek-${block.id}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                >
                  <button
                    type="button"
                    // Skipped by Tab on purpose: this list is driven by the
                    // arrow keys, and Tab out of the search box belongs to the
                    // rest of the form.
                    tabIndex={-1}
                    className={`${styles.resultBtn} ${i === activeIndex ? styles.resultActive : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      // mousedown, not click: the input's blur would otherwise
                      // unmount this list before the click landed.
                      e.preventDefault();
                      add(item.id);
                    }}
                  >
                    <span>{itemLabel(item)}</span>
                    <span className={styles.resultUnit}>{item.unit}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {block.lines.length === 0 ? (
        <p className={styles.hintInline}>Zatím žádné položky.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.lineTable}>
            <thead>
              <tr>
                <th>Položka</th>
                <th>Množství</th>
                <th aria-label="Akce" />
              </tr>
            </thead>
            <tbody>
              {block.lines.map((line) => {
                const item = itemById.get(line.itemId);
                if (!item) return null;
                return (
                  <tr key={line.id}>
                    <td>{itemLabel(item)}</td>
                    <td>
                      <div className={styles.qtyCell}>
                        <QtyInput
                          value={line.qty}
                          label={`Množství – ${itemLabel(item)}`}
                          takeFocus={focusLineId === line.id}
                          onFocused={onFocused}
                          onTabToSearch={() => searchRef.current?.focus()}
                          onChange={(qty) => onSetQty(line.id, qty)}
                        />
                        <span className={styles.unit}>{item.unit}</span>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.rowRemove}
                        aria-label={`Odebrat ${itemLabel(item)}`}
                        onClick={() => onRemoveLine(line.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Quantity field.
 *
 * Holds its own STRING state on top of the numeric model, which exists purely
 * so the field can be empty while it is being retyped. Bound straight to the
 * number, clearing it (select-all + backspace) coerces to 1 on the very next
 * keystroke, so typing "12" over a "1" lands you on "112" — the field fights
 * the most ordinary edit there is. The model only ever sees a valid whole
 * number >= 1; blur restores the last good value if the box was left empty.
 *
 * It is also the middle of the keyboard loop: it takes focus when its line was
 * just added, and Tab hands focus back to the search box for the next item.
 */
function QtyInput({
  value,
  label,
  takeFocus,
  onChange,
  onFocused,
  onTabToSearch,
}: {
  value: number;
  label: string;
  /** This line was just added — grab focus and select, then report back. */
  takeFocus: boolean;
  onChange: (qty: number) => void;
  onFocused: () => void;
  onTabToSearch: () => void;
}) {
  const [text, setText] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  // Re-sync when the model changes from elsewhere. Typing does not trigger a
  // fight: the effect only fires when `value` actually differs, and while the
  // box is transiently empty the model is left untouched.
  useEffect(() => {
    setText(String(value));
  }, [value]);

  useEffect(() => {
    if (!takeFocus) return;
    ref.current?.focus();
    // Selected, not just focused: the field already holds "1", and typing a
    // real quantity should replace it rather than append to it.
    ref.current?.select();
    onFocused();
  }, [takeFocus, onFocused]);

  return (
    <input
      ref={ref}
      className={styles.qtyInput}
      type="number"
      min={1}
      step={1}
      value={text}
      aria-label={label}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = Math.trunc(Number(raw));
        if (raw !== "" && Number.isFinite(n) && n > 0) onChange(n);
      }}
      onKeyDown={(e) => {
        // Tab closes the loop back to the search box so a whole order can be
        // typed without the mouse. Shift+Tab is left alone — reversing out of
        // the form has to keep working.
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          onTabToSearch();
        }
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Číselníky panel                                                     */
/* ------------------------------------------------------------------ */

type ConfigTab = "items" | "hotels";

const CONFIG_TABS: { id: ConfigTab; label: string }[] = [
  { id: "items", label: "Položky" },
  { id: "hotels", label: "Hotely" },
];

function ConfigPanel({
  config,
  companies,
  onSaved,
  onClose,
  onError,
}: {
  config: ObjednavkyConfig;
  /** Read-only here — this list is owned by Nastavení → Společnosti. */
  companies: OrderCompany[];
  /** Hands the saved config back to the tab. Does NOT close the panel. */
  onSaved: (next: ObjednavkyConfig) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  // Whole-array edit, then ONE PUT — the same shape as the Faktury číselníky.
  const [items, setItems] = useState<OrderItem[]>(config.items);
  const [hotels, setHotels] = useState<OrderHotel[]>(config.hotels);
  const [tab, setTab] = useState<ConfigTab>("items");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const draft: ObjednavkyConfig = useMemo(() => ({ items, hotels }), [items, hotels]);

  /**
   * Last state known to be on the server. Compared by VALUE rather than tracked
   * with a dirty flag, so undoing an edit by hand genuinely un-dirties the
   * panel — with a flag, retyping a character back to what it was would leave
   * Uložit enabled forever and the leave-warning firing over nothing.
   */
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(config));
  const dirty = useMemo(() => JSON.stringify(draft) !== savedSnapshot, [draft, savedSnapshot]);

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      await api.put("/objednavky/config", draft);
      // The panel STAYS OPEN: editing a číselník is a session of many small
      // changes, and closing on every save makes saving feel like a punishment.
      setSavedSnapshot(JSON.stringify(draft));
      onSaved(draft);
      setSavedMsg("Uloženo");
      window.setTimeout(() => setSavedMsg(null), 3000);
      return true;
    } catch (e) {
      onError(errorMessage(e, "Číselníky se nepodařilo uložit."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmState({
      title: "Zavřít bez uložení?",
      message: "V číselnících jsou neuložené změny. Zavřením se ztratí.",
      confirmLabel: "Zavřít bez uložení",
      danger: true,
      onConfirm: () => {
        setConfirmState(null);
        onClose();
      },
    });
  }

  function removeItem(item: OrderItem) {
    setConfirmState({
      title: "Odebrat položku?",
      message: `Položka „${itemLabel(item)}" se z číselníku odebere. Rozpracované objednávky, které ji obsahují, o ni přijdou.`,
      confirmLabel: "Odebrat",
      danger: true,
      onConfirm: () => {
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        setConfirmState(null);
      },
    });
  }

  /** Alphabetical, matching the app-wide dropdown convention. */
  const companySorted = useMemo(
    () => [...companies].sort((a, b) => byCs(a.name, b.name)),
    [companies]
  );

  function removeHotel(hotel: OrderHotel) {
    setConfirmState({
      title: "Odebrat hotel?",
      message: `Hotel „${hotel.name}" se z číselníku odebere i s adresou a přiřazenou společností.`,
      confirmLabel: "Odebrat",
      danger: true,
      onConfirm: () => {
        setHotels((prev) => prev.filter((x) => x.id !== hotel.id));
        setConfirmState(null);
      },
    });
  }

  /* The overlay deliberately has NO onClick – this panel holds half-edited
     číselníky and must close only through its own buttons. */
  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Číselníky objednávek</h2>
          <IconButton variant="close" aria-label="Zavřít číselníky" onClick={requestClose}>
            ✕
          </IconButton>
        </div>

        <div className={styles.tabs} role="tablist">
          {CONFIG_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.panelBody}>
          {tab === "items" && (
            <section className={styles.card}>
              <p className={styles.hint}>
                Z tohoto seznamu vybírá vyhledávání při sestavování objednávky. Kód se do e-mailu
                vypíše za název v závorce; položka bez kódu se vypíše jen názvem. Jednotka se
                vypisuje za množství.
              </p>
              <div className={styles.tableScroll}>
                <table className={`${styles.configTable} ${styles.itemTable}`}>
                  <thead>
                    <tr>
                      <th>Název</th>
                      <th>Kód</th>
                      <th>Jednotka</th>
                      <th>Aktivní</th>
                      <th aria-label="Akce" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td>
                          <input
                            className={styles.cellInput}
                            value={it.name}
                            aria-label="Název položky"
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id ? { ...x, name: e.target.value } : x
                                )
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className={styles.cellInput}
                            value={it.code}
                            aria-label="Kód položky"
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id ? { ...x, code: e.target.value } : x
                                )
                              )
                            }
                          />
                        </td>
                        <td>
                          <select
                            className={styles.cellInput}
                            value={it.unit}
                            aria-label="Jednotka"
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? { ...x, unit: e.target.value as OrderUnit }
                                    : x
                                )
                              )
                            }
                          >
                            {ORDER_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={it.active}
                            aria-label="Aktivní"
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id ? { ...x, active: e.target.checked } : x
                                )
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.rowRemove}
                            aria-label="Odebrat položku"
                            onClick={() => removeItem(it)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    { id: newRowId(), name: "", code: "", unit: "ks", active: true },
                  ])
                }
              >
                + Přidat položku
              </Button>
            </section>
          )}

          {tab === "hotels" && (
            <section className={styles.card}>
              <p className={styles.hint}>
                Doručovací adresa se vkládá doprostřed věty („…s doručením na adresu X…"), proto ji
                zadávejte jednořádkově. Fakturační údaje se neopisují – vyberete společnost ze
                seznamu v Nastavení → Společnosti a do e-mailu se doplní její název, adresa, IČO a
                DIČ (zkratka nikdy). Bez adresy i společnosti nejde e-mail pro daný hotel
                zkopírovat.
              </p>
              <div className={styles.hotelList}>
                {hotels.map((h) => (
                  <div key={h.id} className={styles.hotelCard}>
                    <div className={styles.hotelHead}>
                      <input
                        className={styles.hotelName}
                        value={h.name}
                        placeholder="Název hotelu"
                        aria-label="Název hotelu"
                        onChange={(e) =>
                          setHotels((prev) =>
                            prev.map((x) => (x.id === h.id ? { ...x, name: e.target.value } : x))
                          )
                        }
                      />
                      <label className={styles.activeLabel}>
                        <input
                          type="checkbox"
                          checked={h.active}
                          onChange={(e) =>
                            setHotels((prev) =>
                              prev.map((x) =>
                                x.id === h.id ? { ...x, active: e.target.checked } : x
                              )
                            )
                          }
                        />
                        Aktivní
                      </label>
                      <button
                        type="button"
                        className={styles.rowRemove}
                        aria-label="Odebrat hotel"
                        onClick={() => removeHotel(h)}
                      >
                        ✕
                      </button>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Doručovací adresa</span>
                      <input
                        className={styles.cellInput}
                        value={h.deliveryAddress}
                        onChange={(e) =>
                          setHotels((prev) =>
                            prev.map((x) =>
                              x.id === h.id ? { ...x, deliveryAddress: e.target.value } : x
                            )
                          )
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Fakturační údaje (společnost)</span>
                      <select
                        className={styles.cellInput}
                        value={h.companyId ?? ""}
                        onChange={(e) =>
                          setHotels((prev) =>
                            prev.map((x) =>
                              x.id === h.id ? { ...x, companyId: e.target.value || null } : x
                            )
                          )
                        }
                      >
                        <option value="">– vyberte společnost –</option>
                        {companySorted.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {/* Shows the exact string the e-mail will carry, so a
                          missing IČO in Nastavení is visible HERE rather than
                          in a sent message. */}
                      <span className={styles.fieldPreview}>
                        {(() => {
                          const c = companies.find((x) => x.id === h.companyId);
                          if (!c) return "Bez společnosti nelze e-mail pro tento hotel zkopírovat.";
                          return companyInvoiceDetails(c);
                        })()}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setHotels((prev) => [
                    ...prev,
                    {
                      id: newRowId(),
                      name: "",
                      deliveryAddress: "",
                      companyId: null,
                      active: true,
                    },
                  ])
                }
              >
                + Přidat hotel
              </Button>
            </section>
          )}
        </div>

        <div className={styles.panelFooter}>
          {savedMsg && <span className={styles.saveMsg}>{savedMsg}</span>}
          <Button variant="secondary" onClick={requestClose} disabled={saving}>
            Zavřít
          </Button>
          {/* Disabled while there is nothing to save: with the panel staying
              open, an enabled button is the only remaining signal that
              something is still unsaved. */}
          <Button variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Ukládám…" : "Uložit číselníky"}
          </Button>
        </div>
      </div>

      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
