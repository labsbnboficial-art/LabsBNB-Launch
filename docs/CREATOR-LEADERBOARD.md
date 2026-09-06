# 🏆 Creator Leaderboard + 🗓️ Creator Seasons (Fase 2E)

Ranking público de creadores calculado **100 % en el servidor** a partir de
datos que ya existen en el sistema. No crea puntos, no modifica el Creator
Score y no hace llamadas RPC adicionales.

## Fuentes de datos (todas reales)

| Métrica | Peso | Origen |
|---|---|---|
| Creator Points | 40 % | `creator_points_ledger` (solo lectura) |
| Creator Score | 25 % | Creator Profiles (Fase 2A) |
| Graduaciones | 15 % | `tokens.graduated_at` on-chain |
| Trending | 10 % | `trending_snapshots` |
| Volumen orgánico | 10 % | Trending Engine (organic activity) |

Si una métrica no está disponible se muestra **N/A** y su peso se
**redistribuye** entre las medibles. Nunca se inventa un valor.

## Determinismo

`normalizeValues` (0–100) → `computeOverallScore` → `compareEntries` con
desempate fijo: overall → points → score → graduaciones → orgánico →
dirección lexicográfica. Nunca aleatorio: dos ejecuciones con los mismos
datos producen exactamente el mismo ranking.

## Temporadas

- Ventana half-open `[starts_at, ends_at)`: la actividad previa nunca se
  atribuye retroactivamente.
- Solo **una** temporada activa por cadena (índice único parcial en la BD).
- Estados: `draft → scheduled → active → ended → archived`.
- Al finalizar se guarda un snapshot **FINAL inmutable**; la temporada ya no
  puede editarse.

## Idempotencia

Cada snapshot se identifica por un fingerprint SHA-256
(`LEADERBOARD|chainId|address|snapshotAt`, y `…|FINAL` en temporadas) con
índice único e inserción `ignoreDuplicates`. Ejecutar el motor dos veces no
duplica historia. Un lock distribuido por scope (`run`, `backfill`,
`season:<id>`) evita ejecuciones simultáneas.

## Superficies

- `/leaderboard` — categorías Overall, Points, Score, Graduators, Trending,
  Rising, Whale Magnet, Community; podio Top 3 y badges ▲▼—NEW.
- `/leaderboard/seasons` y `/leaderboard/season/:slug`.
- Bloque 🏆 Leaderboard dentro de `/creator/:address`.
- API pública: `/api/public/leaderboard`,
  `/api/public/leaderboard/seasons`,
  `/api/public/leaderboard/season/:slug`,
  `/api/public/creator/:address/leaderboard` (caché 30–60 s).
- Admin → 🏆 Creator Points → 🏆 Creator Leaderboard & Seasons
  (snapshot, backfill, ciclo de vida de temporadas, auditoría).

## Base de datos

`docs/SQL_CREATOR_LEADERBOARD.md` — `creator_seasons`,
`creator_leaderboard_snapshots`, `creator_season_snapshots`. Append-only,
RLS de solo lectura para `anon`/`authenticated`, escritura solo
`service_role`.
