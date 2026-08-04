# SQL — Sección premium 🚀 Impulso (boost promocional)

Ejecuta este script completo en el editor SQL de Supabase
(proyecto `bmfmwlylaedihkkxxgom`). Es idempotente: puedes volver a lanzarlo.

```sql
-- ---------------------------------------------------------------------------
-- 1) Planes de impulso
-- ---------------------------------------------------------------------------
create table if not exists public.boost_packages (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  days        integer     not null check (days > 0 and days <= 365),
  price_bnb   numeric(20, 8),           -- null => se calcula precio_dia * days
  active      boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

grant select on public.boost_packages to anon, authenticated;
grant all    on public.boost_packages to service_role;

alter table public.boost_packages enable row level security;

drop policy if exists "boost packages are public" on public.boost_packages;
create policy "boost packages are public"
  on public.boost_packages for select
  to anon, authenticated
  using (active);

-- ---------------------------------------------------------------------------
-- 2) Impulsos contratados
-- ---------------------------------------------------------------------------
create table if not exists public.token_boosts (
  id            uuid primary key default gen_random_uuid(),
  token_address text        not null,
  token_id      uuid,
  token_name    text,
  token_ticker  text,
  owner_wallet  text        not null,
  package_id    uuid references public.boost_packages(id) on delete set null,
  days          integer     not null check (days > 0 and days <= 365),
  total_paid    numeric(20, 8) not null default 0,
  currency      text        not null default 'BNB',
  tx_hash       text        not null unique,
  status        text        not null default 'pending'
                check (status in ('pending', 'active', 'finished', 'cancelled', 'rejected')),
  starts_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  approved_by   uuid,
  created_at    timestamptz not null default now()
);

create index if not exists token_boosts_status_expires_idx
  on public.token_boosts (status, expires_at desc);
create index if not exists token_boosts_token_idx
  on public.token_boosts (lower(token_address));
create index if not exists token_boosts_wallet_idx
  on public.token_boosts (lower(owner_wallet));
create index if not exists token_boosts_created_idx
  on public.token_boosts (created_at desc);

grant select on public.token_boosts to anon, authenticated;
grant all    on public.token_boosts to service_role;

alter table public.token_boosts enable row level security;

-- Sólo se pueden leer públicamente los impulsos vigentes; el histórico
-- completo queda reservado al panel de administración (service_role).
drop policy if exists "active boosts are public" on public.token_boosts;
create policy "active boosts are public"
  on public.token_boosts for select
  to anon, authenticated
  using (status = 'active' and expires_at > now());

-- ---------------------------------------------------------------------------
-- 3) Realtime
-- ---------------------------------------------------------------------------
alter table public.token_boosts replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.token_boosts;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Configuración por defecto del servicio
-- ---------------------------------------------------------------------------
insert into public.admin_config (key, value, is_public) values
  ('boost_enabled',            'true'::jsonb,  true),
  ('boost_price_per_day_bnb',  '0.05'::jsonb,  true),
  ('boost_currency',           '"BNB"'::jsonb, true),
  ('boost_wallet',             '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('boost_max_slots',          '10'::jsonb,    true),
  ('boost_auto_approve',       'true'::jsonb,  true),
  ('boost_max_days',           '30'::jsonb,    true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5) Planes por defecto
-- ---------------------------------------------------------------------------
insert into public.boost_packages (name, days, price_bnb, sort_order)
select v.name, v.days, null, v.sort
from (values ('1 día', 1, 1), ('3 días', 3, 2), ('7 días', 7, 3),
             ('15 días', 15, 4), ('30 días', 30, 5)) as v(name, days, sort)
where not exists (select 1 from public.boost_packages);
```

## Notas

- El precio de cada plan es `precio por día × días` salvo que el administrador
  fije un `price_bnb` concreto para ese plan.
- Los impulsos caducados pasan automáticamente a `finished` (lo hace el
  servidor en cada lectura); el histórico permanece disponible en el panel.
- Todas las escrituras se realizan con la clave de servicio desde
  `src/lib/boost.functions.ts`, tras verificar el pago on-chain.
