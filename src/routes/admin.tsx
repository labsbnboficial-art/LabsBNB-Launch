import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/labsbnb/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { Shield, Lock, KeyRound, LogOut, ScrollText, Settings2, Rocket, Wallet } from "lucide-react";
import { AdminBoostTab } from "@/components/labsbnb/AdminBoostTab";
import { AdminFeesTab } from "@/components/labsbnb/AdminFeesTab";
import {
  adminAuthStatus,
  adminBootstrap,
  adminLogin,
  adminProvision,
  adminLogout,
  adminVerifyPinStep,
  adminVerifyTotpStep,
  adminUpdateCredentials,
  adminStartTotp,
  adminSetTotpEnabled,
  adminRequestPasswordReset,
  adminResetPassword,
  adminAuditLog,
} from "@/lib/admin-account.functions";
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="glass-strong rounded-3xl p-8">{children}</div>
    </div>
  );
}

function AdminPage() {
  const status = useServerFn(adminAuthStatus);
  const q = useQuery({ queryKey: ["admin-auth-status"], queryFn: () => status(), retry: false });
  const [loggedInOnce, setLoggedInOnce] = useState(false);
  const resetToken = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("reset");
  }, []);

  const refresh = async () => {
    setLoggedInOnce(true);
    await q.refetch();
  };

  if (q.isLoading) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;

  if (q.error) {
    return (
      <AppShell>
        <Card>
          <div className="text-center">
            <Shield className="mx-auto h-8 w-8 text-destructive" />
            <h1 className="mt-3 font-display text-xl font-bold">Admin backend no disponible</h1>
            <p className="mt-2 break-words text-sm text-muted-foreground">{(q.error as Error).message || "No se pudo contactar con el backend de admin. Revisa el secreto LABSBNB_SERVICE_ROLE_KEY y que el SQL de docs/SQL_ADMIN_AUTH.md esté aplicado."}</p>
            <Button variant="outline" className="mt-4" onClick={() => q.refetch()}>Reintentar</Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  const d = q.data!;
  if (resetToken) return <AppShell><ResetPassword token={resetToken} onDone={() => q.refetch()} /></AppShell>;
  if (d.backendError) {
    return (
      <AppShell>
        <Card>
          <div className="text-center">
            <Shield className="mx-auto h-8 w-8 text-destructive" />
            <h1 className="mt-3 font-display text-xl font-bold">Admin backend no disponible</h1>
            <p className="mt-2 break-words text-sm text-muted-foreground">{d.backendError}</p>
            <Button variant="outline" className="mt-4" onClick={() => q.refetch()}>Reintentar</Button>
          </div>
        </Card>
      </AppShell>
    );
  }
  if (d.setupRequired) {
    return (
      <AppShell>
        <Card>
          <div className="text-center">
            <Shield className="mx-auto h-8 w-8 text-accent" />
            <h1 className="mt-3 font-display text-xl font-bold">Falta aplicar el SQL de admin</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ejecuta <code className="font-mono">docs/SQL_ADMIN_AUTH.md</code> en el editor SQL de Supabase y recarga.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => q.refetch()}>Reintentar</Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  // A successful login that does not produce a stage means the session was not
  // readable on the next request: show the real cause instead of the login form.
  if (loggedInOnce && !d.stage) {
    return (
      <AppShell>
        <Card>
          <div className="text-center">
            <Shield className="mx-auto h-8 w-8 text-destructive" />
            <h1 className="mt-3 font-display text-xl font-bold">La sesión de admin no se pudo leer</h1>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {d.sessionError
                ? d.sessionError
                : d.cookiePresent
                  ? "La cookie llegó al servidor pero la sesión fue revocada, caducó o la tabla admin_sessions bloquea la lectura (revisa RLS/GRANTs de admin_sessions y admin_accounts)."
                  : "El navegador no devolvió la cookie de sesión. Suele ocurrir dentro del iframe de vista previa: abre el panel en una pestaña nueva."}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={() => q.refetch()}>Reintentar</Button>
              <Button
                className="brand-gradient text-primary-foreground"
                onClick={() => window.open(`${window.location.origin}/admin`, "_blank", "noopener")}
              >
                Abrir en pestaña nueva
              </Button>
            </div>
            <Button variant="ghost" className="mt-2 w-full text-xs" onClick={() => setLoggedInOnce(false)}>
              Volver al inicio de sesión
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  if (d.needsBootstrap) return <AppShell><Bootstrap onDone={refresh} /></AppShell>;
  if (!d.stage) return <AppShell><LoginForm emailConfigured={d.emailConfigured} onDone={refresh} /></AppShell>;
  if (d.stage === "totp") return <AppShell><TotpStep onDone={refresh} /></AppShell>;
  if (d.stage !== "full") return <AppShell><PinStep onDone={refresh} /></AppShell>;



  return (
    <AppShell>
      <AdminBody
        csrf={d.csrf!}
        username={d.username!}
        email={d.email!}
        totpEnabled={d.totpEnabled}
        onSignedOut={() => q.refetch()}
      />
    </AppShell>
  );
}

/* --------------------------------- screens -------------------------------- */

function Bootstrap({ onDone }: { onDone: () => void }) {

  const fn = useServerFn(adminBootstrap);
  const [v, setV] = useState({ username: "", email: "", password: "", pin: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <div className="text-center">
        <KeyRound className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-3 font-display text-xl font-bold">Crear cuenta de administrador</h1>
        <p className="mt-2 text-sm text-muted-foreground">Primera ejecución: define tus credenciales del panel.</p>
      </div>
      <div className="mt-6 space-y-4">
        <Field label="Usuario" value={v.username} onChange={(x) => setV({ ...v, username: x })} />
        <Field label="Correo" type="email" value={v.email} onChange={(x) => setV({ ...v, email: x })} />
        <Field label="Contraseña (mín. 10 caracteres)" type="password" value={v.password} onChange={(x) => setV({ ...v, password: x })} />
        <Field label="PIN (6 dígitos)" value={v.pin} onChange={(x) => setV({ ...v, pin: x.replace(/\D/g, "").slice(0, 6) })} mono />
      </div>
      <Button
        className="mt-6 w-full brand-gradient text-primary-foreground glow-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await fn({ data: v }); toast.success("Cuenta creada"); onDone(); }
          catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}
      >{busy ? "…" : "Crear cuenta"}</Button>
    </Card>
  );
}

function LoginForm({ emailConfigured, onDone }: { emailConfigured: boolean; onDone: () => void }) {
  const login = useServerFn(adminLogin);
  const reset = useServerFn(adminRequestPasswordReset);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");

  if (forgot) {
    return (
      <Card>
        <h1 className="text-center font-display text-xl font-bold">Recuperar contraseña</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {emailConfigured ? "Te enviaremos un enlace de recuperación." : "Configura RESEND_API_KEY para el envío de correos."}
        </p>
        <div className="mt-6"><Field label="Correo" type="email" value={email} onChange={setEmail} /></div>
        <Button
          className="mt-6 w-full brand-gradient text-primary-foreground"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await reset({ data: { email } });
              toast[r.delivered ? "success" : "message"](
                r.delivered ? "Enlace enviado a tu correo" : "Si el correo existe, se envió un enlace (revisa la configuración de email).",
              );
              setForgot(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}
        >{busy ? "…" : "Enviar enlace"}</Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setForgot(false)}>Volver</Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="text-center">
        <Lock className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-3 font-display text-xl font-bold">Acceso administrador</h1>
        <p className="mt-2 text-sm text-muted-foreground">Usuario o correo y contraseña.</p>
      </div>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try { await login({ data: { identifier, password } }); onDone(); }
          catch (err) {
            const msg = (err as Error).message || "No se pudo iniciar sesión.";
            setError(msg);
            toast.error(msg);
          } finally { setBusy(false); }
        }}
      >
        <Field label="Usuario o correo" value={identifier} onChange={setIdentifier} autoComplete="username" />
        <Field label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-words">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full brand-gradient text-primary-foreground glow-primary">
          {busy ? "Verificando…" : "Entrar"}
        </Button>
      </form>
      <Button variant="ghost" className="mt-2 w-full text-xs" onClick={() => setForgot(true)}>¿Olvidaste tu contraseña?</Button>
      <ProvisionForm />
    </Card>
  );
}

/**
 * Emergency access: creates a new admin (or resets an existing one) using the
 * ADMIN_SETUP_KEY master key. Also clears account locks and failed attempts.
 */
function ProvisionForm() {
  const fn = useServerFn(adminProvision);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ setupKey: "", username: "", email: "", password: "", pin: "" });

  if (!open) {
    return (
      <Button variant="ghost" className="mt-1 w-full text-xs text-muted-foreground" onClick={() => setOpen(true)}>
        Crear / restablecer administrador
      </Button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="font-display text-sm font-semibold">Crear / restablecer administrador</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Requiere la clave maestra <span className="font-mono">ADMIN_SETUP_KEY</span>. Si el usuario o el correo ya
        existen, se restablecen la contraseña y el PIN y se desbloquea la cuenta.
      </p>
      <div className="mt-4 space-y-3">
        <Field label="Clave maestra" type="password" value={v.setupKey} onChange={(x) => setV({ ...v, setupKey: x })} />
        <Field label="Usuario" value={v.username} onChange={(x) => setV({ ...v, username: x })} />
        <Field label="Correo" type="email" value={v.email} onChange={(x) => setV({ ...v, email: x })} />
        <Field label="Contraseña (mín. 10 caracteres)" type="password" value={v.password} onChange={(x) => setV({ ...v, password: x })} />
        <Field label="PIN (6 dígitos)" value={v.pin} onChange={(x) => setV({ ...v, pin: x.replace(/\D/g, "").slice(0, 6) })} mono />
      </div>
      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-words">
          {error}
        </p>
      )}
      <Button
        className="mt-4 w-full brand-gradient text-primary-foreground"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await fn({ data: v });
            toast.success(r.created ? "Administrador creado. Ya puedes iniciar sesión." : "Credenciales restablecidas. Ya puedes iniciar sesión.");
            setOpen(false);
            setV({ setupKey: "", username: "", email: "", password: "", pin: "" });
          } catch (e) {
            const msg = (e as Error).message || "No se pudo completar la operación.";
            setError(msg);
            toast.error(msg);
          } finally { setBusy(false); }
        }}
      >{busy ? "Guardando…" : "Guardar credenciales"}</Button>
      <Button variant="ghost" className="mt-2 w-full text-xs" onClick={() => setOpen(false)}>Cancelar</Button>
    </div>
  );
}

function CodeStep({ title, subtitle, label, onSubmit }: { title: string; subtitle: string; label: string; onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <div className="text-center">
        <Lock className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-3 font-display text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-6 flex justify-center">
          <Input
            inputMode="numeric"
            maxLength={6}
            aria-label={label}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-44 text-center font-mono text-2xl tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
        <Button
          className="mt-6 brand-gradient text-primary-foreground glow-primary"
          disabled={busy}
          onClick={async () => {
            if (!/^\d{6}$/.test(code)) { toast.error("Debe tener 6 dígitos"); return; }
            setBusy(true);
            try { await onSubmit(code); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}
        >{busy ? "…" : "Continuar"}</Button>
      </div>
    </Card>
  );
}

function TotpStep({ onDone }: { onDone: () => void }) {
  const fn = useServerFn(adminVerifyTotpStep);
  return (
    <CodeStep
      title="Verificación en dos pasos"
      subtitle="Introduce el código de Google Authenticator."
      label="Código 2FA"
      onSubmit={async (code) => { await fn({ data: { code } }); onDone(); }}
    />
  );
}

function PinStep({ onDone }: { onDone: () => void }) {
  const fn = useServerFn(adminVerifyPinStep);
  return (
    <CodeStep
      title="PIN de administrador"
      subtitle="Segundo factor obligatorio de 6 dígitos."
      label="PIN"
      onSubmit={async (pin) => { await fn({ data: { pin } }); onDone(); }}
    />
  );
}

function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const fn = useServerFn(adminResetPassword);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <h1 className="text-center font-display text-xl font-bold">Nueva contraseña</h1>
      <div className="mt-6 space-y-4">
        <Field label="Contraseña nueva (mín. 10)" type="password" value={password} onChange={setPassword} />
        <Field label="PIN nuevo (6 dígitos)" value={pin} onChange={(x) => setPin(x.replace(/\D/g, "").slice(0, 6))} mono />
      </div>
      <Button
        className="mt-6 w-full brand-gradient text-primary-foreground"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await fn({ data: { token, password, pin } });
            toast.success("Contraseña actualizada");
            window.location.replace("/admin");
            onDone();
          } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}
      >{busy ? "…" : "Guardar"}</Button>
    </Card>
  );
}

function Field({
  label, value, onChange, type = "text", mono, autoComplete,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean; autoComplete?: string }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono" : ""}
      />
    </div>
  );
}

/* ---------------------------------- panel --------------------------------- */

function AdminBody({
  csrf, username, email, totpEnabled, onSignedOut,
}: { csrf: string; username: string; email: string; totpEnabled: boolean; onSignedOut: () => void }) {
  const { t } = useI18n();
  const loadCfg = useServerFn(getAdminConfig);
  const logout = useServerFn(adminLogout);
  const cfgQ = useQuery({ queryKey: ["admin-config"], queryFn: () => loadCfg({ data: { csrf } }) });

  if (cfgQ.isLoading) {
    return <div className="p-12 text-center text-muted-foreground">Cargando configuración…</div>;
  }

  if (cfgQ.error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="glass-strong rounded-3xl p-8">
          <Shield className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 font-display text-xl font-bold">No se pudo cargar el panel</h1>
          <p className="mt-2 break-words text-sm text-muted-foreground">{(cfgQ.error as Error).message}</p>
          <Button variant="outline" className="mt-4" onClick={() => cfgQ.refetch()}>Reintentar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
          <Shield className="h-5 w-5 text-primary-foreground" />
        </div>
        <h1 className="font-display text-3xl font-bold">{t("admin.title")}</h1>
        <span className="ml-auto text-sm text-muted-foreground">{username}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => { await logout(); onSignedOut(); }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Salir
        </Button>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config"><Settings2 className="mr-2 h-4 w-4" />Configuración</TabsTrigger>
          <TabsTrigger value="fees"><Wallet className="mr-2 h-4 w-4" />Fees</TabsTrigger>
          <TabsTrigger value="boost"><Rocket className="mr-2 h-4 w-4" />🚀 Impulso</TabsTrigger>
          <TabsTrigger value="telegram"><Send className="mr-2 h-4 w-4" />Telegram Signals</TabsTrigger>
          <TabsTrigger value="account"><KeyRound className="mr-2 h-4 w-4" />Cuenta y seguridad</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="mr-2 h-4 w-4" />Auditoría</TabsTrigger>
        </TabsList>
        <TabsContent value="config" className="mt-6">
          <ConfigEditor csrf={csrf} cfg={cfgQ.data ?? {}} onSaved={() => cfgQ.refetch()} />
        </TabsContent>
        <TabsContent value="fees" className="mt-6">
          <AdminFeesTab csrf={csrf} cfg={cfgQ.data ?? {}} onSaved={() => cfgQ.refetch()} />
        </TabsContent>
        <TabsContent value="boost" className="mt-6">
          <AdminBoostTab csrf={csrf} />
        </TabsContent>
        <TabsContent value="telegram" className="mt-6">
          <AdminTelegramTab csrf={csrf} />
        </TabsContent>

        <TabsContent value="account" className="mt-6">
          <AccountSettings csrf={csrf} username={username} email={email} totpEnabled={totpEnabled} onChanged={onSignedOut} />
        </TabsContent>
        <TabsContent value="audit" className="mt-6">
          <AuditLog csrf={csrf} />
        </TabsContent>
      </Tabs>

    </div>
  );
}

function AccountSettings({
  csrf, username, email, totpEnabled, onChanged,
}: { csrf: string; username: string; email: string; totpEnabled: boolean; onChanged: () => void }) {
  const update = useServerFn(adminUpdateCredentials);
  const startTotp = useServerFn(adminStartTotp);
  const setTotp = useServerFn(adminSetTotpEnabled);
  const [v, setV] = useState({ currentPassword: "", username, email, newPassword: "", newPin: "" });
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");

  return (
    <div className="space-y-6">
      <div className="glass-strong rounded-3xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Cambiar usuario, contraseña y PIN</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Contraseña actual" type="password" value={v.currentPassword} onChange={(x) => setV({ ...v, currentPassword: x })} />
          <div />
          <Field label="Usuario" value={v.username} onChange={(x) => setV({ ...v, username: x })} />
          <Field label="Correo" type="email" value={v.email} onChange={(x) => setV({ ...v, email: x })} />
          <Field label="Nueva contraseña (opcional)" type="password" value={v.newPassword} onChange={(x) => setV({ ...v, newPassword: x })} />
          <Field label="Nuevo PIN (opcional)" value={v.newPin} onChange={(x) => setV({ ...v, newPin: x.replace(/\D/g, "").slice(0, 6) })} mono />
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            disabled={busy}
            className="brand-gradient text-primary-foreground"
            onClick={async () => {
              setBusy(true);
              try {
                const r = await update({
                  data: {
                    csrf,
                    currentPassword: v.currentPassword,
                    username: v.username !== username ? v.username : undefined,
                    email: v.email !== email ? v.email : undefined,
                    newPassword: v.newPassword || undefined,
                    newPin: v.newPin || undefined,
                  },
                });
                toast.success(r.signedOut ? "Actualizado. Vuelve a iniciar sesión." : "Actualizado");
                onChanged();
              } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
            }}
          >{busy ? "…" : "Guardar cambios"}</Button>
        </div>
      </div>

      <div className="glass-strong rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Autenticación en dos pasos (Google Authenticator)</h2>
            <p className="text-sm text-muted-foreground">{totpEnabled ? "Activada" : "Desactivada"}</p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              try { setSecret(await startTotp({ data: { csrf } })); }
              catch (e) { toast.error((e as Error).message); }
            }}
          >{totpEnabled ? "Regenerar secreto" : "Generar secreto"}</Button>
        </div>
        {secret && (
          <div className="mt-4 space-y-3">
            <p className="break-all font-mono text-xs text-muted-foreground">{secret.secret}</p>
            <p className="break-all text-[11px] text-muted-foreground">{secret.uri}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Código actual" value={code} onChange={(x) => setCode(x.replace(/\D/g, "").slice(0, 6))} mono />
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const r = await setTotp({ data: { csrf, enabled: !totpEnabled, code } });
                toast.success(r.enabled ? "2FA activada" : "2FA desactivada");
                onChanged();
              } catch (e) { toast.error((e as Error).message); }
            }}
          >{totpEnabled ? "Desactivar 2FA" : "Activar 2FA"}</Button>
        </div>
      </div>
    </div>
  );
}

function AuditLog({ csrf }: { csrf: string }) {
  const fn = useServerFn(adminAuditLog);
  const q = useQuery({ queryKey: ["admin-audit"], queryFn: () => fn({ data: { csrf } }) });
  return (
    <div className="glass-strong overflow-x-auto rounded-3xl p-6">
      <h2 className="mb-4 font-display text-lg font-semibold">Registro de auditoría</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-widest text-muted-foreground">
          <tr><th className="py-2">Fecha</th><th>Acción</th><th>IP</th><th>Navegador</th></tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((r) => (
            <tr key={r.id} className="border-t border-white/5">
              <td className="py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
              <td className="font-mono text-xs">{r.action}</td>
              <td className="font-mono text-xs">{r.ip}</td>
              <td className="max-w-[220px] truncate text-xs text-muted-foreground">{r.user_agent}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data && q.data.length === 0 && <p className="text-sm text-muted-foreground">Sin eventos todavía.</p>}
    </div>
  );
}

/* --------------------------------- config --------------------------------- */

type FieldSpec = {
  key: string;
  label: string;
  type?: "text" | "number" | "bool";
  help?: string;
  mono?: boolean;
  /** Value hardcoded in the smart contract: editable only with a new deploy. */
  locked?: string;
  /** Display-only value shown when locked. */
  fixed?: string;
};

const CONTRACT_FIELDS: FieldSpec[] = [
  { key: "factory_address", label: "Factory address", mono: true, help: "LabsBNBFactory desplegado en BNB Chain." },
  { key: "chain_id", label: "Chain ID", type: "number", help: "56 = BSC Mainnet, 97 = BSC Testnet" },
  { key: "rpc_url", label: "RPC URL", mono: true },
];

const FEE_FIELDS: FieldSpec[] = [
  { key: "fee_wallet", label: "Fee wallet (referencia UI — la real vive en el Factory)", mono: true },
  { key: "creation_fee_bnb", label: "Creation fee (wei BNB)", mono: true, help: "Cobro off-chain en el formulario de creación." },
  { key: "buy_fee_bps", label: "Buy fee (bps)", type: "number", locked: "El contrato usa un único feeBps del Factory. Edítalo en la pestaña Fees.", fixed: "Factory.feeBps" },
  { key: "sell_fee_bps", label: "Sell fee (bps)", type: "number", locked: "El contrato usa un único feeBps del Factory. Edítalo en la pestaña Fees.", fixed: "Factory.feeBps" },
  { key: "fee_bps", label: "Protocol fee (bps)", type: "number", locked: "Se aplica on-chain: cámbialo con setFee() en la pestaña Fees.", fixed: "Factory.feeBps" },
];

const CURVE_FIELDS: FieldSpec[] = [
  { key: "curve_target_bnb", label: "Bonding curve goal / Migration threshold", locked: "MIGRATION_THRESHOLD es una constante de BondingCurve.sol.", fixed: "24 BNB" },
  { key: "virtual_liquidity", label: "Virtual liquidity", locked: "VIRTUAL_BNB / VIRTUAL_TOKENS son constantes del contrato.", fixed: "1.6 BNB · 800.000.000 tokens" },
  { key: "graduation_threshold", label: "Graduation threshold", locked: "Se alcanza cuando bnbCollected ≥ MIGRATION_THRESHOLD.", fixed: "24 BNB" },
  { key: "lp_allocation", label: "LP allocation", locked: "LP_ALLOC es una constante del contrato.", fixed: "200.000.000 tokens (20%)" },
  { key: "burn_allocation", label: "Burn allocation", locked: "La curva no quema supply en la migración.", fixed: "0%" },
  { key: "creator_fee", label: "Creator fee", locked: "CREATOR_FEE_BPS es una constante del contrato.", fixed: "0,20%" },
  { key: "referral_fee", label: "Referral fee", locked: "REFERRAL_FEE_BPS es una constante del contrato.", fixed: "0,10%" },
  { key: "trading_fee", label: "Trading fee (protocolo)", locked: "Editable on-chain con Factory.setFee() desde la pestaña Fees.", fixed: "Factory.feeBps" },
];

const ADVANCED_FIELDS: FieldSpec[] = [
  { key: "advanced_creation_fee_bnb", label: "Advanced tokenomics unlock fee (wei BNB)", mono: true, help: "Users pay this amount in BNB to the admin wallet to unlock custom % LP / Burn / Staking / Reward when creating a token." },
];

const MISSIONS_FIELDS: FieldSpec[] = [
  { key: "missions_enabled", label: "Labs Missions activado", type: "bool" },
  { key: "campaign_fee_bnb", label: "Comisión por crear campaña (wei BNB)", mono: true, help: "Se paga en BNB a la wallet admin antes de activar la campaña." },
  { key: "campaign_min_reward", label: "Recompensa mínima por tarea", type: "number" },
  { key: "campaign_max_reward", label: "Recompensa máxima por tarea", type: "number" },
  { key: "campaign_max_participants", label: "Máx. participantes por campaña", type: "number" },
  { key: "campaign_review_mode", label: "Modo de revisión (auto | manual | manual_all)" },
  { key: "missions_socials_allowed", label: "Redes permitidas (csv)" },
  { key: "missions_task_types", label: "Tipos de tarea habilitados (csv)", mono: true },
  { key: "antifraud_one_per_wallet", label: "Antifraude: 1 participación por wallet", type: "bool" },
  { key: "antifraud_min_account_age_h", label: "Antifraude: antigüedad mínima de cuenta (h)", type: "number" },
  { key: "xp_contributor_min", label: "XP para Contributor", type: "number" },
  { key: "xp_ambassador_min", label: "XP para Ambassador", type: "number" },
  { key: "xp_elite_min", label: "XP para Elite", type: "number" },
  { key: "xp_legend_min", label: "XP para Legend", type: "number" },
  { key: "level_fee_discount_bps", label: "Descuento de comisión por nivel (bps, csv)" },
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

const ALL_FIELDS = [
  ...CONTRACT_FIELDS, ...FEE_FIELDS, ...CURVE_FIELDS, ...ADVANCED_FIELDS,
  ...MISSIONS_FIELDS, ...ADMIN_FIELDS, ...ANTIBOT_FIELDS,
];

function ConfigEditor({ csrf, cfg, onSaved }: { csrf: string; cfg: Record<string, unknown>; onSaved: () => void }) {
  const { t } = useI18n();
  const saveFn = useServerFn(saveAdminConfig);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const v: Record<string, string> = {};
    for (const f of ALL_FIELDS) {
      const raw = cfg[f.key];
      v[f.key] = raw == null ? "" : typeof raw === "string" ? raw : String(raw);
    }
    setValues(v);
  }, [cfg]);

  async function save() {
    setBusy(true);
    try {
      const entries = ALL_FIELDS.filter((f) => !f.locked).map((f) => {
        let value: number | string | boolean | null = values[f.key];
        if (f.type === "bool") value = values[f.key] === "true";
        else if (value === "" || value == null) value = null;
        else if (f.type === "number") {
          value = Number(value);
          if (!Number.isFinite(value)) throw new Error(`${f.label}: introduce un número válido.`);
        }
        return { key: f.key, value, is_public: true };
      });
      await saveFn({ data: { csrf, entries } });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <Section title="Smart contract" fields={CONTRACT_FIELDS} values={values} setValues={setValues} />
      <Section title="Labs Missions" fields={MISSIONS_FIELDS} values={values} setValues={setValues} />
      <Section title="Fees (off-chain / interfaz)" fields={FEE_FIELDS} values={values} setValues={setValues} />
      <Section
        title="Bonding curve & tokenomics (parámetros del contrato)"
        fields={CURVE_FIELDS}
        values={values}
        setValues={setValues}
      />
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
            ) : f.locked ? (
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <span className="font-mono text-sm text-muted-foreground">{f.fixed ?? values[f.key] ?? "—"}</span>
                <span className="ml-auto rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
                  Constante del contrato
                </span>
              </div>
            ) : (
              <Input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={f.mono ? "font-mono" : ""}
              />
            )}
            {(f.help || f.locked) && <p className="mt-1 text-[11px] text-muted-foreground">{f.help ?? f.locked}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
