# Labs Missions — SQL a aplicar (Supabase → SQL editor)

Ejecuta este bloque completo una sola vez. Es idempotente.

```sql
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
```

Tras aplicarlo, `/missions`, el panel de campañas del creador y el bloque
"Missions" del panel de admin quedan operativos.
