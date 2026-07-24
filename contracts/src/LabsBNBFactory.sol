// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LabsBNBToken} from "./LabsBNBToken.sol";
import {BondingCurve} from "./BondingCurve.sol";

/// @title LabsBNBFactory
/// @notice Punto de entrada del launchpad. Crea Token + BondingCurve en una sola tx.
///         La comisión (bps) y la wallet receptora son ajustables por el owner.
contract LabsBNBFactory is Ownable {
    uint16 public feeBps = 50;              // 0.50%
    address public feeWallet;
    address public immutable pancakeRouter;

    address[] public allTokens;
    mapping(address => address) public curveOf;   // token => curve
    mapping(address => address) public creatorOf; // token => creator

    event TokenCreated(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI
    );
    event FeeUpdated(uint16 bps);
    event FeeWalletUpdated(address wallet);

    error InvalidFee();
    error ZeroAddress();

    constructor(address feeWallet_, address pancakeRouter_) Ownable(msg.sender) {
        if (feeWallet_ == address(0) || pancakeRouter_ == address(0)) revert ZeroAddress();
        feeWallet = feeWallet_;
        pancakeRouter = pancakeRouter_;
    }

    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) external returns (address tokenAddr, address curveAddr) {
        BondingCurve curve = new BondingCurve(msg.sender, pancakeRouter);
        LabsBNBToken token = new LabsBNBToken(
            name,
            symbol,
            metadataURI,
            msg.sender,
            address(curve),
            curve.TOTAL_SUPPLY()
        );
        curve.setToken(address(token));

        tokenAddr = address(token);
        curveAddr = address(curve);
        allTokens.push(tokenAddr);
        curveOf[tokenAddr] = curveAddr;
        creatorOf[tokenAddr] = msg.sender;

        emit TokenCreated(tokenAddr, curveAddr, msg.sender, name, symbol, metadataURI);
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    // ---- Admin ----

    function setFee(uint16 bps) external onlyOwner {
        if (bps > 500) revert InvalidFee(); // cap duro al 5%
        feeBps = bps;
        emit FeeUpdated(bps);
    }

    function setFeeWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        feeWallet = wallet;
        emit FeeWalletUpdated(wallet);
    }
}
