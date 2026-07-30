-- LabsBNB — esquema completo para el proyecto Supabase bmfmwlylaedihkkxxgom
-- Pegar TODO en Supabase → SQL editor y ejecutar una sola vez.


-- ======== supabase/migrations/20260722142533_6366391b-ca15-41ae-94ab-454609eb1e40.sql ========

-- =========================================
-- LabsBNB Launchpad — Phase 1 schema
-- =========================================

-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Token status enum
CREATE TYPE public.token_status AS ENUM ('pending', 'active', 'graduated', 'failed');

-- Trade side enum
CREATE TYPE public.trade_side AS ENUM ('buy', 'sell');

-- ---------- profiles ----------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT UNIQUE,
  username TEXT UNIQUE,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are publicly viewable" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ---------- user_roles ----------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ---------- tokens ----------
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contract_address TEXT UNIQUE,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  banner_url TEXT,
  website TEXT,
  telegram TEXT,
  twitter TEXT,
  discord TEXT,
  github TEXT,
  category TEXT,
  supply NUMERIC(78,0) NOT NULL DEFAULT 1000000000,
  decimals INT NOT NULL DEFAULT 18,
  chain_id INT NOT NULL DEFAULT 56,
  status public.token_status NOT NULL DEFAULT 'pending',
  deploy_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  graduated_at TIMESTAMPTZ
);
CREATE INDEX idx_tokens_status ON public.tokens(status);
CREATE INDEX idx_tokens_created_at ON public.tokens(created_at DESC);
GRANT SELECT ON public.tokens TO anon;
GRANT SELECT, INSERT, UPDATE ON public.tokens TO authenticated;
GRANT ALL ON public.tokens TO service_role;
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tokens publicly viewable" ON public.tokens FOR SELECT USING (true);
CREATE POLICY "Auth users create tokens" ON public.tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creator updates own token" ON public.tokens FOR UPDATE TO authenticated USING (auth.uid() = creator_id);
CREATE POLICY "Admins update any token" ON public.tokens FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- bonding_curves ----------
CREATE TABLE public.bonding_curves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL UNIQUE REFERENCES public.tokens(id) ON DELETE CASCADE,
  virtual_bnb_reserves NUMERIC(78,0) NOT NULL DEFAULT 0,
  virtual_token_reserves NUMERIC(78,0) NOT NULL DEFAULT 0,
  real_bnb_reserves NUMERIC(78,0) NOT NULL DEFAULT 0,
  target_bnb NUMERIC(78,0) NOT NULL DEFAULT 24000000000000000000,
  progress_bps INT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bonding_curves TO anon;
GRANT SELECT ON public.bonding_curves TO authenticated;
GRANT ALL ON public.bonding_curves TO service_role;
ALTER TABLE public.bonding_curves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Curves publicly viewable" ON public.bonding_curves FOR SELECT USING (true);

-- ---------- trades ----------
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  side public.trade_side NOT NULL,
  amount_bnb NUMERIC(78,0) NOT NULL,
  amount_token NUMERIC(78,0) NOT NULL,
  price NUMERIC(38,18) NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trades_token ON public.trades(token_id, created_at DESC);
GRANT SELECT ON public.trades TO anon;
GRANT SELECT ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trades publicly viewable" ON public.trades FOR SELECT USING (true);

-- ---------- fees ----------
CREATE TABLE public.fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  amount NUMERIC(78,0) NOT NULL,
  fee_bps INT NOT NULL,
  destination_wallet TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fees_created_at ON public.fees(created_at DESC);
GRANT SELECT ON public.fees TO authenticated;
GRANT ALL ON public.fees TO service_role;
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view fees" ON public.fees FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- favorites / watchlist ----------
CREATE TABLE public.favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token_id)
);
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own favorites" ON public.favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------- comments ----------
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_token ON public.comments(token_id, created_at DESC);
GRANT SELECT ON public.comments TO anon;
GRANT SELECT, INSERT, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Comments publicly viewable" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Users insert own comments" ON public.comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own comments" ON public.comments FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));

-- ---------- reports ----------
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id UUID REFERENCES public.tokens(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users create reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Reporter sees own reports" ON public.reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));

-- ---------- activity ----------
CREATE TABLE public.activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_created_at ON public.activity(created_at DESC);
GRANT SELECT ON public.activity TO anon;
GRANT SELECT ON public.activity TO authenticated;
GRANT ALL ON public.activity TO service_role;
ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Activity publicly viewable" ON public.activity FOR SELECT USING (true);

-- ---------- audit_logs (admin only) ----------
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- admin_config ----------
-- Public read of NON-sensitive keys, admin write.
CREATE TABLE public.admin_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_config TO anon;
GRANT SELECT ON public.admin_config TO authenticated;
GRANT ALL ON public.admin_config TO service_role;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public config readable" ON public.admin_config FOR SELECT USING (is_public = true OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins write config" ON public.admin_config FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ---------- updated_at helper ----------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_curves_updated BEFORE UPDATE ON public.bonding_curves FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_config_updated BEFORE UPDATE ON public.admin_config FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- auto profile on signup ----------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- seed admin_config ----------
INSERT INTO public.admin_config (key, value, is_public) VALUES
  ('fee_bps', '50'::jsonb, true),
  ('fee_wallet', '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('chain_id', '56'::jsonb, true),
  ('curve_target_bnb', '"24000000000000000000"'::jsonb, true),
  ('supported_pay_tokens', '["BNB","LABSBNB","USDT","USDC"]'::jsonb, true),
  ('ecosystem_links', '{"wallet":"#","swap":"#","burn":"#","nft":"#","staking":"#","casino":"#","game":"#","explorer":"#"}'::jsonb, true)
ON CONFLICT (key) DO NOTHING;


-- ======== supabase/migrations/20260722142556_a3a7745c-0943-4be5-86fe-48b3a3dc2d21.sql ========

-- Fix search_path on trigger helper
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Restrict trigger-only functions from being called via API
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- has_role must remain callable by signed-in users (used in RLS policies from client queries)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;


-- ======== supabase/migrations/20260724123859_d370c424-c599-40d9-9717-515d33d5db80.sql ========

-- Ensure wallet_address is unique on profiles
CREATE UNIQUE INDEX IF NOT EXISTS profiles_wallet_address_key
  ON public.profiles (lower(wallet_address)) WHERE wallet_address IS NOT NULL;

-- Helper: does the calling user own the admin wallet?
CREATE OR REPLACE FUNCTION public.is_admin_wallet(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_config c ON c.key = 'admin_wallet'
    WHERE p.id = _user_id
      AND p.wallet_address IS NOT NULL
      AND lower(p.wallet_address) = lower(trim(both '"' from c.value::text))
  );
$$;

-- Seed / update admin_config with all launcher parameters
INSERT INTO public.admin_config (key, value, is_public) VALUES
  ('admin_wallet',      '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('admin_pin_hash',    'null'::jsonb, false),
  ('factory_address',   'null'::jsonb, true),
  ('rpc_url',           '"https://data-seed-prebsc-1-s1.binance.org:8545"'::jsonb, true),
  ('chain_id',          '97'::jsonb, true),
  ('fee_bps',           '50'::jsonb, true),
  ('fee_wallet',        '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('curve_target_bnb',  '"24000000000000000000"'::jsonb, true),
  ('burn_pct',          '0'::jsonb, true),
  ('liquidity_pct',     '100'::jsonb, true),
  ('lp_pct',            '0'::jsonb, true),
  ('staking_pct',       '0'::jsonb, true),
  ('creation_fee_bnb',  '"0"'::jsonb, true),
  ('buy_fee_bps',       '50'::jsonb, true),
  ('sell_fee_bps',      '50'::jsonb, true),
  ('staking_cost_bnb',  '"0"'::jsonb, true),
  ('indexer_cursor',    '0'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

-- Rewrite admin_config write policy to allow admin role OR admin wallet
DROP POLICY IF EXISTS "admins can manage config" ON public.admin_config;
DROP POLICY IF EXISTS "admin_config_admin_write" ON public.admin_config;
CREATE POLICY "admin_config_admin_write"
  ON public.admin_config
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_admin_wallet(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.is_admin_wallet(auth.uid()));


-- ======== supabase/migrations/20260724123929_80d86cc5-4ba7-493c-a0a7-9c1cca791e40.sql ========

REVOKE EXECUTE ON FUNCTION public.is_admin_wallet(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_wallet(uuid) TO service_role;


-- ======== supabase/migrations/20260724123955_e0d77429-2194-4a00-9a0e-799f18b9fecb.sql ========

CREATE POLICY "token media readable by all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'token-media');

CREATE POLICY "authenticated can upload token media to own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'token-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "authenticated can update own token media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'token-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "authenticated can delete own token media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'token-media' AND auth.uid()::text = (storage.foldername(name))[1]);


-- ======== docs/SQL_APPLY.md ========
-- Notifications piggyback on activity(kind='notification', user_id).
create index if not exists activity_notifications_idx
  on public.activity (user_id, created_at desc)
  where kind = 'notification';

-- Creator reputation view.
create or replace view public.creator_reputation as
select
  p.id                                as user_id,
  p.username,
  p.wallet_address,
  p.avatar_url,
  count(distinct t.id)                as tokens_created,
  count(distinct t.id) filter (where t.status = 'graduated') as tokens_graduated,
  coalesce(sum(tr.amount_bnb), 0)     as total_volume_bnb,
  count(distinct tr.wallet_address)   as unique_traders
from public.profiles p
left join public.tokens t on t.creator_id = p.id
left join public.trades tr on tr.token_id = t.id
group by p.id, p.username, p.wallet_address, p.avatar_url;

grant select on public.creator_reputation to anon, authenticated;

-- AntiBot knobs (todo configurable desde /admin).
insert into public.admin_config (key, value, is_public) values
  ('antibot_enabled',        to_jsonb(false),     true),
  ('antibot_max_buy_bnb',    to_jsonb('0'::text), true),
  ('antibot_max_wallet_tk',  to_jsonb('0'::text), true),
  ('antibot_max_tx_tk',      to_jsonb('0'::text), true),
  ('antibot_cooldown_s',     to_jsonb(0),         true),
  ('antibot_anti_sandwich',  to_jsonb(true),      true),
  ('antibot_anti_flashloan', to_jsonb(true),      true)
on conflict (key) do nothing;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon, authenticated, service_role;

-- Lectura pública sólo de las claves marcadas como públicas
DROP POLICY IF EXISTS "public config readable" ON public.admin_config;
CREATE POLICY "public config readable" ON public.admin_config
  FOR SELECT TO anon, authenticated USING (is_public = true);

GRANT SELECT ON public.admin_config TO anon, authenticated;
GRANT ALL ON public.admin_config TO service_role;

INSERT INTO public.admin_config (key, value, is_public) VALUES
  ('antibot_enabled',        'true',  true),
  ('antibot_max_buy_bnb',    '"2000000000000000000"', true),
  ('antibot_max_wallet_tk',  '"0"',   true),
  ('antibot_max_tx_tk',      '"0"',   true),
  ('antibot_cooldown_s',     '3',     true),
  ('antibot_anti_sandwich',  'true',  true),
  ('antibot_anti_flashloan', 'true',  true)
ON CONFLICT (key) DO NOTHING;


-- ======== docs/SQL_MISSIONS.md ========
-- =========================================================
-- LABS MISSIONS: campañas de crecimiento, tareas, XP y niveles
-- =========================================================

-- ---------- MISIONES GLOBALES (LabsBNB) ----------
create table if not exists public.missions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  scope        text not null default 'daily' check (scope in ('daily','weekly','event','sponsored')),
  xp           integer not null default 10 check (xp >= 0),
  reward_text  text,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

grant select on public.missions to anon, authenticated;
grant all on public.missions to service_role;
alter table public.missions enable row level security;

drop policy if exists "missions readable" on public.missions;
create policy "missions readable" on public.missions
  for select to anon, authenticated using (active = true);

-- ---------- CAMPAÑAS DE CRECIMIENTO (por token) ----------
create table if not exists public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  token_id          uuid references public.tokens(id) on delete cascade,
  creator_id        uuid references public.profiles(id) on delete set null,
  title             text not null,
  description       text,
  reward_currency   text not null default 'token'
                    check (reward_currency in ('token','labsbnb','bnb','nft','raffle','fee_discount')),
  reward_budget     numeric not null default 0 check (reward_budget >= 0),
  reward_per_task   numeric not null default 0 check (reward_per_task >= 0),
  max_participants  integer not null default 100 check (max_participants > 0),
  duration_hours    integer not null default 72 check (duration_hours > 0),
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  status            text not null default 'draft' check (status in ('draft','active','ended','cancelled')),
  fee_tx_hash       text,
  created_at        timestamptz not null default now()
);

create index if not exists campaigns_token_idx on public.campaigns (token_id, created_at desc);
create index if not exists campaigns_status_idx on public.campaigns (status, ends_at desc);

grant select on public.campaigns to anon, authenticated;
grant all on public.campaigns to service_role;
alter table public.campaigns enable row level security;

drop policy if exists "campaigns readable" on public.campaigns;
create policy "campaigns readable" on public.campaigns
  for select to anon, authenticated using (status <> 'draft' or creator_id = auth.uid());

-- ---------- TAREAS (de campaña o de misión) ----------
create table if not exists public.campaign_tasks (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  mission_id    uuid references public.missions(id) on delete cascade,
  type          text not null,
  label         text,
  required      boolean not null default true,
  xp            integer not null default 10 check (xp >= 0),
  reward        numeric not null default 0 check (reward >= 0),
  params        jsonb not null default '{}'::jsonb,
  verification  text not null default 'manual' check (verification in ('auto','manual')),
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint campaign_tasks_owner_chk
    check ((campaign_id is null) <> (mission_id is null))
);

create index if not exists campaign_tasks_campaign_idx on public.campaign_tasks (campaign_id, sort);
create index if not exists campaign_tasks_mission_idx on public.campaign_tasks (mission_id, sort);

grant select on public.campaign_tasks to anon, authenticated;
grant all on public.campaign_tasks to service_role;
alter table public.campaign_tasks enable row level security;

drop policy if exists "tasks readable" on public.campaign_tasks;
create policy "tasks readable" on public.campaign_tasks
  for select to anon, authenticated using (true);

-- ---------- PARTICIPANTES ----------
create table if not exists public.campaign_participants (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  wallet_address text,
  xp_earned      integer not null default 0,
  reward_earned  numeric not null default 0,
  status         text not null default 'active' check (status in ('active','completed','disqualified')),
  joined_at      timestamptz not null default now(),
  unique (campaign_id, user_id)
);

grant select on public.campaign_participants to anon, authenticated;
grant all on public.campaign_participants to service_role;
alter table public.campaign_participants enable row level security;

drop policy if exists "participants readable" on public.campaign_participants;
create policy "participants readable" on public.campaign_participants
  for select to anon, authenticated using (true);

-- ---------- ENVÍOS DE TAREA ----------
create table if not exists public.task_submissions (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.campaign_tasks(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete cascade,
  mission_id   uuid references public.missions(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  wallet_address text,
  proof        text,
  status       text not null default 'pending'
               check (status in ('pending','auto_verified','approved','rejected')),
  reason       text,
  reviewer_id  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (task_id, user_id)
);

create index if not exists task_submissions_user_idx on public.task_submissions (user_id, created_at desc);
create index if not exists task_submissions_campaign_idx on public.task_submissions (campaign_id, status);

grant select on public.task_submissions to anon, authenticated;
grant all on public.task_submissions to service_role;
alter table public.task_submissions enable row level security;

drop policy if exists "submissions readable" on public.task_submissions;
create policy "submissions readable" on public.task_submissions
  for select to anon, authenticated using (true);

-- ---------- XP ----------
create table if not exists public.xp_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  task_id    uuid references public.campaign_tasks(id) on delete cascade,
  xp         integer not null default 0,
  reason     text,
  created_at timestamptz not null default now(),
  unique (user_id, task_id)
);

grant select on public.xp_ledger to anon, authenticated;
grant all on public.xp_ledger to service_role;
alter table public.xp_ledger enable row level security;

create unique index if not exists xp_ledger_user_reason_uidx
  on public.xp_ledger (user_id, reason) where task_id is null;

drop policy if exists "xp ledger readable" on public.xp_ledger;
create policy "xp ledger readable" on public.xp_ledger
  for select to anon, authenticated using (true);

create or replace view public.user_level as
select
  p.id                      as user_id,
  p.username,
  p.wallet_address,
  p.avatar_url,
  coalesce(sum(x.xp), 0)::int as xp_total,
  case
    when coalesce(sum(x.xp), 0) >= 10000 then 'legend'
    when coalesce(sum(x.xp), 0) >= 4000  then 'elite'
    when coalesce(sum(x.xp), 0) >= 1500  then 'ambassador'
    when coalesce(sum(x.xp), 0) >= 400   then 'contributor'
    else 'explorer'
  end as level
from public.profiles p
left join public.xp_ledger x on x.user_id = p.id
group by p.id, p.username, p.wallet_address, p.avatar_url;

grant select on public.user_level to anon, authenticated;

-- ---------- CONFIG DE MISSIONS (panel admin) ----------
insert into public.admin_config (key, value, is_public) values
  ('missions_enabled',            to_jsonb(true),            true),
  ('campaign_fee_bnb',            to_jsonb('10000000000000000'::text), true), -- 0.01 BNB
  ('campaign_min_reward',         to_jsonb(0),               true),
  ('campaign_max_reward',         to_jsonb(1000000),         true),
  ('campaign_max_participants',   to_jsonb(5000),            true),
  ('campaign_review_mode',        to_jsonb('manual'::text),  true),  -- manual | auto
  ('missions_socials_allowed',    to_jsonb('x,telegram,discord'::text), true),
  ('missions_task_types',         to_jsonb('follow_labsbnb,follow_project,like,repost,tweet,telegram,discord,buy_min,hold,stake,vote,favorite,profile,referral,comment'::text), true),
  ('antifraud_min_account_age_h', to_jsonb(0),               true),
  ('antifraud_one_per_wallet',    to_jsonb(true),            true),
  ('xp_explorer_min',             to_jsonb(0),               true),
  ('xp_contributor_min',          to_jsonb(400),             true),
  ('xp_ambassador_min',           to_jsonb(1500),            true),
  ('xp_elite_min',                to_jsonb(4000),            true),
  ('xp_legend_min',               to_jsonb(10000),           true),
  ('level_fee_discount_bps',      to_jsonb('0,5,10,15,25'::text), true)
on conflict (key) do nothing;

-- ---------- MISIONES DE EJEMPLO (diarias/semanales) ----------
insert into public.missions (title, description, scope, xp, reward_text)
select 'Check-in diario', 'Visita LabsBNB y completa una acción en la plataforma.', 'daily', 10, '10 XP'
where not exists (select 1 from public.missions where title = 'Check-in diario');

insert into public.missions (title, description, scope, xp, reward_text)
select 'Trader de la semana', 'Realiza al menos 3 compras en tokens de LabsBNB esta semana.', 'weekly', 120, '120 XP + insignia'
where not exists (select 1 from public.missions where title = 'Trader de la semana');


-- ======== docs/SQL_ADMIN_AUTH.md ========
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

