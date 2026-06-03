import { useEffect, useMemo, useState } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import { authApi, roleTypesApi, type RoleType, type UserProfile } from "@/lib/api";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import styles from "./UserPermissionsModal.module.css";

interface Props {
  user: UserProfile;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Per-user permission editor: pick a user type + tweak individual grants/revokes
 * on top of it. The matrix shows the EFFECTIVE state (type ∪ grants − revokes);
 * toggling a box that differs from the type records a grant or revoke (marked ●).
 * The backend enforces the lockout guards (own-admin / last-admin) — surfaced here.
 */
export default function UserPermissionsModal({ user, onClose, onSaved }: Props) {
  const [types, setTypes] = useState<RoleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleType, setRoleType] = useState<string>(user.roleType ?? user.role);
  const [extra, setExtra] = useState<Set<string>>(new Set(user.extraPermissions ?? []));
  const [revoked, setRevoked] = useState<Set<string>>(new Set(user.revokedPermissions ?? []));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    roleTypesApi
      .list()
      .then(setTypes)
      .catch(() => setTypes([]))
      .finally(() => setLoading(false));
  }, []);

  const baseline = useMemo(() => {
    const t = types.find((x) => x.id === roleType);
    return new Set<string>(t?.permissions ?? []);
  }, [types, roleType]);

  const adminBaseline = baseline.has("system.admin");
  const effectiveHas = (key: string) =>
    adminBaseline || ((baseline.has(key) || extra.has(key)) && !revoked.has(key));

  function toggle(key: string) {
    if (adminBaseline) return;
    const inBaseline = baseline.has(key);
    const on = effectiveHas(key);
    const ex = new Set(extra);
    const rv = new Set(revoked);
    if (on) {
      // turn off
      if (inBaseline) rv.add(key);
      ex.delete(key);
    } else {
      // turn on
      if (inBaseline) rv.delete(key);
      else ex.add(key);
      rv.delete(key);
    }
    setExtra(ex);
    setRevoked(rv);
  }

  function changeType(id: string) {
    setRoleType(id);
    // Start fresh from the new type's baseline (clears prior grants/revokes).
    setExtra(new Set());
    setRevoked(new Set());
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await authApi.setUserPermissions(user.uid, {
        roleType,
        extraPermissions: [...extra],
        revokedPermissions: [...revoked],
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const overrideCount = extra.size + revoked.size;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Oprávnění — {user.name}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onClose}>✕</IconButton>
        </div>

        {loading ? (
          <div className={styles.loading}>Načítám…</div>
        ) : (
          <>
            <div className={styles.typeRow}>
              <label className={styles.typeLabel}>Typ uživatele</label>
              <select className={styles.typeSelect} value={roleType} onChange={(e) => changeType(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {overrideCount > 0 && (
                <span className={styles.overrideNote}>{overrideCount} individuálních úprav</span>
              )}
            </div>

            {adminBaseline ? (
              <p className={styles.adminNote}>Tento typ má všechna oprávnění; individuální úpravy se neuplatní.</p>
            ) : (
              <p className={styles.hint}>
                Zaškrtnutí mimo výchozí nastavení typu se uloží jako individuální oprávnění (●).
              </p>
            )}

            <div className={styles.matrix}>
              {PERMISSION_CATALOG.map((group) => (
                <fieldset key={group.group} className={styles.group} disabled={adminBaseline}>
                  <legend className={styles.groupLegend}>{group.group}</legend>
                  <div className={styles.groupItems}>
                    {group.items.map((item) => {
                      const overridden = extra.has(item.key) || revoked.has(item.key);
                      return (
                        <label key={item.key} className={styles.permItem}>
                          <input
                            type="checkbox"
                            checked={effectiveHas(item.key)}
                            disabled={adminBaseline}
                            onChange={() => toggle(item.key)}
                          />
                          <span>{item.label}</span>
                          {overridden && <span className={styles.overrideDot} title="Individuální úprava">●</span>}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>

            {err && <p className={styles.err}>{err}</p>}

            <div className={styles.footer}>
              <Button variant="secondary" onClick={onClose}>Zrušit</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
