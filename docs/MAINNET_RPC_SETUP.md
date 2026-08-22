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
