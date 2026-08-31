# Mainnet Frontend Checklist — LabsBNB Launchpad

Phase: **MAINNET LIVE** — the app defaults to BNB Smart Chain Mainnet (56).
Testnet (97) is only reachable with `VITE_LAUNCHPAD_NETWORK=testnet`.
Single source of truth for all network data: `src/lib/web3/networks.ts`.

## 1. Network

| Item | Testnet (active) | Mainnet |
| --- | --- | --- |
| Key | `testnet` | `mainnet` |
| Selected by | `VITE_LAUNCHPAD_NETWORK=testnet` | default (unset) / `mainnet` |
| UI notice | Persistent "TESTNET" banner | none |

## 2. Chain ID

- Testnet: **97**
- Mainnet: **56**
- Wallet chain is validated by `isCorrectChain()`; `NetworkGuard` blocks with a
  "Wrong network" panel + "Switch Network" (wagmi `useSwitchChain`).

## 3. Factory

- Testnet: `0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9`
- Mainnet: `0xF0fDbF6fCa4FDBe9A6533C56AAa26feC68E85988` (deployed, verified on-chain: owner `0xbd93…53c4`, feeBps 50, creatorFeeBps 20, referralFeeBps 10, totalFeeBps 80)

## 4. Router (PancakeSwap V2)

- Testnet: `0xD99D1c33F9fC3444f8101754aBC46c52416550D1`
- Mainnet: `0x10ED43C718714eb63d5aA57B78B54704E256024E`
- WBNB testnet `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`, mainnet `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`

## 5. Treasury

Testnet: `0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e`.
Mainnet: `0x236716d4287E9f8F0de291450E2bFd0e04260b94` (Impulso, campaigns, advanced creation fee).
Mainnet owner: `0x60e655fe39bc7d17661f226bb44dcc681cc4e05e`.

## 6. Fee wallet

Testnet: `0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e`.
Mainnet: `0xEA265D939E27863dC169Bfb0c21D84d4Ed374E59` (buy/sell + creation fees).

## 7. RPC

Testnet — PRIMARY `https://bsc-prebsc-dataseed.bnbchain.org`; fallbacks: drpc,
binance data-seeds (s1/s2), zan.top. Log-capable subset in `LOG_RPC_URLS`
(chart, trades, holders, ATH, curve events).
Mainnet — PRIMARY `https://bsc-dataseed.bnbchain.org`; fallbacks: defibit,
ninicoin, dataseed2, drpc.
Batching is disabled on purpose (public seeds answer `-32005 limit exceeded`).
No new third-party RPC provider was introduced.

## 8. Explorer

Helpers only: `explorerAddressUrl`, `explorerTxUrl`, `explorerTokenUrl`,
`explorerContractUrl`. Testnet `https://testnet.bscscan.com`, Mainnet
`https://bscscan.com`. No hardcoded explorer URLs remain in components.

## 9. WalletConnect

Unchanged and still validated with MetaMask, Trust, WalletConnect and Coinbase.
`web3Config` now announces only the ACTIVE chain (first-chain rule for Trust).
`VITE_WALLETCONNECT_PROJECT_ID` should be set per environment.

## 10. Environment variables

Public (safe): `VITE_LAUNCHPAD_NETWORK`, `VITE_WALLETCONNECT_PROJECT_ID`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
Server-only, never rendered/logged: `PRIVATE_KEY`, `SIGNALS_CRON_SECRET`,
service-role keys, `BSCSCAN_API_KEY`, `TELEGRAM_BOT_TOKEN`, `LOVABLE_API_KEY`
(enumerated in `FORBIDDEN_PUBLIC_ENV`).

## 11. Security checks

`networkSafetyCheck(net)` (read-only) verifies chain id, factory, router,
treasury, fee wallet, explorer/network coherence and testnet-RPC leakage.
Run it before any Mainnet switch; it currently returns `ok: false` for Mainnet
because the factory is pending.

## 12. Remaining blockers

1. RESOLVED — Mainnet `LabsBNBFactory` deployed at `0xF0fDbF6fCa4FDBe9A6533C56AAa26feC68E85988`.
2. **BLOCKER (contracts phase)** — Mainnet deployment must run the hardened
   BondingCurve/Factory audited in `docs/AUDIT_BONDING_CURVE_POST_FIX.md`.
4. Admin panel network-scoped settings: DB config rows are shared across
   environments; a Mainnet build should not read Testnet-written factory rows
   (mitigated today because the frontend forces the config factory to the
   active-network factory).
5. Dedicated (non-public) RPC endpoint recommended before Mainnet traffic.
