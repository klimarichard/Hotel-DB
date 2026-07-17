import { useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { roleTypesApi, type RoleType } from "@/lib/api";
import PermissionMatrix from "@/components/permissions/PermissionMatrix";
import { resolveToggle, normalize } from "@/lib/permissions/hierarchy";
import styles from "./UserTypesTab.module.css";

interface Draft {
  name: string;
  management: boolean;
  sharedTerminal: boolean;
  noSelfLogout: boolean;
  perms: Set<string>;
}

const setsEqual = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

export default function UserTypesTab() {
  const [types, setTypes] = useState<RoleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string>(""); // "" = blank

  // Modal payload (confirm / error)
  const [modal, setModal] = useState<
    | { title: string; message: string; danger?: boolean; showCancel?: boolean; confirmLabel?: string; onConfirm: () => void }
    | null
  >(null);

  const selected = useMemo(() => types.find((t) => t.id === selectedId) ?? null, [types, selectedId]);
  const isSystem = selected?.system === true;

  async function reload(selectId?: string) {
    setLoading(true);
    try {
      const list = await roleTypesApi.list();
      setTypes(list);
      const pick = selectId ?? selectedId ?? list[0]?.id ?? null;
      setSelectedId(pick);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the draft whenever the selected type changes.
  useEffect(() => {
    if (!selected) {
      setDraft(null);
      setOriginal(null);
      return;
    }
    const d: Draft = {
      name: selected.name,
      management: selected.management,
      sharedTerminal: selected.sharedTerminal === true,
      noSelfLogout: selected.noSelfLogout === true,
      perms: new Set(selected.permissions),
    };
    setDraft({ ...d, perms: new Set(d.perms) });
    setOriginal({ ...d, perms: new Set(d.perms) });
  }, [selected]);

  const isDirty = useMemo(() => {
    if (!draft || !original) return false;
    return (
      draft.name !== original.name ||
      draft.management !== original.management ||
      draft.sharedTerminal !== original.sharedTerminal ||
      draft.noSelfLogout !== original.noSelfLogout ||
      !setsEqual(draft.perms, original.perms)
    );
  }, [draft, original]);

  function togglePerm(key: string) {
    if (!draft || isSystem) return;
    // resolveToggle applies the dependency cascade + mutual exclusion.
    setDraft((prev) => (prev ? { ...prev, perms: resolveToggle(prev.perms, key) } : prev));
  }

  async function save() {
    if (!selected || !draft) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await roleTypesApi.update(selected.id, {
        name: draft.name.trim() || selected.name,
        // normalize cleans any legacy hierarchy violations (orphan child / double
        // mutual-exclusion) on save; conforming sets pass through unchanged.
        permissions: [...normalize(draft.perms)],
        management: draft.management,
        sharedTerminal: draft.sharedTerminal,
        noSelfLogout: draft.noSelfLogout,
      });
      setSaveMsg("Uloženo");
      await reload(selected.id);
    } catch (e) {
      setSaveMsg(`Chyba: ${(e as Error).message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }

  async function doCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await roleTypesApi.create(
        cloneFrom
          ? { name, cloneFrom }
          : { name, permissions: [], management: false, sharedTerminal: false, noSelfLogout: false }
      );
      setCreating(false);
      setNewName("");
      setCloneFrom("");
      await reload(res.id);
    } catch (e) {
      setModal({ title: "Chyba", message: (e as Error).message, showCancel: false, confirmLabel: "OK", onConfirm: () => setModal(null) });
    }
  }

  function submitCreate() {
    if (!newName.trim()) return;
    if (!cloneFrom) {
      // "strip all" / blank type – warn first.
      setModal({
        title: "Prázdný typ",
        message: `Vytvořit typ „${newName.trim()}" zcela bez oprávnění? Uživatelům s tímto typem se vše skryje, dokud práva nepřidáte.`,
        confirmLabel: "Vytvořit",
        onConfirm: () => { setModal(null); doCreate(); },
      });
    } else {
      doCreate();
    }
  }

  function confirmDelete() {
    if (!selected || selected.system) return;
    setModal({
      title: "Smazat typ",
      message: `Opravdu smazat uživatelský typ „${selected.name}"? Tuto akci nelze vrátit.`,
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: async () => {
        setModal(null);
        try {
          await roleTypesApi.remove(selected.id);
          await reload(undefined);
          setSelectedId(null);
        } catch (e) {
          // request() sets the error message to the backend's `error` field
          // (e.g. the 409 "type still assigned to N users" message).
          setModal({ title: "Nelze smazat", message: (e as Error).message, showCancel: false, confirmLabel: "OK", onConfirm: () => setModal(null) });
        }
      },
    });
  }

  if (loading) return <div className={styles.loading}>Načítám…</div>;

  return (
    <div className={styles.wrap}>
      {/* ── Left: type list ── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <h3 className={styles.sidebarTitle}>Typy</h3>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>+ Nový</Button>
        </div>
        <ul className={styles.typeList}>
          {types.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={t.id === selectedId ? styles.typeActive : styles.typeBtn}
                onClick={() => setSelectedId(t.id)}
              >
                <span className={styles.typeName}>{t.name}</span>
                <span className={styles.typeMeta}>
                  {t.system && <span className={styles.sysBadge}>systém</span>}
                  {t.management && <span className={styles.mgmtBadge}>vedení</span>}
                  <span className={styles.permCount}>{t.permissions.includes("system.admin") ? "vše" : t.permissions.length}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ── Right: editor ── */}
      <section className={styles.editor}>
        {!selected || !draft ? (
          <div className={styles.empty}>Vyberte typ vlevo, nebo vytvořte nový.</div>
        ) : (
          <>
            <div className={styles.editorHead}>
              <input
                className={styles.nameInput}
                value={draft.name}
                disabled={isSystem}
                onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
              />
              {!isSystem && (
                <Button variant="danger" size="sm" onClick={confirmDelete}>Smazat typ</Button>
              )}
            </div>

            {isSystem && (
              <p className={styles.sysNote}>
                Systémový typ „Administrátor" má vždy všechna oprávnění a nelze jej upravit ani smazat.
              </p>
            )}

            <label className={styles.mgmtRow}>
              <input
                type="checkbox"
                checked={draft.management}
                disabled={isSystem}
                onChange={(e) => setDraft((p) => (p ? { ...p, management: e.target.checked } : p))}
              />
              <span>Vedení – záznamy zaměstnanců s tímto typem se skryjí personalistovi (a podobným).</span>
            </label>

            <label className={styles.mgmtRow}>
              <input
                type="checkbox"
                checked={draft.sharedTerminal}
                disabled={isSystem}
                onChange={(e) => setDraft((p) => (p ? { ...p, sharedTerminal: e.target.checked } : p))}
              />
              <span>
                Sdílený terminál – zápisy v Recepci se přiřadí tomu, kdo podepsal „Převzal“ na protokolu předchozí
                směny, ne tomuto společnému účtu.
              </span>
            </label>

            <label className={styles.mgmtRow}>
              <input
                type="checkbox"
                checked={draft.noSelfLogout}
                disabled={isSystem}
                onChange={(e) => setDraft((p) => (p ? { ...p, noSelfLogout: e.target.checked } : p))}
              />
              <span>Nemůže se odhlásit sám – odhlášení musí potvrdit nadřízený heslem.</span>
            </label>

            <PermissionMatrix
              isChecked={(k) => draft.perms.has(k)}
              onToggle={togglePerm}
              readOnly={isSystem}
              forceAllOn={isSystem}
            />

            {!isSystem && (
              <div className={styles.footer}>
                {saveMsg && <span className={saveMsg === "Uloženo" ? styles.saveOk : styles.saveErr}>{saveMsg}</span>}
                <Button variant="primary" onClick={save} disabled={!isDirty || saving}>
                  {saving ? "Ukládám…" : "Uložit"}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Create form (inline modal-ish card) ── */}
      {creating && (
        <div className={styles.createOverlay}>
          <div className={styles.createCard}>
            <h3 className={styles.createTitle}>Nový uživatelský typ</h3>
            <label className={styles.createLabel}>Název</label>
            <input className={styles.createInput} value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} />
            <label className={styles.createLabel}>Zkopírovat oprávnění z</label>
            <select className={styles.createInput} value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
              <option value="">Prázdný (bez práv)</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <div className={styles.createFooter}>
              <Button variant="secondary" onClick={() => { setCreating(false); setNewName(""); setCloneFrom(""); }}>Zrušit</Button>
              <Button variant="primary" onClick={submitCreate} disabled={!newName.trim()}>Vytvořit</Button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          danger={modal.danger}
          showCancel={modal.showCancel}
          confirmLabel={modal.confirmLabel}
          onConfirm={modal.onConfirm}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
