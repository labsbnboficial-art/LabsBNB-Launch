// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPancakeRouter} from "./interfaces/IPancakeRouter.sol";

/// @title BondingCurve
/// @notice Curva constante x*y=k con reservas virtuales estilo four.meme / pump.fun.
///         Compra/venta en BNB nativo. Comisión configurable en bps sobre el BNB in/out.
///         Al alcanzar MIGRATION_THRESHOLD de BNB reales recolectados, migra
///         automáticamente la liquidez restante a PancakeSwap V2 y quema los LP tokens.
/// @dev El token es minteado 100% a este contrato en su constructor (ver LabsBNBToken).
///      - CURVE_ALLOC (80%) es la reserva virtual disponible para venta durante la curva.
///      - LP_ALLOC   (20%) se reserva para la migración a PancakeSwap.
contract BondingCurve is ReentrancyGuard {
    // ---- Configuración inmutable ----
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable factory;
    IPancakeRouter public immutable router;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_ALLOC  =   800_000_000 ether;
    uint256 public constant LP_ALLOC     =   200_000_000 ether;

    /// Reservas virtuales iniciales — definen precio inicial y curvatura.
    /// Con VBNB=1.6e18 y VTOK=800M: precio inicial ≈ 2e-9 BNB/token.
    uint256 public constant VIRTUAL_BNB    = 1.6 ether;
    uint256 public constant VIRTUAL_TOKENS = 800_000_000 ether;

    /// BNB real que debe entrar a la curva para gatillar migración.
    uint256 public constant MIGRATION_THRESHOLD = 24 ether;

    // ---- Estado ----
    /// Tokens de la reserva de curva ya vendidos.
    uint256 public tokensSold;
    /// BNB real acumulado (neto de comisiones) disponible para migración.
    uint256 public bnbCollected;
    bool    public migrated;
    address public pancakePair;

    // ---- Eventos ----
    event Buy(address indexed buyer, uint256 bnbIn, uint256 tokensOut, uint256 priceAfter);
    event Sell(address indexed seller, uint256 tokensIn, uint256 bnbOut, uint256 priceAfter);
    event FeeCollected(address indexed to, uint256 amount);
    event Migrated(address indexed pair, uint256 bnbLiquidity, uint256 tokenLiquidity);

    error AlreadyMigrated();
    error SlippageExceeded();
    error ZeroAmount();
    error InsufficientReserve();
    error TransferFailed();

    modifier notMigrated() {
        if (migrated) revert AlreadyMigrated();
        _;
    }

    constructor(address creator_, address router_) {
        factory = msg.sender;
        creator = creator_;
        router = IPancakeRouter(router_);
        // token será asignado por el factory llamando setToken() dentro de la misma tx
    }

    /// El factory hace la doble llamada: primero deploya la curva, luego deploya el token
    /// (que mintea a esta curva) y finalmente registra el token.
    function setToken(address token_) external {
        require(msg.sender == factory, "only factory");
        require(address(token) == address(0), "token set");
        assembly { sstore(token.slot, token_) }
    }

    // ---- Vistas / quotes ----

    function _feeBps() internal view returns (uint16) {
        return ILabsBNBFactory(factory).feeBps();
    }
    function _feeWallet() internal view returns (address) {
        return ILabsBNBFactory(factory).feeWallet();
    }

    /// Reservas efectivas actuales (virtuales + reales acumulados).
    function reserves() public view returns (uint256 rBNB, uint256 rTOK) {
        rBNB = VIRTUAL_BNB + bnbCollected;
        rTOK = VIRTUAL_TOKENS - tokensSold;
    }

    /// Precio actual = rBNB / rTOK * 1e18  (BNB por token, 18 dec).
    function currentPrice() external view returns (uint256) {
        (uint256 rBNB, uint256 rTOK) = reserves();
        return (rBNB * 1e18) / rTOK;
    }

    /// Progreso hacia migración en bps (10000 = 100%).
    function progress() external view returns (uint256) {
        if (migrated) return 10000;
        return (bnbCollected * 10000) / MIGRATION_THRESHOLD;
    }

    /// Tokens que recibiría por `bnbIn` (comisión ya descontada).
    function quoteBuy(uint256 bnbIn) public view returns (uint256 tokensOut, uint256 fee) {
        fee = (bnbIn * _feeBps()) / 10000;
        uint256 net = bnbIn - fee;
        (uint256 rBNB, uint256 rTOK) = reserves();
        // dx = (net * rTOK) / (rBNB + net)
        tokensOut = (net * rTOK) / (rBNB + net);
    }

    /// BNB que recibiría por `tokensIn` (comisión ya descontada).
    function quoteSell(uint256 tokensIn) public view returns (uint256 bnbOut, uint256 fee) {
        (uint256 rBNB, uint256 rTOK) = reserves();
        uint256 gross = (tokensIn * rBNB) / (rTOK + tokensIn);
        fee = (gross * _feeBps()) / 10000;
        bnbOut = gross - fee;
    }

    // ---- Trading ----

    function buy(uint256 minTokensOut) external payable nonReentrant notMigrated {
        if (msg.value == 0) revert ZeroAmount();
        (uint256 tokensOut, uint256 fee) = quoteBuy(msg.value);
        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensSold + tokensOut > CURVE_ALLOC) revert InsufficientReserve();

        uint256 net = msg.value - fee;
        tokensSold += tokensOut;
        bnbCollected += net;

        if (fee > 0) {
            (bool ok,) = _feeWallet().call{value: fee}("");
            if (!ok) revert TransferFailed();
            emit FeeCollected(_feeWallet(), fee);
        }

        require(token.transfer(msg.sender, tokensOut), "tok tx");

        (uint256 rBNB, uint256 rTOK) = reserves();
        emit Buy(msg.sender, msg.value, tokensOut, (rBNB * 1e18) / rTOK);

        if (bnbCollected >= MIGRATION_THRESHOLD) {
            _migrate();
        }
    }

    function sell(uint256 tokensIn, uint256 minBnbOut) external nonReentrant notMigrated {
        if (tokensIn == 0) revert ZeroAmount();
        (uint256 bnbOut, uint256 fee) = quoteSell(tokensIn);
        if (bnbOut < minBnbOut) revert SlippageExceeded();

        require(token.transferFrom(msg.sender, address(this), tokensIn), "tok tx");
        tokensSold -= tokensIn;
        uint256 gross = bnbOut + fee;
        bnbCollected -= gross;

        if (fee > 0) {
            (bool ok1,) = _feeWallet().call{value: fee}("");
            if (!ok1) revert TransferFailed();
            emit FeeCollected(_feeWallet(), fee);
        }
        (bool ok2,) = msg.sender.call{value: bnbOut}("");
        if (!ok2) revert TransferFailed();

        (uint256 rBNB, uint256 rTOK) = reserves();
        emit Sell(msg.sender, tokensIn, bnbOut, (rBNB * 1e18) / rTOK);
    }

    // ---- Migración a PancakeSwap ----

    function _migrate() internal {
        migrated = true;
        uint256 bnbForLP = bnbCollected;
        uint256 tokensForLP = LP_ALLOC;

        require(token.approve(address(router), tokensForLP), "approve");
        (,, uint256 liquidity) = router.addLiquidityETH{value: bnbForLP}(
            address(token),
            tokensForLP,
            0,
            0,
            address(0xdead), // LP tokens quemados
            block.timestamp + 300
        );
        pancakePair = IPancakeFactory(router.factory()).getPair(address(token), router.WETH());

        // Quema cualquier remanente de la curva (evita supply "olvidada")
        uint256 remaining = token.balanceOf(address(this));
        if (remaining > 0) {
            token.transfer(address(0xdead), remaining);
        }

        emit Migrated(pancakePair, bnbForLP, tokensForLP);
        liquidity; // silence
    }

    receive() external payable {}
}

interface ILabsBNBFactory {
    function feeBps() external view returns (uint16);
    function feeWallet() external view returns (address);
}

interface IPancakeFactory {
    function getPair(address a, address b) external view returns (address);
}
