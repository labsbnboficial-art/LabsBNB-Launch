// Contract ABIs generated with `forge inspect <Contract> abi` (see contracts/abi).
// Regenerate with: bash contracts/deploy.sh --abi-only
import LabsBNBFactoryAbi from "./LabsBNBFactory.json";
import BondingCurveAbi from "./BondingCurve.json";
import LabsBNBTokenAbi from "./LabsBNBToken.json";
import { ACTIVE_NETWORK } from "../networks";

export const FACTORY_ABI = LabsBNBFactoryAbi;
export const CURVE_ABI = BondingCurveAbi;
export const TOKEN_ABI = LabsBNBTokenAbi;


/**
 * Deployment constants for the ACTIVE network.
 * Kept under the historical `BSC_TESTNET` name for call-site compatibility;
 * the values now come from the centralized config in `../networks`.
 */
export const BSC_TESTNET = {
  chainId: ACTIVE_NETWORK.chainId,
  rpcUrl: ACTIVE_NETWORK.rpcUrls[0]!,
  pancakeRouter: ACTIVE_NETWORK.contracts.router!,
  wbnb: ACTIVE_NETWORK.contracts.wbnb!,
  explorer: ACTIVE_NETWORK.explorer,
} as const;

export { LOG_RPC_URLS } from "../rpc";
