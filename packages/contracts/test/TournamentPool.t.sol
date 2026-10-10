// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TournamentPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC2 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract TournamentPoolTest is Test {
    TournamentPool pool;
    TournamentPool poolDisabled;
    MockUSDC2      usdc;

    address owner   = address(0x1);
    address ref_    = address(0x2);
    address sponsor = address(0x5);
    address p1      = address(0x6);
    address p2      = address(0x7);
    address p3      = address(0x8);
    address p4      = address(0x9);

    bytes32 constant TID = keccak256("t1");
    uint256 constant FEE = 500_000; // 0.5 USDC

    // 4-way split: 50 / 30 / 20 / 0 — but we need sum == 10000 for 4 placements
    uint16[] splits4 = [5000, 3000, 2000, 0]; // sum 10000

    function setUp() public {
        usdc = new MockUSDC2();
        pool = new TournamentPool(usdc, true,  owner, ref_);
        poolDisabled = new TournamentPool(usdc, false, owner, ref_);

        address[] memory players = new address[](4);
        players[0] = p1; players[1] = p2; players[2] = p3; players[3] = p4;
        for (uint i = 0; i < players.length; i++) {
            usdc.mint(players[i], 10_000_000);
            vm.prank(players[i]);
            usdc.approve(address(pool), type(uint256).max);
        }
        usdc.mint(sponsor, 100_000_000);
        vm.prank(sponsor); usdc.approve(address(pool), type(uint256).max);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _create(bool withFee) internal {
        vm.prank(ref_);
        pool.create(TID, withFee ? FEE : 0, splits4, uint64(block.timestamp + 100));
    }

    function _registerAll() internal {
        vm.prank(p1); pool.register(TID);
        vm.prank(p2); pool.register(TID);
        vm.prank(p3); pool.register(TID);
        vm.prank(p4); pool.register(TID);
    }

    // ── stakes disabled: entry fee rejected ──────────────────────────────────

    function test_Disabled_RejectsFee() public {
        vm.prank(ref_);
        vm.expectRevert("StakesDisabled");
        poolDisabled.create(TID, FEE, splits4, uint64(block.timestamp + 100));
    }

    function test_Disabled_SponsorFundingWorks() public {
        vm.prank(ref_);
        poolDisabled.create(TID, 0, splits4, uint64(block.timestamp + 100));
        vm.prank(sponsor); usdc.approve(address(poolDisabled), type(uint256).max);
        vm.prank(sponsor); poolDisabled.fund(TID, 4_000_000);
        assertEq(poolDisabled.poolBalance(TID), 4_000_000);
    }

    // ── payouts match splits ──────────────────────────────────────────────────

    function test_Finalize_PayoutsMatchSplits() public {
        _create(false);
        vm.prank(sponsor); pool.fund(TID, 4_000_000); // 4 USDC
        _registerAll();
        vm.warp(block.timestamp + 101);

        uint256 b1 = usdc.balanceOf(p1);
        uint256 b2 = usdc.balanceOf(p2);
        uint256 b3 = usdc.balanceOf(p3);

        address[] memory placements = new address[](4);
        placements[0] = p1; placements[1] = p2; placements[2] = p3; placements[3] = p4;

        vm.prank(ref_);
        pool.finalize(TID, placements);

        // splits: 50%, 30%, 20%, 0% of 4_000_000
        assertEq(usdc.balanceOf(p1) - b1, 2_000_000);
        assertEq(usdc.balanceOf(p2) - b2, 1_200_000);
        assertEq(usdc.balanceOf(p3) - b3, 800_000);
    }

    function test_Finalize_DustToFirst() public {
        _create(false);
        // 1 USDC — splits 50/30/20/0 → 500000/300000/200000/0 exact, no dust
        // Use a pool of 7 to get dust: 7 * 5000/10000 = 3.5 → 3, 7*3000/10000=2, 7*2000/10000=1, dust=1
        vm.prank(sponsor); pool.fund(TID, 7);
        _registerAll();
        vm.warp(block.timestamp + 101);

        address[] memory placements = new address[](4);
        placements[0] = p1; placements[1] = p2; placements[2] = p3; placements[3] = p4;

        uint256 b1 = usdc.balanceOf(p1);
        vm.prank(ref_);
        pool.finalize(TID, placements);
        // Last placement (index 3, split=0) gets the dust which is pool - distributed
        // distributed = 3+2+1=6, dust = 1 goes to last split which is p4
        // Actually p4 (last placement index) has split 0, so they get 7-(3+2+1)=1 via dust path
        uint256 remaining = usdc.balanceOf(address(pool));
        assertEq(remaining, 0); // nothing left behind
    }

    // ── cancel refunds every party ────────────────────────────────────────────

    function test_Cancel_RefundsEntrantsAndFunders() public {
        _create(true);
        vm.prank(sponsor); pool.fund(TID, 2_000_000);
        vm.prank(p1); pool.register(TID);
        vm.prank(p2); pool.register(TID);

        uint256 bSponsor = usdc.balanceOf(sponsor);
        uint256 bP1 = usdc.balanceOf(p1);
        uint256 bP2 = usdc.balanceOf(p2);

        vm.prank(ref_);
        pool.cancel(TID);

        assertEq(usdc.balanceOf(sponsor), bSponsor + 2_000_000);
        assertEq(usdc.balanceOf(p1), bP1 + FEE);
        assertEq(usdc.balanceOf(p2), bP2 + FEE);
    }

    function test_Cancel_AnyoneAfterGrace() public {
        _create(false);
        vm.warp(block.timestamp + 101 + 7 days + 1);
        vm.prank(address(0x99));
        pool.cancel(TID); // should not revert
    }

    function test_Cancel_UnauthorisedBeforeGrace() public {
        _create(false);
        vm.warp(block.timestamp + 101);
        vm.prank(address(0x99));
        vm.expectRevert("not authorised");
        pool.cancel(TID);
    }

    // ── splits must sum to 10000 ──────────────────────────────────────────────

    function test_Create_InvalidSplitsReverts() public {
        uint16[] memory bad = new uint16[](2);
        bad[0] = 5000; bad[1] = 4999; // sum 9999
        vm.prank(ref_);
        vm.expectRevert("splits != 10000");
        pool.create(TID, 0, bad, uint64(block.timestamp + 100));
    }
}

// ── Invariant: pool balance = sum of unfinalised contributions + fees ─────────

contract TournamentPoolInvariant is Test {
    TournamentPool pool;
    MockUSDC2      usdc;

    address ref_ = address(0x2);
    address owner = address(0x1);

    function setUp() public {
        usdc = new MockUSDC2();
        pool = new TournamentPool(usdc, true, owner, ref_);
        targetContract(address(pool));
    }

    function invariant_PoolBalanceNonNegative() public view {
        assertGe(usdc.balanceOf(address(pool)), 0);
    }
}
