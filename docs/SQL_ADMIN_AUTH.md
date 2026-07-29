# SQL — Autenticación del panel de admin (usuario + contraseña + PIN)

Aplícalo una sola vez en el **SQL editor** de Supabase. Sustituye por completo el
acceso por firma de wallet (SIWE) del panel `/admin`.

```sql
-- 1) Cuentas de administrador -------------------------------------------------
create table if not exists public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text not null unique,
  password_hash text not null,          -- bcrypt
  pin_hash text,                        -- bcrypt (PIN de 6 dígitos)
  totp_secret text,                     -- base32, solo si 2FA está configurada
  totp_enabled boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  reset_token_hash text,
  reset_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Sesiones ------------------------------------------------------------------
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_accounts(id) on delete cascade,
  token_hash text not null unique,      -- sha256 del token de cookie httpOnly
  csrf_token text not null,
  stage text not null default 'password', -- password | totp | full
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists admin_sessions_admin_idx on public.admin_sessions (admin_id, revoked_at);

-- 3) Auditoría -----------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_accounts(id) on delete set null,
  action text not null,
  ip text,
  user_agent text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_time_idx on public.admin_audit_log (created_at desc);

-- 4) Intentos de inicio de sesión (rate limiting / bloqueo temporal) -----------
create table if not exists public.admin_login_attempts (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  ip text,
  user_agent text,
  success boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_attempts_idx
  on public.admin_login_attempts (identifier, ip, created_at desc);

-- 5) Sin acceso público: solo el service_role del servidor puede leer/escribir --
alter table public.admin_accounts       enable row level security;
alter table public.admin_sessions       enable row level security;
alter table public.admin_audit_log      enable row level security;
alter table public.admin_login_attempts enable row level security;

revoke all on public.admin_accounts, public.admin_sessions,
              public.admin_audit_log, public.admin_login_attempts
  from anon, authenticated;

grant all on public.admin_accounts       to service_role;
grant all on public.admin_sessions       to service_role;
grant all on public.admin_audit_log      to service_role;
grant all on public.admin_login_attempts to service_role;

-- 6) Dirección del Factory desplegado -------------------------------------------
insert into public.admin_config (key, value, is_public) values
  ('factory_address', to_jsonb('0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9'::text), true)
on conflict (key) do update set value = excluded.value, is_public = true;
```

Después de aplicarlo, abre `/admin`: la primera visita te pedirá crear la cuenta
(usuario, correo, contraseña de mínimo 10 caracteres y PIN de 6 dígitos).

## Notas

- Contraseñas y PIN se guardan solo como hash bcrypt (coste 10).
- Sesión en cookie `httpOnly` + `Secure` + `SameSite=Strict`, caducidad absoluta de
  8 h e inactividad de 1 h; al cerrar sesión (o cambiar la contraseña) se invalidan.
- CSRF: cada mutación del panel envía el token CSRF de la sesión.
- Bloqueo temporal de 15 min tras 5 intentos fallidos (por cuenta y por IP).
- Recuperación de contraseña por correo: define el secreto `RESEND_API_KEY`
  (y opcionalmente `ADMIN_EMAIL_FROM`) para que se envíe el enlace.
