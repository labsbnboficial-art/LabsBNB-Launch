// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPancakeRouter} from "./interfaces/IPancakeRouter.sol";

/// @title BondingCurve
/// @notice Curva constante x*y=k con reservas virtuales estilo four.meme / pump.fun.
///         Incluye: creator fee split, referral, antibot (max buy, cooldown,
///         anti-sandwich, anti-flashloan, max wallet, max tx), emergency withdraw
///         y vistas ampliadas (marketCap, liquidity, holders, etc.).
contract BondingCurve is ReentrancyGuard, Pausable {
    // ---- Configuración inmutable ----
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable factory;
    IPancakeRouter public immutable router;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_ALLOC  =   800_000_000 ether;
    uint256 public constant LP_ALLOC     =   200_000_000 ether;

    uint256 public constant VIRTUAL_BNB    = 1.6 ether;
    uint256 public constant VIRTUAL_TOKENS = 800_000_000 ether;
    uint256 public constant MIGRATION_THRESHOLD = 24 ether;

    // ---- Fee split (bps sobre BNB in/out). Total = protocol + creator + referral. ----
    /// Referral bps se aplica solo si hay `referrer` distinto de 0 y del propio comprador.
    uint16 public constant CREATOR_FEE_BPS   = 20; // 0.20%
    uint16 public constant REFERRAL_FEE_BPS  = 10; // 0.10% (si aplica)

    // ---- AntiBot config (admin-configurable vía factory owner) ----
    struct AntiBot {
        uint128 maxBuyBnb;        // 0 = sin límite
        uint128 maxWalletTokens;  // 0 = sin límite
        uint128 maxTxTokens;      // 0 = sin límite
        uint32  cooldownSeconds;  // 0 = sin cooldown
        bool    antiSandwich;     // bloquea buy+sell en el mismo bloque por wallet
        bool    antiFlashloan;    // bloquea contratos (tx.origin != msg.sender)
        bool    enabled;
    }
    AntiBot public antibot;

    // ---- Estado ----
    uint256 public tokensSold;
    uint256 public bnbCollected;
    bool    public migrated;
    address public pancakePair;

    // Analytics
    uint256 public holders;
    uint256 public volume24h;      // rolling ventana simple
    uint256 public volumeWindowStart;
    uint256 public lastPrice;
    uint256 public priceRefPrice;  // precio hace 24h aprox
    uint256 public priceRefTs;

    mapping(address => uint256) public lastActionBlock;
    mapping(address => uint256) public lastActionTs;
    mapping(address => bool)    public counted;

    // ---- Eventos ----
    event Buy(address indexed buyer, uint256 bnbIn, uint256 tokensOut, uint256 priceAfter);
    event Sell(address indexed seller, uint256 tokensIn, uint256 bnbOut, uint256 priceAfter);
    event Trade(
        address indexed trader,
        bool    isBuy,
        uint256 amountBnb,
        uint256 amountTokens,
        uint256 price,
        uint256 marketCap,
        uint256 timestamp
    );
    event FeeCollected(address indexed to, uint256 amount, uint8 kind); // 0=protocol 1=creator 2=referral
    event Referral(address indexed referrer, address indexed buyer, uint256 amount);
    event Migrated(address indexed pair, uint256 bnbLiquidity, uint256 tokenLiquidity);
    event AntiBotUpdated(AntiBot cfg);
    event EmergencyWithdraw(address indexed to, uint256 bnb, uint256 tokens);

    error AlreadyMigrated();
    error SlippageExceeded();
    error ZeroAmount();
    error InsufficientReserve();
    error TransferFailed();
    error OnlyFactoryOwner();
    error AntiBotViolation(string reason);

    modifier notMigrated() {
        if (migrated) revert AlreadyMigrated();
        _;
    }

    modifier onlyFactoryOwner() {
        if (msg.sender != ILabsBNBFactory(factory).owner()) revert OnlyFactoryOwner();
        _;
    }

    constructor(address creator_, address router_) {
        factory = msg.sender;
        creator = creator_;
        router = IPancakeRouter(router_);
        antibot = AntiBot({
            maxBuyBnb: 2 ether,
            maxWalletTokens: uint128(CURVE_ALLOC / 50), // 2%
            maxTxTokens: uint128(CURVE_ALLOC / 100),   // 1%
            cooldownSeconds: 3,
            antiSandwich: true,
            antiFlashloan: true,
            enabled: true
        });
        volumeWindowStart = block.timestamp;
        priceRefTs = block.timestamp;
        priceRefPrice = (VIRTUAL_BNB * 1e18) / VIRTUAL_TOKENS;
        lastPrice = priceRefPrice;
    }

    function setToken(address token_) external {
        require(msg.sender == factory, "only factory");
        require(address(token) == address(0), "token set");
        assembly { sstore(token.slot, token_) }
    }

    // ---- Admin (factory owner) ----

    function setAntiBot(AntiBot calldata cfg) external onlyFactoryOwner {
        antibot = cfg;
        emit AntiBotUpdated(cfg);
    }

    function pause() external onlyFactoryOwner { _pause(); }
    function unpause() external onlyFactoryOwner { _unpause(); }

    /// @notice Rescate de emergencia (solo si NO migró). Envía todo el BNB y tokens al owner.
    function emergencyWithdraw(address to) external onlyFactoryOwner {
        require(!migrated, "migrated");
        uint256 bal = address(this).balance;
        uint256 tbal = token.balanceOf(address(this));
        if (bal > 0) {
            (bool ok,) = to.call{value: bal}("");
            if (!ok) revert TransferFailed();
        }
        if (tbal > 0) {
            require(token.transfer(to, tbal), "tok tx");
        }
        emit EmergencyWithdraw(to, bal, tbal);
    }

    // ---- Vistas / quotes ----

    function _protocolFeeBps() internal view returns (uint16) {
        return ILabsBNBFactory(factory).feeBps();
    }
    function _feeWallet() internal view returns (address) {
        return ILabsBNBFactory(factory).feeWallet();
    }

    function _totalFeeBps(bool withReferral) internal view returns (uint16) {
        uint16 f = _protocolFeeBps() + CREATOR_FEE_BPS;
        if (withReferral) f += REFERRAL_FEE_BPS;
        return f;
    }

    function reserves() public view returns (uint256 rBNB, uint256 rTOK) {
        rBNB = VIRTUAL_BNB + bnbCollected;
        rTOK = VIRTUAL_TOKENS - tokensSold;
    }

    function currentPrice() public view returns (uint256) {
        (uint256 rBNB, uint256 rTOK) = reserves();
        return (rBNB * 1e18) / rTOK;
    }

    function progress() external view returns (uint256) {
        if (migrated) return 10000;
        return (bnbCollected * 10000) / MIGRATION_THRESHOLD;
    }

    function marketCap() public view returns (uint256) {
        return (currentPrice() * TOTAL_SUPPLY) / 1e18;
    }

    function virtualLiquidity() external pure returns (uint256) { return VIRTUAL_BNB; }
    function realLiquidity() external view returns (uint256) { return bnbCollected; }
    function liquidity() external view returns (uint256) { return VIRTUAL_BNB + bnbCollected; }
    function remainingTokens() external view returns (uint256) { return CURVE_ALLOC - tokensSold; }
    function remainingBNB() external view returns (uint256) {
        return bnbCollected >= MIGRATION_THRESHOLD ? 0 : MIGRATION_THRESHOLD - bnbCollected;
    }
    function estimatedMigration() external view returns (uint256 bnbToGo, uint256 progressBps) {
        bnbToGo = bnbCollected >= MIGRATION_THRESHOLD ? 0 : MIGRATION_THRESHOLD - bnbCollected;
        progressBps = migrated ? 10000 : (bnbCollected * 10000) / MIGRATION_THRESHOLD;
    }
    function priceChange() external view returns (int256 bps) {
        if (priceRefPrice == 0) return 0;
        int256 cur = int256(currentPrice());
        int256 ref = int256(priceRefPrice);
        bps = ((cur - ref) * 10000) / ref;
    }

    function quoteBuy(uint256 bnbIn) public view returns (uint256 tokensOut, uint256 fee) {
        fee = (bnbIn * _totalFeeBps(false)) / 10000;
        uint256 net = bnbIn - fee;
        (uint256 rBNB, uint256 rTOK) = reserves();
        tokensOut = (net * rTOK) / (rBNB + net);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 bnbOut, uint256 fee) {
        (uint256 rBNB, uint256 rTOK) = reserves();
        uint256 gross = (tokensIn * rBNB) / (rTOK + tokensIn);
        fee = (gross * _totalFeeBps(false)) / 10000;
        bnbOut = gross - fee;
    }

    // ---- AntiBot ----

    function _checkAntiBot(address who, bool isBuy, uint256 tokenAmount, uint256 bnbAmount) internal {
        AntiBot memory a = antibot;
        if (!a.enabled) return;
        if (a.antiFlashloan) {
            // bloquea contratos
            uint256 size;
            assembly { size := extcodesize(who) }
            if (size > 0 || who != tx.origin) revert AntiBotViolation("contract");
        }
        if (a.antiSandwich) {
            if (lastActionBlock[who] == block.number) revert AntiBotViolation("sandwich");
        }
        if (a.cooldownSeconds > 0) {
            if (block.timestamp < lastActionTs[who] + a.cooldownSeconds) revert AntiBotViolation("cooldown");
        }
        if (isBuy) {
            if (a.maxBuyBnb > 0 && bnbAmount > a.maxBuyBnb) revert AntiBotViolation("maxBuy");
            if (a.maxTxTokens > 0 && tokenAmount > a.maxTxTokens) revert AntiBotViolation("maxTx");
            if (a.maxWalletTokens > 0) {
                uint256 bal = token.balanceOf(who);
                if (bal + tokenAmount > a.maxWalletTokens) revert AntiBotViolation("maxWallet");
            }
        } else {
            if (a.maxTxTokens > 0 && tokenAmount > a.maxTxTokens) revert AntiBotViolation("maxTx");
        }
        lastActionBlock[who] = block.number;
        lastActionTs[who] = block.timestamp;
    }

    // ---- Analytics helpers ----

    function _rollVolume(uint256 add) internal {
        if (block.timestamp >= volumeWindowStart + 1 days) {
            volumeWindowStart = block.timestamp;
            volume24h = add;
        } else {
            volume24h += add;
        }
        if (block.timestamp >= priceRefTs + 1 days) {
            priceRefTs = block.timestamp;
            priceRefPrice = lastPrice == 0 ? currentPrice() : lastPrice;
        }
    }

    // ---- Trading ----

    function buy(uint256 minTokensOut, address referrer)
        external
        payable
        nonReentrant
        whenNotPaused
        notMigrated
    {
        if (msg.value == 0) revert ZeroAmount();

        bool hasRef = referrer != address(0) && referrer != msg.sender;
        uint16 protoBps = _protocolFeeBps();
        uint256 protoFee = (msg.value * protoBps) / 10000;
        uint256 creatorFee = (msg.value * CREATOR_FEE_BPS) / 10000;
        uint256 refFee = hasRef ? (msg.value * REFERRAL_FEE_BPS) / 10000 : 0;
        uint256 totalFee = protoFee + creatorFee + refFee;
        uint256 net = msg.value - totalFee;

        (uint256 rBNB, uint256 rTOK) = reserves();
        uint256 tokensOut = (net * rTOK) / (rBNB + net);
        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensSold + tokensOut > CURVE_ALLOC) revert InsufficientReserve();

        _checkAntiBot(msg.sender, true, tokensOut, msg.value);

        tokensSold += tokensOut;
        bnbCollected += net;

        _payFee(_feeWallet(), protoFee, 0);
        _payFee(creator, creatorFee, 1);
        if (hasRef) {
            _payFee(referrer, refFee, 2);
            emit Referral(referrer, msg.sender, refFee);
        }

        if (!counted[msg.sender]) { counted[msg.sender] = true; holders += 1; }
        require(token.transfer(msg.sender, tokensOut), "tok tx");

        uint256 price = currentPrice();
        lastPrice = price;
        _rollVolume(msg.value);

        emit Buy(msg.sender, msg.value, tokensOut, price);
        emit Trade(msg.sender, true, msg.value, tokensOut, price, marketCap(), block.timestamp);

        if (bnbCollected >= MIGRATION_THRESHOLD) _migrate();
    }

    function sell(uint256 tokensIn, uint256 minBnbOut)
        external
        nonReentrant
        whenNotPaused
        notMigrated
    {
        if (tokensIn == 0) revert ZeroAmount();

        (uint256 rBNB, uint256 rTOK) = reserves();
        uint256 gross = (tokensIn * rBNB) / (rTOK + tokensIn);

        uint16 protoBps = _protocolFeeBps();
        uint256 protoFee = (gross * protoBps) / 10000;
        uint256 creatorFee = (gross * CREATOR_FEE_BPS) / 10000;
        uint256 totalFee = protoFee + creatorFee;
        uint256 bnbOut = gross - totalFee;
        if (bnbOut < minBnbOut) revert SlippageExceeded();

        _checkAntiBot(msg.sender, false, tokensIn, gross);

        require(token.transferFrom(msg.sender, address(this), tokensIn), "tok tx");
        tokensSold -= tokensIn;
        bnbCollected -= gross;

        _payFee(_feeWallet(), protoFee, 0);
        _payFee(creator, creatorFee, 1);

        (bool ok,) = msg.sender.call{value: bnbOut}("");
        if (!ok) revert TransferFailed();

        uint256 price = currentPrice();
        lastPrice = price;
        _rollVolume(gross);

        emit Sell(msg.sender, tokensIn, bnbOut, price);
        emit Trade(msg.sender, false, bnbOut, tokensIn, price, marketCap(), block.timestamp);
    }

    function _payFee(address to, uint256 amount, uint8 kind) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeeCollected(to, amount, kind);
    }

    // ---- Migración a PancakeSwap ----

    function _migrate() internal {
        migrated = true;
        uint256 bnbForLP = bnbCollected;
        uint256 tokensForLP = LP_ALLOC;

        require(token.approve(address(router), tokensForLP), "approve");
        router.addLiquidityETH{value: bnbForLP}(
            address(token),
            tokensForLP,
            0,
            0,
            address(0xdead),
            block.timestamp + 300
        );
        pancakePair = IPancakeFactory(router.factory()).getPair(address(token), router.WETH());

        uint256 remaining = token.balanceOf(address(this));
        if (remaining > 0) token.transfer(address(0xdead), remaining);

        emit Migrated(pancakePair, bnbForLP, tokensForLP);
    }

    receive() external payable {}
}

interface ILabsBNBFactory {
    function feeBps() external view returns (uint16);
    function feeWallet() external view returns (address);
    function owner() external view returns (address);
}

interface IPancakeFactory {
    function getPair(address a, address b) external view returns (address);
}
