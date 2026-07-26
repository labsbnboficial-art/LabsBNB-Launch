import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { Shield, Lock } from "lucide-react";
import { adminHasPin, setAdminPin, verifyAdminPin } from "@/lib/admin-pin.functions";
import { getAdminConfig, saveAdminConfig } from "@/lib/config.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — LabsBNB Launchpad" },
      { name: "description", content: "LabsBNB Launchpad administration panel." },
      { property: "og:title", content: "Admin — LabsBNB Launchpad" },
      { property: "og:description", content: "Administration panel." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const PIN_KEY = "labsbnb.admin.pin_ok";

function AdminPage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pinOk, setPinOk] = useState<boolean>(() => (typeof window !== "undefined" ? sessionStorage.getItem(PIN_KEY) === "1" : false));

  const checkFn = useServerFn(adminHasPin);
  const gate = useQuery({
    queryKey: ["admin-gate", user?.id],
    enabled: !!user,
    queryFn: () => checkFn(),
  });

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth", search: { redirect: "/admin" } }); }, [loading, user, navigate]);

  if (loading || !user) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;
  if (gate.isLoading) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;
  if (gate.error) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-4 py-16">
          <div className="glass-strong rounded-3xl p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-destructive" />
            <h1 className="mt-3 font-display text-xl font-bold">Admin backend unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground break-words">{(gate.error as Error).message}</p>
            <Button variant="outline" className="mt-4" onClick={() => gate.refetch()}>Retry</Button>
          </div>
        </div>
      </AppShell>
    );
  }
  if (!gate.data?.isAdminWallet) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-4 py-16">
          <div className="glass-strong rounded-3xl p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-destructive" />
            <h1 className="mt-3 font-display text-xl font-bold">{t("admin.forbidden")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Admin access is restricted to the configured admin wallet.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!pinOk) {
    return (
      <AppShell>
        <PinGate hasPin={gate.data.hasPin} onPass={() => { sessionStorage.setItem(PIN_KEY, "1"); setPinOk(true); }} />
      </AppShell>
    );
  }

  return <AppShell><AdminBody /></AppShell>;
}

function PinGate({ hasPin, onPass }: { hasPin: boolean; onPass: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const setPinFn = useServerFn(setAdminPin);
  const verifyFn = useServerFn(verifyAdminPin);

  async function submit() {
    if (!/^\d{6}$/.test(pin)) { toast.error("PIN must be 6 digits"); return; }
    setBusy(true);
    try {
      if (!hasPin) {
        await setPinFn({ data: { pin } });
        toast.success("PIN set");
      } else {
        const r = await verifyFn({ data: { pin } });
        if (!r.ok) { toast.error("Wrong PIN"); return; }
      }
      onPass();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="glass-strong rounded-3xl p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-3 font-display text-xl font-bold">{hasPin ? "Enter admin PIN" : "Set your admin PIN"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">6-digit second factor. Your wallet signature already authorized this session.</p>
        <div className="mt-6 flex justify-center">
          <Input
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-40 text-center font-mono text-2xl tracking-[0.5em]"
            placeholder="••••••"
          />
        </div>
        <Button onClick={submit} disabled={busy} className="mt-6 brand-gradient text-primary-foreground glow-primary">
          {busy ? "…" : hasPin ? "Unlock" : "Set PIN"}
        </Button>
      </div>
    </div>
  );
}

function AdminBody() {
  const { t } = useI18n();
  const loadCfg = useServerFn(getAdminConfig);
  const cfgQ = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => loadCfg(),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-12">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
          <Shield className="h-5 w-5 text-primary-foreground" />
        </div>
        <h1 className="font-display text-3xl font-bold">{t("admin.title")}</h1>
      </div>
      <ConfigEditor cfg={cfgQ.data ?? {}} onSaved={() => cfgQ.refetch()} />
    </div>
  );
}

type FieldSpec = { key: string; label: string; type?: "text" | "number" | "bool"; help?: string; mono?: boolean };

const CONTRACT_FIELDS: FieldSpec[] = [
  { key: "factory_address", label: "Factory address", mono: true, help: "Set once the Factory is deployed on-chain." },
  { key: "chain_id", label: "Chain ID", type: "number", help: "56 = BSC Mainnet, 97 = BSC Testnet" },
  { key: "rpc_url", label: "RPC URL", mono: true },
];

const FEE_FIELDS: FieldSpec[] = [
  { key: "fee_wallet", label: "Fee wallet", mono: true },
  { key: "buy_fee_bps", label: "Buy fee (bps)", type: "number" },
  { key: "sell_fee_bps", label: "Sell fee (bps)", type: "number" },
  { key: "fee_bps", label: "Legacy fee (bps)", type: "number" },
  { key: "creation_fee_bnb", label: "Creation fee (wei BNB)", mono: true },
];

const CURVE_FIELDS: FieldSpec[] = [
  { key: "curve_target_bnb", label: "Curve target (wei BNB)", mono: true },
  { key: "burn_pct", label: "% Burn on graduation", type: "number" },
  { key: "liquidity_pct", label: "% Liquidity to Pancake", type: "number" },
  { key: "lp_pct", label: "% LP kept", type: "number" },
  { key: "staking_pct", label: "% Staking allocation", type: "number" },
  { key: "reward_pct", label: "% Reward pool (default)", type: "number" },
  { key: "staking_cost_bnb", label: "Staking activation cost (wei BNB)", mono: true },
];

const ADVANCED_FIELDS: FieldSpec[] = [
  { key: "advanced_creation_fee_bnb", label: "Advanced tokenomics unlock fee (wei BNB)", mono: true, help: "Users pay this amount in BNB to the admin wallet to unlock custom % LP / Burn / Staking / Reward when creating a token." },
];

const ADMIN_FIELDS: FieldSpec[] = [
  { key: "admin_wallet", label: "Admin wallet (receives commissions)", mono: true },
];

const ANTIBOT_FIELDS: FieldSpec[] = [
  { key: "antibot_enabled", label: "AntiBot enabled", type: "bool" },
  { key: "antibot_max_buy_bnb", label: "Max buy (wei BNB, 0 = off)", mono: true },
  { key: "antibot_max_wallet_tk", label: "Max wallet (token wei, 0 = off)", mono: true },
  { key: "antibot_max_tx_tk", label: "Max TX (token wei, 0 = off)", mono: true },
  { key: "antibot_cooldown_s", label: "Cooldown (seconds)", type: "number" },
  { key: "antibot_anti_sandwich", label: "Anti-sandwich", type: "bool" },
  { key: "antibot_anti_flashloan", label: "Anti-flashloan", type: "bool" },
];

function ConfigEditor({ cfg, onSaved }: { cfg: Record<string, unknown>; onSaved: () => void }) {
  const { t } = useI18n();
  const saveFn = useServerFn(saveAdminConfig);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const v: Record<string, string> = {};
    for (const f of [...CONTRACT_FIELDS, ...FEE_FIELDS, ...CURVE_FIELDS, ...ADVANCED_FIELDS, ...ADMIN_FIELDS, ...ANTIBOT_FIELDS]) {
      const raw = cfg[f.key];
      v[f.key] = raw == null ? "" : typeof raw === "string" ? raw : String(raw);
    }
    setValues(v);
  }, [cfg]);

  async function save() {
    setBusy(true);
    try {
      const entries = [...CONTRACT_FIELDS, ...FEE_FIELDS, ...CURVE_FIELDS, ...ADVANCED_FIELDS, ...ADMIN_FIELDS, ...ANTIBOT_FIELDS].map((f) => {
        let value: number | string | boolean | null = values[f.key];
        if (f.type === "bool") value = values[f.key] === "true";
        else if (value === "" || value == null) value = null;
        else if (f.type === "number") value = Number(value);
        return { key: f.key, value, is_public: true };
      });
      await saveFn({ data: { entries } });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <Section title="Smart contract" fields={CONTRACT_FIELDS} values={values} setValues={setValues} />
      <Section title="Fees" fields={FEE_FIELDS} values={values} setValues={setValues} />
      <Section title="Bonding curve & tokenomics" fields={CURVE_FIELDS} values={values} setValues={setValues} />
      <Section title="Advanced tokenomics (paid unlock)" fields={ADVANCED_FIELDS} values={values} setValues={setValues} />
      <Section title="AntiBot" fields={ANTIBOT_FIELDS} values={values} setValues={setValues} />
      <Section title="Admin" fields={ADMIN_FIELDS} values={values} setValues={setValues} />
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy} className="brand-gradient text-primary-foreground glow-primary">
          {busy ? "…" : t("admin.save")}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title, fields, values, setValues,
}: {
  title: string;
  fields: FieldSpec[];
  values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="glass-strong rounded-3xl p-6">
      <h2 className="font-display text-lg font-semibold mb-4">{title}</h2>
      <div className="grid gap-5 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.mono ? "md:col-span-2" : ""}>
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">{f.label}</Label>
            {f.type === "bool" ? (
              <div className="mt-2">
                <Switch
                  checked={values[f.key] === "true"}
                  onCheckedChange={(c) => setValues((v) => ({ ...v, [f.key]: c ? "true" : "false" }))}
                />
              </div>
            ) : (
              <Input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={f.mono ? "font-mono" : ""}
              />
            )}
            {f.help && <p className="mt-1 text-[11px] text-muted-foreground">{f.help}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
