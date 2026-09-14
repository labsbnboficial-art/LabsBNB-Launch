# SQL — Reward Allocation Engine (Fase 2G)

Ejecuta este bloque **completo** en el SQL Editor del proyecto. Es
**idempotente** y no contiene `DROP TABLE`, `DELETE`, `TRUNCATE` ni
`ALTER ... DROP COLUMN`.

No toca ninguna tabla existente: Eligibility (Fase 2F), Points, Levels,
Achievements y Leaderboard permanecen intactos. La configuración de Allocation
vive en `admin_config` (clave `creator_reward_allocation:<program_id>`), así que
esta fase solo añade **una** tabla de snapshots append-only.

Nada de esto distribuye tokens ni dinero: `allocation_amount` es un cálculo
interno del programa y solo existe si hay un reward pool configurado.

```sql
create table if not exists public.creator_reward_allocation_snapshots (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 56,
  program_id uuid not null references public.creator_reward_programs(id) on delete cascade,
  rule_version integer not null default 1,
  allocation_version integer not null default 1,
  basis_hash text not null,
  eligibility_evaluated_at timestamptz,
  creator_address text not null,
  eligibility_status text not null,
  status text not null,
  allocation_score numeric,
  normalized_weight numeric,
  allocation_pct numeric,
  allocation_amount numeric,
  pool_total numeric,
  pool_unit text,
  method text not null default 'weighted',
  factors_result jsonb not null default '[]'::jsonb,
  reasons text[] not null default '{}',
  evaluated_at timestamptz not null default now(),
  fingerprint text not null
);

create unique index if not exists creator_reward_allocation_fingerprint_uidx
  on public.creator_reward_allocation_snapshots (fingerprint);

create index if not exists creator_reward_allocation_program_idx
  on public.creator_reward_allocation_snapshots (chain_id, program_id, evaluated_at desc);

create index if not exists creator_reward_allocation_creator_idx
  on public.creator_reward_allocation_snapshots (chain_id, creator_address, evaluated_at desc);

-- Data API grants
grant select on public.creator_reward_allocation_snapshots to anon, authenticated;
grant all    on public.creator_reward_allocation_snapshots to service_role;

-- RLS: lectura pública, escritura solo del motor (service_role)
alter table public.creator_reward_allocation_snapshots enable row level security;

drop policy if exists "reward allocation readable by everyone" on public.creator_reward_allocation_snapshots;
create policy "reward allocation readable by everyone"
  on public.creator_reward_allocation_snapshots for select
  to anon, authenticated
  using (true);

-- Sin políticas de insert/update/delete: `service_role` las omite por diseño
-- y cualquier cliente queda bloqueado. Los snapshots son append-only.
```

## Verificación

```sql
select policyname, cmd from pg_policies
where tablename = 'creator_reward_allocation_snapshots';

select count(*) as allocation_snapshots from public.creator_reward_allocation_snapshots;
```

Resultado esperado: una sola política `SELECT` y contador a `0` antes de la
primera ejecución del motor.

## Idempotencia

`fingerprint = SHA-256("ALLOCATION|chain|program|r{ruleVersion}|a{allocationVersion}|basisHash|creator")`

donde `basisHash` es el SHA-256 del conjunto ordenado de fingerprints de
elegibilidad usados como base. Repetir la misma evaluación con la misma base y
las mismas versiones inserta **0 filas nuevas** y reporta duplicados evitados.
Cambiar las reglas o la configuración crea una versión nueva y, por tanto, un
snapshot nuevo: los históricos nunca se sobrescriben.
