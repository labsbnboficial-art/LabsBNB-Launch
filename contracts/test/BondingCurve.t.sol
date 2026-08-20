// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LabsBNBFactory} from "../src/LabsBNBFactory.sol";
import {LabsBNBToken} from "../src/LabsBNBToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";

/// @notice Router mock que evita depender de Pancake real en tests.
contract RouterMock {
    bool public shouldFail;
    address public pairAddr = address(0xdeadBEEF);

    function setShouldFail(bool v) external { shouldFail = v; }

    function WETH() external pure returns (address) { return address(0xB00B); }
    function factory() external view returns (address) { return address(this); }
    function getPair(address, address) external view returns (address) { return pairAddr; }

    function addLiquidityETH(address, uint256 amountTokenDesired, uint256, uint256, address, uint256)
        external payable returns (uint256, uint256, uint256)
    {
        require(!shouldFail, "ROUTER_DOWN");
        return (amountTokenDesired, msg.value, 1);
    }
}

/// @notice Router que consume menos de lo pedido → debe disparar la protección de slippage.
contract BadRouterMock {
    function WETH() external pure returns (address) { return address(0xB00B); }
    function factory() external view returns (address) { return address(this); }
    function getPair(address, address) external pure returns (address) { return address(0); }
    function addLiquidityETH(address, uint256 amountTokenDesired, uint256, uint256, address, uint256)
        external payable returns (uint256, uint256, uint256)
    {
        // Sólo usa el 50% → slippage inaceptable.
        return (amountTokenDesired / 2, msg.value / 2, 1);
    }
}

contract SmartWallet {
    function buy(BondingCurve c, uint256 value) external payable {
        c.buy{value: value}(0, address(0));
    }
    receive() external payable {}
}

contract BondingCurveTest is Test {
    LabsBNBFactory factory;
    RouterMock router;
    address feeWallet = address(0xFEE);
    address treasury  = address(0x7EA);
    address creator   = address(0xC0DE);
    address alice     = address(0xA11CE);
    address bob       = address(0xB0B);
    address ref       = address(0xEF);

    function setUp() public {
        router = new RouterMock();
        factory = new LabsBNBFactory(feeWallet, treasury, address(router), false);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _create() internal returns (BondingCurve curve, LabsBNBToken token) {
        vm.prank(creator);
        (address t, address c) = factory.createToken("Test", "TST", "ipfs://x");
        curve = BondingCurve(payable(c));
        token = LabsBNBToken(t);
    }

    function _openAntibot(BondingCurve curve) internal {
        curve.setAntiBot(BondingCurve.AntiBot({
            maxBuyBnb: 0, maxWalletTokens: 0, maxTxTokens: 0,
            cooldownSeconds: 0, antiSandwich: false, antiFlashloan: false, enabled: false
        }));
    }

    // ---------- Base ----------

    function testCreateMintsSupplyToCurve() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        assertEq(token.totalSupply(), curve.TOTAL_SUPPLY());
        assertEq(token.balanceOf(address(curve)), curve.TOTAL_SUPPLY());
        assertEq(token.creator(), creator);
    }

    function testBuyTransfersTokens() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        vm.prank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        assertGt(token.balanceOf(alice), 0);
    }

    // ---------- Matemática / rounding / slippage ----------

    function testQuoteBuyMatchesBuy() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        (uint256 expected,) = curve.quoteBuy(1 ether);
        vm.prank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        assertEq(token.balanceOf(alice), expected);
    }

    function testQuoteBuyWithReferralMatchesBuy() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        (uint256 expected,) = curve.quoteBuyWithReferral(1 ether, ref);
        (uint256 noRef,) = curve.quoteBuy(1 ether);
        assertLt(expected, noRef, "referral quote must be lower");
        vm.prank(alice, alice);
        curve.buy{value: 1 ether}(0, ref);
        assertEq(token.balanceOf(alice), expected);
    }

    function testQuoteSellMatchesSell() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _openAntibot(curve);
        vm.startPrank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        uint256 bal = token.balanceOf(alice);
        (uint256 expected,) = curve.quoteSell(bal);
        token.approve(address(curve), bal);
        uint256 before = alice.balance;
        curve.sell(bal, 0);
        vm.stopPrank();
        assertEq(alice.balance - before, expected);
    }

    function testReservesStayBackedByBalance() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _openAntibot(curve);
        vm.startPrank(alice, alice);
        curve.buy{value: 3 ether}(0, address(0));
        uint256 bal = token.balanceOf(alice) / 2;
        token.approve(address(curve), bal);
        curve.sell(bal, 0);
        vm.stopPrank();
        assertEq(address(curve).balance, curve.bnbCollected());
    }

    function testBuySlippageReverts() public {
        (BondingCurve curve,) = _create();
        (uint256 expected,) = curve.quoteBuy(1 ether);
        vm.prank(alice, alice);
        vm.expectRevert(BondingCurve.SlippageExceeded.selector);
        curve.buy{value: 1 ether}(expected + 1, address(0));
    }

    function testSellSlippageReverts() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _openAntibot(curve);
        vm.startPrank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        uint256 bal = token.balanceOf(alice);
        (uint256 expected,) = curve.quoteSell(bal);
        token.approve(address(curve), bal);
        vm.expectRevert(BondingCurve.SlippageExceeded.selector);
        curve.sell(bal, expected + 1);
        vm.stopPrank();
    }

    function testDustBuyNeverMintsFreeTokens() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        vm.prank(alice, alice);
        curve.buy{value: 1 wei}(0, address(0));
        assertLe(token.balanceOf(alice), 1e18);
        assertLe(curve.bnbCollected(), 1 wei);
    }

    // ---------- Fees ----------

    function testFeeSplitBuy() public {
        (BondingCurve curve,) = _create();
        _openAntibot(curve);
        uint256 fw = feeWallet.balance;
        uint256 cr = creator.balance;
        uint256 rf = ref.balance;
        vm.prank(alice, alice);
        curve.buy{value: 10 ether}(0, ref);
        assertEq(feeWallet.balance - fw, 10 ether * 50 / 10000);
        assertEq(creator.balance - cr, 10 ether * 20 / 10000);
        assertEq(ref.balance - rf, 10 ether * 10 / 10000);
    }

    function testNoSelfReferral() public {
        (BondingCurve curve,) = _create();
        uint256 before = alice.balance;
        vm.prank(alice, alice);
        curve.buy{value: 1 ether}(0, alice);
        // sólo gastó el valor enviado, no recibió rebate
        assertEq(before - alice.balance, 1 ether);
    }

    function testFactoryFeeCapAndTimelock() public {
        vm.expectRevert(LabsBNBFactory.InvalidFee.selector);
        factory.setFee(101);

        // subida → queda en timelock
        factory.setFee(100);
        assertEq(factory.feeBps(), 50);
        vm.expectRevert(LabsBNBFactory.TimelockPending.selector);
        factory.applyFee();
        vm.warp(block.timestamp + 48 hours);
        factory.applyFee();
        assertEq(factory.feeBps(), 100);

        // bajada → inmediata
        factory.setFee(10);
        assertEq(factory.feeBps(), 10);
    }

    function testOnlyOwnerCanChangeFees() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setFee(10);
        vm.prank(alice);
        vm.expectRevert();
        factory.setFeeWallet(alice);
    }

    function testMainnetRejectsDeployerFeeWallet() public {
        vm.chainId(56);
        vm.expectRevert(LabsBNBFactory.FeeWalletIsOwner.selector);
        new LabsBNBFactory(address(this), treasury, address(router), false);
        // permitido si es intencional
        LabsBNBFactory f = new LabsBNBFactory(address(this), treasury, address(router), true);
        assertEq(f.feeWallet(), address(this));
    }

    // ---------- Permisos / pause / skim ----------

    function testPauseBlocksBuysButNeverSells() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _openAntibot(curve);
        vm.prank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        curve.pause();
        vm.prank(alice, alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));
        // la salida sigue disponible
        uint256 bal = token.balanceOf(alice);
        vm.startPrank(alice, alice);
        token.approve(address(curve), bal);
        curve.sell(bal, 0);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 0);
    }

    function testOwnerCannotWithdrawUserFunds() public {
        (BondingCurve curve,) = _create();
        _openAntibot(curve);
        vm.prank(alice, alice);
        curve.buy{value: 5 ether}(0, address(0));
        // no existe emergencyWithdraw; skim sólo puede tocar el excedente (0 aquí)
        assertEq(curve.skimmableBnb(), 0);
        vm.expectRevert(BondingCurve.NothingToSkim.selector);
        curve.skim(feeWallet);
        assertEq(address(curve).balance, curve.bnbCollected());
    }

    function testSkimOnlyTakesDonatedSurplus() public {
        (BondingCurve curve,) = _create();
        vm.prank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        uint256 backed = curve.bnbCollected();
        vm.deal(address(this), 2 ether);
        (bool ok,) = address(curve).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(curve.skimmableBnb(), 2 ether);
        uint256 before = feeWallet.balance;
        curve.skim(feeWallet);
        assertEq(feeWallet.balance - before, 2 ether);
        assertEq(address(curve).balance, backed);
    }

    function testSkimOnlyFactoryOwner() public {
        (BondingCurve curve,) = _create();
        vm.prank(alice);
        vm.expectRevert(BondingCurve.OnlyFactoryOwner.selector);
        curve.skim(alice);
        vm.prank(alice);
        vm.expectRevert(BondingCurve.OnlyFactoryOwner.selector);
        curve.pause();
    }

    // ---------- AntiBot ----------

    function testAntiSandwichBlocksBuySellSameBlock() public {
        (BondingCurve curve,) = _create();
        curve.setAntiBot(BondingCurve.AntiBot({
            maxBuyBnb: 0, maxWalletTokens: 0, maxTxTokens: 0,
            cooldownSeconds: 0, antiSandwich: true, antiFlashloan: false, enabled: true
        }));
        vm.startPrank(alice, alice);
        curve.buy{value: 0.5 ether}(0, address(0));
        vm.expectRevert();
        curve.sell(1, 0);
        vm.stopPrank();
    }

    function testMaxBuyEnforced() public {
        (BondingCurve curve,) = _create();
        curve.setAntiBot(BondingCurve.AntiBot({
            maxBuyBnb: uint128(0.5 ether), maxWalletTokens: 0, maxTxTokens: 0,
            cooldownSeconds: 0, antiSandwich: false, antiFlashloan: false, enabled: true
        }));
        vm.prank(alice, alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));
    }

    function testSmartWalletAllowlist() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        SmartWallet w = new SmartWallet();
        vm.deal(address(w), 5 ether);
        vm.expectRevert();
        w.buy(curve, 1 ether);
        curve.setContractAllowed(address(w), true);
        w.buy(curve, 1 ether);
        assertGt(token.balanceOf(address(w)), 0);
    }

    function testHoldersDecrementsOnFullExit() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _openAntibot(curve);
        vm.startPrank(alice, alice);
        curve.buy{value: 1 ether}(0, address(0));
        assertEq(curve.holders(), 1);
        uint256 bal = token.balanceOf(alice);
        token.approve(address(curve), bal);
        curve.sell(bal, 0);
        vm.stopPrank();
        assertEq(curve.holders(), 0);
    }

    // ---------- Graduation ----------

    function _pushToThreshold(BondingCurve curve) internal {
        _openAntibot(curve);
        vm.prank(alice, alice);
        curve.buy{value: 30 ether}(0, address(0));
    }

    function testBuyDoesNotMigrateInline() public {
        (BondingCurve curve,) = _create();
        _pushToThreshold(curve);
        assertEq(uint8(curve.phase()), uint8(BondingCurve.Phase.Graduating));
        assertFalse(curve.migrated());
        // trading cerrado durante la graduación
        vm.prank(bob, bob);
        vm.expectRevert(BondingCurve.WrongPhase.selector);
        curve.buy{value: 1 ether}(0, address(0));
    }

    function testMigratePermissionlessAndOnce() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _pushToThreshold(curve);
        uint256 bnb = curve.bnbCollected();
        vm.prank(bob);
        curve.migrate();
        assertTrue(curve.migrated());
        assertEq(uint8(curve.phase()), uint8(BondingCurve.Phase.Migrated));
        assertEq(address(router).balance, bnb);
        assertEq(token.balanceOf(address(curve)), 0);
        vm.expectRevert(BondingCurve.WrongPhase.selector);
        curve.migrate();
    }

    function testRouterFailureDoesNotBlockNorHide() public {
        (BondingCurve curve,) = _create();
        _pushToThreshold(curve);
        router.setShouldFail(true);
        vm.expectRevert(bytes("ROUTER_DOWN"));
        curve.migrate();
        // estado intacto y reintentable
        assertEq(uint8(curve.phase()), uint8(BondingCurve.Phase.Graduating));
        assertEq(address(curve).balance, curve.bnbCollected());
        router.setShouldFail(false);
        curve.migrate();
        assertTrue(curve.migrated());
    }

    function testMigrationSlippageProtection() public {
        BadRouterMock bad = new BadRouterMock();
        LabsBNBFactory f = new LabsBNBFactory(feeWallet, treasury, address(bad), false);
        vm.prank(creator);
        (, address c) = f.createToken("T", "T", "u");
        BondingCurve curve = BondingCurve(payable(c));
        _pushToThreshold(curve);
        vm.expectRevert(bytes("migration slippage"));
        curve.migrate();
    }

    function testRefundAfterGraceReturnsUserFunds() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _pushToThreshold(curve);
        router.setShouldFail(true);
        vm.expectRevert(BondingCurve.GraceNotElapsed.selector);
        curve.enableRefund();
        vm.warp(block.timestamp + 7 days + 1);
        curve.enableRefund();
        assertEq(uint8(curve.phase()), uint8(BondingCurve.Phase.Refunding));

        uint256 bal = token.balanceOf(alice);
        uint256 before = alice.balance;
        vm.startPrank(alice, alice);
        token.approve(address(curve), bal);
        curve.redeem(bal);
        vm.stopPrank();
        assertGt(alice.balance - before, 0);
        // el owner nunca pudo llevarse el pool
        assertLe(address(curve).balance, 10);
    }

    function testEnableRefundOnlyOwnerAndOnlyGraduating() public {
        (BondingCurve curve,) = _create();
        vm.expectRevert(BondingCurve.WrongPhase.selector);
        curve.enableRefund();
        _pushToThreshold(curve);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        vm.expectRevert(BondingCurve.OnlyFactoryOwner.selector);
        curve.enableRefund();
    }
}
