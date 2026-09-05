# SQL — Trending Engine (Fase 1)

Ejecuta este script **una sola vez** en el SQL Editor de Supabase.
Crea la tabla de snapshots del Trending Engine con sus GRANTs, RLS e índices.

- Lectura pública (`anon`, `authenticated`): solo métricas agregadas, sin PII.
- Escritura: exclusiva de `service_role` (el motor server-side).

```sql
create table if not exists public.trending_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_address text not null,
  chain_id integer not null default 56,
  timestamp timestamptz not null default now(),

  volume_5m   numeric not null default 0,
  volume_15m  numeric not null default 0,
  volume_1h   numeric not null default 0,
  volume_6h   numeric not null default 0,
  volume_24h  numeric not null default 0,

  trades_5m   integer not null default 0,
  trades_15m  integer not null default 0,
  buyers_5m   integer not null default 0,
  buyers_15m  integer not null default 0,
  sellers_5m  integer not null default 0,
  sellers_15m integer not null default 0,

  holders          integer,
  bonding_progress numeric,
  whale_score      numeric not null default 0,
  trending_score   numeric not null default 0,
  velocity_score   numeric,

  -- Ranking ya calculado por el servidor (lectura instantánea del frontend).
  payload jsonb,

  created_at timestamptz not null default now()
);

grant select on public.trending_snapshots to anon;
grant select on public.trending_snapshots to authenticated;
grant all    on public.trending_snapshots to service_role;

alter table public.trending_snapshots enable row level security;

drop policy if exists "trending snapshots are public" on public.trending_snapshots;
create policy "trending snapshots are public"
  on public.trending_snapshots
  for select
  to anon, authenticated
  using (true);

-- Solo el motor (service_role) escribe: no se crea ninguna policy de
-- insert/update/delete, por lo que ningún usuario puede alterar el score.

create index if not exists trending_snapshots_lookup_idx
  on public.trending_snapshots (chain_id, timestamp desc);

create index if not exists trending_snapshots_token_idx
  on public.trending_snapshots (token_address, timestamp desc);

create index if not exists trending_snapshots_score_idx
  on public.trending_snapshots (chain_id, trending_score desc, timestamp desc);
```

## Limpieza opcional (retención de 7 días)

```sql
delete from public.trending_snapshots
where timestamp < now() - interval '7 days';
```

## Ejecución periódica (pg_cron)

El motor se ejecuta cada `scan_interval_min` minutos (configurable en el panel
de administración). Programa la llamada HTTP al endpoint protegido:

```sql
select cron.schedule(
  'labsbnb-trending-engine',
  '*/3 * * * *',
  $$
  select net.http_post(
    url     := 'https://project--<project-id>.lovable.app/api/public/trending/run',
    headers := jsonb_build_object('x-trending-secret', '<TRENDING_CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
```

Si no configuras el cron, el ranking se calcula bajo demanda con caché de 90 s.
