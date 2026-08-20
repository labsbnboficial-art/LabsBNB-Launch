#!/usr/bin/env bash
# LabsBNB Launchpad — one-command deploy package for BNB Smart Chain Testnet (chainId 97).
#
#   bash contracts/deploy.sh            # install deps, build, test, deploy + verify
#   bash contracts/deploy.sh --abi-only # only regenerate ABIs (no deploy)
#
# Requires contracts/.env with PRIVATE_KEY (deployer funded with tBNB).
# Faucet: https://testnet.bnbchain.org/faucet-smart
set -euo pipefail

cd "$(dirname "$0")"

RPC="${RPC_URL:-https://data-seed-prebsc-1-s1.binance.org:8545}"
DEFAULT_FEE_WALLET="0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"
DEFAULT_TREASURY="0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"
DEFAULT_ROUTER="0xD99D1c33F9fC3444f8101754aBC46c52416550D1" # PancakeSwap V2 Router — BSC Testnet

# 1. Foundry ---------------------------------------------------------------
if ! command -v forge >/dev/null 2>&1; then
  echo "==> Installing Foundry"
  curl -L https://foundry.paradigm.xyz | bash
  export PATH="$PATH:$HOME/.foundry/bin"
  foundryup
fi
export PATH="$PATH:$HOME/.foundry/bin"

# 2. Dependencies ----------------------------------------------------------
mkdir -p lib
[ -d lib/forge-std ] || git clone -q --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
[ -d lib/openzeppelin-contracts ] || git clone -q --depth 1 --branch v5.1.0 \
  https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts

# 3. Build + test ----------------------------------------------------------
echo "==> Building"
forge build
echo "==> Testing"
forge test

# 4. ABIs ------------------------------------------------------------------
mkdir -p abi
for c in LabsBNBFactory BondingCurve LabsBNBToken; do
  forge inspect "$c" abi --json > "abi/$c.json"
  echo "    abi/$c.json"
done
if [ "${1:-}" = "--abi-only" ]; then echo "ABIs regenerated."; exit 0; fi

# 5. Env -------------------------------------------------------------------
[ -f .env ] || { echo "ERROR: contracts/.env missing. Run: cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY missing in contracts/.env}"
export FEE_WALLET="${FEE_WALLET:-$DEFAULT_FEE_WALLET}"
export TREASURY_WALLET="${TREASURY_WALLET:-$DEFAULT_TREASURY}"
export PANCAKE_ROUTER="${PANCAKE_ROUTER:-$DEFAULT_ROUTER}"
export ALLOW_OWNER_FEE_WALLET="${ALLOW_OWNER_FEE_WALLET:-false}"

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
CHAIN_ID="${CHAIN_ID:-97}"
# Guardarraíl mainnet: el fee wallet / treasury nunca deben ser el deployer por accidente.
if [ "$CHAIN_ID" = "56" ] && [ "$ALLOW_OWNER_FEE_WALLET" != "true" ]; then
  low() { echo "$1" | tr 'A-Z' 'a-z'; }
  if [ "$(low "$FEE_WALLET")" = "$(low "$DEPLOYER")" ]; then
    echo "ERROR (mainnet): FEE_WALLET == deployer. Configura una wallet de protocolo distinta."; exit 1
  fi
  if [ "$(low "$TREASURY_WALLET")" = "$(low "$DEPLOYER")" ]; then
    echo "ERROR (mainnet): TREASURY_WALLET == deployer."; exit 1
  fi
fi
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
echo "==> Deployer $DEPLOYER  balance ${BAL} wei"
[ "$BAL" = "0" ] && { echo "ERROR: deployer has no tBNB. Faucet: https://testnet.bnbchain.org/faucet-smart"; exit 1; }

# 6. Deploy ----------------------------------------------------------------
VERIFY=()
if [ -n "${BSCSCAN_API_KEY:-}" ]; then VERIFY=(--verify --etherscan-api-key "$BSCSCAN_API_KEY"); fi

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" --chain "$CHAIN_ID" --broadcast --slow "${VERIFY[@]}" | tee /tmp/labsbnb-deploy.log

FACTORY=$(grep -oE 'Factory deployed at: 0x[a-fA-F0-9]{40}' /tmp/labsbnb-deploy.log | tail -1 | grep -oE '0x[a-fA-F0-9]{40}')
echo
echo "======================================================"
echo " LabsBNBFactory : $FACTORY"
echo " Fee wallet     : $FEE_WALLET"
echo " Treasury       : $TREASURY_WALLET"
echo " Pancake router : $PANCAKE_ROUTER"
echo " Explorer       : https://testnet.bscscan.com/address/$FACTORY"
echo "======================================================"
echo "Paste the factory address in the app: Admin panel -> factory_address"
echo "BondingCurve + Token addresses are created per launch and emitted by"
echo "LabsBNBFactory.TokenCreated(token, curve, creator, name, symbol, metadataURI)."
