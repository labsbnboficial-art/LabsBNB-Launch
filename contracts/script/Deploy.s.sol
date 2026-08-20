// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {LabsBNBFactory} from "../src/LabsBNBFactory.sol";

/// @notice Despliegue del Factory con configuración económica explícita.
/// @dev Variables de entorno:
///      PRIVATE_KEY, FEE_WALLET, TREASURY_WALLET, PANCAKE_ROUTER
///      ALLOW_OWNER_FEE_WALLET (opcional, "true" para permitir feeWallet == deployer)
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address feeWallet = vm.envAddress("FEE_WALLET");
        address treasury = vm.envAddress("TREASURY_WALLET");
        address router = vm.envAddress("PANCAKE_ROUTER");
        bool allowOwnerFeeWallet = vm.envOr("ALLOW_OWNER_FEE_WALLET", false);

        require(feeWallet != address(0), "FEE_WALLET missing");
        require(treasury != address(0), "TREASURY_WALLET missing");
        require(router != address(0), "PANCAKE_ROUTER missing");

        // Guardarraíl de mainnet: el receptor del protocol fee no puede ser el deployer
        // salvo declaración explícita ALLOW_OWNER_FEE_WALLET=true.
        if (block.chainid == 56 && !allowOwnerFeeWallet) {
            require(feeWallet != deployer, "MAINNET: feeWallet == deployer");
            require(treasury != deployer, "MAINNET: treasury == deployer");
        }

        vm.startBroadcast(pk);
        LabsBNBFactory factory = new LabsBNBFactory(feeWallet, treasury, router, allowOwnerFeeWallet);
        vm.stopBroadcast();

        console2.log("Factory deployed at:", address(factory));
        console2.log("Deployer:", deployer);
        console2.log("Fee wallet:", feeWallet);
        console2.log("Treasury:", treasury);
        console2.log("Pancake router:", router);
    }
}
