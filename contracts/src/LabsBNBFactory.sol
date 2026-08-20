// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {LabsBNBToken} from "./LabsBNBToken.sol";
import {BondingCurve} from "./BondingCurve.sol";

/// @title LabsBNBFactory
/// @notice Punto de entrada del launchpad. Crea Token + BondingCurve en una sola tx
///         y centraliza la configuración económica (protocol/creator/referral/treasury).
/// @dev    Cambios de seguridad pre-mainnet:
///         - Ownable2Step (evita perder el owner por typo).
///         - Receptores de fee explícitos y validados; en mainnet el feeWallet no puede
///           ser el deployer/owner salvo que se declare intencionalmente.
///         - feeBps con cap duro del 1% y timelock de 48 h para CUALQUIER subida.
contract LabsBNBFactory is Ownable2Step {
    // ---- Límites duros (inmutables en código) ----
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 100; // 1.00%
    uint16 public constant MAX_CREATOR_FEE_BPS  = 100; // 1.00%
    uint16 public constant MAX_REFERRAL_FEE_BPS = 50;  // 0.50%
    uint256 public constant FEE_TIMELOCK = 48 hours;

    // ---- Configuración económica ----
    uint16 public feeBps = 50;            // protocol fee (0.50%)
    uint16 public creatorFeeBps = 20;     // 0.20%
    uint16 public referralFeeBps = 10;    // 0.10%

    /// @notice Receptor del protocol fee de las curvas (on-chain).
    address public feeWallet;
    /// @notice Tesorería del launchpad para cobros fuera de la curva (Impulso, campañas…).
    address public treasury;
    /// @notice Si el despliegue aceptó explícitamente que feeWallet == owner/deployer.
    bool public immutable ownerFeeWalletAllowed;

    address public immutable pancakeRouter;

    // ---- Timelock de subida de fee ----
    uint16 public pendingFeeBps;
    uint256 public pendingFeeEta;

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
    event FeeChangeQueued(uint16 bps, uint256 eta);
    event FeeChangeCancelled(uint16 bps);
    event CreatorFeeUpdated(uint16 bps);
    event ReferralFeeUpdated(uint16 bps);
    event FeeWalletUpdated(address wallet);
    event TreasuryUpdated(address wallet);

    error InvalidFee();
    error ZeroAddress();
    error FeeWalletIsOwner();
    error TimelockPending();
    error NoPendingFee();

    constructor(
        address feeWallet_,
        address treasury_,
        address pancakeRouter_,
        bool allowOwnerAsFeeWallet_
    ) Ownable(msg.sender) {
        if (feeWallet_ == address(0) || treasury_ == address(0) || pancakeRouter_ == address(0)) {
            revert ZeroAddress();
        }
        ownerFeeWalletAllowed = allowOwnerAsFeeWallet_;
        // En mainnet (BSC 56) el fee wallet no puede caer accidentalmente en el deployer.
        if (!allowOwnerAsFeeWallet_ && block.chainid == 56 && feeWallet_ == msg.sender) {
            revert FeeWalletIsOwner();
        }
        feeWallet = feeWallet_;
        treasury = treasury_;
        pancakeRouter = pancakeRouter_;
        emit FeeWalletUpdated(feeWallet_);
        emit TreasuryUpdated(treasury_);
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

    /// @notice Suma máxima de fees aplicables a un trade con referral (bps).
    function totalFeeBps() external view returns (uint16) {
        return feeBps + creatorFeeBps + referralFeeBps;
    }

    // ---- Admin: fees ----

    /// @notice Bajadas de fee se aplican al instante; subidas quedan en timelock de 48 h.
    function setFee(uint16 bps) external onlyOwner {
        if (bps > MAX_PROTOCOL_FEE_BPS) revert InvalidFee();
        if (bps <= feeBps) {
            feeBps = bps;
            pendingFeeBps = 0;
            pendingFeeEta = 0;
            emit FeeUpdated(bps);
        } else {
            pendingFeeBps = bps;
            pendingFeeEta = block.timestamp + FEE_TIMELOCK;
            emit FeeChangeQueued(bps, pendingFeeEta);
        }
    }

    /// @notice Ejecuta la subida de fee una vez vencido el timelock.
    function applyFee() external onlyOwner {
        if (pendingFeeEta == 0) revert NoPendingFee();
        if (block.timestamp < pendingFeeEta) revert TimelockPending();
        feeBps = pendingFeeBps;
        pendingFeeBps = 0;
        pendingFeeEta = 0;
        emit FeeUpdated(feeBps);
    }

    function cancelPendingFee() external onlyOwner {
        if (pendingFeeEta == 0) revert NoPendingFee();
        emit FeeChangeCancelled(pendingFeeBps);
        pendingFeeBps = 0;
        pendingFeeEta = 0;
    }

    function setCreatorFee(uint16 bps) external onlyOwner {
        if (bps > MAX_CREATOR_FEE_BPS) revert InvalidFee();
        creatorFeeBps = bps;
        emit CreatorFeeUpdated(bps);
    }

    function setReferralFee(uint16 bps) external onlyOwner {
        if (bps > MAX_REFERRAL_FEE_BPS) revert InvalidFee();
        referralFeeBps = bps;
        emit ReferralFeeUpdated(bps);
    }

    // ---- Admin: receptores ----

    function setFeeWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        if (!ownerFeeWalletAllowed && block.chainid == 56 && wallet == owner()) revert FeeWalletIsOwner();
        feeWallet = wallet;
        emit FeeWalletUpdated(wallet);
    }

    function setTreasury(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        treasury = wallet;
        emit TreasuryUpdated(wallet);
    }
}
