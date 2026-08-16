import { useEffect, useMemo, useState } from "react";
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
  copyOrderEmail,
  itemLabel,
  newRowId,
  resolveBlocks,
  searchItems,
  type ObjednavkyConfig,
  type OrderBlock,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  /** The order being assembled. Never persisted, never restored. */
  const [blocks, setBlocks] = useState<OrderBlock[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ObjednavkyConfig>("/objednavky/config")
      .then((c) => {
        if (!cancelled) setConfig(c);
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

  /** Active hotels not already in the order, alphabetically. */
  const availableHotels = useMemo(() => {
    const used = new Set(blocks.map((b) => b.hotelId));
    return config.hotels
      .filter((h) => h.active && !used.has(h.id))
      .sort((a, b) => byCs(a.name, b.name));
  }, [config.hotels, blocks]);

  const resolved = useMemo(() => resolveBlocks(blocks, config), [blocks, config]);
  const html = useMemo(() => buildOrderHtml(resolved), [resolved]);
  const text = useMemo(() => buildOrderText(resolved), [resolved]);

  /**
   * Hotels in the order that have no delivery address or no billing details.
   *
   * This blocks the copy rather than warning beside it: the sentence is built
   * by substitution, so a blank field does not produce a visible gap the user
   * would catch — it produces "s doručením na adresu  a fakturačními údaji .",
   * which reads as a finished sentence and would be sent as one.
   */
  const incompleteHotels = useMemo(
    () =>
      resolved
        .map((r) => r.hotel)
        .filter((h) => h.deliveryAddress.trim() === "" || h.invoiceDetails.trim() === ""),
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
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, lines: [...b.lines, { id: newRowId(), itemId, qty: 1 }] }
          : b
      )
    );
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
        return (
          <HotelBlock
            key={block.id}
            block={block}
            hotel={hotel}
            items={config.items}
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
                Než půjde e-mail zkopírovat, doplňte v číselníku doručovací adresu a fakturační
                údaje: {incompleteHotels.map((h) => h.name).join(", ")}.
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
  onAddLine,
  onSetQty,
  onRemoveLine,
  onRemoveBlock,
}: {
  block: OrderBlock;
  hotel: OrderHotel;
  items: OrderItem[];
  onAddLine: (itemId: string) => void;
  onSetQty: (lineId: string, qty: number) => void;
  onRemoveLine: (lineId: string) => void;
  onRemoveBlock: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

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

  function add(itemId: string) {
    onAddLine(itemId);
    setQuery("");
    setOpen(false);
  }

  const incomplete = hotel.deliveryAddress.trim() === "" || hotel.invoiceDetails.trim() === "";

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
          Tento hotel nemá v číselníku vyplněnou doručovací adresu nebo fakturační údaje.
        </p>
      )}

      <div className={styles.searchWrap}>
        <input
          className={styles.search}
          type="text"
          value={query}
          placeholder="Hledat položku podle názvu nebo kódu…"
          aria-label={`Přidat položku pro ${hotel.name}`}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Blur fires before a click on a result, so closing is deferred past
          // the mousedown that picks one.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        {open && (
          <ul className={styles.results}>
            {results.length === 0 ? (
              <li className={styles.resultEmpty}>Nic nenalezeno</li>
            ) : (
              results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.resultBtn}
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
 */
function QtyInput({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (qty: number) => void;
}) {
  const [text, setText] = useState(String(value));

  // Re-sync when the model changes from elsewhere. Typing does not trigger a
  // fight: the effect only fires when `value` actually differs, and while the
  // box is transiently empty the model is left untouched.
  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <input
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
  onSaved,
  onClose,
  onError,
}: {
  config: ObjednavkyConfig;
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

  function removeHotel(hotel: OrderHotel) {
    setConfirmState({
      title: "Odebrat hotel?",
      message: `Hotel „${hotel.name}" se z číselníku odebere i s adresou a fakturačními údaji.`,
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
                Adresa i fakturační údaje se vkládají doprostřed věty („…s doručením na adresu X a
                fakturačními údaji Y."), proto je zadávejte jednořádkově. Bez obou údajů nejde
                e-mail pro daný hotel zkopírovat.
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
                      <span className={styles.fieldLabel}>Fakturační údaje</span>
                      <input
                        className={styles.cellInput}
                        value={h.invoiceDetails}
                        onChange={(e) =>
                          setHotels((prev) =>
                            prev.map((x) =>
                              x.id === h.id ? { ...x, invoiceDetails: e.target.value } : x
                            )
                          )
                        }
                      />
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
                      invoiceDetails: "",
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
