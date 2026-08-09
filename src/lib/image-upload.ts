// Shared token-image pipeline (logo / banner).
//
// Root cause of the previous `Failed to fetch`: the token page sent the RAW
// file bytes base64-encoded inside a JSON server-function body. A 3–4 MB phone
// photo becomes a ~5.5 MB JSON payload, which the edge/proxy layer drops
// before the handler ever runs — fetch() then rejects with the opaque
// TypeError "Failed to fetch". Everything is now downscaled and re-encoded in
// the browser so the body stays well under 1 MB, and every failure is logged
// with bucket/path/status/cause instead of the bare message.

export type PreparedImage = { contentType: string; base64: string; bytes: number };

const MAX_EDGE = 1024;
const TARGET_BYTES = 700 * 1024; // base64 payload stays ≈ 950 KB

function toBase64(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (bmp) return bmp;
  }
  // Safari / older Android browsers: createImageBitmap can be missing or fail
  // for webp; decode through an <img> instead of aborting the upload.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No pudimos leer la imagen. Usa PNG, JPG o WEBP."));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Downscales + re-encodes so the upload body is always small and a MIME type
 * every browser can display. Keeps PNG only when the source is PNG. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const src = await decode(file);
  const w = "width" in src ? src.width : 0;
  const h = "height" in src ? src.height : 0;
  if (!w || !h) throw new Error("La imagen no tiene dimensiones válidas.");

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible en este navegador.");
  ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  (src as ImageBitmap).close?.();

  const png = /png$/i.test(file.type);
  let type = png ? "image/png" : "image/jpeg";
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  // A large PNG (screenshots, logos with photos) still blows the body budget:
  // fall back to JPEG and drop quality until it fits.
  for (const q of [0.85, 0.75, 0.6]) {
    if (blob && blob.size <= TARGET_BYTES) break;
    type = "image/jpeg";
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  }
  if (!blob) throw new Error("No pudimos procesar la imagen.");
  if (blob.size > 3 * 1024 * 1024) throw new Error("La imagen es demasiado grande incluso comprimida.");

  const buf = new Uint8Array(await blob.arrayBuffer());
  return { contentType: type, base64: toBase64(buf), bytes: buf.length };
}

type UploadFn = (args: {
  data: { kind: "logo" | "banner"; contentType: string; data: string };
}) => Promise<{ url: string }>;

/**
 * Prepares + uploads through the server function, with structured diagnostics
 * and one transparent retry for genuine network failures (mobile radios drop
 * the first POST often). Never swallows the underlying cause.
 */
export async function uploadTokenImage(
  uploadFn: UploadFn,
  kind: "logo" | "banner",
  file: File,
): Promise<string> {
  const tag = "[TOKEN_IMAGE_UPLOAD]";
  if (file.size > 12 * 1024 * 1024) throw new Error("El archivo supera los 12 MB.");
  const prepared = await prepareImage(file);
  const meta = {
    bucket: "token-media",
    kind,
    filename: file.name,
    sourceType: file.type || "(desconocido)",
    sourceBytes: file.size,
    sentType: prepared.contentType,
    sentBytes: prepared.bytes,
    base64Chars: prepared.base64.length,
  };
  console.info(tag, meta);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await uploadFn({
        data: { kind, contentType: prepared.contentType, data: prepared.base64 },
      });
      if (!res?.url) throw new Error("El servidor no devolvió la URL de la imagen.");
      console.info(tag, "ok", { ...meta, attempt, url: res.url });
      return res.url;
    } catch (error) {
      lastError = error;
      const err = error as { message?: string; status?: number; cause?: unknown };
      console.error(tag, "failed", {
        ...meta,
        attempt,
        status: err?.status,
        message: err?.message,
        cause: err?.cause,
        error,
      });
      const network = error instanceof TypeError || /failed to fetch|load failed|network/i.test(err?.message ?? "");
      if (!network || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const err = lastError as { message?: string };
  const msg = err?.message ?? String(lastError);
  if (lastError instanceof TypeError || /failed to fetch|load failed|network/i.test(msg)) {
    throw new Error(
      "No se pudo contactar con el servidor de imágenes (fallo de red). Revisa tu conexión e inténtalo de nuevo; el detalle técnico está en la consola.",
    );
  }
  throw new Error(msg || "No se pudo subir la imagen.");
}
