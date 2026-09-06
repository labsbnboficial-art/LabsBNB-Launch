# 🏅 Creator Achievements Engine (Fase 2D)

Sistema de **logros históricos e inmutables** para creators de LabsBNB Launchpad
(BNB Smart Chain Mainnet, chain 56).

> Un achievement **NO es un segundo sistema de puntos**: desbloquear un logro
> otorga **0 Creator Points**. `creator_points_ledger` sigue siendo la única
> fuente de verdad de puntos y niveles.

## Principios

1. **Solo datos reales.** Cada logro se deriva de datos ya verificados por el
   ecosistema existente: Creator Service (tokens del creator), `trending_snapshots`
   (rank, Top 5, near graduation, whales), `tokens` (fechas de lanzamiento y
   graduación), `creator_points_ledger` y `creator_level_history`.
2. **Sin invención de métricas.** Si un dato no es medible (holders `null`, sin
   timestamps fiables), **no se desbloquea nada** y la UI muestra “Progreso N/A”.
3. **Idempotente.** Fingerprint SHA-256 `ACHIEVEMENT|chainId|creator|key[|source]`
   + índice UNIQUE: ejecuciones concurrentes nunca duplican un logro.
4. **Append-only.** No hay UPDATE ni DELETE. Subir un umbral no revoca logros
   pasados: el logro permanece y se marca como *legacy* si sale del catálogo.
5. **Anti-farming.** Nunca se premia el número bruto de transacciones ni el
   volumen inflado: los logros de comunidad y whales exigen Organic Activity
   Score y diversidad real de wallets.

## Catálogo (10 logros)

| Key | Icono | Rareza | Condición (por defecto, editable) |
|---|---|---|---|
| `first_launch` | 🚀 | common | Primer token con timestamp de creación real |
| `community_starter` | 🌱 | common | 10 holders reales on-chain |
| `community_builder` | 🏗️ | epic | 50 holders + organic ≥ 55 + 15 compradores únicos |
| `trending_creator` | 🔥 | rare | Un token en el Top 5 del Trending |
| `trending_master` | 👑 | epic | 3 apariciones Top 5 (deduplicadas por snapshot) |
| `speed_runner` | ⚡ | epic | Near Graduation en ≤ 24 h desde el lanzamiento |
| `graduator` | 🎓 | rare | Un token graduado de la Bonding Curve |
| `multi_graduator` | 🏅 | legendary | 3 tokens distintos graduados |
| `whale_magnet` | 🐋 | rare | 2 whale trades + organic ≥ 60 + 8 compradores únicos |
| `creator_legend` | 🌟 | legendary | Nivel 7 + graduator + multi_graduator + trending_master |

Los umbrales viven en `rule_config` y se editan desde el panel de admin.

## Arquitectura

```text
src/lib/achievements/
├── achievement-types.ts            catálogo por defecto + tipos compartidos
├── achievement-rules.ts            evaluadores puros + fingerprint + validación
├── achievement-config.server.ts    admin_config: config, estado y lock
├── achievement-history.server.ts   creator_achievements (append-only)
└── achievement-engine.server.ts    orquestación, lectura pública y backfill

src/lib/achievements.functions.ts               RPC (público + admin)
src/routes/api/public/creator/$address/achievements.ts   API pública
src/components/labsbnb/CreatorAchievements.tsx  grid + timeline + evidencia
src/components/labsbnb/AdminAchievementsPanel.tsx  panel de administración
```

### Ejecución

El motor **reutiliza el cron del Creator Points Engine**: tras escribir el ledger
de puntos se llama a `runAchievementsEngine("points-engine")`. No se creó ningún
cron nuevo. También puede lanzarse manualmente desde el panel de admin (Run /
Backfill), protegido por sesión de admin + CSRF y con cooldown de 10 s.

Log de observabilidad:

```
[CREATOR_ACHIEVEMENTS] run <id> (<trigger>) — creators N · unlocked N · duplicates N · errors N · Nms
```

### API pública

`GET /api/public/creator/:address/achievements`

```json
{
  "creator": "0x…",
  "chainId": 56,
  "achievements": [{ "key": "first_launch", "unlocked": true, "unlockedAt": "…", "evidence": { … }, "progress": null, "legacy": false }],
  "totalAchievements": 10,
  "unlockedAchievements": 3,
  "completionPercentage": 30
}
```

Cache `public, max-age=60`. Sin PII, sin datos de admin.

## Seguridad

- El navegador nunca puede desbloquear un logro: no existe ninguna mutación que
  acepte `achievementKey`, `evidence` o una dirección a premiar.
- Escrituras solo con `service_role` desde el servidor; RLS deja únicamente SELECT
  a `anon`/`authenticated`.
- Validación Zod/estricta de toda entrada (dirección EVM, CSRF, umbrales 0…1e6).
- Lock distribuido en `admin_config` (TTL 10 min) además del UNIQUE de la BD.

## Base de datos

`docs/SQL_CREATOR_ACHIEVEMENTS.md` (idempotente, sin operaciones destructivas).

## Tests

`src/lib/achievements/achievement-rules.test.ts` — 39 tests: cada logro, umbrales
límite, datos no medibles, anti-farming (wash/circular/wallet única), idempotencia
x10, no re-emisión, backfill, cambio de configuración, logro deshabilitado,
normalización de direcciones, dirección inválida, evidencia obligatoria y
verificación de que ningún candidato lleva puntos.
