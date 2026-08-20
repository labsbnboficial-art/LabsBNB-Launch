// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPancakeRouter} from "./interfaces/IPancakeRouter.sol";

/// @title BondingCurve
/// @notice Curva constante x*y=k con reservas virtuales estilo four.meme / pump.fun.
/// @dev Endurecimiento pre-mainnet:
///      - Sin `emergencyWithdraw`: el owner NUNCA puede tocar el BNB respaldado por
///        los holders. Sólo puede hacer `skim()` del excedente no contabilizado.
///      - `pause()` bloquea únicamente las COMPRAS: la salida (sell) siempre está abierta.
///      - Graduación en fase propia: `buy()` no llama al router. Al cruzar el umbral la
///        curva entra en `Graduating` y cualquiera puede ejecutar `migrate()` con
///        mínimos de slippage. Si el router falla, la tx revierte (fallo visible) y se
///        puede reintentar; tras 7 días sin éxito se habilita el reembolso pro-rata.
contract BondingCurve is ReentrancyGuard, Pausable {
    // ---- Configuración inmutable ----
    IERC20 public token;
    address public immutable creator;
    address public immutable factory;
    IPancakeRouter public immutable router;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_ALLOC  =   800_000_000 ether;
    uint256 public constant LP_ALLOC     =   200_000_000 ether;

    uint256 public constant VIRTUAL_BNB    = 1.6 ether;
    uint256 public constant VIRTUAL_TOKENS = 800_000_000 ether;
    uint256 public constant MIGRATION_THRESHOLD = 24 ether;

    /// @notice Slippage máximo tolerado al añadir liquidez (1%).
    uint256 public constant MIGRATION_SLIPPAGE_BPS = 100;
    /// @notice Tras este plazo en `Graduating` sin migrar, el owner puede abrir el reembolso.
    uint256 public constant MIGRATION_GRACE = 7 days;

    // ---- Fases ----
    enum Phase { Bonding, Graduating, Migrated, Refunding }
    Phase public phase;

    // ---- AntiBot config (admin-configurable vía factory owner) ----
    struct AntiBot {
        uint128 maxBuyBnb;        // 0 = sin límite
        uint128 maxWalletTokens;  // 0 = sin límite
        uint128 maxTxTokens;      // 0 = sin límite
        uint32  cooldownSeconds;  // 0 = sin cooldown
        bool    antiSandwich;     // bloquea buy+sell en el mismo bloque por wallet
        bool    antiFlashloan;    // bloquea contratos no autorizados
        bool    enabled;
    }
    AntiBot public antibot;

    /// @notice Smart wallets (Safe, ERC-4337…) autorizadas pese a `antiFlashloan`.
    mapping(address => bool) public contractAllowed;

    // ---- Estado ----
    uint256 public tokensSold;
    uint256 public bnbCollected;
    /// @dev Mantenido por compatibilidad de ABI/frontend: true cuando phase == Migrated.
    bool    public migrated;
    address public pancakePair;
    uint256 public graduatingSince;

    // Reembolso de emergencia (sólo si la migración es imposible)
    uint256 public refundBnbPool;
    uint256 public refundTokenPool;

    // Analytics
    uint256 public holders;
    uint256 public volume24h;
    uint256 public volumeWindowStart;
    uint256 public lastPrice;
    uint256 public priceRefPrice;
    uint256 public priceRefTs;

    mapping(address => uint256) public lastActionBlock;
    mapping(address => uint256) public lastActionTs;
    mapping(address => bool)    public counted;

    // ---- Eventos ----
    event Buy(address indexed buyer, uint256 bnbIn, uint256 tokensOut, uint256 priceAfter);
    event Sell(address indexed seller, uint256 tokensIn, uint256 bnbOut, uint256 priceAfter);
    /// @dev `amountBnb` es SIEMPRE el importe bruto del trade (antes de fees), en buy y en sell.
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
    event GraduationReady(uint256 bnbCollected, uint256 timestamp);
    event Migrated(address indexed pair, uint256 bnbLiquidity, uint256 tokenLiquidity);
    event MigrationDust(address indexed to, uint256 bnb, uint256 tokens);
    event RefundEnabled(uint256 bnbPool, uint256 tokenPool);
    event Redeemed(address indexed holder, uint256 tokensIn, uint256 bnbOut);
    event AntiBotUpdated(AntiBot cfg);
    event ContractAllowed(address indexed account, bool allowed);
    event Skimmed(address indexed to, uint256 bnb, uint256 tokens);

    error AlreadyMigrated();
    error SlippageExceeded();
    error ZeroAmount();
    error InsufficientReserve();
    error TransferFailed();
    error OnlyFactoryOwner();
    error AntiBotViolation(string reason);
    error WrongPhase();
    error GraceNotElapsed();
    error NothingToSkim();

    modifier onlyPhase(Phase p) {
        if (phase != p) revert WrongPhase();
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
            maxWalletTokens: 0,
            maxTxTokens: 0,
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
        token = IERC20(token_);
    }

    // ---- Admin (factory owner) ----

    function setAntiBot(AntiBot calldata cfg) external onlyFactoryOwner {
        antibot = cfg;
        emit AntiBotUpdated(cfg);
    }

    function setContractAllowed(address account, bool allowed) external onlyFactoryOwner {
        contractAllowed[account] = allowed;
        emit ContractAllowed(account, allowed);
    }

    /// @notice Pausa SÓLO las compras. Las ventas nunca se pueden bloquear.
    function pause() external onlyFactoryOwner { _pause(); }
    function unpause() external onlyFactoryOwner { _unpause(); }

    /// @notice BNB no contabilizado (donaciones vía receive, polvo post-migración).
    function skimmableBnb() public view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 reserved = phase == Phase.Refunding
            ? refundBnbPool
            : (phase == Phase.Migrated ? 0 : bnbCollected);
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice Tokens no comprometidos con la curva ni con la LP futura.
    function skimmableTokens() public view returns (uint256) {
        if (phase != Phase.Bonding && phase != Phase.Graduating) return 0;
        uint256 bal = token.balanceOf(address(this));
        uint256 reserved = (CURVE_ALLOC - tokensSold) + LP_ALLOC;
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice Rescate ESTRICTAMENTE limitado al excedente. Nunca toca fondos de holders.
    function skim(address to) external nonReentrant onlyFactoryOwner {
        if (to == address(0)) revert TransferFailed();
        uint256 bnb = skimmableBnb();
        uint256 tok = skimmableTokens();
        if (bnb == 0 && tok == 0) revert NothingToSkim();
        if (bnb > 0) {
            (bool ok,) = to.call{value: bnb}("");
            if (!ok) revert TransferFailed();
        }
        if (tok > 0) require(token.transfer(to, tok), "tok tx");
        emit Skimmed(to, bnb, tok);
    }

    // ---- Vistas / quotes ----

    function _protocolFeeBps() internal view returns (uint16) {
        return ILabsBNBFactory(factory).feeBps();
    }
    function _creatorFeeBps() internal view returns (uint16) {
        return ILabsBNBFactory(factory).creatorFeeBps();
    }
    function _referralFeeBps() internal view returns (uint16) {
        return ILabsBNBFactory(factory).referralFeeBps();
    }
    function _feeWallet() internal view returns (address) {
        return ILabsBNBFactory(factory).feeWallet();
    }

    function _totalFeeBps(bool withReferral) internal view returns (uint16) {
        uint16 f = _protocolFeeBps() + _creatorFeeBps();
        if (withReferral) f += _referralFeeBps();
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
        if (phase != Phase.Bonding) return 10000;
        uint256 p = (bnbCollected * 10000) / MIGRATION_THRESHOLD;
        return p > 10000 ? 10000 : p;
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
        if (phase != Phase.Bonding) {
            progressBps = 10000;
        } else {
            uint256 p = (bnbCollected * 10000) / MIGRATION_THRESHOLD;
            progressBps = p > 10000 ? 10000 : p;
        }
    }
    function priceChange() external view returns (int256 bps) {
        if (priceRefPrice == 0) return 0;
        int256 cur = int256(currentPrice());
        int256 ref = int256(priceRefPrice);
        bps = ((cur - ref) * 10000) / ref;
    }

    function quoteBuy(uint256 bnbIn) public view returns (uint256 tokensOut, uint256 fee) {
        return quoteBuyWithReferral(bnbIn, address(0));
    }

    /// @notice Cotización exacta incluyendo el referral fee cuando aplica.
    /// @dev Replica el redondeo componente a componente de `buy()` (fee por fee),
    ///      de modo que la cotización coincide al wei con la ejecución.
    function quoteBuyWithReferral(uint256 bnbIn, address referrer)
        public
        view
        returns (uint256 tokensOut, uint256 fee)
    {
        uint256 protoFee = (bnbIn * _protocolFeeBps()) / 10000;
        uint256 creatorFee = (bnbIn * _creatorFeeBps()) / 10000;
        uint256 refFee = referrer != address(0) ? (bnbIn * _referralFeeBps()) / 10000 : 0;
        fee = protoFee + creatorFee + refFee;
        uint256 net = bnbIn - fee;
        (uint256 rBNB, uint256 rTOK) = reserves();
        tokensOut = (net * rTOK) / (rBNB + net);
    }

    /// @dev Replica el redondeo de `sell()` (protocol y creator fee redondeados por separado).
    function quoteSell(uint256 tokensIn) public view returns (uint256 bnbOut, uint256 fee) {
        (uint256 rBNB, uint256 rTOK) = reserves();
        uint256 gross = (tokensIn * rBNB) / (rTOK + tokensIn);
        uint256 protoFee = (gross * _protocolFeeBps()) / 10000;
        uint256 creatorFee = (gross * _creatorFeeBps()) / 10000;
        fee = protoFee + creatorFee;
        bnbOut = gross - fee;
    }


    // ---- AntiBot ----

    function _checkAntiBot(address who, bool isBuy, uint256 tokenAmount, uint256 bnbAmount) internal {
        AntiBot memory a = antibot;
        if (!a.enabled) return;
        if (a.antiFlashloan && !contractAllowed[who]) {
            uint256 size;
            assembly { size := extcodesize(who) }
            if (size > 0) revert AntiBotViolation("contract");
        }
        if (a.antiSandwich) {
            if (lastActionBlock[who] == block.number) revert AntiBotViolation("sandwich");
        }
        if (a.cooldownSeconds > 0 && lastActionTs[who] != 0) {
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
        onlyPhase(Phase.Bonding)
    {
        if (msg.value == 0) revert ZeroAmount();

        bool hasRef = referrer != address(0) && referrer != msg.sender;
        uint256 protoFee = (msg.value * _protocolFeeBps()) / 10000;
        uint256 creatorFee = (msg.value * _creatorFeeBps()) / 10000;
        uint256 refFee = hasRef ? (msg.value * _referralFeeBps()) / 10000 : 0;
        uint256 net = msg.value - protoFee - creatorFee - refFee;

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

        // La migración NO se ejecuta aquí: sólo se marca la curva como lista.
        if (bnbCollected >= MIGRATION_THRESHOLD) {
            phase = Phase.Graduating;
            graduatingSince = block.timestamp;
            emit GraduationReady(bnbCollected, block.timestamp);
        }
    }

    function sell(uint256 tokensIn, uint256 minBnbOut)
        external
        nonReentrant
        onlyPhase(Phase.Bonding)
    {
        if (tokensIn == 0) revert ZeroAmount();

        (uint256 rBNB, uint256 rTOK) = reserves();
        uint256 gross = (tokensIn * rBNB) / (rTOK + tokensIn);

        uint256 protoFee = (gross * _protocolFeeBps()) / 10000;
        uint256 creatorFee = (gross * _creatorFeeBps()) / 10000;
        uint256 bnbOut = gross - protoFee - creatorFee;
        if (bnbOut < minBnbOut) revert SlippageExceeded();

        _checkAntiBot(msg.sender, false, tokensIn, gross);

        require(token.transferFrom(msg.sender, address(this), tokensIn), "tok tx");
        tokensSold -= tokensIn;
        bnbCollected -= gross;

        _payFee(_feeWallet(), protoFee, 0);
        _payFee(creator, creatorFee, 1);

        (bool ok,) = msg.sender.call{value: bnbOut}("");
        if (!ok) revert TransferFailed();

        if (counted[msg.sender] && token.balanceOf(msg.sender) == 0) {
            counted[msg.sender] = false;
            if (holders > 0) holders -= 1;
        }

        uint256 price = currentPrice();
        lastPrice = price;
        _rollVolume(gross);

        emit Sell(msg.sender, tokensIn, bnbOut, price);
        emit Trade(msg.sender, false, gross, tokensIn, price, marketCap(), block.timestamp);
    }

    function _payFee(address to, uint256 amount, uint8 kind) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeeCollected(to, amount, kind);
    }

    // ---- Migración a PancakeSwap ----

    /// @notice Ejecuta la graduación. Permissionless, reintentable, con mínimos de slippage.
    ///         Si el router falla la transacción revierte por completo (fallo visible),
    ///         la curva permanece en `Graduating` y se puede reintentar.
    function migrate() external nonReentrant onlyPhase(Phase.Graduating) {
        if (bnbCollected < MIGRATION_THRESHOLD) revert InsufficientReserve();

        phase = Phase.Migrated;
        migrated = true;

        uint256 bnbForLP = bnbCollected;
        uint256 tokensForLP = LP_ALLOC;
        uint256 minTokens = (tokensForLP * (10000 - MIGRATION_SLIPPAGE_BPS)) / 10000;
        uint256 minBnb = (bnbForLP * (10000 - MIGRATION_SLIPPAGE_BPS)) / 10000;

        require(token.approve(address(router), tokensForLP), "approve");
        (uint256 usedTokens, uint256 usedBnb,) = router.addLiquidityETH{value: bnbForLP}(
            address(token),
            tokensForLP,
            minTokens,
            minBnb,
            address(0xdead),
            block.timestamp + 300
        );
        require(usedTokens >= minTokens && usedBnb >= minBnb, "migration slippage");
        require(token.approve(address(router), 0), "approve reset");

        pancakePair = IPancakeFactory(router.factory()).getPair(address(token), router.WETH());

        // Tokens sobrantes de la curva → quemados. BNB sobrante (refund del router) → fee wallet.
        uint256 remainingTok = token.balanceOf(address(this));
        if (remainingTok > 0) require(token.transfer(address(0xdead), remainingTok), "burn");
        uint256 dust = address(this).balance;
        if (dust > 0) {
            (bool ok,) = _feeWallet().call{value: dust}("");
            if (!ok) revert TransferFailed();
            emit MigrationDust(_feeWallet(), dust, remainingTok);
        }

        emit Migrated(pancakePair, usedBnb, usedTokens);
    }

    /// @notice Última red de seguridad: si tras `MIGRATION_GRACE` la migración sigue siendo
    ///         imposible (router roto/pausado), habilita el reembolso pro-rata a los holders.
    ///         El owner NO recibe fondos: sólo abre el canje.
    function enableRefund() external onlyFactoryOwner onlyPhase(Phase.Graduating) {
        if (block.timestamp < graduatingSince + MIGRATION_GRACE) revert GraceNotElapsed();
        phase = Phase.Refunding;
        refundBnbPool = address(this).balance;
        refundTokenPool = tokensSold;
        emit RefundEnabled(refundBnbPool, refundTokenPool);
    }

    /// @notice Canjea tokens por su parte proporcional del BNB de la curva.
    function redeem(uint256 tokensIn) external nonReentrant onlyPhase(Phase.Refunding) {
        if (tokensIn == 0) revert ZeroAmount();
        if (refundTokenPool == 0) revert InsufficientReserve();
        uint256 bnbOut = (tokensIn * refundBnbPool) / refundTokenPool;
        refundBnbPool -= bnbOut;
        refundTokenPool -= tokensIn;
        require(token.transferFrom(msg.sender, address(this), tokensIn), "tok tx");
        if (bnbOut > 0) {
            (bool ok,) = msg.sender.call{value: bnbOut}("");
            if (!ok) revert TransferFailed();
        }
        emit Redeemed(msg.sender, tokensIn, bnbOut);
    }

    receive() external payable {}
}

interface ILabsBNBFactory {
    function feeBps() external view returns (uint16);
    function creatorFeeBps() external view returns (uint16);
    function referralFeeBps() external view returns (uint16);
    function feeWallet() external view returns (address);
    function treasury() external view returns (address);
    function owner() external view returns (address);
}

interface IPancakeFactory {
    function getPair(address a, address b) external view returns (address);
}
