// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title LabsBNBToken
/// @notice ERC-20 minimal, supply fija minteada al deploy hacia la bonding curve.
/// @dev Sin funciones de mint/burn adicionales — supply inmutable tras el constructor.
contract LabsBNBToken is ERC20 {
    uint8 private constant DECIMALS = 18;
    address public immutable creator;
    string public metadataURI;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address creator_,
        address curve_,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) {
        creator = creator_;
        metadataURI = metadataURI_;
        _mint(curve_, totalSupply_);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
}
