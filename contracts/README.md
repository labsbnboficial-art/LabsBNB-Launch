# LabsBNB Launchpad — Smart Contracts

Contratos Solidity para el launchpad estilo four.meme en BNB Smart Chain.

## Contenido

- `src/LabsBNBToken.sol` — ERC-20 minimal (fixed supply, minted al bonding curve).
- `src/BondingCurve.sol` — curva x*y=k con liquidez virtual. Compra/venta en BNB.
  Migra automáticamente a PancakeSwap cuando se alcanza `MIGRATION_THRESHOLD`.
- `src/LabsBNBFactory.sol` — factory que crea Token + BondingCurve en 1 tx.
  Gestiona comisión configurable (bps) y wallet receptora.
- `script/Deploy.s.sol` — script Foundry para desplegar factory en BSC Testnet.

## Parámetros por defecto (editables tras deploy vía `setFee`/`setFeeWallet`)

- Supply total: 1,000,000,000 tokens (18 decimales)
- Reservado a bonding curve: 800,000,000
- Reservado a liquidez PancakeSwap post-migración: 200,000,000
- Liquidez virtual inicial: 1.6 BNB virtual + 800M tokens virtuales
- Umbral de migración: 24 BNB reales recolectados en la curva
- Comisión: 50 bps (0.50%) → `0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e`

## Redes

- **BSC Testnet** chainId `97`, RPC `https://data-seed-prebsc-1-s1.binance.org:8545`
- PancakeSwap V2 Router Testnet: `0xD99D1c33F9fC3444f8101754aBC46c52416550D1`
- WBNB Testnet: `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`

## Despliegue en 1 comando (BSC Testnet, chainId 97)

```bash
cp contracts/.env.example contracts/.env   # rellena PRIVATE_KEY (wallet con tBNB)
bash contracts/deploy.sh
```

`deploy.sh` hace todo por ti desde cualquier ordenador y sin tocar código:
instala Foundry si falta, clona `forge-std` + `openzeppelin-contracts v5.1.0`,
compila, ejecuta los tests, regenera los ABI en `contracts/abi/`, comprueba el
saldo del deployer y despliega `LabsBNBFactory` (verificando en BscScan si hay
`BSCSCAN_API_KEY`). Al terminar imprime la dirección del Factory.

Solo ABIs: `bash contracts/deploy.sh --abi-only`.

Estado verificado en este repo: `forge build` sin errores y `forge test` 6/6 OK.
No se pudo desplegar desde Lovable porque no hay `PRIVATE_KEY` (clave privada del
deployer) — el comando de arriba lo resuelve en local.

### Después del deploy

1. Copia la dirección impresa `LabsBNBFactory`.
2. Panel **Admin → factory_address** → pégala y guarda. Es el único cambio que
   necesita el frontend (los ABIs ya están en `src/lib/web3/abis/`).
3. `BondingCurve` y el token se crean por cada lanzamiento; sus direcciones
   llegan en el evento `TokenCreated(token, curve, creator, name, symbol, metadataURI)`.


## Obtener BNB testnet gratis
https://testnet.bnbchain.org/faucet-smart

## Eventos que el indexador escuchará

- `LabsBNBFactory.TokenCreated(address token, address curve, address creator, string name, string symbol)`
- `BondingCurve.Buy(address buyer, uint256 bnbIn, uint256 tokensOut, uint256 newPriceX96)`
- `BondingCurve.Sell(address seller, uint256 tokensIn, uint256 bnbOut, uint256 newPriceX96)`
- `BondingCurve.Migrated(address pair, uint256 bnbLiquidity, uint256 tokenLiquidity)`
- `BondingCurve.FeeCollected(address to, uint256 amount)`

## Funciones públicas principales

**Factory**
- `createToken(string name, string symbol, string metadataURI) → (address token, address curve)`
- `setFee(uint16 bps)` (owner)
- `setFeeWallet(address wallet)` (owner)
- `allTokens(uint256 i)` / `allTokensLength()`

**BondingCurve**
- `buy(uint256 minTokensOut) payable`
- `sell(uint256 tokensIn, uint256 minBnbOut)`
- `quoteBuy(uint256 bnbIn) view → uint256 tokensOut`
- `quoteSell(uint256 tokensIn) view → uint256 bnbOut`
- `currentPrice() view → uint256` (BNB por token, escala 1e18)
- `progress() view → uint256` (bps 0-10000 respecto a migración)
- `migrated() view → bool`
