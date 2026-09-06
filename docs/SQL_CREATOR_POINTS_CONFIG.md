# 🏆 Creator Points — Configuración persistente (auditoría + SQL)

## Resultado de la auditoría

**NO se crea `public.creator_points_config`.** La configuración de Creator Points
YA tiene una fuente de verdad persistente: la tabla existente **`public.admin_config`**.

| Dato | Dónde vive | Clave |
| --- | --- | --- |
| `enabled`, `base_points`, `daily_cap`, `one_time`, `apply_multiplier`, `minimum_activity` por evento | `admin_config.value` (JSONB) | `creator_points` |
| Milestones (buyers / holders / organic volume), `milestone_points`, thresholds de comunidad, `scan_interval_min`, `lookback_days`, `max_token_creations_per_day`, `engine_enabled` | misma fila | `creator_points` |
| Estado del motor (última ejecución, métricas, errores) | `admin_config.value` | `creator_points_state` |
| Lock single-flight del motor | `admin_config.value` | `creator_points_lock` |

Código responsable: `src/lib/points/points-config.server.ts`
(`loadPointsConfig`, `savePointsConfigValue`, `loadPointsState`, `savePointsState`).

Crear una segunda tabla duplicaría las reglas y rompería la regla de
"una única fuente de verdad", por eso se descartó la Opción Preferida.

## Seguridad (ya vigente, sin cambios)

- Las tres filas se guardan con `is_public: false`, de modo que **nunca** se
  exponen por el endpoint público de configuración.
- Toda lectura/escritura pasa por el **service-role** desde el servidor
  (`src/integrations/supabase/admin.server.ts`); el cliente nunca toca
  `admin_config` para Creator Points.
- Las server functions `getPointsOverview`, `savePointsConfig` y
  `runPointsEngine` exigen **sesión de admin + CSRF** (`requireAdmin(csrf)`,
  el sistema de admin propio de LabsBNB: usuario/contraseña + PIN), no
  simplemente el rol `authenticated`.
- Cada guardado queda registrado en `admin_audit_log` (`admin.points.config`).
- Validación server-side estricta (`validatePointsConfig`): rangos de puntos,
  caps, intervalos, milestones ascendentes; cualquier valor inválido se rechaza
  antes de escribir.

## SQL a ejecutar

**Ninguno obligatorio.** `admin_config` ya existe y ya tiene RLS. Si querés
verificar el estado actual, ejecutá solo esta lectura (no modifica nada):

```sql
select key, is_public, updated_at
from public.admin_config
where key in ('creator_points', 'creator_points_state', 'creator_points_lock');
```

### Semilla opcional de la configuración inicial

La configuración por defecto vive en el código
(`DEFAULT_POINTS_CONFIG` en `src/lib/points/points-types.ts`) y se aplica
automáticamente cuando la fila no existe, así que **no hace falta insertarla**.
Si preferís materializarla en la base de datos, este bloque es idempotente y
no pisa una configuración existente:

```sql
insert into public.admin_config (key, value, is_public)
values (
  'creator_points',
  jsonb_build_object(
    'engine_enabled', true,
    'scan_interval_min', 5,
    'max_token_creations_per_day', 3,
    'lookback_days', 7,
    'buyer_milestones', jsonb_build_array(10, 25, 50, 100, 250, 500, 1000),
    'holder_milestones', jsonb_build_array(10, 25, 50, 100, 250, 500, 1000),
    'volume_milestones', jsonb_build_array(1, 5, 10, 25, 50, 100, 250),
    'milestone_points', jsonb_build_array(100, 250, 500, 1000, 2500, 5000, 10000),
    'community_min_holders', 25,
    'community_min_buyers', 25,
    'events', jsonb_build_object(
      'TOKEN_CREATED',              jsonb_build_object('enabled', true,  'base_points', 100,  'daily_cap', 300,   'one_time', true,  'apply_multiplier', false, 'minimum_activity', 0),
      'UNIQUE_BUYER_MILESTONE',     jsonb_build_object('enabled', true,  'base_points', 0,    'daily_cap', 10000, 'one_time', true,  'apply_multiplier', true,  'minimum_activity', 0),
      'HOLDER_MILESTONE',           jsonb_build_object('enabled', true,  'base_points', 0,    'daily_cap', 10000, 'one_time', true,  'apply_multiplier', true,  'minimum_activity', 0),
      'ORGANIC_VOLUME_MILESTONE',   jsonb_build_object('enabled', true,  'base_points', 0,    'daily_cap', 10000, 'one_time', true,  'apply_multiplier', true,  'minimum_activity', 0),
      'TRENDING_TOP10',             jsonb_build_object('enabled', true,  'base_points', 250,  'daily_cap', 1000,  'one_time', false, 'apply_multiplier', true,  'minimum_activity', 0),
      'TRENDING_TOP5',              jsonb_build_object('enabled', true,  'base_points', 1000, 'daily_cap', 2000,  'one_time', false, 'apply_multiplier', true,  'minimum_activity', 0),
      'RISING_FAST',                jsonb_build_object('enabled', true,  'base_points', 500,  'daily_cap', 1000,  'one_time', false, 'apply_multiplier', true,  'minimum_activity', 0),
      'NEAR_GRADUATION',            jsonb_build_object('enabled', true,  'base_points', 1000, 'daily_cap', 1000,  'one_time', true,  'apply_multiplier', true,  'minimum_activity', 0),
      'GRADUATED',                  jsonb_build_object('enabled', true,  'base_points', 5000, 'daily_cap', 5000,  'one_time', true,  'apply_multiplier', true,  'minimum_activity', 0),
      'COMMUNITY_MILESTONE',        jsonb_build_object('enabled', true,  'base_points', 2000, 'daily_cap', 2000,  'one_time', true,  'apply_multiplier', true,  'minimum_activity', 0),
      'ADMIN_ADJUSTMENT',           jsonb_build_object('enabled', false, 'base_points', 0,    'daily_cap', 0,     'one_time', false, 'apply_multiplier', false, 'minimum_activity', 0)
    )
  ),
  false
)
on conflict (key) do nothing;
```

> Los valores reales por defecto son los de `DEFAULT_POINTS_CONFIG`; si los
> cambiás en el panel, la fila de `admin_config` manda.

## No retroactividad

Cambiar la configuración **no toca** `creator_points_ledger`. El ledger es
append-only: el código de puntos no contiene ninguna llamada `.update()` ni
`.delete()` sobre esa tabla (test automatizado lo verifica), y los duplicados
se bloquean por el `UNIQUE(fingerprint)`. Las reglas nuevas se aplican solo a
eventos futuros.

## Tests relacionados

`src/lib/points/points-rules.test.ts` → bloque
"persistent configuration (single source of truth)": fuente única, privacidad,
autorización admin + CSRF, validación previa a la escritura, rechazo de puntos
y multiplicadores inválidos, imposibilidad de reglas duplicadas por evento,
round-trip tras recarga, no retroactividad del ledger y defaults de la spec.

## Prohibido

No se usa `DROP TABLE` ni se borra ningún dato existente.
