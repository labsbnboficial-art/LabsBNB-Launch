import { SOCIAL_FIELDS, type SocialKey } from "@/lib/social";
import { ExternalLink } from "lucide-react";

/** Renders only the social networks that the creator actually configured. */
export function SocialLinks({
  values,
  className = "",
}: {
  values: Partial<Record<SocialKey, string | null>>;
  className?: string;
}) {
  const present = SOCIAL_FIELDS.filter((f) => !!values[f.key]);
  if (!present.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs ${className}`}>
      {present.map((f) => (
        <a
          key={f.key}
          href={values[f.key] as string}
          target="_blank"
          rel="noopener noreferrer"
          title={f.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10 hover:text-accent transition"
        >
          {f.short}
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      ))}
    </div>
  );
}
