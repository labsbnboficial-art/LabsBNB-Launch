// Contract ABIs generated with `forge inspect <Contract> abi` (see contracts/abi).
// Regenerate with: bash contracts/deploy.sh --abi-only
import LabsBNBFactoryAbi from "./LabsBNBFactory.json";
import BondingCurveAbi from "./BondingCurve.json";
import LabsBNBTokenAbi from "./LabsBNBToken.json";

export const FACTORY_ABI = LabsBNBFactoryAbi;
export const CURVE_ABI = BondingCurveAbi;
export const TOKEN_ABI = LabsBNBTokenAbi;


/** BSC Testnet (chainId 97) deployment constants. */
export const BSC_TESTNET = {
  chainId: 97,
  rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
  pancakeRouter: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
  wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
  explorer: "https://testnet.bscscan.com",
} as const;
