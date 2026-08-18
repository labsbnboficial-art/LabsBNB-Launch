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

## Ejecución automática (cron) — Fase 3

> El cron oficial de producción está documentado en
> [`SQL_SIGNALS_CRON.md`](./SQL_SIGNALS_CRON.md) (dominio
> `https://labsbnb-launchpad.com`, cada 5 min, secret en Supabase Vault).
> Lo de abajo se mantiene sólo como referencia histórica.

El secret `SIGNALS_CRON_SECRET` ya está creado en el gestor de secrets del
proyecto (server-side, nunca se expone al cliente ni a los logs).

El endpoint es el único trigger externo y ejecuta **exactamente el mismo motor**
que el botón *RUN ENGINE NOW*:

```
POST https://lp-burn-stake-gain.lovable.app/api/public/signals/run
Header: x-signals-secret: <SIGNALS_CRON_SECRET>
```

Respuesta: `success, skippedLocked, tokensScanned, detected, sent, skipped,
failed, durationMs, notes`. Sin secretos ni datos privados.

### Anti-concurrencia

El motor toma un lock distribuido en `admin_config` (`signal_engine_lock`,
TTL 4 min). Si una ejecución sigue activa, la nueva devuelve
`skippedLocked: true` y no inicia una segunda instancia. Un lock huérfano
expira solo.

### Programación con pg_cron (cada minuto)

Ejecuta esto **una vez** en el SQL Editor de Supabase
(`bmfmwlylaedihkkxxgom`), sustituyendo el secret:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('labsbnb-signals')
where exists (select 1 from cron.job where jobname = 'labsbnb-signals');

select cron.schedule(
  'labsbnb-signals',
  '* * * * *',            -- cada minuto
  $$
  select net.http_post(
    url := 'https://lp-burn-stake-gain.lovable.app/api/public/signals/run',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-signals-secret', 'REEMPLAZA_CON_EL_SECRET'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

Comprobación:

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'labsbnb-signals';
select status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;
```

Alternativa sin SQL: cualquier monitor externo (UptimeRobot, cron-job.org,
GitHub Actions) haciendo POST cada 1–2 minutos con la misma cabecera.

La primera ejecución del motor **no publica nada**: registra el estado actual
como *baseline* para no inundar el canal con historial antiguo.

