/**
 * Convert a Blob to a base64 string (no data: prefix) for JSON transport.
 * Chunked over a Uint8Array to avoid the call-stack overflow that
 * String.fromCharCode(...buf) hits on multi-MB PDFs.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
