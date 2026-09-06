# 🏆 Creator Levels + Progression System (Fase 2C)

Creator Levels convierten los **Creator Points** en una progresión visual.
No son un token, no son BNB, no tienen valor monetario, no otorgan recompensas
ni airdrops, y no ejecutan ninguna transacción on-chain.

```
REAL ACTIVITY → CREATOR POINTS (ledger) → CREATOR LEVEL (derived) → PROFILE / DIRECTORY
```

## Fuente de verdad

| Concepto        | Origen                                            | Rango  |
| --------------- | ------------------------------------------------- | ------ |
| Creator Score   | `creator-score.ts` (calidad / reputación)          | 0–100  |
| Creator Points  | `SUM(creator_points_ledger.points)` (Fase 2B)      | 0–∞    |
| Creator Level   | **Derivado** de Creator Points                     | 1–7    |

No existe una tabla `creator_levels_balance`, ni puntos alternativos, ni forma
de comprar niveles. El nivel se recalcula en cada lectura a partir de los puntos.

## Niveles por defecto

| Level | Icon | Name            | Min Points |
| ----- | ---- | --------------- | ---------- |
| 1     | 🏁   | New Creator     | 0          |
| 2     | 🌱   | Rising Creator  | 500        |
| 3     | 🔥   | Active Creator  | 2,000      |
| 4     | ⚡   | Pro Creator     | 5,000      |
| 5     | 💎   | Elite Creator   | 15,000     |
| 6     | 👑   | Master Creator  | 50,000     |
| 7     | 🏆   | Legend Creator  | 150,000    |

## Cálculo

`calculateCreatorLevel(totalPoints, config)` (`src/lib/levels/levels-rules.ts`):

- **current level**: el nivel de mayor `minPoints` que no supera `totalPoints`.
- **next level**: el siguiente nivel de la escalera, o `null` en el último.
- **progress**: `(points - currentMin) / (nextMin - currentMin)`, limitado a 0–100
  y redondeado. En el último nivel siempre es `100`.
- **points remaining**: `max(0, nextMin - points)`; `0` en el último nivel.

Ejemplo: 8,500 puntos → ⚡ Pro Creator, 8,500 / 15,000, 35 %, faltan 6,500 para
Elite Creator.

## Configuración

Se persiste en la tabla existente **`admin_config`**, clave **`creator_levels`**
(`is_public: false`). No se creó ninguna tabla nueva.

```json
{
  "enabled": true,
  "levels": [
    { "level": 1, "name": "New Creator", "icon": "🏁", "minPoints": 0, "benefits": ["profile_badge"] }
  ]
}
```

Validaciones (`validateLevelsConfig`): niveles consecutivos desde 1, nivel 1 en 0
puntos, umbrales enteros, positivos, únicos y ascendentes, nombres e iconos no
vacíos, máximo 20 niveles.

Cambiar los umbrales recalcula el nivel mostrado, **nunca** modifica
`creator_points_ledger`.

### Estado desactivado

Con `enabled: false` no se borra nada: el perfil muestra
"Creator Levels temporarily unavailable", el directorio omite la insignia y el
Creator Points Engine sigue funcionando igual.

## Seguridad

- Todo cálculo ocurre en el servidor; el frontend sólo presenta el resultado.
- No existe ninguna mutación que acepte `level`, `points` o `progress` desde el cliente.
- La escritura de configuración exige sesión de admin + CSRF (`requireAdmin`) y queda
  registrada en el audit log (`admin.levels.config`).
- Las direcciones se validan con el mismo regex EVM que Creator Profiles; la
  paginación mantiene los límites existentes.

## API

- `GET /api/public/creators?limit=50` → cada fila incluye `creatorPoints` y
  `creatorLevel { level, name, icon, progressPercent, pointsToNextLevel, nextLevelName }`.
- Server functions (`src/lib/levels.functions.ts`): `getCreatorLevel`,
  `getLevelsConfig` (públicas) y `getLevelsOverview`, `saveLevelsConfig` (admin).

No se crearon endpoints redundantes.

## Rendimiento

El directorio usa `totalsByCreator()` — una única consulta agregada para toda la
página — más la caché de perfiles existente. No hay N+1.

## Level-up

`CreatorLevelSection` detecta `previousLevel < currentLevel` y muestra un toast
"🎉 Level Up!". Es puramente visual, no otorga puntos y es idempotente: el último
nivel visto se guarda en `localStorage` por dirección, así que refrescar (F5) o
reejecutar el cron no repite el evento.

## Extensiones futuras

`level.benefits` ya existe en el modelo con valores no monetarios
(`profile_badge`, `creator_page_highlight`). No hay beneficios económicos,
descuentos, rewards ni asignación de airdrop.
