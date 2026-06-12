import { useEffect, useMemo, useState } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import { authApi, roleTypesApi, type RoleType, type UserProfile } from "@/lib/api";
import PermissionMatrix from "@/components/permissions/PermissionMatrix";
import { resolveToggle } from "@/lib/permissions/hierarchy";
import { useAuth } from "@/hooks/useAuth";
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
  const { can } = useAuth();
  // Editing individual grants/revokes requires users.permissions.manage. A
  // caller with only users.setType can still open this modal (to change the
  // type) but the permission matrix is read-only for them, and save() sends
  // only the roleType — mirroring the backend gate on PATCH .../permissions.
  const canManagePerms = can("users.permissions.manage");
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
  // The matrix is read-only when the target type is admin (everything on) OR
  // when the current admin lacks users.permissions.manage (setType-only).
  const matrixReadOnly = adminBaseline || !canManagePerms;
  const effectiveHas = (key: string) =>
    adminBaseline || ((baseline.has(key) || extra.has(key)) && !revoked.has(key));

  function toggle(key: string) {
    if (matrixReadOnly) return;
    // The matrix shows the EFFECTIVE set (baseline ∪ extra − revoked); run the
    // hierarchy cascade/exclusion on that, then re-decompose into deltas from the
    // type baseline. A cascade/exclusion removal of a BASELINE perm becomes a
    // revoke (●); removal of an EXTRA perm just drops from extra.
    const eff = new Set<string>(baseline);
    for (const k of extra) eff.add(k);
    for (const k of revoked) eff.delete(k);
    const next = resolveToggle(eff, key);
    setExtra(new Set([...next].filter((k) => !baseline.has(k))));
    setRevoked(new Set([...baseline].filter((k) => !next.has(k))));
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
      await authApi.setUserPermissions(
        user.uid,
        canManagePerms
          ? { roleType, extraPermissions: [...extra], revokedPermissions: [...revoked] }
          : { roleType } // setType-only: never touch grants/revokes
      );
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
            ) : !canManagePerms ? (
              <p className={styles.adminNote}>Můžete pouze změnit typ uživatele; individuální oprávnění upravit nelze.</p>
            ) : (
              <p className={styles.hint}>
                Zaškrtnutí mimo výchozí nastavení typu se uloží jako individuální oprávnění (●).
              </p>
            )}

            <PermissionMatrix
              isChecked={effectiveHas}
              onToggle={toggle}
              readOnly={matrixReadOnly}
              forceAllOn={adminBaseline}
              decorate={(key) =>
                extra.has(key) || revoked.has(key) ? (
                  <span className={styles.overrideDot} title="Individuální úprava">●</span>
                ) : null
              }
            />

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
