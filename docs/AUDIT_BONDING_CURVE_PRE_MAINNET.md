# AUDITORÍA PRE-MAINNET — LabsBNB Bonding Curve

Fecha: 2026-08-20 · Alcance: `contracts/src/LabsBNBFactory.sol`, `contracts/src/BondingCurve.sol`,
`contracts/src/LabsBNBToken.sol`, frontend de trading (`src/components/labsbnb/TradePanel.tsx`,
`src/lib/web3/*`, `src/lib/launchpad-config.ts`).
Modo: **solo lectura**. No se modificó código, no se desplegó nada, no se ejecutaron transacciones.

---

## 0. DATOS ON-CHAIN REALES (BSC Testnet, chainId 97, leídos hoy)

| Dato | Valor real on-chain |
|---|---|
| Factory | `0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9` |
| Factory `owner()` | `0xbd93228c75EE66692dE048B05782DBF1c4Bb53c4` |
| Factory `feeWallet()` | **`0xbd93228c75EE66692dE048B05782DBF1c4Bb53c4`** (= deployer) |
| Wallet declarada en la app | `0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e` |
| `feeBps()` | 50 (0.50 %) |
| `pancakeRouter()` | `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` (Pancake V2 testnet) |
| Tokens creados | 16 |
| Threshold (`MIGRATION_THRESHOLD`) | 24 BNB (constante, inmutable) |
| Antibot por defecto en curvas vivas | maxBuy 2 BNB, maxWallet 0, maxTx 0, cooldown 3 s, antiSandwich ✅, antiFlashloan ✅, enabled ✅ |
| Ejemplo curva `0x3239a0fD…5Eb9` | sold 549.279.668 tk · bnbCollected 3,50529 · balance real 3,50529 · migrated false |
| Ejemplo curva `0xFA40E585…EcCB` | sold 24.077.834 tk · bnbCollected 0,04965 · balance real 0,04965 |

`bnbCollected == balance real` en todas las curvas leídas → **contabilidad BNB sincronizada**.

### Wallets económicas detectadas
- **FACTORY FEE WALLET (real):** `0xbd93228c75EE66692dE048B05782DBF1c4Bb53c4` ← recibe el **protocol fee 0,50 %** de cada buy/sell.
- **TREASURY (declarada en app/DB):** `0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e` ← hoy **NO recibe nada del curve**; sólo cobra pagos off-curve (Impulso, advanced creation fee, campañas) que verifica el backend.
- **CREATOR:** dirección que llamó `createToken()`; recibe **0,20 %** de cada buy/sell, pagado directo por la curva.
- **REFERRER:** dirección opcional pasada en `buy()`; recibe **0,10 %** sólo en compras.
- **Owner:** `0xbd93…53c4` — controla feeBps, feeWallet, antibot, pause y emergencyWithdraw de **todas** las curvas.

---

## 1. FÓRMULA EXACTA DE LA CURVA

Reservas virtuales (constantes de contrato):
```
VIRTUAL_BNB     = 1.6 BNB
VIRTUAL_TOKENS  = 800.000.000 tk
CURVE_ALLOC     = 800.000.000 tk   LP_ALLOC = 200.000.000 tk   TOTAL_SUPPLY = 1.000.000.000 tk (18 dec)

rBNB = VIRTUAL_BNB + bnbCollected
rTOK = VIRTUAL_TOKENS - tokensSold
price = rBNB * 1e18 / rTOK          marketCap = price * TOTAL_SUPPLY / 1e18
```
BUY (`buy(minTokensOut, referrer)`):
```
protoFee   = value * feeBps/10000            (0,50 %)
creatorFee = value * 20/10000                (0,20 %)
refFee     = hasRef ? value * 10/10000 : 0   (0,10 %)
net        = value - protoFee - creatorFee - refFee
tokensOut  = net * rTOK / (rBNB + net)       ← constant product x*y=k
tokensSold += tokensOut ; bnbCollected += net
```
SELL (`sell(tokensIn, minBnbOut)`):
```
gross  = tokensIn * rBNB / (rTOK + tokensIn)
fees   = gross*feeBps/10000 + gross*20/10000
bnbOut = gross - fees
tokensSold -= tokensIn ; bnbCollected -= gross
```
Graduation: dentro de `buy()`, si `bnbCollected >= 24 BNB` → `_migrate()`.

---

## 2. SIMULACIONES MATEMÁTICAS (sin transacciones)

| Escenario | Resultado |
|---|---|
| Buy 0,000001 BNB | 496,49 tk · round-trip devuelve 0,000000986 BNB (−1,395 % = fees ida+vuelta) ✅ coherente |
| Buy 0,01 BNB | 4.934.376 tk · round-trip −1,395 % ✅ |
| Buy 1 BNB | **306.363.285 tk = 30,6 % del supply total** en una sola compra |
| Buy 2 BNB (max buy actual) | **443.056.330 tk = 44,3 % del supply** |
| Buy 30 BNB | 759.222.682 tk, no excede CURVE_ALLOC, dispara migración en la misma tx |
| Buy 1 wei | 499.999.999 wei-tokens, coll +1 wei (sin token gratis) |
| Sell 1 wei-token | 0 BNB (redondeo a favor del pool) ✅ |
| 10 × buy 1 BNB → vender todo | entra 10 BNB, sale 9,86049 BNB; residual `bnbCollected` = 4 wei, `tokensSold` = 4 wei |
| Camino a graduation con maxBuy 2 BNB | **13 compras** bastan para graduar (25,8 BNB) |

**Conclusión matemática:** no hay tokens gratis, ni BNB gratis, ni pérdida por redondeo; el residuo es de unos pocos wei siempre **a favor del pool**. Reservas internas y balance real coinciden.
**Pero la curva es económicamente muy plana:** con sólo 1,6 BNB de reserva virtual frente a un threshold de 24 BNB, el primer comprador con 1–2 BNB se lleva 30–44 % del supply. Es el hallazgo económico más relevante para mainnet.

---

## 3. INFORME DE HALLAZGOS

### 🔴 CRÍTICO

**C-1 · Fee wallet on-chain ≠ wallet declarada**
`LabsBNBFactory.feeWallet` = `0xbd93228c75EE66692dE048B05782DBF1c4Bb53c4` (**el deployer**), mientras la app, la DB y el panel muestran `0x60e655Fe…e05e`. El 0,50 % de todo el volumen de bonding curve está llegando al deployer, no a la tesorería declarada. *Impacto:* desvío total de ingresos de protocolo + inconsistencia contable en el dashboard de Fees. *Recomendación (no aplicada):* `setFeeWallet(0x60e6…)` antes de mainnet, o desplegar con el argumento correcto.

**C-2 · `emergencyWithdraw` permite vaciar la curva (rug técnico)**
`BondingCurve.emergencyWithdraw(address to)` (línea ~130) envía **todo el BNB y todos los tokens** de una curva no migrada a donde el owner de la Factory quiera, sin timelock, sin límite, sin evento previo. *Impacto:* el owner puede quedarse con el 100 % de los fondos de todos los usuarios de todas las curvas. *Riesgo de centralización máximo.*

**C-3 · Migración sin protección de precio (LP sniping)**
`_migrate()` llama `addLiquidityETH(..., amountTokenMin=0, amountETHMin=0, to=0xdead, ...)`. Si un atacante crea antes el par token/WBNB con una ratio manipulada, el router aporta liquidez a esa ratio y devuelve el sobrante; el atacante extrae la diferencia. Además, el BNB devuelto por el router queda **atrapado para siempre** (tras `migrated=true`, `emergencyWithdraw` revierte con `"migrated"`). *Impacto:* pérdida parcial o total de las 24 BNB de liquidez en la graduación.

### 🟠 ALTO

**A-1 · Graduation dentro de `buy()` → DoS permanente si el router falla**
`_migrate()` se ejecuta en la misma tx que la compra que cruza el threshold. Si `addLiquidityETH` revierte (par manipulado, router pausado, gas), **toda compra que cruce 24 BNB revierte** y el token queda congelado justo bajo el threshold. No hay `migrate()` externo ni reintento.

**A-2 · `pause()` sin salida para el usuario**
`buy` y `sell` son `whenNotPaused`. El owner puede pausar indefinidamente y los holders quedan sin poder vender. No existe modo "sólo venta".

**A-3 · `setFee` modificable en caliente hasta 5 %**
`LabsBNBFactory.setFee(bps)` (cap 500 bps) afecta inmediatamente a todas las curvas existentes, sin timelock ni aviso. Un usuario puede firmar una compra con 0,5 % y ejecutarse con 5 %.

**A-4 · Diseño económico de la curva (reserva virtual 1,6 BNB)**
Ver simulaciones: 1 BNB = 30 % del supply, 13 compras gradúan el token. En mainnet esto favorece extremadamente al primer comprador/bot y hace irrelevante la fase de curva. Requiere revisión de `VIRTUAL_BNB` / threshold antes de fondos reales.

### 🟡 MEDIO

**M-1 · `antiFlashloan` bloquea smart-contract wallets**
`extcodesize(who) > 0 || who != tx.origin` → Safe, Argent, cuentas AA (ERC-4337) y agregadores **no pueden operar**. Está activo por defecto en todas las curvas vivas.

**M-2 · `quoteBuy` ignora el referral fee**
`quoteBuy` usa `_totalFeeBps(false)`; con referrer el `tokensOut` real es ~0,10 % menor que la cotización que muestra el frontend. El slippage del 1 % lo absorbe, pero interfaz ≠ contrato.

**M-3 · Evento `Trade` inconsistente entre buy y sell**
En buy `amountBnb = msg.value` (bruto); en sell `amountBnb = bnbOut` (neto). El volumen calculado desde eventos por el frontend/Signals queda sesgado.

**M-4 · `holders` sólo incrementa**
`counted[]` nunca se limpia: quien vende todo sigue contando. La métrica "holders" del contrato está inflada; el frontend usa además su propio cálculo (`src/lib/web3/holders.ts`), duplicando fuentes de verdad.

**M-5 · `volume24h` / `priceChange` son aproximaciones**
Ventana de 24 h reiniciada por evento (`_rollVolume`), no deslizante; `priceRefPrice` se actualiza sólo cuando hay trades. Sin operaciones durante >24 h, `priceChange` queda congelado.

### 🔵 BAJO

- **B-1** BNB enviado por `receive()` (donaciones) no entra en `bnbCollected` y no se puede recuperar tras migrar.
- **B-2** Residuos de 1–4 wei en `bnbCollected`/`tokensSold` tras ciclos completos (siempre a favor del pool).
- **B-3** Auto-referral con una segunda wallet permite auto-rebate del 0,10 %.
- **B-4** `progress()`/`estimatedMigration()` dividen por constante; sin riesgo, pero devuelven >10000 bps si una sola compra supera el threshold antes de migrar.
- **B-5** Factory sin fee de creación on-chain: crear tokens es gratis (spam), la fee "advanced" se cobra off-curve y la valida el backend.

### 🟢 OK

- Contabilidad BNB: `balance == bnbCollected` verificado on-chain en las curvas activas. ✅
- Sin overflow/underflow: Solidity 0.8.24 con checked math; ninguna simulación produce salida > reservas. ✅
- `nonReentrant` en `buy`/`sell`; `migrated = true` antes de la llamada externa al router. ✅
- Slippage real: `minTokensOut` / `minBnbOut` comprobados en el contrato y usados por el frontend (1 %). ✅
- Anti-sandwich (mismo bloque) y cooldown (3 s) activos y verificados on-chain. ✅
- Token ERC-20 sin mint/burn adicional, supply fijo, 18 decimales, sin owner. ✅
- Tokens LP quemados a `0xdead` → liquidez bloqueada permanentemente. ✅
- Frontend: chainId 97 forzado, Factory correcto, ABIs correctos, `curveOf()` usado, `quoteBuy/quoteSell` leídos del propio contrato, `approve` previo a `sell`, simulación previa a cada tx. ✅
- Frontend nunca calcula precios por su cuenta: todas las cifras vienen del contrato. ✅ (única excepción: M-2).

---

## 4. FLUJO DE GRADUATION (paso a paso, no ejecutado)

```
BUY que cruza el umbral
 → bnbCollected >= 24 BNB
 → _migrate() en la MISMA transacción
   → migrated = true (bloquea buy y sell para siempre)
   → approve(router, 200.000.000 tk)
   → addLiquidityETH{value: bnbCollected}(token, 200M, min 0, min 0, to=0xdead, +300s)
   → pancakePair = PancakeFactory.getPair(token, WBNB)
   → tokens sobrantes de la curva → 0xdead (quemados)
   → emit Migrated(pair, bnbLiquidity, tokenLiquidity)
 → ESTADO FINAL: curva cerrada, LP quemado, trading sólo en PancakeSwap V2
```
Doble ejecución: imposible (`notMigrated` + `migrated=true` al inicio de `_migrate`). ✅
Ventas tras graduación: **bloqueadas en la curva** (`notMigrated`), sólo en el DEX.

---

## 5. PREPARADO PARA MAINNET

| Área | Estado |
|---|---|
| Matemática de la curva (x*y=k, redondeo, precisión) | ✅ Correcto |
| Contabilidad BNB/tokens y sincronía de reservas | ✅ Correcto |
| Reentrancy / overflow / acceso no autorizado | ✅ Correcto |
| Slippage y coherencia frontend↔contrato | ✅ Correcto (⚠️ M-2 referral) |
| Antibot / anti-sandwich | ⚠️ Requiere revisión (bloquea smart wallets) |
| Fee wallet on-chain | ❌ No preparado (C-1: apunta al deployer) |
| Poderes de emergencia / pause | ❌ No preparado (C-2, A-2: rug técnico posible) |
| Proceso de graduación / migración de liquidez | ❌ No preparado (C-3, A-1: sin min amounts, DoS) |
| Parametrización económica (VIRTUAL_BNB vs threshold) | ⚠️ Requiere revisión (A-4) |
| Gobernanza de fees (setFee en caliente) | ⚠️ Requiere revisión (A-3) |

---

## 6. CONCLUSIÓN FINAL

La **matemática** de la bonding curve es sólida: constante de producto correcta, sin fugas de fondos,
sin exploits de redondeo, reservas internas perfectamente sincronizadas con el balance real
(verificado on-chain en 16 tokens desplegados). El frontend refleja fielmente lo que ejecuta el contrato.

Sin embargo, **la Bonding Curve NO está lista para Mainnet** por tres motivos bloqueantes:

1. 🔴 el fee wallet real es el deployer, no la tesorería declarada;
2. 🔴 `emergencyWithdraw` + `pause` permiten al owner vaciar o congelar fondos de usuarios sin restricción;
3. 🔴 la migración a PancakeSwap se hace con `min = 0` y dentro del `buy`, exponiéndola a sniping del par y a un bloqueo permanente si el router falla.

A ello se suma un ⚠️ de diseño económico: con 1,6 BNB de reserva virtual, una sola compra de 1–2 BNB
absorbe el 30–44 % del supply y 13 compras gradúan el token.

Ninguna corrección fue aplicada, conforme a lo solicitado.
