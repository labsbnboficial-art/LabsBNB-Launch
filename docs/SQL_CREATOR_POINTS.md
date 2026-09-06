# SQL — Creator Points Engine (Fase 2B)

Ejecuta este bloque **completo** en el SQL Editor de la base de datos del proyecto.
Es idempotente: puede ejecutarse varias veces sin efectos secundarios.

El ledger es **append-only**: no hay política de UPDATE ni DELETE para usuarios;
solo `service_role` (el motor del servidor) puede escribir. El cliente jamás
puede crear, editar ni borrar puntos.

```sql
-- 1) Ledger inmutable de Creator Points
create table if not exists public.creator_points_ledger (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 56,
  creator_address text not null,
  token_address text,
  event_type text not null,
  points integer not null,
  base_points integer not null default 0,
  multiplier numeric not null default 1,
  reason text not null,
  source_id text,
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 2) Idempotencia: un mismo hecho on-chain nunca puede puntuar dos veces
create unique index if not exists creator_points_fingerprint_uidx
  on public.creator_points_ledger (fingerprint);

create index if not exists creator_points_creator_idx
  on public.creator_points_ledger (chain_id, creator_address, created_at desc);

create index if not exists creator_points_token_idx
  on public.creator_points_ledger (chain_id, token_address);

create index if not exists creator_points_event_idx
  on public.creator_points_ledger (chain_id, event_type, created_at desc);

-- 3) Data API grants
grant select on public.creator_points_ledger to anon;
grant select on public.creator_points_ledger to authenticated;
grant all    on public.creator_points_ledger to service_role;

-- 4) RLS: lectura pública, escritura solo del motor (service_role)
alter table public.creator_points_ledger enable row level security;

drop policy if exists "points readable by everyone" on public.creator_points_ledger;
create policy "points readable by everyone"
  on public.creator_points_ledger for select
  to anon, authenticated
  using (true);

-- Sin políticas de insert/update/delete: `service_role` las omite por diseño
-- y cualquier cliente queda bloqueado.
```

## Verificación

```sql
select count(*) as total, coalesce(sum(points), 0) as puntos
from public.creator_points_ledger;

select policyname, cmd from pg_policies
where tablename = 'creator_points_ledger';
```

Resultado esperado: la tabla existe, hay **una sola** política (`SELECT`) y el
total inicial es `0` puntos.

## Cron

El motor se ejecuta desde `POST /api/public/creator-points/run` con la cabecera
`x-points-secret: <POINTS_CRON_SECRET>` (o `TRENDING_CRON_SECRET` /
`SIGNALS_CRON_SECRET` como respaldo). Intervalo recomendado: cada 15 minutos.
