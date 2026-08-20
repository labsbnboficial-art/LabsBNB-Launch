# BONDING CURVE — CORRECCIÓN DE BLOQUEANTES PRE-MAINNET

Fecha: 2026-08-20 · Base: `docs/AUDIT_BONDING_CURVE_PRE_MAINNET.md`
Estado: **implementado y testeado en local. NO desplegado. Sin transacciones reales.**

> ⚠️ Los contratos actualmente desplegados en BSC Testnet (`Factory 0x0738dA58…abD9`) siguen
> siendo la versión antigua. Estas correcciones **requieren un redeploy completo**
> (Factory + curvas nuevas). Los tokens ya creados no se pueden actualizar.

---

## 1. Archivos modificados

| Archivo | Cambio |
|---|---|
| `contracts/src/LabsBNBFactory.sol` | Config económica explícita, Ownable2Step, cap 1 %, timelock 48 h, guard anti-deployer |
| `contracts/src/BondingCurve.sol` | Fases de graduación, `migrate()` externo con slippage, refund pro-rata, `skim()` en vez de `emergencyWithdraw`, pause sólo-compras, allowlist smart wallets, quotes exactas, `Trade` coherente, `holders` decreciente |
| `contracts/script/Deploy.s.sol` | Nuevos parámetros (`TREASURY_WALLET`, `ALLOW_OWNER_FEE_WALLET`) + validaciones mainnet |
| `contracts/deploy.sh`, `contracts/.env.example` | Variables nuevas y guardarraíl de mainnet en el script |
| `contracts/test/BondingCurve.t.sol` | Suite ampliada a 28 tests |
| `contracts/abi/*.json`, `src/lib/web3/abis/*.json` | ABIs regeneradas |

Frontend: **sin cambios de lógica**. Todas las funciones que consume (`quoteBuy`, `quoteSell`,
`buy`, `sell`, `migrated`, `paused`, `progress`, `feeBps`, `feeWallet`, `setFee`, `curveOf`,
`createToken`, evento `TokenCreated`/`Trade`/`FeeCollected`) mantienen su firma.

---

## 2. Problemas corregidos

### 🔴 C-1 — Fee wallet dependiente del deployer (PRIORIDAD 1)

- `LabsBNBFactory` recibe ahora **cuatro** parámetros explícitos:
  `constructor(feeWallet, treasury, pancakeRouter, allowOwnerAsFeeWallet)`.
- `feeWallet` = receptor on-chain del protocol fee. `treasury` = receptor de cobros fuera de la
  curva (Impulso, campañas, advanced fee), declarado on-chain para que app y contrato coincidan.
- `creatorFeeBps` (cap 1 %) y `referralFeeBps` (cap 0,5 %) pasan de constantes de la curva a
  configuración del Factory; la curva las lee en cada trade.
- **Validación anti-deployer:** en `block.chainid == 56`, el constructor y `setFeeWallet`
  revierten con `FeeWalletIsOwner()` si `feeWallet == owner/deployer`, salvo que se declare
  `allowOwnerAsFeeWallet = true` de forma intencional. `deploy.sh` y `Deploy.s.sol` repiten el
  chequeo (también para la treasury) antes de firmar.
- Testnet puede seguir usando las direcciones actuales sin fricción (chainid 97 no aplica el guard).
- `Ownable2Step`: la transferencia de propiedad requiere aceptación del nuevo owner.

### 🔴 C-2 — Emergency withdraw / pause (PRIORIDAD 2)

Cambio de arquitectura (propuesto e implementado):

- **`emergencyWithdraw` eliminado.** El owner ya no puede, bajo ninguna circunstancia, retirar el
  BNB que respalda a los holders.
- **`skim(to)`**: única vía de rescate. Sólo mueve el **excedente no contabilizado**:
  `skimmableBnb() = balance − bnbCollected` (donaciones vía `receive`, polvo) y
  `skimmableTokens() = balance − (CURVE_ALLOC − tokensSold) − LP_ALLOC`. Revierte con
  `NothingToSkim()` si no hay excedente. Separa explícitamente fondos del protocolo de fondos de usuarios.
- **`pause()` sólo bloquea compras.** `sell()` ya no lleva `whenNotPaused`: la salida de los
  holders no se puede congelar nunca (corrige A-2).
- **Red de seguridad sin poder de rug:** si la migración es imposible durante `MIGRATION_GRACE`
  (7 días), el owner puede llamar `enableRefund()` — que **no le transfiere nada** — y los holders
  canjean sus tokens por su parte proporcional del BNB con `redeem()`.

### 🔴 C-3 / 🟠 A-1 — Graduation / migración de liquidez (PRIORIDAD 3)

- `buy()` **ya no llama al router**. Al cruzar 24 BNB la curva pasa a fase `Graduating`
  (`GraduationReady`), quedando cerradas compras y ventas para congelar las reservas de la LP.
- **`migrate()` público y reintentable**: cualquiera puede ejecutarlo. Ya no existe la ruta en la
  que una compra revierte por culpa del router (fin del DoS permanente).
- **Slippage de migración:** `amountTokenMin`/`amountETHMin` = 99 % del deseado
  (`MIGRATION_SLIPPAGE_BPS = 100`) + verificación posterior de los importes realmente usados
  (`require(usedTokens >= minTokens && usedBnb >= minBnb)`). Un par pre-creado/manipulado
  (sniping) hace revertir la migración en vez de regalar liquidez.
- **Fallo del router:** la tx revierte por completo con el error real del router (no se oculta, no
  se traga con `try/catch`, no se marca como migrado). El estado vuelve a `Graduating` y el intento
  se puede repetir.
- **Doble graduación imposible:** `onlyPhase(Graduating)` + cambio de fase antes de la llamada externa.
- **BNB sobrante:** el refund de ETH del router se envía al `feeWallet` con evento `MigrationDust`;
  no queda atrapado ni silenciado. Los tokens sobrantes se queman en `0xdead` como antes.
- **Fondos nunca atrapados:** ruta de reembolso pro-rata descrita en C-2.

### 🟠 A-3 — setFee (PRIORIDAD 4)

- Cap duro bajado de **500 bps a 100 bps** (`MAX_PROTOCOL_FEE_BPS`).
- **Bajadas** de fee: inmediatas. **Subidas**: quedan en cola con `FEE_TIMELOCK = 48 h`
  (`FeeChangeQueued`) y requieren `applyFee()`; `cancelPendingFee()` las anula.
- Eventos completos: `FeeUpdated`, `FeeChangeQueued`, `FeeChangeCancelled`, `CreatorFeeUpdated`,
  `ReferralFeeUpdated`, `FeeWalletUpdated`, `TreasuryUpdated`.
- El panel admin sigue llamando `setFee(bps)`; con una subida el cambio queda pendiente hasta
  `applyFee()` (comportamiento a reflejar en la UI cuando se redespliegue).

### 🟡 Medios (PRIORIDAD 5)

- **M-1 antiFlashloan:** se elimina el chequeo `who != tx.origin` (rompía relayers/ERC-4337) y se
  añade `contractAllowed[]` gestionada por el owner, de modo que Safe/Argent/AA pueden operar
  autorizándose explícitamente. El bloqueo genérico de contratos se mantiene por defecto.
- **M-2 quoteBuy y referral:** nueva `quoteBuyWithReferral(bnbIn, referrer)`; además `quoteBuy` y
  `quoteSell` replican ahora el **redondeo componente a componente** de `buy`/`sell`, de modo que
  la cotización coincide **al wei** con la ejecución (antes había 1 wei de desviación).
- **M-3 evento `Trade`:** `amountBnb` es ahora el importe **bruto** tanto en buy como en sell
  (antes buy=bruto / sell=neto), corrigiendo el sesgo del volumen del frontend y del Signal Engine.
- **M-4 `holders`:** se decrementa cuando el vendedor queda a 0 tokens.
- **B-4 `progress()` / `estimatedMigration()`:** limitados a 10000 bps.

**Economía sin cambios:** `VIRTUAL_BNB = 1,6`, `MIGRATION_THRESHOLD = 24 BNB`, splits por defecto
0,50 % / 0,20 % / 0,10 %. El hallazgo A-4 (curva muy agresiva) sigue **abierto** por diseño: no se
modificó la economía sin decisión de producto.

---

## 3. Cambios de almacenamiento / ABI / redeploy

- **Storage nuevo** en `BondingCurve`: `phase`, `graduatingSince`, `refundBnbPool`,
  `refundTokenPool`, `contractAllowed`. **Eliminado:** constantes `CREATOR_FEE_BPS` /
  `REFERRAL_FEE_BPS` (ahora en el Factory).
- **ABI BondingCurve:** `+ migrate()`, `+ redeem()`, `+ enableRefund()`, `+ skim()`,
  `+ skimmableBnb()`, `+ skimmableTokens()`, `+ phase()`, `+ quoteBuyWithReferral()`,
  `+ setContractAllowed()`; **− `emergencyWithdraw()`**.
- **ABI Factory:** constructor de 4 args; `+ treasury()`, `+ creatorFeeBps()`, `+ referralFeeBps()`,
  `+ applyFee()`, `+ cancelPendingFee()`, `+ setCreatorFee()`, `+ setReferralFee()`,
  `+ setTreasury()`, `+ totalFeeBps()`, `+ pendingFeeBps/pendingFeeEta`, `+ acceptOwnership()`.
- **Redeploy: SÍ, obligatorio.** No hay proxy ni upgradeabilidad. Las 16 curvas de testnet
  existentes conservan el comportamiento antiguo.

---

## 4. Tests ejecutados

`forge test` — **28/28 PASS** (`forge coverage`: BondingCurve 81 % líneas, Factory 59 %).

| Área | Tests |
|---|---|
| Creación / supply | `testCreateMintsSupplyToCurve` |
| Buy | `testBuyTransfersTokens`, `testQuoteBuyMatchesBuy`, `testQuoteBuyWithReferralMatchesBuy` |
| Sell | `testQuoteSellMatchesSell`, `testHoldersDecrementsOnFullExit` |
| Matemática / rounding | `testReservesStayBackedByBalance`, `testDustBuyNeverMintsFreeTokens` |
| Slippage | `testBuySlippageReverts`, `testSellSlippageReverts` |
| Fees | `testFeeSplitBuy`, `testNoSelfReferral`, `testFactoryFeeCapAndTimelock` |
| Permisos | `testOnlyOwnerCanChangeFees`, `testSkimOnlyFactoryOwner`, `testEnableRefundOnlyOwnerAndOnlyGraduating`, `testMainnetRejectsDeployerFeeWallet` |
| Pause | `testPauseBlocksBuysButNeverSells` |
| Emergency / fondos de usuario | `testOwnerCannotWithdrawUserFunds`, `testSkimOnlyTakesDonatedSurplus` |
| Graduation | `testBuyDoesNotMigrateInline`, `testMigratePermissionlessAndOnce`, `testMigrationSlippageProtection` |
| Router failure | `testRouterFailureDoesNotBlockNorHide`, `testRefundAfterGraceReturnsUserFunds` |
| AntiBot | `testAntiSandwichBlocksBuySellSameBlock`, `testMaxBuyEnforced`, `testSmartWalletAllowlist` |

App: `tsgo --noEmit` limpio · `vitest run` 6/6 PASS.

---

## 5. Riesgos restantes

1. **A-4 economía de la curva (abierto).** 1 BNB ≈ 30 % del supply; 13 compras gradúan. Decisión de
   producto pendiente sobre `VIRTUAL_BNB` / `MIGRATION_THRESHOLD`.
2. **Owner sigue siendo una EOA única** para fees, antibot, pause y `enableRefund`. Recomendado
   Gnosis Safe multisig antes de mainnet (ya no puede robar fondos, pero sí pausar compras).
3. **Pause de compras** sigue siendo unilateral (impacto limitado: la venta nunca se bloquea).
4. **`enableRefund` es discrecional tras 7 días**: no puede robar, pero cierra la ruta a PancakeSwap
   para ese token. Alternativa a valorar: permissionless tras 30 días.
5. **B-3 auto-referral** con segunda wallet (rebate 0,10 %) sigue siendo posible: mitigable off-chain.
6. **`volume24h` / `priceChange`** siguen siendo ventanas aproximadas (M-5), no deslizantes.
7. **`treasury` on-chain no se usa todavía** en flujos de pago del backend (Impulso/campañas siguen
   verificando la dirección configurada en la app). Conviene unificarlos al redesplegar.

## 6. Puntos que requieren nueva auditoría

- Ciclo completo de graduación contra el **router real de PancakeSwap** en testnet (mock usado en tests).
- Ruta `enableRefund` + `redeem` con múltiples holders y ventas parciales.
- Interacción del panel admin con `setFee` en modo timelock y con las nuevas fees del Factory.
- Revisión económica de la curva (A-4) si se cambian `VIRTUAL_BNB` o el threshold.
