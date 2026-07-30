import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useWriteContract, useSwitchChain, usePublicClient } from "wagmi";
import { parseUnits, decodeEventLog, type Abi } from "viem";
import { FACTORY_ABI } from "@/lib/web3/abis";
import { useI18n } from "@/lib/i18n";
import { AppShell } from "@/components/labsbnb/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLaunchpadConfig } from "@/lib/launchpad-config";
import { toast } from "sonner";
import { Rocket, Check, ArrowLeft, ArrowRight, Sparkles, Lock } from "lucide-react";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create a token — LabsBNB Launchpad" },
      { name: "description", content: "Launch a token on BNB Chain in 3 steps. No deploy fees. Only gas." },
      { property: "og:title", content: "Create a token — LabsBNB Launchpad" },
      { property: "og:description", content: "Launch a token on BNB Chain in 3 steps." },
    ],
  }),
  component: CreatePage,
});

const CATEGORIES = ["Meme", "AI", "DeFi", "GameFi", "Utility", "Community", "Other"];

const step1Schema = z.object({
  name: z.string().trim().min(2).max(48),
  ticker: z.string().trim().min(2).max(10).regex(/^[A-Z0-9]+$/, "A-Z 0-9 only"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  logo_url: z.string().url().max(500).optional().or(z.literal("")),
  banner_url: z.string().url().max(500).optional().or(z.literal("")),
  website: z.string().url().max(200).optional().or(z.literal("")),
  telegram: z.string().max(200).optional().or(z.literal("")),
  twitter: z.string().max(200).optional().or(z.literal("")),
  discord: z.string().max(200).optional().or(z.literal("")),
  github: z.string().max(200).optional().or(z.literal("")),
  category: z.string().min(1),
});

const step2Schema = z.object({
  supply: z.coerce.number().positive().max(1e15),
  decimals: z.coerce.number().int().min(0).max(18),
  initial_buy_bnb: z.coerce.number().min(0).max(1000),
  target_bnb: z.coerce.number().positive().max(10000),
});

type FormState = z.infer<typeof step1Schema> & z.infer<typeof step2Schema>;

type AdvancedState = {
  enabled: boolean;
  lp_pct: number;
  burn_pct: number;
  staking_pct: number;
  reward_pct: number;
  paid_tx: string | null;
};

const initialAdvanced: AdvancedState = {
  enabled: false,
  lp_pct: 60,
  burn_pct: 10,
  staking_pct: 20,
  reward_pct: 10,
  paid_tx: null,
};

const initial: FormState = {
  name: "", ticker: "", description: "", logo_url: "", banner_url: "",
  website: "", telegram: "", twitter: "", discord: "", github: "",
  category: "Meme",
  supply: 1_000_000_000, decimals: 18, initial_buy_bnb: 0, target_bnb: 24,
};

function CreatePage() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [adv, setAdv] = useState<AdvancedState>(initialAdvanced);
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const { data: cfg } = useLaunchpadConfig();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const chainId = cfg?.chain_id ?? 97;
  const publicClient = usePublicClient({ chainId });
  const factory = (cfg?.factory_address ?? null) as `0x${string}` | null;
  const [deployTx, setDeployTx] = useState<`0x${string}` | null>(null);
  const [deployState, setDeployState] = useState<string>("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function goNext() {
    if (step === 0) {
      const r = step1Schema.safeParse(form);
      if (!r.success) { toast.error(r.error.issues[0].message); return; }
      setStep(1);
    } else if (step === 1) {
      const r = step2Schema.safeParse(form);
      if (!r.success) { toast.error(r.error.issues[0].message); return; }
      setStep(2);
    }
  }

  async function deploy() {
    if (!user) { toast.error("Sign in first"); navigate({ to: "/auth", search: { redirect: "/create" } }); return; }
    if (!isConnected || !address) { toast.error("Connect your wallet first"); return; }
    if (adv.enabled && !adv.paid_tx) { toast.error("Pay the advanced tokenomics unlock first"); return; }
    if (adv.enabled) {
      const total = adv.lp_pct + adv.burn_pct + adv.staking_pct + adv.reward_pct;
      if (total !== 100) { toast.error(`Advanced % must sum to 100 (current: ${total})`); return; }
    }
    if (!factory) { toast.error("Factory address not configured"); return; }
    setSubmitting(true);
    setDeployTx(null);
    setDeployedToken(null);
    try {
      // 1) Make sure the wallet is on BNB Smart Chain Testnet (97) before signing.
      if (walletChainId !== chainId) {
        try {
          await switchChainAsync({ chainId });
        } catch {
          throw new Error("Switch your wallet to BNB Smart Chain Testnet (chain 97) and try again");
        }
      }

      // 2) Simulate then send the real createToken() transaction.
      const metadataURI = form.logo_url || form.website || "";
      const args = [form.name, form.ticker.toUpperCase(), metadataURI] as const;
      setDeployState("Checking the transaction with the factory…");
      await publicClient!.simulateContract({
        account: address,
        address: factory,
        abi: FACTORY_ABI as Abi,
        functionName: "createToken",
        args: args as unknown as unknown[],
      });

      setDeployState("Confirm the transaction in your wallet (gas in tBNB)…");
      const hash = await writeContractAsync({
        address: factory,
        abi: FACTORY_ABI as Abi,
        functionName: "createToken",
        args: args as unknown as unknown[],
        chainId,
      });
      setDeployTx(hash);
      setDeployState("Waiting for confirmation on BNB Testnet…");

      // 3) Wait for the receipt and read the TokenCreated event.
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error("Transaction reverted on-chain");
      let tokenAddress: string | null = null;
      let curveAddress: string | null = null;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: FACTORY_ABI as Abi, data: log.data, topics: log.topics });
          if (ev.eventName === "TokenCreated") {
            const a = ev.args as unknown as { token: string; curve: string };
            tokenAddress = a.token;
            curveAddress = a.curve;
            break;
          }
        } catch { /* not a factory event */ }
      }
      if (!tokenAddress) throw new Error("TokenCreated event not found in the transaction receipt");
      setDeployedToken(tokenAddress);
      setDeployState("Deployed — saving…");

      // 4) Persist the on-chain result.
      const { data, error } = await supabase.from("tokens").insert({
        creator_id: user.id,
        name: form.name,
        ticker: form.ticker.toUpperCase(),
        description: form.description || null,
        logo_url: form.logo_url || null,
        banner_url: form.banner_url || null,
        website: form.website || null,
        telegram: form.telegram || null,
        twitter: form.twitter || null,
        discord: form.discord || null,
        github: form.github || null,
        category: form.category,
        supply: form.supply,
        decimals: form.decimals,
        chain_id: chainId,
        contract_address: tokenAddress,
        deploy_tx_hash: hash,
        status: "active",
      }).select("id").single();
      if (error) throw error;
      await supabase.from("bonding_curves").insert({
        token_id: data.id,
        target_bnb: Math.floor(form.target_bnb * 1e18),
      });
      await supabase.from("activity").insert({
        user_id: user.id,
        token_id: data.id,
        kind: "deploy",
        payload: {
          token_address: tokenAddress,
          curve_address: curveAddress,
          factory_address: factory,
          tx_hash: hash,
          chain_id: chainId,
        },
      });
      if (adv.enabled) {
        await supabase.from("activity").insert({
          user_id: user.id,
          token_id: data.id,
          kind: "advanced_tokenomics",
          payload: {
            lp_pct: adv.lp_pct,
            burn_pct: adv.burn_pct,
            staking_pct: adv.staking_pct,
            reward_pct: adv.reward_pct,
            payment_tx: adv.paid_tx,
            payment_wallet: cfg?.admin_wallet ?? null,
            payment_amount_wei: cfg?.advanced_creation_fee_bnb ?? null,
          },
        });
      }
      setDeployState("Deployed");
      toast.success("Token deployed on-chain");
      navigate({ to: "/token/$address", params: { address: tokenAddress } });
    } catch (e) {
      console.error(e);
      setDeployState("Failed");
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl brand-gradient glow-primary mb-4">
            <Rocket className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{t("create.title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("create.subtitle")}</p>
        </div>

        <Stepper step={step} labels={[t("create.step1"), t("create.step2"), t("create.step3")]} />

        <div className="glass-strong rounded-3xl p-6 md:p-8 mt-8">
          {step === 0 && (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label={t("create.name")}><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label={t("create.ticker")}><Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} className="font-mono" /></Field>
              <Field label={t("create.description")} full><Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
              <Field label={t("create.logo")}><FileUploader value={form.logo_url} onChange={(url) => set("logo_url", url)} kind="logo" userId={user?.id} /></Field>
              <Field label={t("create.banner")}><FileUploader value={form.banner_url} onChange={(url) => set("banner_url", url)} kind="banner" userId={user?.id} /></Field>
              <Field label={t("create.website")}><Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Telegram"><Input value={form.telegram} onChange={(e) => set("telegram", e.target.value)} /></Field>
              <Field label="X / Twitter"><Input value={form.twitter} onChange={(e) => set("twitter", e.target.value)} /></Field>
              <Field label="Discord"><Input value={form.discord} onChange={(e) => set("discord", e.target.value)} /></Field>
              <Field label="GitHub"><Input value={form.github} onChange={(e) => set("github", e.target.value)} /></Field>
              <Field label={t("create.category")}>
                <select value={form.category} onChange={(e) => set("category", e.target.value)} className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c} className="bg-background">{c}</option>)}
                </select>
              </Field>
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label={t("create.supply")}><Input type="number" value={form.supply} onChange={(e) => set("supply", Number(e.target.value))} /></Field>
              <Field label={t("create.decimals")}><Input type="number" value={form.decimals} onChange={(e) => set("decimals", Number(e.target.value))} /></Field>
              <Field label={t("create.initialBuy")}><Input type="number" step="0.01" value={form.initial_buy_bnb} onChange={(e) => set("initial_buy_bnb", Number(e.target.value))} /></Field>
              <Field label={t("create.target")}><Input type="number" step="0.1" value={form.target_bnb} onChange={(e) => set("target_bnb", Number(e.target.value))} /></Field>
              <div className="md:col-span-2 rounded-xl border border-accent/20 bg-accent/5 p-4 text-sm">
                <div className="font-medium text-accent mb-1">Virtual bonding curve</div>
                <p className="text-muted-foreground">
                  Liquidity grows automatically as buys happen. When the curve reaches the target,
                  the pool is created and liquidity is locked. Zero deploy fees — you only pay gas.
                </p>
              </div>
              <div className="md:col-span-2">
                <AdvancedTokenomics
                  adv={adv}
                  setAdv={setAdv}
                  feeWei={cfg?.advanced_creation_fee_bnb ?? "0"}
                  adminWallet={(cfg?.admin_wallet ?? "0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e") as `0x${string}`}
                />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <Summary form={form} adv={adv} />
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-muted-foreground space-y-1">
                <div>
                  Your wallet ({address ?? "not connected"}) will sign <span className="font-mono text-accent">createToken()</span> on the LabsBNB factory.
                </div>
                <div>
                  Factory: <span className="font-mono text-accent">{factory ?? "not configured"}</span> · Chain ID <span className="font-mono">{chainId}</span>
                </div>
              </div>
              {(deployTx || deployState) && (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-xs space-y-1">
                  <div className="text-accent">{deployState || "…"}</div>
                  {deployTx && (
                    <a
                      className="font-mono underline break-all"
                      href={`https://testnet.bscscan.com/tx/${deployTx}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {deployTx}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("create.back")}
            </Button>
            {step < 2 ? (
              <Button onClick={goNext} className="brand-gradient text-primary-foreground glow-primary">
                {t("create.next")} <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={deploy} disabled={submitting} className="brand-gradient text-primary-foreground glow-primary">
                {submitting ? "…" : t("create.deploy")} <Check className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <Label className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-full grid place-items-center text-xs font-bold transition ${i <= step ? "brand-gradient text-primary-foreground glow-primary" : "bg-white/5 text-muted-foreground"}`}>
            {i + 1}
          </div>
          <span className={`text-sm ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{l}</span>
          {i < labels.length - 1 && <div className="w-8 h-px bg-white/10 mx-1" />}
        </div>
      ))}
    </div>
  );
}

function Summary({ form, adv }: { form: FormState; adv: AdvancedState }) {
  const rows: [string, string][] = [
    ["Name", form.name],
    ["Ticker", "$" + form.ticker],
    ["Category", form.category],
    ["Supply", form.supply.toLocaleString()],
    ["Decimals", String(form.decimals)],
    ["Initial buy", `${form.initial_buy_bnb} BNB`],
    ["Curve target", `${form.target_bnb} BNB`],
  ];
  if (adv.enabled) {
    rows.push(
      ["LP %", `${adv.lp_pct}%`],
      ["Burn %", `${adv.burn_pct}%`],
      ["Staking %", `${adv.staking_pct}%`],
      ["Reward %", `${adv.reward_pct}%`],
      ["Advanced tx", adv.paid_tx ? `${adv.paid_tx.slice(0, 10)}…` : "—"],
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-mono">{v}</span>
        </div>
      ))}
    </div>
  );
}

function AdvancedTokenomics({
  adv, setAdv, feeWei, adminWallet,
}: {
  adv: AdvancedState;
  setAdv: React.Dispatch<React.SetStateAction<AdvancedState>>;
  feeWei: string;
  adminWallet: `0x${string}`;
}) {
  const feeBnb = useMemo(() => {
    try { return Number(BigInt(feeWei)) / 1e18; } catch { return 0; }
  }, [feeWei]);
  const total = adv.lp_pct + adv.burn_pct + adv.staking_pct + adv.reward_pct;
  const { sendTransactionAsync, isPending } = useSendTransaction();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  async function pay() {
    try {
      const value = parseUnits(String(feeBnb || 0), 18);
      const hash = await sendTransactionAsync({ to: adminWallet, value });
      setTxHash(hash);
      setAdv((a) => ({ ...a, paid_tx: hash }));
      toast.success("Payment sent, waiting for confirmation…");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const paid = Boolean(adv.paid_tx);
  const setPct = (k: keyof AdvancedState, v: number) =>
    setAdv((a) => ({ ...a, [k]: Math.max(0, Math.min(100, Math.floor(v || 0))) }));

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg brand-gradient grid place-items-center glow-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-semibold flex items-center gap-2">
              Advanced tokenomics
              {!paid && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customize LP, Burn, Staking and Reward percentages. Unlock fee:{" "}
              <span className="font-mono text-accent">{feeBnb} BNB</span>
            </p>
          </div>
        </div>
        <Switch checked={adv.enabled} onCheckedChange={(v) => setAdv((a) => ({ ...a, enabled: v }))} />
      </div>

      {adv.enabled && (
        <div className="mt-5 space-y-4">
          {!paid ? (
            <div className="rounded-lg border border-white/10 bg-black/20 p-4 flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">Unlock required</div>
                <div className="text-xs text-muted-foreground">
                  Send {feeBnb} BNB to{" "}
                  <span className="font-mono">{adminWallet.slice(0, 6)}…{adminWallet.slice(-4)}</span>
                </div>
              </div>
              <Button onClick={pay} disabled={isPending || confirming} className="brand-gradient text-primary-foreground">
                {isPending ? "Confirm in wallet…" : confirming ? "Confirming…" : `Pay ${feeBnb} BNB`}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-accent flex items-center gap-2">
              <Check className="h-3.5 w-3.5" /> Payment {isSuccess ? "confirmed" : "sent"} — tx {adv.paid_tx?.slice(0, 10)}…
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["lp_pct", "burn_pct", "staking_pct", "reward_pct"] as const).map((k) => (
              <div key={k}>
                <Label className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  {k.replace("_pct", "")} %
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={adv[k] as number}
                  onChange={(e) => setPct(k, Number(e.target.value))}
                  disabled={!paid}
                />
              </div>
            ))}
          </div>
          <div className={`text-xs ${total === 100 ? "text-accent" : "text-destructive"}`}>
            Total: {total}% {total === 100 ? "✓" : "(must equal 100)"}
          </div>
        </div>
      )}
    </div>
  );
}

function FileUploader({ value, onChange, kind, userId }: { value?: string; onChange: (url: string) => void; kind: "logo" | "banner"; userId?: string }) {
  const [busy, setBusy] = useState(false);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${userId}/${kind}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("token-media").upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw up.error;
      const { data } = await supabase.storage.from("token-media").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (data?.signedUrl) onChange(data.signedUrl);
      toast.success("Uploaded");
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <Input type="file" accept="image/*" disabled={busy} onChange={onFile} />
      {value && <img src={value} alt="" className="h-16 w-16 rounded-lg object-cover border border-white/10" />}
    </div>
  );
}
