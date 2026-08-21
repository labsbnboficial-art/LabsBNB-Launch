# PRODUCTION RPC ARCHITECTURE AUDIT — LabsBNB Launchpad

Auditoría **SOLO LECTURA**. No se modificó código, configuración, contratos, RPC, dependencias ni variables de entorno.
Fecha: 2026-08-21 · Red activa del build: **BNB Smart Chain Testnet (97)**.

Archivos inspeccionados:
`src/lib/web3/rpc.ts`, `networks.ts`, `config.ts`, `onchain-token.ts`, `live-price.ts`, `curve-events.ts`, `log-range.ts`, `holders.ts`, `ath.ts`, `timeout.ts`, `providers.ts`, `tx.ts`,
`src/lib/launchpad/market-data.ts`, `realtime.ts`,
`src/lib/signals/signal-engine.server.ts`, `signal-rules.server.ts`, `signal-config.server.ts`, `signal-lock.server.ts`,
`src/lib/fees.server.ts`, `boost.server.ts`, `missions.functions.ts`,
`src/routes/index.tsx`, `token.$address.tsx`, `create.tsx`, `explorer.tsx`, `ranking.tsx`, `admin.tsx`,
`src/components/labsbnb/CandleChart.tsx`, `TradePanel.tsx`, `NetworkGuard.tsx`, `AdminFeesTab.tsx`.

---

## 1. RPC actuales

Todos los endpoints están centralizados en `src/lib/web3/rpc.ts` y expuestos vía `networks.ts`.
**Ninguno depende de variable de entorno; ninguno lleva API key.** Todos son **públicos y gratuitos**.

### TESTNET (chainId 97) — `TESTNET_RPC_URLS`, orden = prioridad

| # | URL | Rol | Público/Privado | Env |
|---|-----|-----|-----------------|-----|
| 1 | bsc-prebsc-dataseed.bnbchain.org | Primary | Público | No |
| 2 | bsc-testnet.drpc.org | Fallback | Público (free tier) | No |
| 3 | data-seed-prebsc-1-s1.binance.org:8545 | Fallback | Público | No |
| 4 | data-seed-prebsc-2-s1.bnbchain.org:8545 | Fallback | Público | No |
| 5 | data-seed-prebsc-1-s2.binance.org:8545 | Fallback | Público | No |
| 6 | data-seed-prebsc-2-s2.binance.org:8545 | Fallback | Público | No |
| 7 | api.zan.top/bsc-testnet | Fallback | Público | No |

### TESTNET LOGS (`LOG_RPC_URLS`) — usados solo por `eth_getLogs`
bsc-prebsc-dataseed.bnbchain.org (primary) · bsc-testnet.drpc.org · api.zan.top/bsc-testnet · data-seed-prebsc-1-s1.binance.org:8545

### MAINNET (chainId 56) — `MAINNET_RPC_URLS`, **hoy sin usar**
bsc-dataseed.bnbchain.org (primary) · bsc-dataseed1.defibit.io · bsc-dataseed1.ninicoin.io · bsc-dataseed2.bnbchain.org · bsc.drpc.org
`networks.mainnet.logRpcUrls` **reutiliza la misma lista pública** → los data-seeds de Mainnet **no sirven `eth_getLogs` con rangos útiles**. Es el hallazgo más importante de esta auditoría.

### RPC dedicado
**No existe ninguno.** No hay proveedor con API key, ni WebSocket, ni endpoint archive.

### Otros orígenes de red detectados
- `missions.functions.ts:734` — crea un `publicClient` con `http(args.rpc)`, **RPC recibido por parámetro** (verificación on-chain de misiones). No usa la lista central.
- `useLabsBnbPrice.ts` — precio BNB desde **CoinGecko HTTP** (no RPC).
- `src/routes/api/public/token-media.ts` — proxy de imágenes (no RPC).

### Quién consume cada transporte

| Consumidor | Transporte | Fallback |
|---|---|---|
| wagmi (`config.ts`) — wallet, writes, receipts | `rpcTransport(TESTNET_RPC_URLS)` | Sí (7) |
| `readClient()` (`onchain-token.ts`) — todas las lecturas de UI | mismo transporte + `batch.multicall {wait:24}` | Sí (7) |
| `log-range.ts` — todos los `eth_getLogs` | clientes propios uno-a-uno sobre `LOG_RPC_URLS` | Sí (4), con endpoint “preferido” pegajoso |
| `fees.server.ts` (servidor) | `testnetTransport()`, chunk fijo 1.000 | Sí |
| `boost.server.ts` (servidor) | `testnetTransport()` | Sí |
| Signal Engine (servidor) | `readClient()` + `log-range` | Sí |

Configuración del transporte (`rpcTransport`): `batch: false` (batching JSON-RPC **desactivado a propósito**: los data-seeds responden `-32005 limit exceeded`), `timeout 20s`, `retryCount 3`, `retryDelay 400ms`, `fallback({ rank: {interval 30s, sampleCount 3, timeout 4s}, retryCount 3 })`.

---

## 2. Componentes que usan RPC

| Módulo | Archivo | Métodos RPC |
|---|---|---|
| Network detection / NetworkGuard | `NetworkGuard.tsx`, `networks.ts` | `eth_chainId`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` (EIP-3085) |
| Conexión de wallet | `config.ts`, EIP-6963 | `eth_requestAccounts`, `eth_chainId` |
| Home / listado híbrido | `index.tsx`, `onchain-token.ts` | `eth_call` (multicall: `allTokens`, `name`, `symbol`, `metadataURI`, `curveOf`, `creatorOf`) |
| Explorer / Ranking | `explorer.tsx`, `ranking.tsx` | igual que Home (refetch 15s) |
| Create Token | `create.tsx` | `eth_getBalance`, `eth_estimateGas`, `eth_call` (simulate), `eth_sendTransaction`, `eth_getTransactionReceipt` |
| Token Detail / Bonding Curve | `token.$address.tsx`, `live-price.ts` | `eth_call` (`currentPrice`, `marketCap`, `realLiquidity`, `volume24h`, `priceChange`, `holders`, `progress`, `migrated`, `pancakePair`, `getReserves`), `eth_blockNumber` |
| Buy / Sell | `TradePanel.tsx`, `tx.ts` | `eth_call` (quote + simulate), `eth_estimateGas`, `eth_sendTransaction`, `eth_getTransactionReceipt` |
| Chart | `CandleChart.tsx` ← `curve-events.ts` | `eth_getLogs`, `eth_blockNumber` |
| Trades | `token.$address.tsx` (infinite query) | `eth_getLogs`, `eth_blockNumber` |
| Holders | `holders.ts` | `eth_getLogs` (Transfer), `eth_blockNumber` |
| ATH | `ath.ts` | Ninguno propio — **deriva de los logs Trade ya cargados** |
| Volume 24h | `live-price.ts` (view del contrato) + `market-data.ts` (logs) | `eth_call` / `eth_getLogs` |
| Realtime | `launchpad/realtime.ts` | `watchContractEvent` → polling `eth_getLogs` cada 6s por curva |
| Signals | `signal-engine.server.ts` | `eth_call` masivo + `eth_getLogs` por token |
| Missions | `missions.functions.ts` | `eth_call`/`eth_getTransactionReceipt` con RPC por parámetro |
| Admin Fees | `fees.server.ts` | `eth_call`, `eth_getLogs` (FeeCollected), `eth_getBalance`, `eth_blockNumber` |
| Impulso (Boost) | `boost.server.ts` | `eth_getTransactionReceipt` (`waitForTransactionReceipt`, timeout 90s), `eth_call` |

---

## 3. eth_getLogs

Lector único: **`src/lib/web3/log-range.ts`** (`getLogsChunked`). Es la pieza más madura del stack.

- **Ventana inicial** `DEFAULT_WINDOW = 1.000` bloques; **mínimo** 100.
- **Auto-shrink**: `isRangeError()` detecta `exceeds defined limit`, `limit exceeded`, `range`, `too many results`, `response size`, `-32005` → divide la ventana a la mitad **por endpoint** y la memoriza en `windowByUrl`.
- **Retry**: 3 intentos por ventana y por endpoint, backoff lineal 350ms·intento. Timeout por request 12s, `retryCount:0` en el http (el retry lo gestiona el propio bucle).
- **Fallback**: recorre `LOG_RPC_URLS` completo; fija `preferredRpc` al primero que responde y lo suelta al fallar.
- **Paginación**: ventanas contiguas e inclusivas, dedupe por `txHash:logIndex`, orden por `(blockNumber, logIndex)`, guard duro de 5.000 ventanas.
- **Consultas demasiado grandes**: no se emiten nunca en crudo; el techo real de rango por request es 1.000 bloques.

Rangos por módulo:

| Módulo | Grid | Techo de escaneo | Requests peor caso |
|---|---|---|---|
| Trades / Chart (`curve-events.ts`) | 3.000 (cache) | `MAX_LOOKBACK 600.000` bloques (~21 días), `MAX_CHUNKS_PER_PAGE 36`, `MAX_EMPTY_CHUNKS_PER_PAGE 108`, 3 chunks en paralelo | 108 chunks × 3 ventanas = **~324 `eth_getLogs`** para una curva sin actividad, por página |
| Holders (`holders.ts`) | 3.000 | `MAX_CHUNKS 72` (~216k bloques, ~7 días) | 72 × 3 = **~216 `eth_getLogs`** por token en cache miss |
| Fees admin (`fees.server.ts`) | 1.000 fijo | según ventana del dashboard | proporcional al rango pedido |
| Realtime (`realtime.ts`) | — | `watchContractEvent` poll 6s | 1 `eth_getLogs` cada 6s **por curva abierta** |

**Historia de los errores BSC "Request exceeds defined limit"**: se producían al pedir rangos amplios de una sola vez contra data-seeds y drpc. La respuesta fue exactamente `log-range.ts` (chunking + shrink adaptativo + rotación de endpoint). Los logs de red actuales todavía muestran `drpc.org` devolviendo **HTTP 500 code 19 "Temporary internal error"** en `eth_getLogs` incluso con rangos de ~1.000 bloques → el fallback es lo único que mantiene la función viva hoy.

**Más sensibles a límites de logs en Mainnet** (orden de riesgo):
1. **Holders** — reconstruye balances desde `Transfer` sin indexer; en Mainnet un token con actividad real genera órdenes de magnitud más logs y el escaneo de 7 días puede no alcanzar el mint → `complete:false` permanente.
2. **Trades/Chart** — 21 días de lookback con curvas activas.
3. **Signal Engine** — multiplica lo anterior por número de tokens escaneados.
4. **Realtime watcher** — un poll cada 6s por pestaña abierta y por curva.

---

## 4. Chart / Trades / Holders

| Aspecto | Chart | Trades | Holders |
|---|---|---|---|
| RPC | `LOG_RPC_URLS` vía `log-range` | idem | idem |
| Fallback | Sí (4 endpoints) | Sí | Sí |
| Timeout | 12s/request + `withRpcTimeout` 25s de UI | igual | `withRpcTimeout` 25s |
| Cache | `chunkCache` en memoria por chunk finalizado + `inflight` (dedupe de peticiones concurrentes); `HEAD_MARGIN 6` bloques sin cachear por reorgs | comparte el mismo cache que el chart (misma fuente de eventos) | `cache` Map con **TTL 60s** |
| Requests | ver §3 | infinite query, 25 trades/página, refetch 15s | secuencial, hasta 72 chunks |
| RPC lento | los 25s cortan y muestran error + Retry | igual | igual |
| RPC caído | rota endpoint; si todos fallan → error visible, no spinner | igual | igual |
| Espera infinita | **No** — `withRpcTimeout` la elimina | No | No |

Valoración: la **capa de resiliencia (timeout/retry/fallback/cache) es adecuada**; lo que **no** es adecuado para Mainnet es la **fuente**: reconstruir trades, velas, ATH y holders escaneando logs públicos en el cliente. En Mainnet eso significa cientos de `eth_getLogs` por visita de página y por usuario. **Es el principal cuello de botella arquitectónico.**

Nota: `holders.ts` escanea **secuencialmente** (sin paralelismo) hasta 72 chunks → en el peor caso el TTL de 60s se agota antes de completar y se repite el escaneo.

---

## 5. Signal Engine

- RPC: los mismos endpoints públicos (`readClient()` + `log-range`). Sin RPC propio.
- Por ejecución: `listMarketTokens(cfg.scan_tokens)` con `scan_tokens` configurable **1–50** (`signal-config.server.ts:83`).
- Por token: 1 lote multicall de views (`fetchOnChainToken` + `fetchLivePrice`, ~10-14 `eth_call` agregados) + `fetchTradeEvents(curve)` completo cuando hay alguna señal de historial activada (NEW_ATH, VOLUME_SPIKE, WHALE_BUY/SELL).
- Estimación con 50 tokens y curvas poco activas: **50 × (1 multicall + hasta ~324 `eth_getLogs`) ≈ hasta ~16.000 requests de logs por corrida** en el peor caso. Con el cache de chunks caliente en el mismo proceso baja drásticamente, pero el proceso serverless **no garantiza reutilización de memoria entre invocaciones de cron** → el peor caso es realista tras un cold start.
- Holders/volumen: se leen como **views del contrato** (`eth_call`), no por logs. Bien.
- Fallback: sí. Timeout: 12s por ventana. Cache: `chunkCache` en memoria del proceso (no compartido).
- Lock distribuido + cron: presentes, evitan solapamiento (correcto, no se toca).
- **Riesgo de rate limiting: ALTO en Mainnet** con endpoints públicos. El engine es el consumidor de RPC más pesado del sistema y hoy **comparte los mismos endpoints que el frontend** → si el engine se topa con el rate limit, degrada también la experiencia de usuario. **Separar cargas es lo más justificado de todo el informe.**

---

## 6. Create / Buy / Sell

| Operación | Llamadas | Criticidad de latencia |
|---|---|---|
| Conexión de wallet | `eth_requestAccounts`, `eth_chainId` (proveedor del wallet, no nuestro RPC) | MEDIA |
| Lectura de Factory | `eth_call` multicall (`allTokens`, `curveOf`, `creatorOf`, fees) | MEDIA |
| Create token | `getBalance` → simulate (`eth_call`) → `estimateGas` → `sendTransaction` → `waitForTransactionReceipt` | **CRÍTICA** |
| Buy | quote `eth_call` → simulate → `estimateGas` → send → receipt | **CRÍTICA** (quote se repite al teclear) |
| Sell | idem + `allowance`/`approve` | **CRÍTICA** |
| Receipts | `waitForTransactionReceipt` (boost usa timeout 90s) | ALTA |
| Balances | `eth_getBalance`, `balanceOf` | MEDIA |
| Bonding Curve views | `eth_call` cada 3s en la página de token | ALTA (frecuencia) |

Puntos a vigilar: el `refetchInterval: 3_000` del precio en vivo (`token.$address.tsx:124`) es el generador constante de `eth_call` más agresivo del frontend, y las cotizaciones de Buy/Sell dependen de baja latencia para no mostrar precios rancios frente a un slippage real.
No se ejecutó ninguna transacción durante esta auditoría.

---

## 7. Cache / retry / fallback — dónde sí y dónde no

| Técnica | Existe | Dónde |
|---|---|---|
| Cache | Parcial | `chunkCache` (eventos, en memoria), `holders.ts` TTL 60s, React Query staleTime en Home/config, `launchpad-config` 30s |
| Deduplicación | Parcial | `inflight` en `curve-events`, dedupe de logs por `txHash:logIndex`, React Query por queryKey |
| Batching | Parcial y contradictorio | `batch.multicall {wait:24}` **activo** en `readClient` (agrega `eth_call` vía Multicall3 — funciona, se ve en los logs de red); **JSON-RPC batching desactivado** en `rpcTransport` a propósito |
| Memoización | Sí | `useMemo` en token page; clientes cacheados por URL en `log-range` |
| Retry | Sí | viem `retryCount:3` + bucle propio 3 intentos/ventana + React Query `retry` |
| Exponential backoff | **No** | el backoff de `log-range` es **lineal** (350ms·intento) |
| Circuit breaker | **No** | no hay ninguno. `preferredRpc` es solo afinidad, no apertura de circuito |
| Fallback RPC | Sí | `fallback()` con ranking cada 30s + rotación manual en `log-range` |
| Cache persistente / servidor | **No** | todo es memoria de proceso; no hay Redis, KV ni tabla de eventos |
| Indexer | **No** | no existe |

---

## 8. Mainnet load analysis

| Componente | Carga estimada | Motivo |
|---|---|---|
| Holders (Transfer logs) | **CRITICAL** | hasta ~216 `eth_getLogs` por token, sin indexer, volumen de logs de Mainnet muy superior |
| Signal Engine | **CRITICAL** | hasta 50 tokens × escaneo completo de logs por corrida, mismo pool público |
| Chart + Trades | **HIGH** | ~324 `eth_getLogs` por página en el peor caso, ×usuarios concurrentes |
| Realtime watcher | **HIGH** | 1 `eth_getLogs` cada 6s por curva y por pestaña abierta |
| Live price (3s) | **HIGH** | `eth_call` continuo por cada pestaña de token abierta |
| Home / Explorer / Ranking | **MEDIUM** | multicall cada 15–30s, escala con nº de tokens del Factory |
| Buy / Sell | **MEDIUM** | ráfagas cortas por transacción, pero sensibles a latencia |
| Create Token | **LOW** | evento puntual |
| Admin Fees | **LOW** | uso ocasional, aunque con `eth_getLogs` de rango amplio |
| Missions | **LOW** | verificaciones puntuales |

**NO MEDIBLE DESDE EL CÓDIGO ACTUAL**: usuarios concurrentes, requests/segundo reales, tokens esperados en Mainnet, tasa de aciertos de cache, coste por proveedor. No hay telemetría de RPC (ni contador de requests ni métricas de latencia) en el repositorio.

---

## 9. Requisitos del RPC de producción

Para BNB Smart Chain Mainnet (56):

- **HTTP JSON-RPC** obligatorio, alta disponibilidad, con SLA declarado.
- **`eth_call` de alto volumen** y soporte de **Multicall3** (ya se usa).
- **`eth_getLogs` con rango amplio garantizado por contrato de servicio**: mínimo 5.000–10.000 bloques por request y sin límite duro de resultados. Es el requisito diferenciador; los data-seeds públicos no lo cumplen.
- **Archive / historical**: no se necesita estado histórico (`eth_call` en bloque antiguo) — sí se necesitan **logs históricos** de al menos 30 días con retención garantizada.
- **Rate limits**: expresados en req/s y en cómputo, con cabeceras de cuota legibles; suficiente para el pico de Signal Engine (miles de requests en minutos) + frontend.
- **Concurrencia**: soportar ráfagas paralelas (el chart pide 3 chunks a la vez; el engine escanea en serie por token).
- **Latencia**: p95 < 300ms en `eth_call` para que quotes de Buy/Sell y el poll de 3s no degraden.
- **WebSocket**: **aporta valor real** para el watcher de eventos — sustituiría el poll de 6s por push (`eth_subscribe logs`) y quitaría carga proporcional al nº de pestañas. No es bloqueante: el fallback a polling ya existe. Recomendado, no obligatorio para el día 1.
- **Fallback**: segundo proveedor **independiente** (distinta empresa e infraestructura), no una segunda región del mismo.
- **Monitoring**: dashboard de requests, errores por método, latencia y alertas de cuota. Hoy **no existe ninguna observabilidad de RPC en el código**.

Sobre proveedores: no se recomienda ninguno por marketing. Al comparar (p. ej. QuickNode, Ankr, dRPC, NodeReal, Chainstack, Alchemy BSC, Blockdaemon) medir con **una prueba propia** sobre el Factory real: (1) rango máximo real de `eth_getLogs` sin error, (2) latencia p95 de `eth_call` desde la región de los usuarios, (3) comportamiento bajo la ráfaga concreta del Signal Engine, (4) política de cuota (créditos vs req/s), (5) qué ocurre al superar el límite (429 vs throttling silencioso), (6) precio por millón de requests con **nuestro** perfil de uso, (7) disponibilidad de WSS, (8) retención de logs.

---

## 10. Arquitectura recomendada (propuesta, NO implementada)

```text
                    ┌──────────────────────────────┐
  Navegador ───────▶│  Frontend RPC (dedicado #1)  │──▶ fallback: dedicado #2
   (wagmi/viem)     │  eth_call, receipts, quotes  │──▶ fallback: data-seeds públicos
                    └──────────────────────────────┘

  Signal Engine ───▶┌──────────────────────────────┐
  (cron, server)    │  Backend RPC (dedicado #2)   │──▶ fallback: dedicado #1
                    │  eth_getLogs masivo          │
                    └──────────────────────────────┘

  Chart/Trades/Holders ─▶ [Indexer / cache de eventos]  ← lee logs una sola vez
                          (tabla Supabase + cursor)        y sirve a todos los usuarios
```

**¿Hace falta separar cargas?** Sí, en un punto concreto: **Signal Engine vs Frontend**. Hoy comparten pool y el engine puede consumir la cuota que el frontend necesita para cotizar un Buy. Separar las *claves* (no necesariamente los proveedores) ya resuelve el 80% del problema y es barato.

**¿Hace falta un indexer?** Es la decisión de mayor impacto. Sin él, cada usuario que abre una página de token paga cientos de `eth_getLogs`. Con un indexer sencillo (una tabla `trade_events` + cursor de bloque, alimentada por el cron que ya existe), el coste pasa de *O(usuarios × tokens)* a *O(tokens)*, y el chart, trades, ATH y holders se sirven desde base de datos en milisegundos. **Recomendado antes de Mainnet con volumen; no bloqueante para un lanzamiento con pocos tokens.**

Arquitectura mínima viable si se quiere simplicidad: **un proveedor dedicado con dos claves** (frontend / backend) + los data-seeds públicos como último recurso, manteniendo `log-range.ts` tal cual. Suficiente para arrancar; el indexer se añade cuando el tráfico lo justifique.

- **Primary RPC recomendado**: proveedor dedicado de pago con `eth_getLogs` de rango amplio garantizado y WSS disponible, elegido tras la prueba de §9. Declarar como primera URL de `MAINNET_RPC_URLS`.
- **Fallback RPC recomendado**: segundo proveedor dedicado de otra empresa; y por debajo, los data-seeds públicos de BNB Chain como red de seguridad de solo `eth_call` (nunca como fuente de logs).

---

## 11. Seguridad

Verificado, **sin hallazgos críticos**:

- **No hay ninguna API key de RPC en el repositorio**, ni en cliente ni en servidor. Todas las URLs son públicas y sin credencial → hoy no existe secreto que exponer, pero tampoco existe protección.
- `FORBIDDEN_PUBLIC_ENV` (`networks.ts:193`) ya lista los secretos que nunca deben imprimirse: `PRIVATE_KEY`, `SIGNALS_CRON_SECRET`, `LABSBNB_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BSCSCAN_API_KEY`, `LOVABLE_API_KEY`, `TELEGRAM_BOT_TOKEN`.
- Los secretos de servidor se leen con `process.env` **dentro de handlers** (`admin-auth.server.ts`, `telegram.server.ts`, `client.server.ts`, `api/ai-copilot.ts`) — correcto, no llegan al bundle del cliente.
- Solo `VITE_*` llega al navegador: `VITE_SUPABASE_*` (publishable, correcto), `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_LAUNCHPAD_NETWORK`. Clasificación correcta.
- `WC_PROJECT_ID` tiene un **valor por defecto hardcodeado** en `config.ts:17`. Un WalletConnect projectId es público por diseño, pero conviene que en Mainnet venga solo de env y con el dominio restringido en el dashboard de WC. **Advertencia, no vulnerabilidad.**
- Logs: `log-range.ts` y `timeout.ts` imprimen URLs de RPC en `console.warn`. Hoy son públicas y no revelan nada. **Con un RPC dedicado con API key en la URL, estos `console.warn` filtrarían la clave en la consola del navegador.** Es el único riesgo de seguridad que introduce la migración a RPC dedicado — a tener en cuenta cuando se configure (no se corrige aquí).
- `missions.functions.ts` acepta una URL de RPC como parámetro de entrada; conviene validarla contra una allowlist antes de Mainnet (SSRF potencial desde el servidor). **Riesgo bajo, fuera del alcance de esta auditoría.**

---

## 12. Riesgos actuales (resumen)

| # | Riesgo | Severidad |
|---|---|---|
| R-1 | `networks.mainnet.logRpcUrls` apunta a data-seeds públicos que no sirven `eth_getLogs` útil → chart, trades, holders y ATH quedarían vacíos o en error el día 1 de Mainnet | **BLOCKER** |
| R-2 | Cero RPC dedicado; toda la app depende de endpoints públicos gratuitos que ya devuelven HTTP 500 en Testnet | **BLOCKER** |
| R-3 | Signal Engine y frontend comparten el mismo pool → rate limit del engine degrada el trading | ALTO |
| R-4 | Holders sin indexer: no escalará a tokens con historial real en Mainnet | ALTO |
| R-5 | Sin circuit breaker ni backoff exponencial: ante un proveedor degradado se insiste 3×N veces | MEDIO |
| R-6 | Sin observabilidad de RPC (requests, latencia, cuota) | MEDIO |
| R-7 | `console.warn` con URLs de RPC filtraría una API key si se añade a la URL | MEDIO (futuro) |
| R-8 | Realtime watcher 6s + live price 3s multiplican carga por pestaña abierta | MEDIO |
| R-9 | `missions.functions.ts` acepta RPC arbitrario por parámetro | BAJO |

## 13. Qué debe hacerse antes de Mainnet

1. Contratar **dos** RPC dedicados de proveedores distintos y validarlos con la prueba de §9 (rango real de `eth_getLogs`, latencia p95, ráfaga del engine).
2. Definir `MAINNET_RPC_URLS` y, **por separado**, `logRpcUrls` de Mainnet (hoy son la misma lista — R-1).
3. Mover las URLs con credencial a variables de entorno y separar clave de frontend y clave de backend.
4. Antes de exponer una URL con API key, revisar los `console.warn` de `log-range.ts` (R-7).
5. Desplegar el Factory de Mainnet y rellenar `networks.mainnet.contracts.factory` (`networkSafetyCheck` ya lo marca como error).
6. Ejecutar `networkSafetyCheck()` con `VITE_LAUNCHPAD_NETWORK=mainnet` y comprobar 0 errores.
7. Decidir sobre el indexer de eventos según el volumen esperado de tokens.
8. Añadir monitorización mínima de cuota y alertas del proveedor.

## 14. Qué NO es necesario modificar

- `src/lib/web3/log-range.ts` — chunking, shrink adaptativo, dedupe y orden son correctos y siguen siendo válidos con un RPC dedicado.
- `src/lib/web3/timeout.ts` y los estados de error + Retry del chart/trades/holders — ya resuelven los spinners infinitos.
- `src/lib/web3/networks.ts` como capa de abstracción — el diseño de fuente única es el adecuado; solo cambian los valores.
- `batch: false` en `rpcTransport` — la decisión sigue siendo válida mientras los data-seeds sean fallback.
- `batch.multicall` de `readClient()` — funciona y reduce `eth_call` drásticamente.
- Signal Engine: lock distribuido, cron y dedupe. Solo cambia el endpoint que consume.
- Contratos, Bonding Curve, AntiBot, fees, gráfica y WalletConnect.

---

## AUDITORÍA COMPLETADA — SIN CAMBIOS

**BLOCKERS reales**: R-1 (`logRpcUrls` de Mainnet inservibles para `eth_getLogs`) y R-2 (ausencia total de RPC dedicado). Ambos deben resolverse antes de cualquier despliegue en BNB Smart Chain Mainnet.
