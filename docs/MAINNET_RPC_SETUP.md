# Mainnet RPC Setup — LabsBNB Launchpad

Fuente única de verdad: `src/lib/web3/networks.ts` (lee las listas de `src/lib/web3/rpc.ts`).
No se hardcodean API keys ni se imprimen secretos. Cambiar de proveedor NO requiere tocar
contratos, Bonding Curve, Buy/Sell, WalletConnect, Signals ni Missions.

## Arquitectura

| Concepto  | Campo               | Uso                                                     |
| --------- | ------------------- | ------------------------------------------------------- |
| Principal | `rpcUrls[0]`        | primer endpoint del transport `fallback` de viem/wagmi   |
| Fallback  | `rpcUrls[1..n]`     | ranking automático + retry/timeout ya existentes         |
| Logs      | `logRpcUrls`        | `eth_getLogs`: Chart, Trades, ATH, Holders               |

Los mecanismos de timeout (20s), retry (3) y ranking en `rpcTransport()` y el chunking
adaptativo de `log-range.ts` se mantienen sin cambios de lógica.

## Variables de entorno

Todas opcionales: si no se definen se usan los endpoints públicos por defecto.
Son configuración pública de cliente; si el proveedor entrega una URL con key incluida,
esa URL vive SÓLO en la variable de entorno (nunca en el repo, logs o UI).

### Dónde se configuran (Lovable Cloud)

Lovable Cloud rechaza nombres con prefijo `VITE_` porque son variables de build del
navegador. Por eso el proyecto acepta el **alias sin prefijo** como secreto de Cloud:

| Nombre canónico en código        | Nombre del secreto en Lovable Cloud |
| -------------------------------- | ----------------------------------- |
| `VITE_BSC_MAINNET_RPC_PRIMARY`   | `BSC_MAINNET_RPC_PRIMARY`           |
| `VITE_BSC_MAINNET_RPC_FALLBACKS` | `BSC_MAINNET_RPC_FALLBACKS`         |
| `VITE_BSC_MAINNET_LOG_RPC_URLS`  | `BSC_MAINNET_LOG_RPC_URLS`          |
| (idem para testnet)              | `BSC_TESTNET_*`                     |

`src/lib/web3/runtime-rpc.ts` lee el secreto en el servidor durante el SSR y lo inyecta
en un `<script>` inline dentro de `<head>` (antes del bundle) como
`window.__LABSBNB_RUNTIME_RPC__`. `src/lib/web3/rpc.ts` resuelve en este orden:

1. `import.meta.env.VITE_*` (build-time)
2. runtime inyectado por el servidor (secreto de Cloud)
3. `process.env` (`VITE_*` y alias sin prefijo)

Sólo viajan URLs públicas de RPC por este puente; ninguna clave privada ni secreto de
servidor se expone.



### Mainnet (chain 56)

```
VITE_BSC_MAINNET_RPC_PRIMARY=https://<proveedor-dedicado>
VITE_BSC_MAINNET_RPC_FALLBACKS=https://<fallback-1>,https://<fallback-2>
VITE_BSC_MAINNET_LOG_RPC_URLS=https://<log-provider-1>,https://<log-provider-2>
```

### Testnet (chain 97)

```
VITE_BSC_TESTNET_RPC_PRIMARY=
VITE_BSC_TESTNET_RPC_FALLBACKS=
VITE_BSC_TESTNET_LOG_RPC_URLS=
```

### Selección de red

```
VITE_LAUNCHPAD_NETWORK=testnet   # o mainnet
```

## Pendiente antes de Mainnet

- **`VITE_BSC_MAINNET_LOG_RPC_URLS` es obligatorio en producción.** Los data-seeds públicos
  limitan `eth_getLogs` y romperían Chart/Trades/ATH. Mientras no esté configurada,
  `networkSafetyCheck()` emite el warning `LOG_RPC_DEDICATED`.
- No se han creado credenciales nuevas ni se han inventado endpoints con key.

MAINNET RPC SETUP COMPLETE — NO DEPLOYMENT
