# 🏆 Creator Level History — Fase 2C.1

Convierte el Creator Level de un valor puramente calculado (+ notificación local)
en **milestones históricos persistentes, inmutables y verificables**.

No crea un segundo sistema de puntos, no toca contratos, no otorga recompensas.

## Arquitectura

```text
creator_points_ledger        (única fuente de verdad de puntos)
        ↓ SUM(points)
level calculator             (levels-rules.ts + admin_config.creator_levels)
        ↓
current level                (derivado, nunca almacenado como balance)
        ↓ comparar con milestones persistidos
detect missing milestones    (level-history-rules.ts)
        ↓ insert append-only
creator_level_history        (histórico inmutable)
        ↓
perfil / admin / API / Fase 2D Achievements
```

Tres capas separadas:

| Capa | Fuente | Mutabilidad |
| --- | --- | --- |
| Creator Points | `creator_points_ledger` | append-only |
| Creator Level | cálculo desde puntos + `admin_config.creator_levels` | derivado |
| Level History | `creator_level_history` | append-only, inmutable |

## Base de datos

`docs/SQL_CREATOR_LEVEL_HISTORY.md` (ejecutar en Supabase). Tabla
`public.creator_level_history` con `chain_id`, `creator_address` (siempre
minúsculas), `previous_level`, `new_level`, `points_at_level_up`,
`milestone_key`, `source`, `fingerprint`, `metadata`, `created_at`.

Índices: único sobre `fingerprint`, más `(chain_id, creator_address, created_at desc)`,
`(chain_id, new_level, created_at desc)` y `(chain_id, milestone_key)`.

## Idempotencia y fingerprints

```
LEVEL_UP|56|0xcreator|3|creator_level_3   →   SHA-256
```

El fingerprint no incluye el umbral de puntos, de modo que un cambio de
configuración futuro no puede duplicar un milestone ya alcanzado. La inserción
usa `upsert(onConflict: "fingerprint", ignoreDuplicates: true)`: nunca
`if (!exists) insert`, por lo que dos ejecuciones simultáneas del cron no
duplican eventos.

## Multi-level jumps

Un salto de nivel 2 → 5 genera tres eventos consecutivos (3, 4 y 5), cada uno con
su propio fingerprint y `previous_level`. Los niveles intermedios registran su
umbral configurado; el nivel más alto registra el total real de puntos del
creador en el momento de la detección (`metadata.totalPointsAtDetection`).

## Backfill

`backfillCreatorLevelHistory()` recorre los creators con puntos > 0, calcula el
nivel actual, deduce los milestones que deberían existir e inserta solo los
faltantes. Es idempotente. No inventa fechas: `created_at = now()` y
`metadata = { backfill: true, reason: "initial_level_history_migration" }`.

## Cambios de configuración y level-down

El historial nunca se recalcula de forma destructiva. Si un admin sube un umbral
y el nivel calculado baja, los eventos ya registrados permanecen: representan
«milestones alcanzados», no «estado actual». No existe level-down ni borrado.

## Seguridad

- RLS activado; solo política `SELECT` para `anon`/`authenticated`.
- Sin políticas de INSERT/UPDATE/DELETE: solo `service_role` escribe.
- Todas las escrituras pasan por `src/lib/levels/level-history.server.ts`.
- Acciones de admin protegidas por `requireAdmin` + CSRF y auditadas en
  `admin_audit_log` (`admin.level_history.sync`, `admin.level_history.backfill`).
- Validación de dirección con Zod y normalización a minúsculas.
- Ningún componente React puede insertar milestones.

## API pública

```
GET /api/public/creator/:address/level-history
```

```json
{
  "creator": "0x…",
  "chainId": 56,
  "currentLevel": 4,
  "currentPoints": 7312,
  "history": [
    { "previousLevel": 1, "newLevel": 2, "pointsAtLevelUp": 500, "createdAt": "…", "milestoneKey": "creator_level_2", "source": "creator_points", "backfill": false }
  ]
}
```

También disponible como server function `getCreatorLevelHistory` para el perfil.

## Cron

Reutiliza el cron existente del Creator Points Engine: tras escribir en el
ledger, `runLevelHistorySync("points-engine")` sincroniza el historial. No se
creó un cron paralelo. El admin puede forzar una sincronización manual desde
**Admin → Creator Points → 📜 Level History**.

Cada ejecución registra en logs:
`[CREATOR_LEVEL_HISTORY] run (trigger) — creators N · detected N · inserted N · existing N · errors N · Nms`.

## Performance

`totalsByCreator(chainId)` hace una única lectura por lote del ledger; el sync no
consulta el ledger por creador (sin N+1). El perfil público consume una sola
llamada de historial cacheada 60 s. `/creators` sigue mostrando nivel y puntos con
el servicio batched existente, sin cargar historial.

## Tests

`src/lib/levels/level-history-rules.test.ts` — 18 tests: thresholds
(0/500/1.999/2.000/5.000/150.000), idempotencia (10 ejecuciones), concurrencia,
multi-level jump, backfill, cambios de configuración, level-down, direcciones
inválidas y normalización de mayúsculas.

## Fase 2D — Achievements

`creator_level_history` queda disponible como fuente histórica verificable junto
a `creator_points_ledger`, `trending_snapshots`, perfiles de creador y eventos de
graduación.
