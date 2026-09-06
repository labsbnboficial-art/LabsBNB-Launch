# SQL — Fase 2E · Creator Leaderboard + Seasons

Ejecuta este script **completo** en Supabase → SQL Editor.

- Es **idempotente** (`IF NOT EXISTS`): puedes ejecutarlo varias veces.
- **No contiene** `DROP`, `DELETE`, `TRUNCATE` ni `ALTER ... DROP`.
- **No toca** `creator_points_ledger`, `creator_level_history`,
  `creator_achievements`, `trending_snapshots`, `tokens`, `trades` ni
  `bonding_curves`.
- Los snapshots son **append-only**: no hay políticas de UPDATE ni DELETE.

```sql
-- =====================================================================
-- LabsBNB — Fase 2E: Creator Leaderboard + Creator Seasons
-- =====================================================================

-- 1) Temporadas ------------------------------------------------------
create table if not exists public.creator_seasons (
  id           uuid primary key default gen_random_uuid(),
  chain_id     integer     not null,
  name         text        not null,
  slug         text        not null,
  description  text,
  status       text        not null default 'draft',
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  rules        jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finalized_at timestamptz,
  constraint creator_seasons_status_chk
    check (status in ('draft','scheduled','active','ended','archived')),
  constraint creator_seasons_window_chk check (ends_at > starts_at)
);

create unique index if not exists creator_seasons_slug_idx
  on public.creator_seasons (chain_id, slug);
create index if not exists creator_seasons_status_idx
  on public.creator_seasons (chain_id, status, starts_at desc);

-- Como máximo UNA temporada activa por cadena.
create unique index if not exists creator_seasons_single_active_idx
  on public.creator_seasons (chain_id)
  where status = 'active';

grant select on public.creator_seasons to anon;
grant select on public.creator_seasons to authenticated;
grant all    on public.creator_seasons to service_role;

alter table public.creator_seasons enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'creator_seasons'
      and policyname = 'creator_seasons_public_read'
  ) then
    create policy creator_seasons_public_read on public.creator_seasons
      for select to anon, authenticated
      using (status <> 'draft');
  end if;
end $$;

-- 2) Snapshots del leaderboard global (append-only) ------------------
create table if not exists public.creator_leaderboard_snapshots (
  id              uuid primary key default gen_random_uuid(),
  chain_id        integer     not null,
  creator_address text        not null,
  rank            integer     not null,
  overall_score   numeric     not null,
  creator_points  numeric,
  creator_score   numeric,
  graduations     integer,
  trending_metric numeric,
  organic_metric  numeric,
  components      jsonb       not null default '{}'::jsonb,
  snapshot_at     timestamptz not null,
  fingerprint     text        not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists creator_leaderboard_snapshots_fp_idx
  on public.creator_leaderboard_snapshots (fingerprint);
create index if not exists creator_leaderboard_snapshots_lookup_idx
  on public.creator_leaderboard_snapshots (chain_id, snapshot_at desc);
create index if not exists creator_leaderboard_snapshots_creator_idx
  on public.creator_leaderboard_snapshots (chain_id, creator_address, snapshot_at desc);

grant select on public.creator_leaderboard_snapshots to anon;
grant select on public.creator_leaderboard_snapshots to authenticated;
grant all    on public.creator_leaderboard_snapshots to service_role;

alter table public.creator_leaderboard_snapshots enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'creator_leaderboard_snapshots'
      and policyname = 'creator_leaderboard_snapshots_public_read'
  ) then
    create policy creator_leaderboard_snapshots_public_read
      on public.creator_leaderboard_snapshots
      for select to anon, authenticated using (true);
  end if;
end $$;

-- 3) Snapshots por temporada (append-only, FINAL inmutable) ----------
create table if not exists public.creator_season_snapshots (
  id              uuid primary key default gen_random_uuid(),
  chain_id        integer     not null,
  season_id       uuid        not null references public.creator_seasons(id) on delete cascade,
  creator_address text        not null,
  rank            integer     not null,
  season_score    numeric     not null,
  overall_score   numeric     not null,
  creator_points  numeric,
  creator_score   numeric,
  graduations     integer,
  trending_metric numeric,
  organic_metric  numeric,
  components      jsonb       not null default '{}'::jsonb,
  is_final        boolean     not null default false,
  snapshot_at     timestamptz not null,
  fingerprint     text        not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists creator_season_snapshots_fp_idx
  on public.creator_season_snapshots (fingerprint);
create index if not exists creator_season_snapshots_season_idx
  on public.creator_season_snapshots (season_id, is_final desc, snapshot_at desc, rank);
create index if not exists creator_season_snapshots_creator_idx
  on public.creator_season_snapshots (chain_id, creator_address, snapshot_at desc);

grant select on public.creator_season_snapshots to anon;
grant select on public.creator_season_snapshots to authenticated;
grant all    on public.creator_season_snapshots to service_role;

alter table public.creator_season_snapshots enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'creator_season_snapshots'
      and policyname = 'creator_season_snapshots_public_read'
  ) then
    create policy creator_season_snapshots_public_read
      on public.creator_season_snapshots
      for select to anon, authenticated using (true);
  end if;
end $$;
```

## Después de ejecutarlo

1. Entra en **Admin → 🏆 Creator Points → 🏆 Creator Leaderboard & Seasons**.
2. Pulsa **Backfill inicial** una vez (crea el primer snapshot de referencia).
3. Opcional: crea la primera temporada y pulsa **Activar**.

## Notas de seguridad

- Solo `service_role` puede escribir: el motor corre siempre en el servidor.
- `anon` y `authenticated` solo leen; los borradores de temporada no son
  públicos.
- No existen políticas de UPDATE/DELETE: la historia de rankings es inmutable.
