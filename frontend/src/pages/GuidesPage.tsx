import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { blobToBase64 } from "@/lib/blobToBase64";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import GuideViewerModal from "@/components/GuideViewerModal";
import styles from "./GuidesPage.module.css";

/** Mirrors the 7 MB server-side ceiling in functions/src/routes/guides.ts. */
const MAX_PDF_BYTES = 7 * 1024 * 1024;

interface Guide {
  id: string;
  title: string;
  description: string;
  tags: string[];
  kind: "pdf" | "link";
  url: string;
  fileName: string;
  order: number;
}

interface GuidesResponse {
  guides: Guide[];
  /** Tag vocabulary derived server-side from the guides themselves. */
  tags: string[];
}

interface GuideDraft {
  id: string | null;
  title: string;
  description: string;
  tags: string[];
  kind: "pdf" | "link";
  url: string;
  file: File | null;
  /** Text currently being typed into the tag box (not yet committed as a tag). */
  tagInput: string;
}

function emptyDraft(kind: "pdf" | "link"): GuideDraft {
  return { id: null, title: "", description: "", tags: [], kind, url: "", file: null, tagInput: "" };
}

/**
 * Fold a string for searching: lowercase + strip diacritics, so "uzaverka"
 * matches "Uzávěrka". Czech staff routinely type without diacritics, and an
 * accent-sensitive search would silently return nothing.
 */
function fold(s: string): string {
  return s
    .toLocaleLowerCase("cs")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Návody — reference material for staff: PDF tutorials (opened in an in-page
 * viewer) and links to external resources.
 *
 * Guides are classified by free-form tags rather than one category, because a
 * guide routinely belongs to several topics at once. The search box does a
 * full-text, diacritics-insensitive match over name, description and tags;
 * clicking a tag filters by it (several tags = AND, i.e. narrowing).
 *
 * Viewing needs `nav.guides.view` (everyone); every mutation needs
 * `guides.manage`. The backend enforces both independently.
 */
export default function GuidesPage() {
  const { can, loading: authLoading } = useAuth();
  const canManage = can("guides.manage");

  const [guides, setGuides] = useState<Guide[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const [viewing, setViewing] = useState<Guide | null>(null);
  const [draft, setDraft] = useState<GuideDraft | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    showCancel?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<GuidesResponse>("/guides");
      setGuides(data.guides);
      setAllTags(data.tags);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Návody se nepodařilo načíst."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  /** Info-only dialog — the app never uses window.alert. */
  function showError(message: string) {
    setConfirm({
      title: "Chyba",
      message,
      showCancel: false,
      onConfirm: () => setConfirm(null),
    });
  }

  // Full-text over name + description + tags, plus the tag-chip filter (AND).
  const visible = useMemo(() => {
    const needles = fold(query).split(/\s+/).filter(Boolean);
    return guides.filter((g) => {
      if (activeTags.length > 0) {
        const own = new Set(g.tags.map(fold));
        if (!activeTags.every((t) => own.has(fold(t)))) return false;
      }
      if (needles.length === 0) return true;
      const haystack = fold([g.title, g.description, ...g.tags].join(" "));
      // Every word must appear somewhere — typing more words narrows.
      return needles.every((n) => haystack.includes(n));
    });
  }, [guides, query, activeTags]);

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.some((t) => fold(t) === fold(tag))
        ? prev.filter((t) => fold(t) !== fold(tag))
        : [...prev, tag]
    );
  }

  // ─── Draft tag editing ─────────────────────────────────────────────────────

  function addDraftTag(raw: string) {
    if (!draft) return;
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) return;
    if (draft.tags.some((t) => fold(t) === fold(tag))) {
      setDraft({ ...draft, tagInput: "" });
      return;
    }
    setDraft({ ...draft, tags: [...draft.tags, tag], tagInput: "" });
  }

  function removeDraftTag(tag: string) {
    if (!draft) return;
    setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) });
  }

  /** Existing tags matching what's typed, minus the ones already on the draft. */
  const tagSuggestions = useMemo(() => {
    if (!draft) return [];
    const typed = fold(draft.tagInput);
    return allTags
      .filter((t) => !draft.tags.some((d) => fold(d) === fold(t)))
      .filter((t) => (typed ? fold(t).includes(typed) : true))
      .slice(0, 8);
  }, [draft, allTags]);

  // ─── Save / delete ─────────────────────────────────────────────────────────

  async function handleSaveGuide() {
    if (!draft) return;
    if (!draft.title.trim()) {
      showError("Zadejte název návodu.");
      return;
    }
    if (draft.kind === "link" && !draft.url.trim()) {
      showError("Zadejte odkaz.");
      return;
    }
    if (draft.kind === "pdf" && !draft.id && !draft.file) {
      showError("Vyberte PDF soubor.");
      return;
    }
    if (draft.file && draft.file.size > MAX_PDF_BYTES) {
      showError("Soubor je příliš velký (max 7 MB).");
      return;
    }

    // A tag typed but not committed (no Enter pressed) would otherwise be lost.
    const tags = draft.tagInput.trim()
      ? [...draft.tags, draft.tagInput.trim()]
      : draft.tags;

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        tags,
      };
      if (draft.kind === "link") {
        body.url = draft.url.trim();
      } else if (draft.file) {
        body.pdfBase64 = await blobToBase64(draft.file);
        body.fileName = draft.file.name;
      }

      if (draft.id) {
        await api.put(`/guides/${draft.id}`, body);
      } else {
        await api.post("/guides", { ...body, kind: draft.kind });
      }
      setDraft(null);
      await load();
    } catch (e) {
      showError(errorMessage(e, "Návod se nepodařilo uložit."));
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteGuide(guide: Guide) {
    setConfirm({
      title: "Smazat návod",
      message: `Opravdu smazat návod „${guide.title}“? Tuto akci nelze vrátit zpět.`,
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/guides/${guide.id}`);
          await load();
        } catch (e) {
          showError(errorMessage(e, "Návod se nepodařilo smazat."));
        }
      },
    });
  }

  /**
   * Reordering applies to the full list, so it is only offered when the list is
   * unfiltered — moving a row "up" past hidden rows would be meaningless.
   */
  async function moveGuide(guide: Guide, delta: -1 | 1) {
    const ordered = [...guides].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((g) => g.id === guide.id);
    const target = idx + delta;
    if (target < 0 || target >= ordered.length) return;

    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    setGuides(ordered.map((g, i) => ({ ...g, order: i })));

    try {
      await api.put("/guides/order", { orderedIds: ordered.map((g) => g.id) });
    } catch (e) {
      showError(errorMessage(e, "Pořadí se nepodařilo uložit."));
      await load();
    }
  }

  function openGuide(guide: Guide) {
    if (guide.kind === "link") {
      window.open(guide.url, "_blank", "noopener,noreferrer");
    } else {
      setViewing(guide);
    }
  }

  // useAuth refetches per component — redirecting before it resolves would
  // bounce a permitted user off their own page.
  if (authLoading) return null;
  if (!can("nav.guides.view")) return <Navigate to="/" replace />;

  const isFiltered = query.trim() !== "" || activeTags.length > 0;

  return (
    <div className={styles.page} data-tour="guides-page">
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Návody</h1>
        {canManage && (
          <div className={styles.headerActions} data-tour="guides-manage">
            <Button type="button" size="sm" onClick={() => setDraft(emptyDraft("pdf"))}>
              Nový návod
            </Button>
          </div>
        )}
      </div>

      <div className={styles.searchRow} data-tour="guides-search">
        <input
          className={styles.search}
          type="search"
          placeholder="Hledat v názvech, popisech a štítcích…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {isFiltered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setActiveTags([]);
            }}
          >
            Zrušit filtr
          </Button>
        )}
      </div>

      {allTags.length > 0 && (
        <div className={styles.tagFilter}>
          {allTags.map((tag) => {
            const active = activeTags.some((t) => fold(t) === fold(tag));
            return (
              <button
                key={tag}
                type="button"
                className={active ? `${styles.tagChip} ${styles.tagChipActive}` : styles.tagChip}
                aria-pressed={active}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.empty}>Načítám…</p>}

      {!loading && guides.length === 0 && (
        <p className={styles.empty}>
          {canManage
            ? "Zatím tu nejsou žádné návody. Přidejte první tlačítkem „Nový návod“."
            : "Zatím tu nejsou žádné návody."}
        </p>
      )}

      {!loading && guides.length > 0 && visible.length === 0 && (
        <p className={styles.empty}>Žádný návod neodpovídá hledání.</p>
      )}

      <ul className={styles.list}>
        {visible.map((guide) => (
          <li key={guide.id} className={styles.item}>
            <button type="button" className={styles.itemMain} onClick={() => openGuide(guide)}>
              <span className={styles.icon} aria-hidden="true">
                {guide.kind === "pdf" ? "📄" : "🔗"}
              </span>
              <span className={styles.itemText}>
                <span className={styles.itemTitle}>{guide.title}</span>
                {guide.description && (
                  <span className={styles.itemDesc}>{guide.description}</span>
                )}
              </span>
            </button>

            {guide.tags.length > 0 && (
              <div className={styles.itemTags}>
                {guide.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={styles.itemTag}
                    title={`Filtrovat podle „${tag}“`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {canManage && (
              <div className={styles.itemActions}>
                {!isFiltered && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={guide.order === 0}
                      onClick={() => moveGuide(guide, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={guide.order === guides.length - 1}
                      onClick={() => moveGuide(guide, 1)}
                    >
                      ↓
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      id: guide.id,
                      title: guide.title,
                      description: guide.description,
                      tags: [...guide.tags],
                      kind: guide.kind,
                      url: guide.url,
                      file: null,
                      tagInput: "",
                    })
                  }
                >
                  Upravit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteGuide(guide)}
                >
                  Smazat
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {viewing && (
        <GuideViewerModal
          guideId={viewing.id}
          title={viewing.title}
          onClose={() => setViewing(null)}
        />
      )}

      {draft && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {draft.id ? "Upravit návod" : "Nový návod"}
              </h2>
              <IconButton variant="close" aria-label="Zavřít" onClick={() => setDraft(null)} />
            </div>

            <div className={styles.modalBody}>
              {!draft.id && (
                <div className={styles.field}>
                  <span className={styles.label}>Typ</span>
                  <div className={styles.kindRow}>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        checked={draft.kind === "pdf"}
                        onChange={() => setDraft({ ...draft, kind: "pdf" })}
                      />
                      PDF soubor
                    </label>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        checked={draft.kind === "link"}
                        onChange={() => setDraft({ ...draft, kind: "link" })}
                      />
                      Odkaz
                    </label>
                  </div>
                </div>
              )}

              <label className={styles.field}>
                <span className={styles.label}>Název</span>
                <input
                  className={styles.input}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Popis (nepovinné)</span>
                <input
                  className={styles.input}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>

              <div className={styles.field}>
                <span className={styles.label}>Štítky</span>
                {draft.tags.length > 0 && (
                  <div className={styles.draftTags}>
                    {draft.tags.map((tag) => (
                      <span key={tag} className={styles.draftTag}>
                        {tag}
                        <button
                          type="button"
                          className={styles.draftTagRemove}
                          aria-label={`Odebrat štítek ${tag}`}
                          onClick={() => removeDraftTag(tag)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className={styles.input}
                  placeholder="Napište štítek a stiskněte Enter"
                  value={draft.tagInput}
                  onChange={(e) => setDraft({ ...draft, tagInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      // Enter must not submit anything else in the modal.
                      e.preventDefault();
                      addDraftTag(draft.tagInput);
                    } else if (
                      e.key === "Backspace" &&
                      !draft.tagInput &&
                      draft.tags.length > 0
                    ) {
                      removeDraftTag(draft.tags[draft.tags.length - 1]);
                    }
                  }}
                />
                {tagSuggestions.length > 0 && (
                  <div className={styles.suggestions}>
                    {tagSuggestions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={styles.suggestion}
                        onClick={() => addDraftTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {draft.kind === "link" ? (
                <label className={styles.field}>
                  <span className={styles.label}>Odkaz</span>
                  <input
                    className={styles.input}
                    placeholder="https://drive.google.com/…"
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  />
                </label>
              ) : (
                <label className={styles.field}>
                  <span className={styles.label}>
                    {draft.id ? "Nahradit PDF (nepovinné)" : "PDF soubor (max 7 MB)"}
                  </span>
                  <input
                    className={styles.input}
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })}
                  />
                </label>
              )}
            </div>

            <div className={styles.modalFooter}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDraft(null)}
                disabled={saving}
              >
                Zrušit
              </Button>
              <Button type="button" onClick={handleSaveGuide} disabled={saving}>
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          showCancel={confirm.showCancel}
          confirmLabel={confirm.showCancel === false ? "OK" : undefined}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
