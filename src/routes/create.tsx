import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { uploadTokenMedia } from "@/lib/media.functions";
import { saveTokenProfile } from "@/lib/tokens.functions";
import { SOCIAL_FIELDS, normalizeSocial, type SocialKey } from "@/lib/social";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useWriteContract, useSwitchChain, usePublicClient, useChainId } from "wagmi";
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
import { useSiweSignIn } from "@/lib/use-siwe";
import { useLaunchpadConfig } from "@/lib/launchpad-config";
import { describeTxError, describeTxErrorVerbose, ensureChain } from "@/lib/web3/tx";
import { ACTIVE_CHAIN_ID, BSC_TESTNET_RPC } from "@/lib/web3/config";
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

/** Accepts absolute URLs and app-relative upload paths ("/api/public/..."). */
const mediaUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || v.startsWith("/") || /^(https?:\/\/|ipfs:\/\/|data:image\/)/.test(v), "URL de imagen inválida")
  .optional()
  .or(z.literal(""));

const step1Schema = z.object({
  name: z.string().trim().min(2).max(48),
  ticker: z.string().trim().min(2).max(10).regex(/^[A-Z0-9]+$/, "A-Z 0-9 only"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  // Uploads return an app-relative proxy path (/api/public/token-media?...),
  // so absolute-URL validation would reject a perfectly valid image.
  logo_url: mediaUrl,
  banner_url: mediaUrl,

  metadata_uri: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^(https?:\/\/|ipfs:\/\/)/.test(v), "Use an https:// or ipfs:// URI")
    .optional()
    .or(z.literal("")),
  ...(Object.fromEntries(
    SOCIAL_FIELDS.map((f) => [
      f.key,
      z
        .string()
        .trim()
        .max(200)
        .refine((v) => normalizeSocial(f.key, v) !== false, `URL de ${f.label} inválida`)
        .optional()
        .or(z.literal("")),
    ]),
  ) as unknown as Record<SocialKey, z.ZodTypeAny>),
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
  staking_wallet: string;
  reward_wallet: string;
  paid_tx: string | null;
};

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const initialAdvanced: AdvancedState = {
  enabled: false,
  lp_pct: 60,
  burn_pct: 10,
  staking_pct: 20,
  reward_pct: 10,
  staking_wallet: "",
  reward_wallet: "",
  paid_tx: null,
};


const initial: FormState = {
  name: "", ticker: "", description: "", logo_url: "", banner_url: "", metadata_uri: "",
  ...(Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.key, ""])) as Record<SocialKey, string>),
  category: "Meme",
  supply: 1_000_000_000, decimals: 18, initial_buy_bnb: 0, target_bnb: 24,
};

function CreatePage() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [adv, setAdv] = useState<AdvancedState>(initialAdvanced);
  const [submitting, setSubmitting] = useState(false);
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const { data: cfg } = useLaunchpadConfig();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const chainId = cfg?.chain_id ?? 97;
  const publicClient = usePublicClient({ chainId });
  const factory = (cfg?.factory_address ?? null) as `0x${string}` | null;
  const walletChainId = useChainId();
  const [deployTx, setDeployTx] = useState<`0x${string}` | null>(null);
  const [deployedToken, setDeployedToken] = useState<string | null>(null);
  const [deployedCurve, setDeployedCurve] = useState<string | null>(null);
  const [deployState, setDeployState] = useState<string>("");
  const [deployMeta, setDeployMeta] = useState<{ hash: string; metadataURI: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ensureSession = useSiweSignIn();
  const persistProfile = useServerFn(saveTokenProfile);

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

  /**
   * Saves the deployment to the database. Never throws: an on-chain deploy is
   * final, so a failed save only degrades to a retryable warning state.
   */
  async function saveDeployment(
    tokenAddress: string,
    curveAddress: string | null,
    hash: string,
    metadataURI: string,
  ) {
    setSaveError(null);
    setSaving(true);
    try {
      setDeployState("Saving the token profile…");
      const socials = Object.fromEntries(
        SOCIAL_FIELDS.map((f) => [f.key, (form as unknown as Record<string, string>)[f.key] || null]),
      );
      const account = await ensureSession(); // creates the SIWE session if missing
      // Saved with the service role: RLS on `tokens` can never drop the logo,
      // banner or the social links of a token that is already deployed.
      const data = await persistProfile({
        data: {
          address: tokenAddress,
          name: form.name,
          ticker: form.ticker.toUpperCase(),
          description: form.description || null,
          logo_url: form.logo_url || null,
          banner_url: form.banner_url || null,
          category: form.category,
          supply: Number(form.supply),
          decimals: Number(form.decimals),
          chain_id: chainId,
          deploy_tx_hash: hash,
          curve_address: curveAddress,
          target_bnb: Number(form.target_bnb),
          ...socials,
        },
      });
      // Activity feed is cosmetic: never fail the save because of it.
      try {
        await supabase.from("activity").insert({
          user_id: account.id,
          token_id: data.id,
          kind: "deploy",
          payload: {
            token_address: tokenAddress,
            curve_address: curveAddress,
            factory_address: factory,
            tx_hash: hash,
            chain_id: chainId,
            metadata_uri: metadataURI,
          },
        });
        if (adv.enabled) {
          await supabase.from("activity").insert({
            user_id: account.id,
            token_id: data.id,
            kind: "advanced_tokenomics",
            payload: {
              lp_pct: adv.lp_pct,
              burn_pct: adv.burn_pct,
              staking_pct: adv.staking_pct,
              reward_pct: adv.reward_pct,
              staking_wallet: adv.staking_wallet || null,
              reward_wallet: adv.reward_wallet || null,
              // Allocations stay reserved on the curve; they are only sent to
              // these wallets after the bonding curve graduates.
              distribution_status: "pending_graduation",
              payment_tx: adv.paid_tx,
              payment_wallet: cfg?.admin_wallet ?? null,
              payment_amount_wei: cfg?.advanced_creation_fee_bnb ?? null,
            },
          });
        }
      } catch (activityErr) {
        console.warn("[create] activity log skipped", activityErr);
      }
      setDeployState("Deployed and saved");
      // Refresh the launchpad listings so the new token shows up immediately.
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      queryClient.invalidateQueries({ queryKey: ["landing-stats"] });
      return true;
    } catch (saveErr) {
      console.error(saveErr);
      setSaveError((saveErr as Error).message);
      setDeployState("Deployed on-chain (the profile could not be saved)");
      toast.warning("El token está desplegado on-chain, pero no se pudo guardar el perfil.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function deploy() {
    // SIWE/session only authenticates + enables saving metadata. It never replaces the tx.
    if (!isConnected || !address) { toast.error("Connect your wallet first"); return; }
    if (adv.enabled && !adv.paid_tx) { toast.error("Pay the advanced tokenomics unlock first"); return; }
    if (adv.enabled) {
      const total = adv.lp_pct + adv.burn_pct + adv.staking_pct + adv.reward_pct;
      if (total !== 100) { toast.error(`Advanced % must sum to 100 (current: ${total})`); return; }
      if (adv.staking_pct > 0 && !EVM_ADDRESS.test(adv.staking_wallet.trim())) {
        toast.error("Staking wallet: introduce una dirección BNB (EVM) válida."); return;
      }
      if (adv.reward_pct > 0 && !EVM_ADDRESS.test(adv.reward_wallet.trim())) {
        toast.error("Reward wallet: introduce una dirección BNB (EVM) válida."); return;
      }
    }

    if (!factory) { toast.error("Factory address not configured"); return; }
    setSubmitting(true);
    setDeployTx(null);
    setDeployedToken(null);
    setDeployedCurve(null);
    try {
      // 1) Make sure the wallet is on BNB Smart Chain Testnet (97) before signing.
      await ensureChain(chainId, walletChainId, switchChainAsync);

      // 2) Simulate then send the real createToken() transaction.
      const rawUri = (form.metadata_uri || form.logo_url || form.website || "").trim();
      // The factory stores the URI verbatim: normalise "labs.com" -> "https://labs.com"
      // and reject anything that is not a valid ipfs:// or http(s):// resource.
      const metadataURI = rawUri
        ? /^(ipfs|https?):\/\//i.test(rawUri)
          ? rawUri
          : /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(rawUri)
            ? `https://${rawUri}`
            : ""
        : "";
      if (rawUri && !metadataURI) {
        throw new Error(`Invalid metadata URI "${rawUri}". Use ipfs://… or https://…`);
      }
      const args = [form.name, form.ticker.toUpperCase(), metadataURI] as const;
      setDeployState("Checking the transaction with the factory…");
      console.info("[labsbnb] createToken preflight", {
        chainId,
        walletChainId,
        factory,
        rpc: publicClient?.transport?.url ?? "fallback(multi-rpc)",
        args,
      });
      try {
        await publicClient!.simulateContract({
          account: address,
          address: factory,
          abi: FACTORY_ABI as Abi,
          functionName: "createToken",
          args: args as unknown as unknown[],
        });
        const gas = await publicClient!
          .estimateContractGas({
            account: address,
            address: factory,
            abi: FACTORY_ABI as Abi,
            functionName: "createToken",
            args: args as unknown as unknown[],
          })
          .catch(() => null);
        console.info("[labsbnb] createToken simulate OK", { gas: gas ? String(gas) : "n/a" });
      } catch (e) {
        const err = e as { shortMessage?: string; details?: string; message?: string };
        const reason = err.shortMessage || err.details || err.message || "unknown revert";
        console.error("[labsbnb] createToken simulate FAILED", { factory, chainId, reason });
        throw new Error(`Factory simulation failed: ${reason}`);
      }

      setDeployState("Confirm the transaction in your wallet (gas in tBNB)…");
      const hash = await writeContractAsync({
        address: factory,
        abi: FACTORY_ABI as Abi,
        functionName: "createToken",
        args: args as unknown as unknown[],
      });
      setDeployTx(hash);
      setDeployState("Waiting for confirmation on BNB Testnet…");

      // 3) Wait for the receipt and read the TokenCreated event.
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      console.info("[labsbnb] createToken receipt", {
        hash,
        status: receipt.status,
        gasUsed: String(receipt.gasUsed),
        block: String(receipt.blockNumber),
      });
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
      setDeployedCurve(curveAddress);
      setDeployState("Deployed on-chain");
      toast.success("Token deployed on BNB Testnet");
      // The Factory list is the source of truth: refresh it even if the DB save fails.
      queryClient.invalidateQueries({ queryKey: ["tokens", "onchain"] });


      // 4) Persist the on-chain result (best effort — never hides a successful deploy).
      setDeployMeta({ hash, metadataURI });
      await saveDeployment(tokenAddress, curveAddress, hash, metadataURI);

    } catch (e) {
      console.error(e);
      setDeployState("Failed");
      toast.error(describeTxError(e));
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
              <Field label={t("create.logo")}><FileUploader value={form.logo_url} onChange={(url) => set("logo_url", url)} kind="logo" /></Field>
              <Field label={t("create.banner")}><FileUploader value={form.banner_url} onChange={(url) => set("banner_url", url)} kind="banner" /></Field>
              <Field label="Metadata URI" full>
                <Input
                  value={form.metadata_uri}
                  onChange={(e) => set("metadata_uri", e.target.value)}
                  placeholder="ipfs://… or https://… (optional — defaults to your logo URL)"
                  className="font-mono text-xs"
                />
              </Field>
              {SOCIAL_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Input value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
                </Field>
              ))}
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
                  Factory: <span className="font-mono text-accent">{factory ?? "not configured"}</span> · BNB Testnet · Chain ID <span className="font-mono">{chainId}</span>
                </div>
                <div>Gas is paid in <span className="text-accent">tBNB</span>.</div>
              </div>
              {(deployTx || deployState) && (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-xs space-y-1">
                  <div className="text-accent">{deployState || "…"}</div>
                  {deployTx && (
                    <div>
                      <span className="text-muted-foreground">Tx: </span>
                      <a
                        className="font-mono underline break-all"
                        href={`https://testnet.bscscan.com/tx/${deployTx}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {deployTx}
                      </a>
                    </div>
                  )}
                  {deployedToken && (
                    <div>
                      <span className="text-muted-foreground">Token: </span>
                      <a
                        className="font-mono underline break-all"
                        href={`https://testnet.bscscan.com/address/${deployedToken}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {deployedToken}
                      </a>
                    </div>
                  )}
                  {deployedCurve && (
                    <div>
                      <span className="text-muted-foreground">Bonding curve: </span>
                      <a
                        className="font-mono underline break-all"
                        href={`https://testnet.bscscan.com/address/${deployedCurve}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {deployedCurve}
                      </a>
                    </div>
                  )}
                  {saveError && deployedToken && (
                    <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                      <div className="text-destructive">
                        El despliegue on-chain fue correcto, pero no se pudo guardar el perfil: {saveError}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() =>
                          deployMeta &&
                          saveDeployment(deployedToken, deployedCurve, deployMeta.hash, deployMeta.metadataURI)
                        }
                      >
                        {saving ? "Guardando…" : "Reintentar guardado"}
                      </Button>
                    </div>
                  )}
                  {deployedToken && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => navigate({ to: "/token/$address", params: { address: deployedToken } })}
                    >
                      Open token page
                    </Button>
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
  // Keep the fee as wei (bigint) end-to-end: converting through a float first
  // loses precision and can hand the wallet a bogus `value`.
  const feeWeiBig = useMemo(() => {
    try { return BigInt(feeWei || "0"); } catch { return 0n; }
  }, [feeWei]);
  const feeBnb = useMemo(() => Number(feeWeiBig) / 1e18, [feeWeiBig]);
  const total = adv.lp_pct + adv.burn_pct + adv.staking_pct + adv.reward_pct;
  const { sendTransactionAsync, isPending } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const walletChainId = useChainId();
  const { address, connector } = useAccount();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID });
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // The service is only unlocked once the receipt confirms on-chain.
  useEffect(() => {
    if (isSuccess && txHash) {
      setAdv((a) => (a.paid_tx === txHash ? a : { ...a, paid_tx: txHash }));
      toast.success("Pago confirmado on-chain. Advanced tokenomics desbloqueado.");
    }
  }, [isSuccess, txHash, setAdv]);

  /**
   * Connect → check chain → check balance → estimate gas → send → receipt.
   * Nothing is unlocked before the receipt confirms (see the effect above).
   */
  async function pay() {
    const ctx = {
      action: "advanced-tokenomics-unlock",
      chainId: ACTIVE_CHAIN_ID,
      walletChainId,
      account: address,
      to: adminWallet,
      value: feeWeiBig,
      connector: connector?.name,
      rpcUrl: BSC_TESTNET_RPC,
    };
    setBusy(true);
    try {
      if (!address) throw new Error("Conecta la wallet antes de pagar.");
      if (feeWeiBig <= 0n) throw new Error("La comisión configurada es 0. Revísala en el panel de admin.");

      // 1) Network — re-read from the connector itself, not from wagmi's cache.
      await ensureChain(ACTIVE_CHAIN_ID, walletChainId, switchChainAsync, () => connector?.getChainId());
      const live = await connector?.getChainId();
      if (live !== undefined && live !== ACTIVE_CHAIN_ID) {
        throw new Error(
          `Tu wallet sigue en chain ${live}. Cambia manualmente a BNB Smart Chain Testnet (97) y reintenta.`,
        );
      }

      // 2) Balance must cover value + gas.
      let gas: bigint | undefined;
      if (publicClient) {
        const balance = await publicClient.getBalance({ address });
        gas = await publicClient.estimateGas({ account: address, to: adminWallet, value: feeWeiBig });
        const gasPrice = await publicClient.getGasPrice();
        const cost = feeWeiBig + gas * gasPrice;
        if (balance < cost) {
          throw new Error(
            `Insufficient tBNB for payment + gas (tienes ${(Number(balance) / 1e18).toFixed(5)} tBNB, ` +
              `necesitas ~${(Number(cost) / 1e18).toFixed(5)} tBNB).`,
          );
        }
      }

      // 3) Send. `gas` comes from the real estimate (+25% headroom), never an
      //    arbitrary large limit; Trust Wallet rejects transactions with no gas
      //    field on some WalletConnect sessions.
      const hash = await sendTransactionAsync({
        to: adminWallet,
        value: feeWeiBig,
        ...(gas ? { gas: (gas * 125n) / 100n } : {}),
      });
      setTxHash(hash);
      toast.success("Pago enviado, esperando confirmación…");
    } catch (e) {
      toast.error(describeTxErrorVerbose(e, ctx), { duration: 12_000 });
    } finally {
      setBusy(false);
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

          <div className="grid gap-3 md:grid-cols-2">
            {([
              ["staking_wallet", "Staking wallet", adv.staking_pct] as const,
              ["reward_wallet", "Reward wallet", adv.reward_pct] as const,
            ]).map(([key, label, pct]) => {
              const value = adv[key];
              const invalid = pct > 0 && value.trim() !== "" && !EVM_ADDRESS.test(value.trim());
              return (
                <div key={key}>
                  <Label className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5 block">
                    {label} · {pct}%
                  </Label>
                  <Input
                    placeholder="0x…"
                    spellCheck={false}
                    value={value}
                    disabled={!paid || pct === 0}
                    onChange={(e) => setAdv((a) => ({ ...a, [key]: e.target.value.trim() }))}
                    className={invalid ? "border-destructive" : ""}
                  />
                  <p className={`mt-1 text-[11px] ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
                    {invalid
                      ? "Dirección EVM inválida (0x + 40 caracteres hex)."
                      : key === "staking_wallet"
                        ? "Recibirá la asignación destinada a Staking."
                        : "Recibirá la asignación destinada a Rewards."}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-accent/25 bg-accent/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-accent">Cuándo se envían los tokens:</span> durante la bonding curve
            las asignaciones de Staking y Reward quedan <span className="font-mono">reservadas</span> y solo se
            muestran como porcentaje. La distribución a estas wallets se ejecuta al graduar la curva (migración a
            PancakeSwap). El contrato <span className="font-mono">BondingCurve</span> desplegado no expone todavía
            una función de distribución post-graduación, por lo que el estado quedará como{" "}
            <span className="font-mono">pending_graduation</span> hasta redeployar el contrato con ese método.
          </div>

        </div>
      )}
    </div>
  );
}

/**
 * Downscales the picture in the browser (phone cameras easily produce 6-12 MB
 * files, which used to fail silently on Android/iOS) and re-encodes it to a
 * format every browser can display, then uploads it through the server.
 */
async function prepareImage(file: File): Promise<{ contentType: string; base64: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("No pudimos leer la imagen. Usa PNG, JPG o WEBP.");
  const MAX = 1024;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible en este navegador.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, type, 0.9));
  if (!blob) throw new Error("No pudimos procesar la imagen.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { contentType: type, base64: btoa(bin) };
}

function FileUploader({ value, onChange, kind }: { value?: string; onChange: (url: string) => void; kind: "logo" | "banner" }) {
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(uploadTokenMedia);
  const ensureSession = useSiweSignIn();
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await ensureSession();
      const { contentType, base64 } = await prepareImage(file);
      const res = await upload({ data: { kind, contentType, data: base64 } });
      onChange(res.url);
      toast.success("Imagen subida");
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); e.target.value = ""; }
  }
  return (
    <div className="space-y-2">
      <Input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" disabled={busy} onChange={onFile} />
      {busy && <p className="text-xs text-muted-foreground">Subiendo…</p>}
      {value && <img src={value} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover border border-white/10" />}
    </div>
  );
}
