// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LabsBNBFactory} from "../src/LabsBNBFactory.sol";
import {LabsBNBToken} from "../src/LabsBNBToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";

/// @notice Router mock que evita depender de Pancake real en tests.
contract RouterMock {
    address public constant WETH_ADDR = address(0xB00B); // stub
    function WETH() external pure returns (address) { return address(0xB00B); }
    function factory() external pure returns (address) { return address(0xFAC); }
    function addLiquidityETH(address, uint256, uint256, uint256, address, uint256)
        external payable returns (uint256, uint256, uint256) { return (0, 0, 0); }
}

contract BondingCurveTest is Test {
    LabsBNBFactory factory;
    RouterMock router;
    address feeWallet = address(0xFEE);
    address creator   = address(0xC0DE);
    address alice     = address(0xA11CE);
    address bob       = address(0xB0B);
    address ref       = address(0xEF);

    function setUp() public {
        router = new RouterMock();
        vm.prank(address(this));
        factory = new LabsBNBFactory(feeWallet, address(router));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _create() internal returns (BondingCurve curve, LabsBNBToken token) {
        vm.prank(creator);
        (address t, address c) = factory.createToken("Test", "TST", "ipfs://x");
        curve = BondingCurve(payable(c));
        token = LabsBNBToken(t);
    }

    function testCreateMintsSupplyToCurve() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        assertEq(token.totalSupply(), curve.TOTAL_SUPPLY());
        assertEq(token.balanceOf(address(curve)), curve.TOTAL_SUPPLY());
        assertEq(token.creator(), creator);
    }

    function testBuyTransfersTokens() public {
        (BondingCurve curve, LabsBNBToken token) = _create();
        vm.prank(alice);
        curve.buy{value: 1 ether}(0, address(0));
        assertGt(token.balanceOf(alice), 0);
    }

    function testAntiSandwichBlocksBuySellSameBlock() public {
        (BondingCurve curve,) = _create();
        // enable antibot
        vm.prank(address(this)); // owner of factory == this
        curve.setAntiBot(BondingCurve.AntiBot({
            maxBuyBnb: 0, maxWalletTokens: 0, maxTxTokens: 0,
            cooldownSeconds: 0, antiSandwich: true, antiFlashloan: false, enabled: true
        }));
        vm.startPrank(alice);
        curve.buy{value: 0.5 ether}(0, address(0));
        vm.expectRevert();
        curve.sell(1, 0);
        vm.stopPrank();
    }

    function testMaxBuyEnforced() public {
        (BondingCurve curve,) = _create();
        vm.prank(address(this));
        curve.setAntiBot(BondingCurve.AntiBot({
            maxBuyBnb: uint128(0.5 ether), maxWalletTokens: 0, maxTxTokens: 0,
            cooldownSeconds: 0, antiSandwich: false, antiFlashloan: false, enabled: true
        }));
        vm.prank(alice);
        vm.expectRevert();
        curve.buy{value: 1 ether}(0, address(0));
    }

    function testReferralFeeCredited() public {
        (BondingCurve curve,) = _create();
        uint256 before = ref.balance;
        vm.prank(alice);
        curve.buy{value: 1 ether}(0, ref);
        assertGt(ref.balance, before, "referrer should receive fee");
    }

    function testEmergencyWithdrawOnlyFactoryOwner() public {
        (BondingCurve curve,) = _create();
        vm.prank(alice);
        curve.buy{value: 1 ether}(0, address(0));
        vm.expectRevert();
        vm.prank(alice);
        curve.emergencyWithdraw(alice);
        // owner call
        uint256 before = feeWallet.balance;
        vm.prank(address(this));
        curve.emergencyWithdraw(feeWallet);
        assertGt(feeWallet.balance, before);
    }
}
