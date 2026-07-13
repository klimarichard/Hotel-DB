import { useCallback, useEffect, useState } from "react";
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

interface GuideCategory {
  id: string;
  name: string;
  order: number;
}

interface Guide {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  kind: "pdf" | "link";
  url: string;
  fileName: string;
  order: number;
}

interface GuidesResponse {
  categories: GuideCategory[];
  guides: Guide[];
}

/** Draft state of the add/edit guide form. */
interface GuideDraft {
  id: string | null;
  title: string;
  description: string;
  categoryId: string;
  kind: "pdf" | "link";
  url: string;
  file: File | null;
}

function emptyDraft(categoryId: string, kind: "pdf" | "link"): GuideDraft {
  return { id: null, title: "", description: "", categoryId, kind, url: "", file: null };
}

/**
 * Návody — reference material for staff: PDF tutorials (opened in an in-page
 * viewer) and links to external resources, grouped into categories.
 *
 * Viewing needs `nav.guides.view` (everyone); every mutation needs
 * `guides.manage`. The backend enforces both independently.
 */
export default function GuidesPage() {
  const { can, loading: authLoading } = useAuth();
  const canManage = can("guides.manage");

  const [categories, setCategories] = useState<GuideCategory[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState<Guide | null>(null);
  const [draft, setDraft] = useState<GuideDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<{ id: string | null; name: string } | null>(null);
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
      setCategories(data.categories);
      setGuides(data.guides);
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

  // ─── Guides ────────────────────────────────────────────────────────────────

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

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        categoryId: draft.categoryId,
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

  /** Move a guide up/down within its category and persist the new order. */
  async function moveGuide(guide: Guide, delta: -1 | 1) {
    const siblings = guides
      .filter((g) => g.categoryId === guide.categoryId)
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((g) => g.id === guide.id);
    const target = idx + delta;
    if (target < 0 || target >= siblings.length) return;

    const reordered = [...siblings];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];

    // Optimistic: renumber locally so the row moves immediately.
    const orderById = new Map(reordered.map((g, i) => [g.id, i]));
    setGuides((prev) =>
      prev.map((g) => (orderById.has(g.id) ? { ...g, order: orderById.get(g.id)! } : g))
    );

    try {
      await api.put("/guides/order", { orderedIds: reordered.map((g) => g.id) });
    } catch (e) {
      showError(errorMessage(e, "Pořadí se nepodařilo uložit."));
      await load();
    }
  }

  // ─── Categories ────────────────────────────────────────────────────────────

  async function handleSaveCategory() {
    if (!categoryDraft) return;
    const name = categoryDraft.name.trim();
    if (!name) {
      showError("Zadejte název kategorie.");
      return;
    }

    setSaving(true);
    try {
      if (categoryDraft.id) {
        await api.put(`/guides/categories/${categoryDraft.id}`, { name });
      } else {
        await api.post("/guides/categories", { name });
      }
      setCategoryDraft(null);
      await load();
    } catch (e) {
      showError(errorMessage(e, "Kategorii se nepodařilo uložit."));
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteCategory(category: GuideCategory) {
    setConfirm({
      title: "Smazat kategorii",
      message: `Opravdu smazat kategorii „${category.name}“?`,
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/guides/categories/${category.id}`);
          await load();
        } catch (e) {
          // 409 = still holds guides; the backend message says what to do.
          showError(errorMessage(e, "Kategorii se nepodařilo smazat."));
        }
      },
    });
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

  return (
    <div className={styles.page} data-tour="guides-page">
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Návody</h1>
        {canManage && (
          <div className={styles.headerActions} data-tour="guides-manage">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCategoryDraft({ id: null, name: "" })}
            >
              Nová kategorie
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={categories.length === 0}
              onClick={() => setDraft(emptyDraft(categories[0]?.id ?? "", "pdf"))}
            >
              Nový návod
            </Button>
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.empty}>Načítám…</p>}

      {!loading && categories.length === 0 && (
        <p className={styles.empty}>
          {canManage
            ? "Zatím tu nejsou žádné kategorie. Začněte tlačítkem „Nová kategorie“."
            : "Zatím tu nejsou žádné návody."}
        </p>
      )}

      {!loading &&
        categories.map((category) => {
          const items = guides
            .filter((g) => g.categoryId === category.id)
            .sort((a, b) => a.order - b.order);

          return (
            <section key={category.id} className={styles.category}>
              <div className={styles.categoryHead}>
                <h2 className={styles.categoryTitle}>{category.name}</h2>
                {canManage && (
                  <div className={styles.categoryActions}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCategoryDraft({ id: category.id, name: category.name })}
                    >
                      Přejmenovat
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCategory(category)}
                    >
                      Smazat
                    </Button>
                  </div>
                )}
              </div>

              {items.length === 0 && <p className={styles.empty}>Žádné návody.</p>}

              <ul className={styles.list}>
                {items.map((guide, idx) => (
                  <li key={guide.id} className={styles.item}>
                    <button
                      type="button"
                      className={styles.itemMain}
                      onClick={() => openGuide(guide)}
                    >
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

                    {canManage && (
                      <div className={styles.itemActions}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={idx === 0}
                          onClick={() => moveGuide(guide, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={idx === items.length - 1}
                          onClick={() => moveGuide(guide, 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDraft({
                              id: guide.id,
                              title: guide.title,
                              description: guide.description,
                              categoryId: guide.categoryId,
                              kind: guide.kind,
                              url: guide.url,
                              file: null,
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
            </section>
          );
        })}

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

              <label className={styles.field}>
                <span className={styles.label}>Kategorie</span>
                <select
                  className={styles.input}
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

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
                    onChange={(e) =>
                      setDraft({ ...draft, file: e.target.files?.[0] ?? null })
                    }
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

      {categoryDraft && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {categoryDraft.id ? "Přejmenovat kategorii" : "Nová kategorie"}
              </h2>
              <IconButton
                variant="close"
                aria-label="Zavřít"
                onClick={() => setCategoryDraft(null)}
              />
            </div>

            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span className={styles.label}>Název kategorie</span>
                <input
                  className={styles.input}
                  value={categoryDraft.name}
                  onChange={(e) =>
                    setCategoryDraft({ ...categoryDraft, name: e.target.value })
                  }
                />
              </label>
            </div>

            <div className={styles.modalFooter}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCategoryDraft(null)}
                disabled={saving}
              >
                Zrušit
              </Button>
              <Button type="button" onClick={handleSaveCategory} disabled={saving}>
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
