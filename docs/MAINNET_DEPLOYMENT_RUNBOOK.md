# MAINNET DEPLOYMENT RUNBOOK — LabsBNB Launchpad

Fase: **preparación de Mainnet**. Auditoría de sólo lectura + documentación.
**No se desplegaron contratos, no se modificaron contratos, no se ejecutaron transacciones.**

Red activa hoy: **BNB Smart Chain Testnet (97)**. `VITE_LAUNCHPAD_NETWORK` sin
definir o `testnet`. Mainnet se activa con `VITE_LAUNCHPAD_NETWORK=mainnet`.

---

## 1. Auditoría de configuración Mainnet

| Archivo | Estado |
| --- | --- |
| `src/lib/web3/networks.ts` | Fuente única de verdad. `testnet` = chainId 97, `mainnet` = chainId 56. Correcto. |
| `src/lib/web3/config.ts` | `activeChain` derivado de `ACTIVE_NETWORK.chainId` (`bsc` si 56, `bscTestnet` si 97). Sólo se anuncia la chain activa a las wallets. Transports de ambas chains construidos desde `NETWORKS.*.rpcUrls`. Correcto. |
| `src/lib/web3/abis/index.ts` | ABIs estáticos (`contracts/abi`). `BSC_TESTNET` es sólo un alias histórico: sus valores (`chainId`, `rpcUrl`, `router`, `wbnb`, `explorer`) vienen de `ACTIVE_NETWORK`. Correcto, aunque el nombre confunde. |
| `src/lib/web3/tx.ts` | Usa `ACTIVE_CHAIN_ID` y `chainAddParams()` (EIP-3085) desde `networks.ts`. El identificador `BSC_TESTNET_PARAMS` es un alias histórico, el contenido es de la red activa. Correcto. |
| `src/lib/launchpad-config.ts` | `DEFAULT_CONFIG` deriva `factory_address`, `rpc_url`, `chain_id`, `fee_wallet`, `admin_wallet` de `ACTIVE_NETWORK`. Correcto. |
| `contracts/deploy.sh` | Por defecto RPC/chain de Testnet (`CHAIN_ID=97`). Tiene guardarraíl de mainnet (ver §8). |
| Env Web3 | Sólo variables públicas: `VITE_LAUNCHPAD_NETWORK`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_SUPABASE_*`. Ninguna dirección viene de env. |

Ninguna dirección Mainnet ha sido inventada. La única pendiente está marcada
como `null` con el comentario "PENDING — no Mainnet deployment exists yet".

---

## 2. Direcciones necesarias (a completar tras el deployment)

| Dirección | Dónde se configura | Origen | ¿Centralizada en `networks.ts`? | Estado Mainnet |
| --- | --- | --- | --- | --- |
| **Factory** (`LabsBNBFactory`) | `NETWORKS.mainnet.contracts.factory` | Salida del deploy (`Factory deployed at:`) | Sí | **PENDING MAINNET ADDRESS** |
| **Router** (PancakeSwap V2) | `NETWORKS.mainnet.contracts.router` | Constante pública de PancakeSwap | Sí | `0x10ED43C718714eb63d5aA57B78B54704E256024E` (confirmar antes del deploy) |
| **WBNB** | `NETWORKS.mainnet.contracts.wbnb` | Constante pública | Sí | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` (confirmar) |
| **feeWallet** | `NETWORKS.mainnet.contracts.feeWallet` + constructor del Factory + `contracts/.env` (`FEE_WALLET`) | Decisión del proyecto | Sí (frontend) | `0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e` — **pendiente de confirmación / multisig** |
| **treasury** | `NETWORKS.mainnet.contracts.treasury` + constructor del Factory + `contracts/.env` (`TREASURY_WALLET`) | Decisión del proyecto | Sí (frontend) | mismo wallet — **pendiente de decidir si debe diferir** |
| **BondingCurve / Token** | No se configuran | Creados por launch, emitidos en `TokenCreated(token, curve, creator, name, symbol, metadataURI)` | N/A | Dinámicos |
| **owner del Factory** | Deployer (`PRIVATE_KEY` en `contracts/.env`) | Deploy | No | **Pendiente: definir multisig** |

Duplicados fuera de `networks.ts` (defaults de servidor, no configuración de red):
`src/lib/fees.server.ts:12` (`DEFAULT_FEE_WALLET`), `src/lib/boost.server.ts:12`
(`DEFAULT_BOOST_WALLET`), `src/routes/create.tsx:448` (fallback de `admin_wallet`).
Son fallbacks de pago off-chain con el mismo wallet; **no se modificaron**, pero
deben revisarse si el wallet de Mainnet cambia.

---

## 3. Mainnet safety (verificado, sin cambios)

- `networkSafetyCheck(net)` (read-only) valida chainId por red, presencia de
  factory/router/feeWallet/treasury, coherencia del explorer y fuga de RPC de
  testnet en un build de mainnet. Hoy devuelve `ok: false` para Mainnet porque
  la factory está pendiente → **imposible arrancar Mainnet con factory Testnet**
  (el valor es `null`, no la de Testnet).
- Router y WBNB de Mainnet están separados por red; no hay ruta que lea los de
  Testnet cuando `ACTIVE_NETWORK_KEY === "mainnet"`.
- `chainId 97` en Mainnet: imposible, `ACTIVE_CHAIN_ID` deriva de la red activa y
  `web3Config` sólo anuncia `activeChain`.
- `DEPRECATED_ADDRESSES` conserva la factory placeholder histórica sólo para
  aserciones de test; ninguna ruta la referencia.
- `NetworkGuard` sigue operativo: panel "Wrong network" + `useSwitchChain`, y
  banner TESTNET permanente sólo cuando `IS_TESTNET_ENV`.
- `src/lib/web3/networks.test.ts` cubre estas invariantes.

---

## 4. Frontend Mainnet

| Área | Fuente de red | OK |
| --- | --- | --- |
| explorer | `explorerAddressUrl/TxUrl/TokenUrl/ContractUrl` | Sí |
| chainId | `ACTIVE_CHAIN_ID` / `isCorrectChain` | Sí |
| Factory | `ACTIVE_NETWORK.contracts.factory` (y `launchpad-config` fuerza la factory activa) | Sí |
| Router / WBNB | `BSC_TESTNET` (alias) → `ACTIVE_NETWORK.contracts` | Sí |
| feeWallet / treasury | `ACTIVE_NETWORK.contracts` + defaults de servidor (§2) | Parcial |
| Token creation / detail / Buy / Sell | Config activa + `curveOf(token)` | Sí |
| chart / trades / holders | `logRpcUrls` de la red activa | Sí (ver §5 blocker) |
| Missions / Boost / Fees | wallet de tesorería desde config DB con fallback constante | Parcial (§2) |
| Signals | `site_url` de config + `FALLBACK_SITE_URL` | Sí |

No se añadieron ni duplicaron direcciones. No se implementó ninguna dirección Mainnet.

---

## 5. RPC Mainnet

Estructura ya existente en `src/lib/web3/rpc.ts`:

- `MAINNET_RPC_URLS[0]` = **PRIMARY**, el resto **FALLBACK** (viem `fallback()` con ranking).
- Separación conceptual soportada: `rpcUrls` (frontend), `logRpcUrls` (chart/trades/holders/ATH),
  y el Signal Engine consume el mismo `logRpcUrls` de la red activa.
- Cambiar de proveedor = editar `MAINNET_RPC_URLS` / `NETWORKS.mainnet.logRpcUrls`;
  **no requiere tocar contratos**. Si se quiere por entorno, basta añadir una lectura
  `VITE_*` en `rpc.ts` (no implementado en esta fase).
- No se contrató proveedor ni se introdujeron API keys.

**Blocker conocido**: `NETWORKS.mainnet.logRpcUrls` reutiliza los data-seeds públicos,
que no sirven `eth_getLogs` con rangos amplios (ver `docs/PRODUCTION_RPC_AUDIT.md`).
Requiere al menos un proveedor dedicado antes de Mainnet.

---

## 6. Dominio oficial

Dominio productivo: **https://labsbnb-launchpad.com** (+ `www`).
`FALLBACK_SITE_URL` en `src/lib/signals/signal-formatters.ts:7` ya apunta ahí, y toda
la documentación de cron/Signals usa ese host.

Referencias restantes a documentar (no modificadas en esta fase):

- `lp-burn-stake-gain.lovable.app`: sólo aparece como cita histórica en
  `docs/LAUNCHPAD_FINAL_UX_QA.md`. **No queda ninguna referencia en código.**
- `labsbnb.app` (dominio no productivo) sigue usado como metadata por defecto en
  `src/lib/web3/config.ts:22-23` (WalletConnect `url`/`icons`, sólo en SSR — en
  navegador usa `window.location.origin`) y en los defaults de SIWE
  (`src/lib/siwe.functions.ts`, `src/lib/use-siwe.ts`). Recomendado alinearlo a
  `labsbnb-launchpad.com` antes de Mainnet.

---

## 7. Signal Engine / cron

- **Endpoint oficial**: `POST https://labsbnb-launchpad.com/api/public/signals/run`.
- **Secret**: header `x-signals-secret`, valor en `SIGNALS_CRON_SECRET` (server-only,
  listado en `FORBIDDEN_PUBLIC_ENV`). El endpoint devuelve error si falta.
- **Cron**: `pg_cron` + `pg_net` documentado en `docs/SQL_SIGNALS_CRON.md` (cada 5 min).
- **Vault**: el secret se lee desde Supabase Vault en el job de cron.
- **Red**: el engine usa los RPC de la red activa; al cambiar a Mainnet hereda
  automáticamente `NETWORKS.mainnet` (sujeto al blocker de logs de §5).
- No se ejecutó el cron ni se enviaron señales. Lógica sin modificar.

---

## 8. Deploy script (`contracts/deploy.sh` + `script/Deploy.s.sol`)

**Variables**: `PRIVATE_KEY` (obligatoria), `FEE_WALLET`, `TREASURY_WALLET`,
`PANCAKE_ROUTER`, `ALLOW_OWNER_FEE_WALLET`, `RPC_URL`, `CHAIN_ID`, `BSCSCAN_API_KEY`.

**Qué despliega**: sólo `LabsBNBFactory` (constructor: feeWallet, treasury, router,
allowOwnerFeeWallet). `BondingCurve` y `LabsBNBToken` se crean por launch.

**Orden**: Foundry → deps (forge-std, OZ v5.1.0) → `forge build` → `forge test` →
generar ABIs → cargar `.env` → validar deployer/balance → `forge script --broadcast`
(+ `--verify` si hay API key) → imprimir la dirección del Factory.

**Validaciones existentes**: `.env` presente, `PRIVATE_KEY` presente, balance del
deployer > 0, direcciones no-cero en el script, y guardarraíl para `CHAIN_ID=56`
(feeWallet ≠ deployer y treasury ≠ deployer salvo `ALLOW_OWNER_FEE_WALLET=true`).

**Validaciones Mainnet que faltan**:
1. Los defaults del script son de **Testnet** (`RPC` y `DEFAULT_ROUTER`): para Mainnet
   hay que exportar `RPC_URL`, `CHAIN_ID=56` y `PANCAKE_ROUTER` mainnet explícitamente;
   no hay chequeo de coherencia RPC↔`CHAIN_ID`.
2. No se valida que el router sea el de PancakeSwap V2 mainnet ni que exista código en él.
3. No se valida WBNB (no es parámetro del constructor; lo resuelve el router).
4. No hay verificación post-deploy on-chain de `feeWallet`/`treasury` leídos del Factory.
5. No hay transferencia de ownership a multisig dentro del script.

**A completar antes del deployment**: feeWallet definitivo, treasury definitivo,
owner/multisig, router mainnet confirmado, `BSCSCAN_API_KEY`, deployer fondeado en BNB real.

---

## 9. Checklist de deployment

```text
PRE-DEPLOY
   ↓
CONTRACT DEPLOYMENT
   ↓
CONTRACT VERIFICATION
   ↓
FRONTEND CONFIGURATION
   ↓
MAINNET SMOKE TEST
   ↓
FINAL SECURITY CHECK
   ↓
GO / NO-GO
```

### PRE-DEPLOY
- [ ] P-1 corregido
- [ ] Foundry tests en verde
- [ ] feeWallet confirmado
- [ ] treasury confirmado
- [ ] owner confirmado
- [ ] multisig decidido
- [ ] Router confirmado
- [ ] WBNB confirmado
- [ ] Deployer fondeado con BNB real y `CHAIN_ID=56` + `RPC_URL` mainnet exportados

### CONTRACT DEPLOYMENT
- [ ] Factory Mainnet desplegada
- [ ] Dirección del Factory registrada (salida `Factory deployed at:`)

### CONTRACT VERIFICATION
- [ ] contratos verificados (BscScan)
- [ ] `feeWallet` / `treasury` / `router` leídos on-chain coinciden con lo acordado

### FRONTEND CONFIGURATION
- [ ] direcciones actualizadas en frontend (`NETWORKS.mainnet.contracts.factory`)
- [ ] `VITE_LAUNCHPAD_NETWORK=mainnet`
- [ ] RPC configurado (primary + fallbacks + LOG RPC dedicado)
- [ ] `networkSafetyCheck(NETWORKS.mainnet).ok === true`

### MAINNET SMOKE TEST
- [ ] NetworkGuard verificado (wrong network + switch)
- [ ] smoke test completado (create → buy → sell → chart → holders → trades)
- [ ] dominio oficial verificado (`https://labsbnb-launchpad.com`)
- [ ] Signals/cron verificado

### FINAL SECURITY CHECK
- [ ] auditoría final completada
- [ ] ownership transferido a multisig

### GO / NO-GO
- [ ] GO para Mainnet

---

## 10. P-1

P-1 sigue siendo un **BLOCKER de seguridad** y **no se tocó en esta fase**.
Es requisito obligatorio del checklist antes de cualquier deployment Mainnet.

---

## 11. Validación ejecutada

Sólo typecheck, tests y build. Sin transacciones, sin deploy, sin cambio de la red activa.

---

## 12. Resumen

**Preparado**: configuración de red centralizada y conmutable por env, chainIds
correctos (97/56), NetworkGuard, `networkSafetyCheck`, explorer/RPC/ABIs derivados
de la red activa, estructura primary/fallback/LOG RPC, endpoint y cron de Signals
documentados con el dominio oficial, script de deploy con guardarraíles de mainnet.

**Falta**: factory Mainnet, RPC dedicado con `eth_getLogs`, decisión de multisig,
confirmación de feeWallet/treasury, alinear metadata `labsbnb.app` al dominio productivo,
validaciones mainnet adicionales en el deploy script.

**Direcciones pendientes**: Factory Mainnet (**PENDING MAINNET ADDRESS**);
Router/WBNB mainnet pendientes de confirmación formal; feeWallet/treasury/owner
pendientes de decisión definitiva.

**Variables pendientes**: `VITE_LAUNCHPAD_NETWORK=mainnet`, `RPC_URL`/`CHAIN_ID=56`,
`PANCAKE_ROUTER` mainnet, `BSCSCAN_API_KEY`, `PRIVATE_KEY` del deployer mainnet,
`SIGNALS_CRON_SECRET` en el entorno productivo.

**Validaciones existentes**: `networkSafetyCheck`, `networks.test.ts`, NetworkGuard,
`isCorrectChain`, guardarraíl mainnet de `deploy.sh` y `Deploy.s.sol`, `FORBIDDEN_PUBLIC_ENV`.

**Blockers reales**:
1. P-1 (seguridad de contrato).
2. Factory Mainnet no desplegada.
3. LOG RPC de Mainnet sin proveedor capaz de `eth_getLogs`.
4. Multisig / ownership sin decidir.

**Orden exacto**: PRE-DEPLOY → CONTRACT DEPLOYMENT → CONTRACT VERIFICATION →
FRONTEND CONFIGURATION → MAINNET SMOKE TEST → FINAL SECURITY CHECK → GO / NO-GO.

---

**MAINNET PREPARATION COMPLETE — NO DEPLOYMENT PERFORMED**
