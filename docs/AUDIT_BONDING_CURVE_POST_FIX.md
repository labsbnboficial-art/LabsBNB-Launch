# SEGUNDA AUDITORÍA — BONDING CURVE POST-FIX (PRE-MAINNET)

Fecha: 2026-08-20 · Alcance: cambios de `docs/BONDING_CURVE_SECURITY_FIX.md`
Modo: **solo lectura**. No se modificó código, no se desplegó nada, no se ejecutaron transacciones.
Archivos auditados: `contracts/src/LabsBNBFactory.sol`, `contracts/src/BondingCurve.sol`,
`contracts/script/Deploy.s.sol`, `contracts/deploy.sh`, `contracts/.env.example`,
`contracts/abi/*`, `src/lib/web3/abis/*`, `src/lib/launchpad-config.ts`, frontend consumidor.

---

## 1. FEE WALLET

| Punto | Resultado |
|---|---|
| `feeWallet` explícito en constructor | 🟢 OK |
| `treasury` explícito | 🟢 OK (declarado on-chain; aún no usado por el backend) |
| `Ownable2Step` | 🟢 OK — `transferOwnership` + `acceptOwnership`, `pendingOwner()` en ABI |
| Guard anti-deployer en mainnet | 🟢 OK en constructor y `setFeeWallet` (`chainid == 56`), replicado en `Deploy.s.sol` y `deploy.sh` (también para treasury) |
| Eventos | 🟢 `FeeWalletUpdated`, `TreasuryUpdated`, `FeeUpdated`, `FeeChangeQueued/Cancelled`, `CreatorFeeUpdated`, `ReferralFeeUpdated` |
| Cambio de fee wallet | 🟢 `setFeeWallet` con `ZeroAddress()` y guard de mainnet |
| Estado inválido | 🟠 ver F-1 y F-2 |

**Confirmación:** con `ALLOW_OWNER_FEE_WALLET=false` (default) es **imposible** que en chainid 56 los fees
terminen en el deployer, tanto en el deploy como en un `setFeeWallet` posterior. El guard **no aplica en
testnet (97)** — correcto y documentado.

### 🟠 F-1 — `renounceOwnership()` sigue disponible
- Archivo/función: `LabsBNBFactory.sol` (heredado de `Ownable`).
- Impacto: si el owner renuncia, el Factory queda sin owner → `setFee`, `setFeeWallet`, y en **todas las
  curvas** `pause/unpause`, `setAntiBot`, `skim`, `enableRefund` quedan bloqueados para siempre
  (`onlyFactoryOwner` consulta `factory.owner()`, que pasaría a ser `address(0)`).
- Riesgo: MEDIO-ALTO (irreversible, pero requiere acción deliberada del owner).
- Recomendación: sobrescribir `renounceOwnership()` con `revert`.

### 🟠 F-2 — Pagos push: un `feeWallet`/`creator` que revierte bloquea el trading
- Archivo/función: `BondingCurve._payFee` (llamado en `buy` y `sell`).
- Descripción: los fees se envían con `call` y **la tx revierte si el receptor rechaza BNB**. `creator` es
  `immutable`. Si el creador es un contrato (o una wallet-contrato) que empieza aceptando BNB y luego deja
  de hacerlo, **todas las ventas de ese token revierten** y los holders quedan atrapados. Lo mismo aplica
  globalmente si `feeWallet` se apunta a un contrato que revierte (mitigable cambiando el wallet).
- Impacto: bloqueo total de salida por token (fondos de usuarios atrapados sin ruta de rescate: `sell`
  revierte y `redeem` sólo existe en `Refunding`).
- Riesgo: **ALTO** (afecta a la promesa central "la venta nunca se puede bloquear").
- Recomendación: pull-payments (acumular `pendingFees[to]` + `claim()`), o `call` con gas limitado cuyo
  fallo acumule el importe en vez de revertir.

---

## 2. SKIM

Implementación: `skimmableBnb()`, `skimmableTokens()`, `skim(to)` (`nonReentrant`, `onlyFactoryOwner`).

**BNB — reservado por fase**

| Fase | `reserved` | Comentario |
|---|---|---|
| Bonding | `bnbCollected` | invariante: `balance == bnbCollected + donaciones` |
| Graduating | `bnbCollected` | idéntico; no se puede tocar la reserva de la LP |
| Migrated | `0` | tras `migrate()` el balance ya se vació al router y al feeWallet |
| Refunding | `refundBnbPool` | pool pro-rata protegido |

**Demostración (Bonding/Graduating).** Sea `B` el balance del contrato. Cada `buy` hace
`B += msg.value` y luego paga `protoFee + creatorFee + refFee`, incrementando `bnbCollected += net`
con `net = msg.value − fees`; por tanto `ΔB = Δ bnbCollected`. Cada `sell` hace
`bnbCollected −= gross` y paga `protoFee + creatorFee + bnbOut = gross`; de nuevo `ΔB = Δ bnbCollected`.
Con `B₀ = bnbCollected₀ = 0`, se cumple en todo momento
`B = bnbCollected + D`, siendo `D ≥ 0` el BNB donado vía `receive()`.
`skimmableBnb() = max(B − bnbCollected, 0) = D`. **`skim` no puede extraer ni 1 wei contabilizado.** ∎

**Tokens.** `reserved = (CURVE_ALLOC − tokensSold) + LP_ALLOC`; el balance de tokens de la curva es
exactamente eso más lo donado, porque `buy` transfiere `tokensOut` y sube `tokensSold` en el mismo
importe, y `sell` hace la operación inversa. `skimmableTokens()` devuelve 0 fuera de Bonding/Graduating.

- Post-`buy` / post-`sell`: 🟢 excedente 0 salvo donaciones.
- Durante graduation: 🟢 protegido (reserva completa).
- Post-graduation: 🟢 el balance restante es polvo real; los tokens ya se quemaron en `0xdead`.

### 🔵 S-1 — Residuo bloqueado en `Refunding`
`refundBnbPool` sólo baja por `redeem`; si algún holder nunca canjea (o quemó tokens), ese BNB queda
inmovilizado permanentemente y `skim` no puede recuperarlo. Riesgo BAJO. Recomendación: permitir
`skim` del sobrante de refund tras un plazo largo (p.ej. 180 días).

---

## 3. PAUSE

- `buy` → `whenNotPaused` ✔ · `sell` → **sin** `whenNotPaused` ✔ · `migrate` / `redeem` → sin pausa ✔.
- Funciones admin siguen operativas con la curva pausada ✔.

### 🔴 P-1 — El antibot sí puede congelar las ventas (contradice el objetivo de C-2)
- Archivo/función: `BondingCurve.setAntiBot` + `_checkAntiBot` (rama `else` de venta).
- Descripción: `maxTxTokens` y `cooldownSeconds` se aplican **también a `sell`**. El factory owner puede
  fijar `maxTxTokens = 1 wei` o `cooldownSeconds = 4.294.967.295` (~136 años) y dejar las ventas
  efectivamente bloqueadas para siempre, sin `pause()`.
- Impacto: los usuarios pueden quedar atrapados por decisión unilateral del owner; `pause()` deja de ser
  el único vector de censura.
- Riesgo: **CRÍTICO** en el modelo de confianza declarado (no permite robar fondos, pero sí congelarlos).
- Recomendación: cap duro en código (`cooldownSeconds ≤ 60`, `maxTxTokens == 0 || ≥ X`), o excluir la
  venta de `maxTxTokens`/`cooldown`, o timelock para endurecer el antibot.

### 🟠 P-2 — `sell` bloqueado durante `Graduating`
`sell` lleva `onlyPhase(Bonding)`. Entre el cruce del umbral y una migración exitosa **nadie puede
vender**, y si `migrate()` es imposible la espera mínima es de 7 días **y** requiere que el owner llame
`enableRefund()` (discrecional, nunca permissionless). Estado de atrapamiento indefinido si el owner
desaparece. Riesgo ALTO. Recomendación: `enableRefund` permissionless tras `MIGRATION_GRACE + 30 días`.

---

## 4. REFUND PRO-RATA

- Condición: `phase == Graduating` **y** `block.timestamp ≥ graduatingSince + 7 days`, sólo factory owner.
- `refundBnbPool = address(this).balance` (incluye donaciones, a favor del usuario), `refundTokenPool = tokensSold`.
- Cálculo: `bnbOut = tokensIn * refundBnbPool / refundTokenPool` con **floor**; ambos pools se decrementan
  antes de las transferencias externas → 🟢 sin reentrancy y sin doble claim (los tokens se transfieren al
  contrato, no se puede reclamar dos veces con los mismos tokens).
- Quién reclama: cualquier holder con `approve` previo. Eventos `RefundEnabled` y `Redeemed` ✔.

**Simulación de suma.** Con pools `(P, T)` y canjes `t₁…tₙ` con `Σtᵢ ≤ T`:
tras cada canje `P' = P − ⌊tᵢP/T⌋` y `T' = T − tᵢ`, y se conserva `P'/T' ≥ P/T` (el floor deja residuo en
el pool). Por inducción `Σ bnbOutᵢ ≤ P₀` siempre, con residuo ≥ 0. **Nunca se puede pagar de más.** ∎
Verificado numéricamente con 3 holders (40/35/25 %) y con canjes parciales: suma = 99,999…% del pool.

### 🟡 R-1 — Refund no cubre la fase `Bonding`
Si el token se queda muerto sin llegar al umbral no hay refund, pero `sell` sigue abierto → aceptable.
### 🟡 R-2 — `refundTokenPool = tokensSold` ignora tokens quemados por holders
Los tokens enviados a `0xdead` por un usuario reducen los canjes efectivos y dejan residuo (ver S-1).

---

## 5. GRADUATION

- Fases `Bonding → Graduating → Migrated | Refunding` ✔. `phase` se cambia **antes** de la llamada externa
  y `nonReentrant` ✔ → doble migración imposible.
- `migrate()` permissionless y reintentable ✔; el fallo del router revierte toda la tx (incluido el cambio
  de fase) → el estado vuelve a `Graduating` y el error real es visible ✔.
- Post-éxito: `migrated = true`, `pancakePair` fijado, tokens sobrantes quemados, polvo BNB → feeWallet
  con evento `MigrationDust` ✔.

### Slippage "99 %" — interpretación exacta
`MIGRATION_SLIPPAGE_BPS = 100` (1 %). Los mínimos son
`minTokens = 99 % · LP_ALLOC` y `minBnb = 99 % · bnbCollected`, más una verificación posterior
`usedTokens ≥ minTokens && usedBnb ≥ minBnb`.
**No es una tolerancia del 99 %: es una tolerancia del 1 %.** El nombre "slippage 99 %" en la
documentación es engañoso, pero el comportamiento es **estricto y correcto**: el protocolo NO puede sufrir
una migración desfavorable; como mucho la migración **revierte**.

### 🟠 G-1 — DoS de migración por par pre-creado (sniping convertido en bloqueo)
- Archivo/función: `BondingCurve.migrate`.
- Descripción: cualquiera puede crear el par y sesgar la ratio con un importe mínimo antes de la
  graduación. `addLiquidityETH` respetará la ratio del par y usará menos de uno de los dos lados →
  el `require` de 1 % revierte. El ataque es repetible y muy barato → **migración bloqueada de forma
  indefinida**, saliendo por la vía de refund (7 días, discrecional) en el peor caso.
- Impacto: no hay pérdida de fondos; sí denegación permanente de la ruta a PancakeSwap.
- Riesgo: ALTO. Recomendación: si el par ya existe con reservas, calcular las cantidades a la ratio
  del par y aportar el máximo posible (con un mínimo de valor total), o `sync/skim` previo + tolerancia
  configurable por owner con cap.
- Frontrunning/sandwich del propio `migrate()`: sin impacto económico para el protocolo (los mínimos
  protegen); el sandwicher sólo puede provocar la reversión.

### 🔵 G-2 — `bnbCollected` no se pone a 0 tras migrar
`realLiquidity()` y `remainingBNB()` siguen reportando el valor histórico post-migración. Cosmético.

---

## 6. FEES

- Cap `MAX_PROTOCOL_FEE_BPS = 100` (1 %) ✔ · `FEE_TIMELOCK = 48h` ✔ · `applyFee()` valida
  `pendingFeeEta != 0` y `block.timestamp ≥ eta` ✔ · `cancelPendingFee()` ✔ · eventos completos ✔.
- Verificado en `testFactoryFeeCapAndTimelock` (28/28 en verde).

### 🟠 FE-1 — `creatorFeeBps` y `referralFeeBps` NO tienen timelock
`setCreatorFee` (cap 1 %) y `setReferralFee` (cap 0,5 %) se aplican **de inmediato**. El owner puede
elevar el coste total de trading de 0,80 % a 2,50 % en una sola tx sin espera. Riesgo MEDIO-ALTO.
Recomendación: aplicar el mismo timelock a las subidas de estas dos fees.

### 🔵 FE-2 — Las bajadas de `feeBps` son inmediatas (por diseño)
Respuesta explícita a la pregunta "¿ningún cambio puede aplicarse inmediatamente?": **las subidas, no;
las bajadas, sí** (favorables al usuario). Es intencional y está testeado.

### 🔵 FE-3 — Cambio de fee entre cotización y ejecución
Un `setFee`/`setCreatorFee` puede aterrizar entre `quoteBuy` y `buy`; el usuario está protegido por
`minTokensOut`/`minBnbOut` (revierte, no pierde).

---

## 7. QUOTES

Comparación línea a línea (orden de operaciones y redondeos idénticos):

| | quote | ejecución |
|---|---|---|
| buy | `proto=⌊in·p/1e4⌋`, `creator=⌊in·c/1e4⌋`, `ref=⌊in·r/1e4⌋`, `out=⌊(in−Σ)·rTOK/(rBNB+in−Σ)⌋` | idéntico |
| sell | `gross=⌊tin·rBNB/(rTOK+tin)⌋`, `proto`, `creator`, `out=gross−Σ` | idéntico |

🟢 **Coincidencia exacta al wei** (cubierto por `testQuoteBuyMatchesBuy`,
`testQuoteBuyWithReferralMatchesBuy`, `testQuoteSellMatchesSell`).

### 🟡 Q-1 — Auto-referral: divergencia quote vs ejecución
`buy` ignora el referral cuando `referrer == msg.sender` (`hasRef = false`), pero
`quoteBuyWithReferral(bnbIn, msg.sender)` **sí** descuenta `refFee`. El frontend cotizaría de menos
(la ejecución entrega más tokens; no perjudica al usuario, sí confunde a la UI). Recomendación: replicar
la condición `referrer != msg.sender` en la quote.

---

## 8. HOLDERS

- Incremento: primera compra (`counted[msg.sender]`) ✔. Decremento: venta que deja balance 0 ✔
  (`testHoldersDecrementsOnFullExit`). Compras/ventas múltiples: sin doble conteo ✔.

### 🟡 H-1 — `holders` no observa transferencias ERC-20
El contador sólo se actualiza en `buy`/`sell`. Un holder que transfiere todo su balance a otra wallet
sigue contado, y el receptor nunca se cuenta. También queda contado quien quema sus tokens.
`holders` es por tanto **"wallets que compraron y no vendieron todo en la curva"**, no "wallets con
balance > 0". Riesgo BAJO (métrica). Recomendación: contar en un hook `_update` del token, o calcular
holders off-chain por eventos `Transfer` (el frontend ya tiene `src/lib/web3/holders.ts`).

---

## 9. TRADE EVENT

`Trade(trader, isBuy, amountBnb, amountTokens, price, marketCap, timestamp)`.

- BNB bruto: ✔ en buy (`msg.value`) y en sell (`gross`), coherente para volumen.
- Tokens, precio post-trade, marketCap, timestamp: ✔. Buyer/seller: campo `trader` **indexado** ✔.
- Bloque: implícito en el log ✔.

### 🔵 T-1 — El evento no incluye el fee
Los indexadores deben cruzar con `FeeCollected` (no indexa el token/trade) para obtener el neto. Sugerido
añadir `fee` a `Trade` en un futuro redeploy. El Signal Engine y el frontend actuales sólo usan
`amountBnb`/`amountTokens`/`price` → 🟢 compatibles.
### 🔵 T-2 — `isBuy` no indexado: filtrar buys/sells requiere leer todos los logs (coste RPC).

---

## 10. ANÁLISIS ECONÓMICO A-4 (PRIORIDAD)

Fórmula real: `out = net·rTOK/(rBNB+net)` con `rBNB = 1,6 + bnbCollected`, `rTOK = 800M − tokensSold`,
fee total 0,80 % (0,50 + 0,20 + 0,10). Simulación desde curva virgen:

| Compra | % supply total (1.000M) | % de la curva (800M) | Precio ×  |
|---|---|---|---|
| 0,01 BNB | 0,49 % | 0,62 % | 1,006 |
| 0,1 BNB | 4,67 % | 5,84 % | 1,062 |
| 0,5 BNB | 18,93 % | 23,66 % | 1,31 |
| **1 BNB** | **30,62 %** | **38,27 %** | **1,62** |
| 2 BNB | 44,29 % | 55,36 % | 2,24 |
| 5 BNB | 60,49 % | 75,61 % | 4,10 |
| 10 BNB | 68,89 % | 86,11 % | 7,20 |

- **El hallazgo A-4 SIGUE VIGENTE E IDÉNTICO**: 1 BNB compra ~30,6 % del supply total. Las correcciones de
  seguridad no tocaron la economía (`VIRTUAL_BNB = 1,6`, `MIGRATION_THRESHOLD = 24`).
- Compras consecutivas de 1 BNB: **25 compras** gradúan la curva (24,8 BNB) vendiendo el 75 % del supply.
- Precio de graduación / precio inicial = **×272**; capital necesario para duplicar el precio: ~1,6 BNB
  desde cero (crece linealmente con la reserva: cerca del umbral hacen falta ~25 BNB para duplicar).
- Round-trip 1 BNB (buy → sell inmediato, sin otros trades): se recuperan **0,9841 BNB**, pérdida 1,59 %
  ≈ 2 × 0,8 % de fees. 🟢 No hay arbitraje de ida y vuelta rentable; el rounding deja residuos a favor de
  la curva (floor en cada componente, verificado en `testDustBuyNeverMintsFreeTokens` y
  `testReservesStayBackedByBalance`).
- Sell → buy: simétrico, misma pérdida por fees; ninguna secuencia extrae valor de la curva.
- Concentración: el primer comprador con 1–2 BNB controla 30–44 % del supply y puede vender contra la
  curva con un impacto de precio moderado, dominando el mercado hasta la graduación.
- Slippage por trade cerca del umbral: mucho menor (reserva 25,6 BNB) → la curva es **extremadamente
  desigual entre el primer comprador y el último**.

**Clasificación: 🟠 ALTO (diseño económico, no bug).** El antibot con `maxBuyBnb = 2 ether` limita el
sniping por tx, pero no por número de txs/wallets.

**Alternativas propuestas (no aplicadas):**
1. `VIRTUAL_BNB` de 1,6 → **6–8 BNB** manteniendo el umbral en 24: 1 BNB pasaría a comprar ~11 % (6) o
   ~9 % (8) del supply, y harían falta ~30–40 compras para graduar. Es el cambio de un solo parámetro.
2. Subir `MIGRATION_THRESHOLD` a 40–60 BNB junto con `VIRTUAL_BNB` proporcional, para conservar el
   múltiplo de precio en ×80–×120 en vez de ×272.
3. Mantener la curva agresiva pero endurecer el antibot por defecto: `maxBuyBnb = 0,25`,
   `maxWalletTokens = 2 % del supply`, cooldown 15–30 s durante los primeros N bloques.
4. Fee decreciente por tramos (mayor fee en el primer 20 % de la curva) para desincentivar el sniping.

---

## 11. OWNER EOA

Poderes actuales del owner del Factory (una sola EOA), sobre **todos** los tokens del launchpad:

| Función | Alcance | Riesgo |
|---|---|---|
| `setFee` (subida) | timelock 48 h, cap 1 % | 🟢 |
| `setFee` (bajada) / `applyFee` / `cancelPendingFee` | inmediato | 🟢 |
| `setCreatorFee`, `setReferralFee` | **inmediato**, cap 1 % / 0,5 % | 🟠 |
| `setFeeWallet`, `setTreasury` | inmediato (guard mainnet en feeWallet) | 🟡 |
| `transferOwnership` / `acceptOwnership` | 2 pasos | 🟢 |
| `renounceOwnership` | irreversible, deja el sistema sin admin | 🟠 (F-1) |
| `pause` / `unpause` (por curva) | bloquea sólo compras | 🟡 |
| `setAntiBot` (por curva) | **puede congelar las ventas** | 🔴 (P-1) |
| `setContractAllowed` | allowlist de smart wallets | 🟢 |
| `skim` | sólo excedente no contabilizado | 🟢 |
| `enableRefund` | sólo tras 7 días en Graduating; no recibe fondos | 🟡 |
| Graduación / `migrate` | permissionless, el owner no tiene privilegio | 🟢 |
| Retirada de fondos de usuarios | **imposible** | 🟢 |

**Clasificación del riesgo: 🟠 ALTO.** El owner ya **no puede robar**, pero con una sola EOA puede
(a) congelar salidas vía antibot, (b) subir creator/referral fee al instante, (c) dejar el sistema sin
admin. Una clave comprometida degrada el launchpad completo. Recomendación (no implementada): Gnosis Safe
2-de-3 o 3-de-5 como owner antes de mainnet, más los caps de P-1 y FE-1.

---

## 12. INTEGRACIÓN FRONTEND

- ABIs regeneradas y sincronizadas: `src/lib/web3/abis/BondingCurve.json` incluye `phase`, `migrate`,
  `redeem`, `enableRefund`, `skim`, `skimmableBnb/Tokens`, `quoteBuyWithReferral`, `setContractAllowed`;
  **`emergencyWithdraw` ya no existe** en ninguna ABI. Factory con constructor de 4 args, `treasury`,
  `applyFee`, `pendingFeeBps/Eta`, `acceptOwnership`, `pendingOwner`. 🟢
- Ninguna referencia a `emergencyWithdraw` en `src/`. 🟢
- El frontend sigue usando sólo funciones cuya firma no cambió (`quoteBuy`, `quoteSell`, `buy`, `sell`,
  `migrated`, `paused`, `progress`, `feeBps`, `feeWallet`, `curveOf`, `createToken`, eventos
  `TokenCreated`/`Trade`/`FeeCollected`) → 🟢 compatible con los contratos **antiguos y nuevos**.

### 🟠 FR-1 — Dirección desplegada obsoleta
`src/lib/launchpad-config.ts` apunta a `TESTNET_FACTORY = 0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9`,
que es la **versión anterior** del Factory. Las funciones nuevas (`phase()`, `quoteBuyWithReferral`,
`treasury()`, `applyFee()`) no existen en esa dirección. Hoy no se llaman, pero cualquier UI nueva que las
use fallará hasta redesplegar y actualizar la dirección.

### 🟡 FR-2 — UI sin cobertura de las nuevas capacidades
No hay interfaz para: fase de la curva / botón `migrate()`, estado de refund y `redeem()`, `skim`,
`acceptOwnership`, ni aviso de **fee pendiente por timelock** (el panel llama `setFee` y asume efecto
inmediato → mostrará un valor que aún no está activo). Recomendación: añadirlo junto al redeploy.

---

## 13. DEPLOY READINESS

| Punto | Estado |
|---|---|
| `deploy.sh` instala Foundry, deps, build, test, ABIs, deploy + verify | 🟢 |
| Guardarraíl mainnet (feeWallet/treasury ≠ deployer) en script y contrato | 🟢 |
| `CHAIN_ID` por defecto **97** y `RPC` por defecto **testnet** | 🟡 D-1 |
| `PANCAKE_ROUTER` por defecto **testnet** `0xD99D…50D1` | 🟠 D-2 |
| `FEE_WALLET` = `TREASURY_WALLET` = `0x60e6…e05e` (misma wallet) | 🟡 D-3 |
| Owner = deployer; sin transferencia a multisig en el script | 🟠 (ver §11) |
| Threshold / antibot | valores hardcodeados en la curva (24 BNB, maxBuy 2 BNB, cooldown 3 s) 🟡 D-4 |
| Contratos compilados y testeados 28/28 | 🟢 |

- **🟠 D-2:** para mainnet hay que exportar explícitamente
  `PANCAKE_ROUTER=0x10ED43C718714eb63d5aA57B78B54704E256024E`, `CHAIN_ID=56` y un `RPC_URL` de BSC
  mainnet. Nada valida que el `chainId` del RPC coincida con `CHAIN_ID`: un despliegue con `CHAIN_ID=56`
  contra un RPC de testnet (o viceversa) desactivaría los guards. Recomendación: `cast chain-id --rpc-url`
  y comparar antes de firmar.
- **🟡 D-3:** feeWallet y treasury idénticos anulan la separación conceptual protocolo/tesorería.
- **🟡 D-1/D-4:** `.env.example` sigue siendo un fichero de testnet; conviene una plantilla `.env.mainnet`.

---

## 14. RESULTADO FINAL

### Hallazgos

| ID | Sev | Problema | Archivo · función |
|---|---|---|---|
| P-1 | 🔴 | `setAntiBot` puede congelar las ventas (maxTxTokens/cooldown se aplican a `sell`) | `BondingCurve.setAntiBot` / `_checkAntiBot` |
| F-2 | 🟠 | Push-payments: `feeWallet`/`creator` que revierte bloquea buy y sell | `BondingCurve._payFee` |
| P-2 | 🟠 | `sell` bloqueado en `Graduating`; refund discrecional del owner | `BondingCurve.sell` / `enableRefund` |
| G-1 | 🟠 | DoS de migración con par pre-creado y ratio sesgada | `BondingCurve.migrate` |
| FE-1 | 🟠 | `setCreatorFee` / `setReferralFee` sin timelock | `LabsBNBFactory` |
| F-1 | 🟠 | `renounceOwnership` deja el sistema sin admin | `LabsBNBFactory` |
| A-4 | 🟠 | Curva ultra-agresiva: 1 BNB = 30,6 % del supply (sin cambios) | `BondingCurve` (VIRTUAL_BNB) |
| OWN | 🟠 | Owner EOA única con poderes de congelación | Factory + curvas |
| FR-1 | 🟠 | Dirección de Factory desplegada obsoleta en el frontend | `src/lib/launchpad-config.ts` |
| D-2 | 🟠 | Router/chain/RPC de mainnet no validados en el deploy | `contracts/deploy.sh` |
| Q-1 | 🟡 | Auto-referral: quote ≠ ejecución | `quoteBuyWithReferral` |
| H-1 | 🟡 | `holders` no observa transferencias ERC-20 | `BondingCurve` |
| R-2 / FR-2 / D-1 / D-3 / D-4 | 🟡 | Residuos de refund, UI incompleta, plantillas de deploy | varios |
| S-1 / G-2 / T-1 / T-2 / FE-2 / FE-3 | 🔵 | Cosméticos e informativos | varios |

### Tabla de componentes

| COMPONENTE | ESTADO | MAINNET |
|---|---|---|
| Factory | 🟢 OK con observaciones (F-1, FE-1) | SÍ con condiciones |
| BondingCurve | 🟠 estructura correcta, censura vía antibot | NO hasta corregir P-1 |
| Fees | 🟢 cap + timelock correctos; falta timelock creator/referral | SÍ con condiciones |
| Skim | 🟢 demostrado seguro | SÍ |
| Pause | 🟠 pause OK, pero antibot lo puentea | NO hasta P-1 |
| Refund | 🟢 matemática correcta; activación discrecional | SÍ con condiciones |
| Graduation | 🟠 sin pérdida de fondos, DoS posible | SÍ con condiciones |
| Quotes | 🟢 exactas al wei | SÍ |
| Holders | 🟡 métrica aproximada | SÍ |
| Trade events | 🟢 coherentes (BNB bruto) | SÍ |
| Frontend integration | 🟠 ABIs OK, dirección antigua y UI incompleta | SÍ tras redeploy |
| Economía | 🟠 A-4 sin resolver | NO sin decisión de producto |
| Owner | 🟠 EOA única con poder de congelar | NO sin multisig |
| Deploy configuration | 🟠 plantilla de testnet | NO sin config de mainnet |

### Conclusión

**¿Está preparada la Bonding Curve para Mainnet? → SÍ CON CONDICIONES.**

Las tres críticas de la primera auditoría (C-1 fee wallet, C-2 emergency withdraw, C-3 graduación) están
**correctamente resueltas**: el owner ya no puede extraer fondos de usuarios, la migración es
reintentable y protegida, y los fees no pueden caer en el deployer en mainnet. La matemática de la curva,
las quotes y el refund son correctos y demostrables.

Condiciones bloqueantes antes de mainnet:
1. **P-1** — capar `setAntiBot` para que nunca pueda congelar las ventas (única 🔴 abierta).
2. **F-2** — pull-payments o fee no bloqueante, para que un creador/feeWallet hostil no atrape holders.
3. **A-4** — decisión de producto sobre `VIRTUAL_BNB`/`MIGRATION_THRESHOLD` (1 BNB = 30,6 % del supply).
4. **Owner** — mover la propiedad del Factory a un multisig y bloquear `renounceOwnership`.
5. **Deploy** — router/chainId/RPC de mainnet verificados y `feeWallet ≠ treasury ≠ deployer`.

Recomendadas (no bloqueantes): P-2, G-1, FE-1, FR-1/FR-2, Q-1, H-1.
