// Social links shared between the create form, the token profile and the admin
// panel. Values are normalised (a bare handle becomes a full URL) and validated
// before they ever reach the database.

export type SocialKey =
  | "website"
  | "twitter"
  | "telegram"
  | "discord"
  | "github"
  | "medium"
  | "youtube"
  | "instagram";

export const SOCIAL_FIELDS: { key: SocialKey; label: string; short: string; placeholder: string }[] = [
  { key: "website", label: "Website", short: "Web", placeholder: "https://misitio.com" },
  { key: "twitter", label: "X (Twitter)", short: "X", placeholder: "@handle o https://x.com/handle" },
  { key: "telegram", label: "Telegram", short: "TG", placeholder: "@canal o https://t.me/canal" },
  { key: "discord", label: "Discord", short: "DC", placeholder: "https://discord.gg/…" },
  { key: "github", label: "GitHub", short: "GH", placeholder: "usuario o https://github.com/usuario" },
  { key: "medium", label: "Medium", short: "M", placeholder: "@perfil o https://medium.com/@perfil" },
  { key: "youtube", label: "YouTube", short: "YT", placeholder: "https://youtube.com/@canal" },
  { key: "instagram", label: "Instagram", short: "IG", placeholder: "@perfil o https://instagram.com/perfil" },
];

/** Columns that only exist after the optional social-links migration. */
export const OPTIONAL_SOCIAL_KEYS: SocialKey[] = ["medium", "youtube", "instagram"];

const HANDLE_BASE: Partial<Record<SocialKey, string>> = {
  twitter: "https://x.com/",
  telegram: "https://t.me/",
  github: "https://github.com/",
  medium: "https://medium.com/@",
  youtube: "https://youtube.com/@",
  instagram: "https://instagram.com/",
};

/**
 * Turns user input into a canonical https URL.
 * Returns `null` when the field is empty and `false` when it is invalid.
 */
export function normalizeSocial(key: SocialKey, raw: string | null | undefined): string | null | false {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    const base = HANDLE_BASE[key];
    if (base && !candidate.includes("/") && !candidate.includes(".")) {
      candidate = base + candidate.replace(/^@+/, "");
    } else {
      candidate = `https://${candidate}`;
    }
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!url.hostname.includes(".")) return false;
    return url.toString().replace(/\/$/, "");
  } catch {
    return false;
  }
}

/** Normalises a whole record, throwing on the first invalid entry. */
export function normalizeSocialRecord(input: Partial<Record<SocialKey, string | null>>) {
  const out: Partial<Record<SocialKey, string | null>> = {};
  for (const { key, label } of SOCIAL_FIELDS) {
    if (!(key in input)) continue;
    const v = normalizeSocial(key, input[key]);
    if (v === false) throw new Error(`La URL de ${label} no es válida.`);
    out[key] = v;
  }
  return out;
}
