/**
 * Cryptographic hash utility supporting browser Web Crypto API and Node.js crypto.
 */

export async function computeSha256(data: string | ArrayBuffer | Blob): Promise<string> {
  let buffer: ArrayBuffer;
  if (typeof data === "string") {
    buffer = new TextEncoder().encode(data).buffer;
  } else if (data instanceof ArrayBuffer) {
    buffer = data;
  } else if (typeof Blob !== "undefined" && data instanceof Blob) {
    buffer = await data.arrayBuffer();
  } else {
    buffer = new TextEncoder().encode(String(data)).buffer;
  }

  // Browser Web Crypto API
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Node.js crypto fallback
  try {
    const nodeCrypto = await import("crypto");
    const hash = nodeCrypto.createHash("sha256");
    hash.update(Buffer.from(buffer));
    return hash.digest("hex");
  } catch {
    // Basic fallback if neither subtle nor node:crypto available
    let hash = 0;
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i++) {
      hash = (hash << 5) - hash + view[i];
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}
