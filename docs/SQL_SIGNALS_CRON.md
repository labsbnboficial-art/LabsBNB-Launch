# Cron oficial — LabsBNB Telegram Signal Engine

Automatiza el motor de señales llamando **exclusivamente** al dominio oficial:

```
POST https://labsbnb-launchpad.com/api/public/signals/run
Header: content-type: application/json
Header: x-signals-secret: <SIGNALS_CRON_SECRET>
Body:   {}
Schedule: */5 * * * *
Job name: labsbnb-signal-engine
```

## Auditoría previa (ya realizada)

- El endpoint acepta `POST` (y `GET`) y valida la cabecera `x-signals-secret`
  con comparación en tiempo constante; también admite `Authorization: Bearer`.
- Verificado en producción: `POST https://labsbnb-launchpad.com/api/public/signals/run`
  con secret inválido devuelve `401 Unauthorized` → el dominio oficial sirve la
  misma aplicación y la misma ruta del Signal Engine.
- El secret **nunca** se escribe en el SQL: se guarda en Supabase Vault.
- El motor mantiene su lock distribuido, así que solapamientos son inofensivos.

---

## Orden de ejecución en Supabase → SQL Editor (proyecto `bmfmwlylaedihkkxxgom`)

### 1. Extensiones (pg_cron + pg_net)

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
```

### 2. Supabase Vault

Vault viene habilitado en Supabase (`supabase_vault`). Comprobación:

```sql
create extension if not exists supabase_vault with schema vault;
select * from vault.secrets where name = 'SIGNALS_CRON_SECRET';
```

### 3. Guardar `SIGNALS_CRON_SECRET` en Vault

Sustituye `PEGA_AQUI_EL_SECRET` por el valor real (el mismo que está en los
secrets del proyecto Lovable). Ejecuta esta sentencia una sola vez y no la
guardes en ningún repositorio.

```sql
-- Crea o actualiza el secreto sin duplicarlo
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'SIGNALS_CRON_SECRET';
  if v_id is null then
    perform vault.create_secret('PEGA_AQUI_EL_SECRET', 'SIGNALS_CRON_SECRET',
                                'Secret del cron del Telegram Signal Engine');
  else
    perform vault.update_secret(v_id, 'PEGA_AQUI_EL_SECRET', 'SIGNALS_CRON_SECRET',
                                'Secret del cron del Telegram Signal Engine');
  end if;
end $$;
```

Lectura (sólo para comprobar que existe; evita imprimir el valor en pantalla
compartida):

```sql
select name, created_at from vault.decrypted_secrets where name = 'SIGNALS_CRON_SECRET';
```

### 4. Evitar jobs duplicados

```sql
-- Elimina el job nuevo si ya existía
select cron.unschedule('labsbnb-signal-engine')
where exists (select 1 from cron.job where jobname = 'labsbnb-signal-engine');

-- Elimina el job antiguo que apuntaba al dominio *.lovable.app
select cron.unschedule('labsbnb-signals')
where exists (select 1 from cron.job where jobname = 'labsbnb-signals');
```

### 5. Crear el cron (cada 5 minutos, secret leído desde Vault)

```sql
select cron.schedule(
  'labsbnb-signal-engine',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://labsbnb-launchpad.com/api/public/signals/run',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-signals-secret',
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'SIGNALS_CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

### 6. Verificar que el job existe

```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'labsbnb-signal-engine';
```

---

## Consultar ejecuciones

```sql
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'labsbnb-signal-engine')
order by start_time desc
limit 20;
```

Respuestas HTTP reales devueltas por el endpoint:

```sql
select id, status_code, content::text, created
from net._http_response
order by created desc
limit 20;
```

## Verificar errores

```sql
-- Ejecuciones fallidas del cron
select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'labsbnb-signal-engine')
  and status <> 'succeeded'
order by start_time desc
limit 20;

-- Respuestas HTTP no-200 (401 => secret incorrecto en Vault)
select id, status_code, content::text, created
from net._http_response
where status_code is distinct from 200
order by created desc
limit 20;
```

También puedes revisar el historial del motor:

```sql
select created_at, signal_type, status, reason, error
from public.signal_log
order by created_at desc
limit 20;
```

## Eliminar el cron

```sql
select cron.unschedule('labsbnb-signal-engine');
```

## Actualizar la URL (si el dominio cambiara)

Recrear el job es la forma soportada:

```sql
select cron.unschedule('labsbnb-signal-engine')
where exists (select 1 from cron.job where jobname = 'labsbnb-signal-engine');

select cron.schedule(
  'labsbnb-signal-engine',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://labsbnb-launchpad.com/api/public/signals/run',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-signals-secret',
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'SIGNALS_CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

## Rotar el secret

1. Actualiza `SIGNALS_CRON_SECRET` en los secrets del proyecto Lovable.
2. Ejecuta de nuevo el bloque del paso 3 con el nuevo valor.
   El cron no necesita cambios: lee el valor desde Vault en cada ejecución.
