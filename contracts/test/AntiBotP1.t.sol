// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LabsBNBFactory} from "../src/LabsBNBFactory.sol";
import {LabsBNBToken} from "../src/LabsBNBToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";

contract RouterMockP1 {
    function WETH() external pure returns (address) { return address(0xB00B); }
    function factory() external view returns (address) { return address(this); }
    function getPair(address, address) external pure returns (address) { return address(0xdead); }
    function addLiquidityETH(address, uint256 amountTokenDesired, uint256, uint256, address, uint256)
        external payable returns (uint256, uint256, uint256)
    {
        return (amountTokenDesired, msg.value, 1);
    }
}

contract ContractBuyer {
    function buy(BondingCurve c) external payable { c.buy{value: msg.value}(0, address(0)); }
    receive() external payable {}
}

/// @notice P-1: AntiBot nunca puede bloquear una venta legítima.
contract AntiBotP1Test is Test {
    LabsBNBFactory factory;
    RouterMockP1 router;
    address feeWallet = address(0xFEE);
    address treasury  = address(0x7EA);
    address creator   = address(0xC0DE);
    address alice     = address(0xA11CE);

    function setUp() public {
        router = new RouterMockP1();
        factory = new LabsBNBFactory(feeWallet, treasury, address(router), false);
        vm.deal(alice, 1000 ether);
    }

    function _create() internal returns (BondingCurve curve, LabsBNBToken token) {
        vm.prank(creator);
        (address t, address c) = factory.createToken("Test", "TST", "ipfs://x");
        curve = BondingCurve(payable(c));
        token = LabsBNBToken(t);
    }

    function _cfg(
        uint128 maxBuyBnb,
        uint128 maxWalletTokens,
        uint128 maxTxTokens,
        uint32 cooldown,
        bool sandwich,
        bool flashloan
    ) internal pure returns (BondingCurve.AntiBot memory) {
        return BondingCurve.AntiBot({
            maxBuyBnb: maxBuyBnb,
            maxWalletTokens: maxWalletTokens,
            maxTxTokens: maxTxTokens,
            cooldownSeconds: cooldown,
            antiSandwich: sandwich,
            antiFlashloan: flashloan,
            enabled: true
        });
    }

    function _buy(BondingCurve curve, uint256 v) internal {
        vm.prank(alice, alice);
        curve.buy{value: v}(0, address(0));
    }

    function _sell(BondingCurve curve, LabsBNBToken token, uint256 amount) internal {
        vm.startPrank(alice, alice);
        token.approve(address(curve), amount);
        curve.sell(amount, 0);
        vm.stopPrank();
    }

    // TEST 1 — configuración normal: buy y sell funcionan.
    function testNormalConfigBuyAndSellWork() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _buy(curve, 1 ether);
        uint256 bal = token.balanceOf(curve.creator()) + token.balanceOf(alice);
        assertGt(bal, 0);
        vm.warp(block.timestamp + 10);
        vm.roll(block.number + 1);
        _sell(curve, token, token.balanceOf(alice));
        assertEq(token.balanceOf(alice), 0);
    }

    // TEST 2 — maxTxTokens mínimo: bloquea buy, nunca sell.
    function testMaxTxDoesNotBlockSell() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _buy(curve, 1 ether);
        uint256 bal = token.balanceOf(alice);

        curve.setAntiBot(_cfg(0, 0, 1, 0, false, false));

        vm.roll(block.number + 1);
        vm.prank(alice, alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));

        _sell(curve, token, bal);
        assertEq(token.balanceOf(alice), 0);
    }

    // TEST 3 — cooldown extremo: bloquea buy, sell inmediato sigue funcionando.
    function testCooldownDoesNotBlockSell() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _buy(curve, 1 ether);
        uint256 bal = token.balanceOf(alice);

        curve.setAntiBot(_cfg(0, 0, 0, type(uint32).max, false, false));

        vm.roll(block.number + 1);
        vm.prank(alice, alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));

        // Sin avanzar el tiempo: la venta debe pasar igualmente.
        _sell(curve, token, bal);
        assertEq(token.balanceOf(alice), 0);
    }

    // TEST 4 — pause: buy bloqueado, sell operativo.
    function testPauseBlocksBuyNotSell() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _buy(curve, 1 ether);
        uint256 bal = token.balanceOf(alice);

        curve.pause();
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 100);
        vm.prank(alice, alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));

        _sell(curve, token, bal);
        assertEq(token.balanceOf(alice), 0);
    }

    // TEST 5 — anti-sandwich / anti-flashloan: siguen protegiendo buy, no bloquean sell.
    function testSandwichAndFlashloanOnlyAffectBuy() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        curve.setAntiBot(_cfg(0, 0, 0, 0, true, true));

        _buy(curve, 1 ether);
        // Segunda compra en el mismo bloque → anti-sandwich.
        vm.prank(alice, alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));

        // Contrato → anti-flashloan.
        ContractBuyer cb = new ContractBuyer();
        vm.deal(address(cb), 5 ether);
        vm.expectRevert();
        cb.buy{value: 1 ether}(curve);

        // Sell en el MISMO bloque que la compra: permitido.
        _sell(curve, token, token.balanceOf(alice));
        assertEq(token.balanceOf(alice), 0);
    }

    // TEST 6 — configuración agresiva máxima no puede congelar la salida.
    function testAggressiveAntiBotCannotFreezeExit() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _buy(curve, 2 ether);
        uint256 bal = token.balanceOf(alice);

        curve.setAntiBot(_cfg(1, 1, 1, type(uint32).max, true, true));
        curve.pause();

        _sell(curve, token, bal / 2);
        _sell(curve, token, token.balanceOf(alice));
        assertEq(token.balanceOf(alice), 0);
    }

    // TEST 7 — fees y balances correctos tras una venta con AntiBot agresivo.
    function testFeesAndBalancesAfterSell() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        _buy(curve, 1 ether);
        uint256 bal = token.balanceOf(alice);

        curve.setAntiBot(_cfg(1, 1, 1, type(uint32).max, true, true));

        (uint256 expectedOut,) = curve.quoteSell(bal);
        uint256 feeBefore = feeWallet.balance;
        uint256 creatorBefore = creator.balance;
        uint256 aliceBefore = alice.balance;

        _sell(curve, token, bal);

        assertEq(alice.balance - aliceBefore, expectedOut, "seller payout");
        assertGt(feeWallet.balance, feeBefore, "protocol fee");
        assertGt(creator.balance, creatorBefore, "creator fee");
        assertEq(address(curve).balance, curve.bnbCollected(), "curve backing");
    }
}
