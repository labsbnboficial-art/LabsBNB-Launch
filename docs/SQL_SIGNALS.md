# SQL — Telegram Signal Engine (Fase 2)

Aplica este SQL en Supabase (`bmfmwlylaedihkkxxgom` → SQL Editor). Crea la tabla
`signal_log`, única fuente de verdad de deduplicación e historial de señales.

```sql
create table if not exists public.signal_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- NULL para filas SKIPPED (no reservan el evento); único para el resto.
  fingerprint text,
  signal_type text not null,
  token_address text,
  token_symbol text,
  event_id text,
  tx_hash text,
  metric numeric,
  status text not null default 'PENDING'
    check (status in ('PENDING','SENT','SKIPPED','FAILED')),
  reason text,
  error text,
  error_code int,
  attempts int not null default 0,
  telegram_message_id bigint,
  payload jsonb
);

-- Garantía anti-spam: un mismo (tipo|token|evento) sólo puede reservarse una vez.
create unique index if not exists signal_log_fingerprint_key
  on public.signal_log (fingerprint) where fingerprint is not null;

create index if not exists signal_log_created_idx on public.signal_log (created_at desc);
create index if not exists signal_log_type_token_idx
  on public.signal_log (signal_type, token_address, status);

grant all on public.signal_log to service_role;

alter table public.signal_log enable row level security;
-- Sin políticas: sólo el backend (service_role) accede a la tabla.
```

## Configuración

El motor guarda su configuración y su estado en `admin_config` como claves
privadas (`is_public = false`):

- `signal_engine` → thresholds, cooldowns, tipos activos.
- `signal_engine_state` → última ejecución, contadores y último error.

No requiere SQL adicional si `admin_config` ya existe.

## Ejecución automática (cron)

1. Guarda el secret `SIGNALS_CRON_SECRET` en el gestor de secrets del proyecto.
2. Programa un POST cada 2–5 minutos a:

```
https://project--a0ce9313-68d4-41dc-82f5-379383b2e462-dev.lovable.app/api/public/signals/run
```

con la cabecera `x-signals-secret: <SIGNALS_CRON_SECRET>`.

Ejemplo con `pg_cron` + `pg_net`:

```sql
select cron.schedule(
  'labsbnb-signals',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := 'https://project--a0ce9313-68d4-41dc-82f5-379383b2e462-dev.lovable.app/api/public/signals/run',
    headers := jsonb_build_object('x-signals-secret', 'REEMPLAZA_CON_EL_SECRET'),
    body := '{}'::jsonb
  );
  $$
);
```

La primera ejecución del motor **no publica nada**: registra el estado actual
como *baseline* para no inundar el canal con historial antiguo.
