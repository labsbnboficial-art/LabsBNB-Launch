const PUBLIC_OBJECT_MARKER = "/storage/v1/object/public/token-media/";

/** Uses the app's stable media endpoint for token-media objects, including
 * projects where the storage bucket was accidentally left private. */
export function tokenMediaUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("/api/public/token-media?path=")) return raw;
  try {
    const url = new URL(raw);
    const markerAt = url.pathname.indexOf(PUBLIC_OBJECT_MARKER);
    if (markerAt < 0) return raw;
    const path = decodeURIComponent(url.pathname.slice(markerAt + PUBLIC_OBJECT_MARKER.length));
    return `/api/public/token-media?path=${encodeURIComponent(path)}`;
  } catch {
    return raw;
  }
}