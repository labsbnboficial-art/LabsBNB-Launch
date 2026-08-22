# P-1 FIX — AntiBot nunca puede bloquear una venta

Fecha: 2026-08-22 · Alcance: `contracts/src/BondingCurve.sol` + tests Foundry. Sin deployment.

## Causa raíz

`_checkAntiBot(who, isBuy, ...)` se invocaba también desde `sell()`. Aunque `pause()` ya no
bloqueaba las salidas, la configuración de `setAntiBot()` sí lo hacía por vía indirecta:

- `cooldownSeconds` se evaluaba en ventas → un cooldown alto (hasta `type(uint32).max`)
  congelaba la salida del holder.
- `maxTxTokens` se evaluaba en ventas → un valor mínimo impedía vender el saldo.
- `antiSandwich` / `antiFlashloan` se evaluaban en ventas → un contrato/smart wallet o un
  holder que hubiera comprado en el mismo bloque no podía salir.

Resultado: el owner de la factory podía, sin recibir fondos, limitar o congelar las ventas.

## Cambio realizado

1. `_checkAntiBot(...)` se reemplaza por `_checkAntiBotBuy(who, tokenAmount, bnbAmount)`:
   contiene exactamente las mismas validaciones de COMPRA (anti-flashloan, anti-sandwich,
   cooldown, maxBuyBnb, maxTxTokens, maxWalletTokens), sin rama de venta.
2. Nuevo helper `_recordAction(who)` que sólo actualiza `lastActionBlock` / `lastActionTs`.
3. `buy()` llama a `_checkAntiBotBuy(...)` (protección intacta).
4. `sell()` ya no ejecuta ninguna validación AntiBot: sólo `_recordAction(msg.sender)`, para
   que la venta siga contando como actividad de referencia en las protecciones de compra.
5. `sell()` sigue sin `whenNotPaused`.

No se tocaron fees, fórmula de la curva, migración/graduación, `skim()`, ownership,
treasury/feeWallet, scripts de deploy ni frontend. No se usa `tx.origin`, no hay nuevos
privilegios ni bypass para el owner. El ABI público no cambia (funciones internas).

## Funciones afectadas

- `_checkAntiBot` → `_checkAntiBotBuy` (renombrada y reducida a BUY)
- `_recordAction` (nueva, interna)
- `buy()` (una línea: nueva llamada)
- `sell()` (una línea: registro de actividad en lugar de validación)

## Tests añadidos — `contracts/test/AntiBotP1.t.sol`

| Test | Verifica |
| --- | --- |
| `testNormalConfigBuyAndSellWork` | Config normal: buy y sell OK |
| `testMaxTxDoesNotBlockSell` | `maxTxTokens = 1` limita buy, no sell |
| `testCooldownDoesNotBlockSell` | `cooldownSeconds = max` limita buy, sell inmediato OK |
| `testPauseBlocksBuyNotSell` | `pause()` bloquea buy, sell operativo |
| `testSandwichAndFlashloanOnlyAffectBuy` | Anti-sandwich y anti-flashloan siguen protegiendo buy; sell en el mismo bloque permitido |
| `testAggressiveAntiBotCannotFreezeExit` | Config máxima agresiva + pause: la salida total sigue disponible |
| `testFeesAndBalancesAfterSell` | Payout = `quoteSell`, fees a protocolo y creador, `balance == bnbCollected` |

## Resultado de tests

- Foundry: `forge test` → **35 passed, 0 failed** (28 suite existente + 7 P-1).
- Typecheck (`tsgo`): sin errores.
- App tests (`vitest run`): 19 passed.
- Build (`bun run build`): OK.

## Riesgos restantes

- Una venta actualiza `lastActionBlock`/`lastActionTs`, por lo que puede retrasar una COMPRA
  posterior del mismo wallet (comportamiento buscado del anti-sandwich; nunca afecta a ventas).
- AntiBot sigue pudiendo endurecerse contra las compras hasta hacerlas inviables; es una
  palanca administrativa aceptada, no bloquea la salida de fondos.
- Fuera de alcance de esta fase: Factory Mainnet sin desplegar, proveedor de `eth_getLogs`
  para Mainnet y decisión de multisig (ver `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`).
