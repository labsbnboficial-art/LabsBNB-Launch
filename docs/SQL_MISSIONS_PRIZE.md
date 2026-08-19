# Labs Missions — Premio al ganador (SQL adicional)

Ejecuta este bloque en el editor SQL de Supabase. Es idempotente y sólo añade
columnas nuevas a `campaigns` (no borra nada).

```sql
alter table public.campaigns add column if not exists prize_amount    numeric not null default 0;
alter table public.campaigns add column if not exists prize_currency  text    not null default 'bnb';
alter table public.campaigns add column if not exists prize_tx_hash   text;
alter table public.campaigns add column if not exists winner_user_id  uuid references public.profiles(id) on delete set null;
alter table public.campaigns add column if not exists prize_paid      boolean not null default false;
alter table public.campaigns add column if not exists prize_payout_tx text;
alter table public.campaigns add column if not exists announced       boolean not null default false;

create index if not exists campaigns_ends_idx on public.campaigns (status, ends_at);
```

Tras aplicarlo:

- El creador deposita el premio del ganador (BNB verificado on-chain) al crear
  la campaña, además de la comisión de la plataforma.
- Al vencer `ends_at`, la campaña se cierra sola, se elige al participante con
  más XP y se publica el anuncio del ganador en `missions` (pestaña Eventos)
  y en la tarjeta de la campaña.
