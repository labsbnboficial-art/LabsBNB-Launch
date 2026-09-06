# SQL — Creator Rewards & Airdrop Eligibility (Fase 2F)

Ejecuta este bloque **completo** en el SQL Editor de la base de datos del proyecto.
Es **idempotente**: puede ejecutarse varias veces sin efectos secundarios y no
contiene `DROP TABLE`, `DELETE`, `TRUNCATE` ni `ALTER ... DROP COLUMN`.

No toca ninguna tabla existente (`creator_points_ledger`, `creator_levels`,
`creator_achievements`, `creator_leaderboard_*`, `creator_seasons`, …).

Los snapshots son **append-only**: solo `service_role` escribe; ningún cliente
puede crear, editar ni borrar elegibilidad.

```sql
-- 1) Programas de recompensas
create table if not exists public.creator_reward_programs (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 56,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  season_id uuid,
  evaluation_window text not null default 'current',
  evaluation_start timestamptz,
  evaluation_end timestamptz,
  rule_version integer not null default 1,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists creator_reward_programs_slug_uidx
  on public.creator_reward_programs (chain_id, slug);

create index if not exists creator_reward_programs_status_idx
  on public.creator_reward_programs (chain_id, status, starts_at desc);

-- 2) Versiones inmutables de reglas (auditoría, nunca se recalcula el pasado)
create table if not exists public.creator_reward_rule_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.creator_reward_programs(id) on delete cascade,
  version integer not null,
  rules jsonb not null,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists creator_reward_rule_versions_uidx
  on public.creator_reward_rule_versions (program_id, version);

-- 3) Snapshots de elegibilidad (append-only, idempotentes por fingerprint)
create table if not exists public.creator_reward_eligibility_snapshots (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 56,
  program_id uuid not null references public.creator_reward_programs(id) on delete cascade,
  rule_version integer not null default 1,
  creator_address text not null,
  status text not null,
  eligible boolean not null default false,
  eligibility_score numeric not null default 0,
  points integer,
  creator_score numeric,
  creator_level integer,
  achievements integer,
  graduations integer,
  organic_score numeric,
  season_rank integer,
  criteria_result jsonb not null default '[]'::jsonb,
  risk_flags text[] not null default '{}',
  evaluation_window text not null default 'current',
  evaluation_start timestamptz,
  evaluation_end timestamptz,
  evaluated_at timestamptz not null default now(),
  fingerprint text not null
);

create unique index if not exists creator_reward_eligibility_fingerprint_uidx
  on public.creator_reward_eligibility_snapshots (fingerprint);

create index if not exists creator_reward_eligibility_program_idx
  on public.creator_reward_eligibility_snapshots (chain_id, program_id, evaluated_at desc);

create index if not exists creator_reward_eligibility_creator_idx
  on public.creator_reward_eligibility_snapshots (chain_id, creator_address, evaluated_at desc);

create index if not exists creator_reward_eligibility_status_idx
  on public.creator_reward_eligibility_snapshots (chain_id, program_id, status);

-- 4) Data API grants
grant select on public.creator_reward_programs to anon, authenticated;
grant all    on public.creator_reward_programs to service_role;

grant select on public.creator_reward_rule_versions to anon, authenticated;
grant all    on public.creator_reward_rule_versions to service_role;

grant select on public.creator_reward_eligibility_snapshots to anon, authenticated;
grant all    on public.creator_reward_eligibility_snapshots to service_role;

-- 5) RLS: lectura pública, escritura solo del motor (service_role)
alter table public.creator_reward_programs enable row level security;
alter table public.creator_reward_rule_versions enable row level security;
alter table public.creator_reward_eligibility_snapshots enable row level security;

drop policy if exists "reward programs readable by everyone" on public.creator_reward_programs;
create policy "reward programs readable by everyone"
  on public.creator_reward_programs for select
  to anon, authenticated
  using (status <> 'draft');

drop policy if exists "reward rule versions readable by everyone" on public.creator_reward_rule_versions;
create policy "reward rule versions readable by everyone"
  on public.creator_reward_rule_versions for select
  to anon, authenticated
  using (true);

drop policy if exists "reward eligibility readable by everyone" on public.creator_reward_eligibility_snapshots;
create policy "reward eligibility readable by everyone"
  on public.creator_reward_eligibility_snapshots for select
  to anon, authenticated
  using (true);

-- Sin políticas de insert/update/delete: `service_role` las omite por diseño
-- y cualquier cliente queda bloqueado.
```

## Verificación

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'creator_reward%';

select policyname, cmd from pg_policies
where tablename like 'creator_reward%';

select count(*) as programas from public.creator_reward_programs;
select count(*) as snapshots from public.creator_reward_eligibility_snapshots;
```

Resultado esperado: tres tablas, **una sola** política `SELECT` por tabla y
contadores a `0` antes de la primera ejecución del motor.

## Cron

El motor se ejecuta desde `POST /api/public/rewards/run` con la cabecera
`x-rewards-secret: <REWARDS_CRON_SECRET>` (respaldo: `POINTS_CRON_SECRET`,
`TRENDING_CRON_SECRET` o `SIGNALS_CRON_SECRET`). También se encadena
automáticamente al final del cron de Creator Points. Intervalo recomendado:
cada 15 minutos, alineado con el bucket de idempotencia.
