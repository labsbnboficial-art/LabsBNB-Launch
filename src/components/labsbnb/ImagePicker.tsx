// Themed image control used by /create and the token "edit details" form.
// Presentation only: the upload/validation logic stays with the caller, which
// passes `onFile` (already-selected File) and the resulting `value` URL.
import { useId, useRef } from "react";
import { ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif";

export function ImagePicker({
  value,
  busy = false,
  hint,
  aspect = "square",
  onFile,
  onClear,
}: {
  value?: string | null;
  busy?: boolean;
  hint?: string;
  aspect?: "square" | "wide";
  onFile: (file: File) => void;
  onClear?: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const has = Boolean(value);

  return (
    <div className="space-y-2">
      <input
        ref={ref}
        id={id}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />

      <label
        htmlFor={id}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-3 transition hover:border-primary/40 hover:bg-white/[0.06] focus-within:ring-2 focus-within:ring-primary/50 ${
          busy ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <div
          className={`grid shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-background/60 ${
            aspect === "wide" ? "h-12 w-20" : "h-12 w-12"
          }`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : has ? (
            <img src={value as string} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">
            {busy ? "Subiendo imagen…" : has ? "Imagen cargada" : "Seleccionar imagen"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {hint ?? "PNG, JPG, WEBP o GIF · se optimiza automáticamente"}
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted-foreground">
          {has ? (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3" /> Reemplazar
            </span>
          ) : (
            "Examinar"
          )}
        </span>
      </label>

      {has && onClear && !busy && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" /> Quitar imagen
        </button>
      )}
    </div>
  );
}
