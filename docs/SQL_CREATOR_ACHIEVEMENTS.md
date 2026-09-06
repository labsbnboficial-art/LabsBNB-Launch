# SQL — Creator Achievements (Fase 2D)

Ejecuta este bloque **completo** en el SQL Editor de Supabase **antes** de usar la
sección “🏅 Achievements” del perfil y el panel de admin. Es idempotente y **no
contiene operaciones destructivas** (sin `DROP`, `DELETE`, `TRUNCATE`).

`creator_achievements` es **append-only**: solo `service_role` (el servidor) puede
insertar; `anon`/`authenticated` solo pueden leer. No hay políticas de UPDATE ni
DELETE, así que subir un umbral **nunca** revoca un logro histórico.

```sql
-- 1) Catálogo de definiciones (editable desde el panel de admin)
create table if not exists public.creator_achievement_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null,
  icon text not null,
  category text not null,
  rarity text not null default 'common',
  enabled boolean not null default true,
  rule_config jsonb not null default '{}'::jsonb,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Logros desbloqueados (inmutable, append-only)
create table if not exists public.creator_achievements (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 56,
  creator_address text not null,
  achievement_key text not null,
  unlocked_at timestamptz not null default now(),
  source_type text not null default 'engine',
  source_id text,
  evidence jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb
);

-- 3) Idempotencia: un creator solo puede desbloquear cada logro UNA vez
create unique index if not exists creator_achievements_fingerprint_uidx
  on public.creator_achievements (fingerprint);

create unique index if not exists creator_achievements_unique_idx
  on public.creator_achievements (chain_id, creator_address, achievement_key);

-- 4) Índices de consulta
create index if not exists creator_achievements_creator_idx
  on public.creator_achievements (chain_id, creator_address, unlocked_at desc);

create index if not exists creator_achievements_key_idx
  on public.creator_achievements (chain_id, achievement_key, unlocked_at desc);

-- 5) Data API grants
grant select on public.creator_achievement_definitions to anon;
grant select on public.creator_achievement_definitions to authenticated;
grant all    on public.creator_achievement_definitions to service_role;

grant select on public.creator_achievements to anon;
grant select on public.creator_achievements to authenticated;
grant all    on public.creator_achievements to service_role;

-- 6) RLS: lectura pública, escritura exclusiva del servidor
alter table public.creator_achievement_definitions enable row level security;
alter table public.creator_achievements enable row level security;

drop policy if exists "achievement definitions readable by everyone" on public.creator_achievement_definitions;
create policy "achievement definitions readable by everyone"
  on public.creator_achievement_definitions for select
  to anon, authenticated
  using (true);

drop policy if exists "achievements readable by everyone" on public.creator_achievements;
create policy "achievements readable by everyone"
  on public.creator_achievements for select
  to anon, authenticated
  using (true);

-- Sin políticas de insert/update/delete: `service_role` las omite por diseño
-- y cualquier cliente queda bloqueado (append-only real).
```

## Verificación

```sql
select count(*) as unlocked from public.creator_achievements;

select creator_address, achievement_key, unlocked_at, evidence->>'metric' as metric,
       evidence->>'value' as value, metadata->>'backfill' as backfill
from public.creator_achievements
order by unlocked_at desc
limit 20;
```

## Después de ejecutarlo

1. Entra en **Admin → 🏆 Creator Points → 🏅 Achievements**.
2. Pulsa **Backfill inicial** una sola vez (idempotente) para reconstruir los
   logros de los creators con actividad histórica real.
3. A partir de ahí, el cron existente del Creator Points Engine evalúa los logros
   automáticamente; **no hace falta un cron nuevo**.
