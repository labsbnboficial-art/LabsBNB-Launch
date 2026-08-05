// 🚀 Impulso — admin management tab: service settings, plans and campaigns.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  adminBoostOverview,
  adminSaveBoostSettings,
  adminSaveBoostPackage,
  adminDeleteBoostPackage,
  adminUpdateBoost,
  adminGrantBoost,
} from "@/lib/boost.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Rocket } from "lucide-react";

type Settings = {
  enabled: boolean;
  pricePerDayBnb: number;
  currency: string;
  wallet: string;
  maxSlots: number;
  autoApprove: boolean;
  maxDays: number;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  pending: "Pendiente",
  finished: "Finalizado",
  cancelled: "Cancelado",
  rejected: "Rechazado",
};

export function AdminBoostTab({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(adminBoostOverview);
  const saveSettingsFn = useServerFn(adminSaveBoostSettings);
  const savePkgFn = useServerFn(adminSaveBoostPackage);
  const delPkgFn = useServerFn(adminDeleteBoostPackage);
  const updateFn = useServerFn(adminUpdateBoost);
  const grantFn = useServerFn(adminGrantBoost);

  const q = useQuery({
    queryKey: ["admin-boost"],
    queryFn: () => overviewFn({ data: { csrf } }),
    refetchInterval: 30_000,
  });

  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (q.data?.settings) setS(q.data.settings as Settings); }, [q.data?.settings]);

  const [busy, setBusy] = useState(false);
  const [grantToken, setGrantToken] = useState("");
  const [grantDays, setGrantDays] = useState("7");

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await q.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Cargando Impulso…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;

  const stats = q.data?.stats;
  const packages = q.data?.packages ?? [];
  const boosts = q.data?.boosts ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Impulsos activos" value={String(stats?.active ?? 0)} />
        <Stat label="Pendientes" value={String(stats?.pending ?? 0)} />
        <Stat label="Ingresos" value={`${stats?.revenue ?? 0} ${s?.currency ?? "BNB"}`} />
      </div>

      {/* Settings */}
      {s && (
        <section className="glass-strong rounded-3xl p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Configuración del servicio</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle label="Servicio activo" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
            <Toggle label="Aprobación automática" checked={s.autoApprove} onChange={(v) => setS({ ...s, autoApprove: v })} />
            <Field label="Precio por día" value={String(s.pricePerDayBnb)} onChange={(v) => setS({ ...s, pricePerDayBnb: Number(v) || 0 })} />
            <Field label="Moneda" value={s.currency} onChange={(v) => setS({ ...s, currency: v })} />
            <Field label="Wallet de tesorería" mono value={s.wallet} onChange={(v) => setS({ ...s, wallet: v })} />
            <Field label="Slots máximos en portada" value={String(s.maxSlots)} onChange={(v) => setS({ ...s, maxSlots: Number(v) || 1 })} />
            <Field label="Días máximos por compra" value={String(s.maxDays)} onChange={(v) => setS({ ...s, maxDays: Number(v) || 1 })} />
          </div>
          <Button
            className="mt-4"
            disabled={busy}
            onClick={() => run("Configuración guardada", () => saveSettingsFn({ data: { csrf, ...s } }))}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar configuración
          </Button>
        </section>
      )}

      {/* Packages */}
      <section className="glass-strong rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Planes de impulso</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run("Plan creado", () =>
                savePkgFn({
                  data: { csrf, name: "Nuevo plan", days: 1, priceBnb: null, active: true, sortOrder: packages.length + 1 },
                }),
              )
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> Añadir plan
          </Button>
        </div>
        <div className="space-y-3">
          {packages.map((p) => (
            <PackageRowEditor
              key={p.id}
              pkg={p}
              busy={busy}
              onSave={(row) => run("Plan actualizado", () => savePkgFn({ data: { csrf, id: p.id, ...row } }))}
              onDelete={() => run("Plan eliminado", () => delPkgFn({ data: { csrf, id: p.id } }))}
            />
          ))}
          {packages.length === 0 && <p className="text-sm text-muted-foreground">Sin planes. El precio por día se aplicará igualmente.</p>}
        </div>
      </section>

      {/* Manual grant */}
      <section className="glass-strong rounded-3xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Conceder impulso manual</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Dirección del token</label>
            <Input className="mt-1 font-mono" placeholder="0x…" value={grantToken} onChange={(e) => setGrantToken(e.target.value)} />
          </div>
          <div className="w-28">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Días</label>
            <Input className="mt-1" value={grantDays} onChange={(e) => setGrantDays(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
          <Button
            disabled={busy || !/^0x[a-fA-F0-9]{40}$/.test(grantToken)}
            onClick={() =>
              run("Impulso concedido", async () => {
                await grantFn({ data: { csrf, token: grantToken, days: Number(grantDays) || 1 } });
                setGrantToken("");
              })
            }
          >
            <Rocket className="mr-1.5 h-4 w-4" /> Conceder
          </Button>
        </div>
      </section>

      {/* Campaigns */}
      <section className="glass-strong overflow-x-auto rounded-3xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Campañas</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="py-2">Token</th><th>Wallet</th><th>Días</th><th>Pagado</th>
              <th>Estado</th><th>Expira</th><th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {boosts.map((b) => (
              <tr key={b.id} className="border-t border-white/5">
                <td className="py-2">
                  <p className="font-medium">{b.token_name || "—"}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{b.token_address.slice(0, 12)}…</p>
                </td>
                <td className="font-mono text-[11px]">{b.owner_wallet.slice(0, 10)}…</td>
                <td>{b.days}</td>
                <td className="font-mono text-xs">{b.total_paid}</td>
                <td>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest">
                    {STATUS_LABEL[b.status] ?? b.status}
                  </span>
                </td>
                <td className="whitespace-nowrap text-xs">{new Date(b.expires_at).toLocaleString()}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    {b.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => run("Impulso aprobado", () => updateFn({ data: { csrf, id: b.id, action: "approve" } }))}>
                          Aprobar
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => run("Impulso rechazado", () => updateFn({ data: { csrf, id: b.id, action: "reject" } }))}>
                          Rechazar
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => run("Impulso extendido", () => updateFn({ data: { csrf, id: b.id, action: "extend", days: 1 } }))}>
                      +1 día
                    </Button>
                    {b.status === "active" && (
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => run("Impulso cancelado", () => updateFn({ data: { csrf, id: b.id, action: "cancel" } }))}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {boosts.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay impulsos contratados.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-strong rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-widest text-muted-foreground">{label}</label>
      <Input className={`mt-1 ${mono ? "font-mono" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

type Pkg = { id: string; name: string; days: number; price_bnb: number | null; active: boolean; sort_order: number; effectivePrice: number };

function PackageRowEditor({
  pkg, busy, onSave, onDelete,
}: {
  pkg: Pkg;
  busy: boolean;
  onSave: (row: { name: string; days: number; priceBnb: number | null; active: boolean; sortOrder: number }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(pkg.name);
  const [days, setDays] = useState(String(pkg.days));
  const [price, setPrice] = useState(pkg.price_bnb == null ? "" : String(pkg.price_bnb));
  const [active, setActive] = useState(pkg.active);
  const [sort, setSort] = useState(String(pkg.sort_order));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="min-w-[160px] flex-1">
        <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Nombre</label>
        <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="w-24">
        <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Días</label>
        <Input className="mt-1" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} />
      </div>
      <div className="w-32">
        <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Precio fijo</label>
        <Input className="mt-1" placeholder={String(pkg.effectivePrice)} value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="w-20">
        <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Orden</label>
        <Input className="mt-1" value={sort} onChange={(e) => setSort(e.target.value.replace(/[^0-9]/g, ""))} />
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch checked={active} onCheckedChange={setActive} />
        <span className="text-xs text-muted-foreground">Activo</span>
      </div>
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          onSave({
            name,
            days: Number(days) || 1,
            priceBnb: price.trim() === "" ? null : Number(price) || null,
            active,
            sortOrder: Number(sort) || 0,
          })
        }
      >
        Guardar
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onDelete} aria-label="Eliminar plan">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
