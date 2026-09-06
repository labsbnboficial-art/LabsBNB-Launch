# 🎁 Creator Rewards & Airdrop Eligibility (Fase 2F)

Motor de **elegibilidad**, no de distribución. El sistema evalúa qué creadores
cumplen los criterios de un programa y publica el resultado con su desglose.
**No transfiere tokens, no promete cantidades y no ejecuta ninguna transacción
on-chain.** Tampoco toca los contratos (chain 56) ni maneja claves privadas.

## Separación de capas

| Capa | Qué es | Dónde vive |
| --- | --- | --- |
| Reputación | Points, Creator Score, Levels, Achievements | Fases 2B–2E |
| Competición | Leaderboard y temporadas | Fase 2E |
| **Elegibilidad** | **Reglas + evaluación + snapshots** | **Fase 2F** |
| Distribución | Reparto real de valor | **No implementada** |

La elegibilidad **lee** las capas anteriores; nunca crea puntos, niveles,
logros ni posiciones.

## Programas

Cada programa tiene ciclo de vida `draft → scheduled → active → ended → archived`.
Un programa `ended` o `archived` es **inmutable**: ni fechas ni reglas.

Ventanas de evaluación:

- `current` — sin acotar, evalúa el estado actual.
- `season` — usa exactamente la ventana de la temporada asociada.
- `historical` — ventana explícita (inicio y fin obligatorios).

La ventana es única por programa, de modo que toda la actividad se atribuye a
un solo periodo.

## Criterios

`points`, `score`, `level`, `achievements`, `graduations`, `organic`, `seasonRank`.

Cada criterio tiene:

- `enabled` — si participa en la evaluación,
- `minimum` — umbral (en `seasonRank` es "Top N": menor es mejor),
- `required` — **hard requirement** (si falla, no elegible) o soft (solo suma),
- `weight` — peso en el *eligibility score*.

El *eligibility score* (0–100) es una métrica interna de progreso. **No es una
cantidad de tokens ni el Creator Score.** El peso de los criterios sin datos se
redistribuye entre los disponibles.

## Estados

| Estado | Significado |
| --- | --- |
| `eligible` | Cumple todos los requisitos obligatorios |
| `not_eligible` | Falla al menos un requisito obligatorio |
| `pending` | Falta algún dato real → **N/A**, nunca FAIL |
| `excluded` | Regla anti-farming o lista de bloqueo |

Un dato ausente jamás se convierte en `0`: se muestra `N/A` y el creador queda
en revisión hasta la siguiente ejecución.

## Anti-farming

Señales derivadas de la actividad orgánica ya existente, sin identidad
artificial ni datos personales:

- `self_trade_detected` — ≥10 trades con una única wallet compradora y vendedora.
- `circular_activity` — ≥20 trades con ratio trades/wallets ≥ 25.
- `non_organic_activity` — volumen orgánico < 25 % del volumen con ≥10 trades.

Además, el admin puede exigir participación en la temporada y mantener una
lista de direcciones bloqueadas.

## Snapshots e idempotencia

Cada evaluación escribe un snapshot **append-only** con `fingerprint` SHA-256 de
`ELIGIBILITY|chain|program|v{ruleVersion}|creator|window|bucket` (bucket de 15
minutos). El índice único sobre `fingerprint` + `ignoreDuplicates` garantiza que
ejecuciones repetidas o concurrentes no dupliquen filas. Un lock con TTL de 10
minutos evita solapamientos.

Editar las reglas **siempre** crea una `rule_version` nueva. Los snapshots
antiguos conservan su versión y nunca se recalculan.

## Superficies

- `/rewards` — programas públicos, requisitos y creadores elegibles.
- `/rewards/:slug` — detalle con pestañas Elegibilidad / Estadísticas / Reglas.
- `/creator/:address` — bloque **Rewards Eligibility** con PASS / FAIL / N/A.
- Admin → Points → **Rewards & Eligibility**: crear programas, editar reglas
  (versionadas), cambiar estado, dry-run y evaluación real. Todo con sesión
  admin + CSRF y registrado en `admin_audit_log`.

## API pública

| Endpoint | Cache |
| --- | --- |
| `GET /api/public/rewards` | 60 s |
| `GET /api/public/rewards/:slug` | 60 s |
| `GET /api/public/rewards/:slug/eligibility?filter=&page=&pageSize=` | 30 s |
| `GET /api/public/creator/:address/rewards` | 60 s |
| `POST /api/public/rewards/run` | protegido por secreto compartido |

## Base de datos

Aplica `docs/SQL_CREATOR_REWARDS_ELIGIBILITY.md`. Hasta entonces la UI muestra
un aviso y todas las lecturas degradan a "no disponible" sin romper nada.

## Aviso

Cumplir los criterios indica **elegibilidad**, no una recompensa garantizada.
No existe ningún compromiso de cantidad, token ni fecha de distribución.
