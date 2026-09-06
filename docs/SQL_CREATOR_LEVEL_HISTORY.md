# SQL — Creator Level History (Fase 2C.1)

Ejecuta este bloque **completo** en el SQL Editor de Supabase **antes** de usar la
sección “🏆 Level History” del perfil y el panel de admin. Es idempotente y **no
contiene operaciones destructivas** (sin `DROP`, `DELETE`, `TRUNCATE`).

La tabla es **append-only**: solo `service_role` (el servidor) puede insertar;
`anon`/`authenticated` solo pueden leer. No existen políticas de UPDATE ni DELETE.

```sql
-- 1) Historial inmutable de milestones de nivel
create table if not exists public.creator_level_history (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 56,
  creator_address text not null,
  previous_level integer,
  new_level integer not null,
  points_at_level_up integer not null,
  milestone_key text not null,
  source text not null default 'creator_points',
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 2) Idempotencia: un creator solo puede alcanzar cada nivel UNA vez
create unique index if not exists creator_level_history_fingerprint_uidx
  on public.creator_level_history (fingerprint);

-- 3) Índices de consulta
create index if not exists creator_level_history_creator_idx
  on public.creator_level_history (chain_id, creator_address, created_at desc);

create index if not exists creator_level_history_level_idx
  on public.creator_level_history (chain_id, new_level, created_at desc);

create index if not exists creator_level_history_milestone_idx
  on public.creator_level_history (chain_id, milestone_key);

-- 4) Data API grants
grant select on public.creator_level_history to anon;
grant select on public.creator_level_history to authenticated;
grant all    on public.creator_level_history to service_role;

-- 5) RLS: lectura pública, escritura exclusiva del servidor
alter table public.creator_level_history enable row level security;

drop policy if exists "level history readable by everyone" on public.creator_level_history;
create policy "level history readable by everyone"
  on public.creator_level_history for select
  to anon, authenticated
  using (true);

-- Sin políticas de insert/update/delete: `service_role` las omite por diseño
-- y cualquier cliente queda bloqueado (append-only real).
```

## Verificación

```sql
select count(*) as milestones from public.creator_level_history;

select creator_address, new_level, points_at_level_up, created_at, metadata->>'backfill' as backfill
from public.creator_level_history
order by created_at desc
limit 20;
```

## Después de ejecutarlo

1. Entra en **Admin → 🏆 Creator Points → Creator Levels → 📜 Level History**.
2. Pulsa **Backfill inicial** una sola vez (idempotente) para reconstruir los
   milestones de los creators que ya tenían Creator Points.
3. A partir de ahí, el cron existente del Creator Points Engine sincroniza el
   historial automáticamente; **no hace falta un cron nuevo**.
