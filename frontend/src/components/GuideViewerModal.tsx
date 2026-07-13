import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import { useIsPhone } from "@/hooks/useIsPhone";
import styles from "./GuideViewerModal.module.css";

/**
 * Full-screen viewer for a PDF návod.
 *
 * The PDF is not a public URL: `GET /api/guides/:id/file` requires an
 * Authorization header, so it can't simply be the `src` of an <iframe>. We fetch
 * it with the token, wrap the bytes in an object URL, and point the iframe at
 * that — which hands rendering to the browser's built-in PDF viewer (zoom, page
 * nav, print) for free.
 *
 * Phones don't get the iframe: mobile Safari/Chrome render an embedded PDF as a
 * blank box or a one-page thumbnail, so there we offer the native open/download
 * instead of a broken preview.
 *
 * Closes only via its buttons — never on backdrop click.
 */
export default function GuideViewerModal({
  guideId,
  title,
  onClose,
}: {
  guideId: string;
  title: string;
  onClose: () => void;
}) {
  const isPhone = useIsPhone();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;

    (async () => {
      try {
        const user = getAuth().currentUser;
        if (!user) throw new Error("Nejste přihlášeni.");
        const token = await user.getIdToken();
        const resp = await fetch(`/api/guides/${guideId}/file`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!resp.ok) throw new Error("Návod se nepodařilo načíst.");
        const blob = await resp.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Návod se nepodařilo načíst.");
        }
      }
    })();

    return () => {
      cancelled = true;
      // Revoke on unmount — the object URL holds the whole PDF in memory.
      if (created) URL.revokeObjectURL(created);
    };
  }, [guideId]);

  function handleOpenInTab() {
    if (blobUrl) window.open(blobUrl, "_blank", "noopener,noreferrer");
  }

  function handleDownload() {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${title || "navod"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onClose} />
        </div>

        <div className={styles.body}>
          {error && <p className={styles.message}>{error}</p>}

          {!error && !blobUrl && <p className={styles.message}>Načítám návod…</p>}

          {!error && blobUrl && isPhone && (
            <div className={styles.phoneFallback}>
              <p className={styles.message}>
                Na telefonu se návod otevře v prohlížeči PDF.
              </p>
              <Button type="button" onClick={handleOpenInTab}>
                Otevřít návod
              </Button>
            </div>
          )}

          {!error && blobUrl && !isPhone && (
            <iframe className={styles.frame} src={blobUrl} title={title} />
          )}
        </div>

        <div className={styles.footer}>
          {blobUrl && !error && (
            <>
              <Button type="button" variant="secondary" onClick={handleDownload}>
                Stáhnout
              </Button>
              <Button type="button" variant="secondary" onClick={handleOpenInTab}>
                Otevřít v novém okně
              </Button>
            </>
          )}
          <Button type="button" onClick={onClose}>
            Zavřít
          </Button>
        </div>
      </div>
    </div>
  );
}
