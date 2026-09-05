# Creator Profiles — Fase 2A (optional customisation only)

The Creator System derives **every statistic, badge and Creator Score from real
data** (Factory `creatorOf`, on-chain `Trade(...)` logs through the Trending
Engine, `trending_snapshots` and the `tokens` table). This table stores ONLY the
optional, sanitised profile customisation — never scores or metrics.

Run this once in the Supabase SQL editor.

```sql
create table if not exists public.creator_profiles (
  id uuid primary key default gen_random_uuid(),
  creator_address text not null,
  chain_id integer not null default 56,
  display_name text,
  avatar_url text,
  bio text,
  twitter text,
  telegram text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_address, chain_id),
  constraint creator_profiles_address_chk check (creator_address ~ '^0x[0-9a-f]{40}$'),
  constraint creator_profiles_name_chk check (display_name is null or char_length(display_name) <= 40),
  constraint creator_profiles_bio_chk check (bio is null or char_length(bio) <= 280),
  constraint creator_profiles_avatar_chk check (avatar_url is null or avatar_url ~* '^https://'),
  constraint creator_profiles_website_chk check (website is null or website ~* '^https://')
);

create index if not exists creator_profiles_lookup_idx
  on public.creator_profiles (chain_id, creator_address);

-- Data API grants (PostgREST needs them explicitly)
grant select on public.creator_profiles to anon;
grant select on public.creator_profiles to authenticated;
grant all on public.creator_profiles to service_role;

alter table public.creator_profiles enable row level security;

-- Public read (profiles are public information)
drop policy if exists "creator_profiles public read" on public.creator_profiles;
create policy "creator_profiles public read"
  on public.creator_profiles for select
  to anon, authenticated
  using (true);

-- No client-side writes in Fase 2A: only the server (service_role) may write,
-- which keeps score/statistics/badges impossible to tamper with.
```

Verification:

```sql
select indexname from pg_indexes where tablename = 'creator_profiles';
select polname, cmd from pg_policies where tablename = 'creator_profiles';
```

Until this script is executed the launchpad keeps working: profiles simply show
the wallet address as identity (no display name / avatar / bio).
