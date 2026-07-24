// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {LabsBNBFactory} from "../src/LabsBNBFactory.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address feeWallet = vm.envAddress("FEE_WALLET");
        address router = vm.envAddress("PANCAKE_ROUTER");

        vm.startBroadcast(pk);
        LabsBNBFactory factory = new LabsBNBFactory(feeWallet, router);
        vm.stopBroadcast();

        console2.log("Factory deployed at:", address(factory));
        console2.log("Fee wallet:", feeWallet);
        console2.log("Pancake router:", router);
    }
}
