// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/FinalMoveLedger.sol";

contract FinalMoveLedgerTest is Test {
    FinalMoveLedger ledger;
    address owner   = address(0x1);
    address ref_    = address(0x2);
    address white   = address(0x3);
    address black   = address(0x4);
    bytes32 constant GID = keccak256("game1");

    function setUp() public {
        ledger = new FinalMoveLedger(owner, ref_);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _create() internal {
        vm.prank(ref_);
        ledger.createGame(GID, white, black, 0, 300, 3, bytes32(0));
    }

    // ── createGame ───────────────────────────────────────────────────────────

    function test_CreateGame() public {
        _create();
        (FinalMoveLedger.Status s,,,,) = ledger.resultOf(GID);
        assertEq(uint(s), uint(FinalMoveLedger.Status.Live));
    }

    function test_CreateGame_RejectsZeroPlayer() public {
        vm.prank(ref_);
        vm.expectRevert("zero player");
        ledger.createGame(GID, address(0), black, 0, 300, 3, bytes32(0));
    }

    function test_CreateGame_RejectsSamePlayer() public {
        vm.prank(ref_);
        vm.expectRevert("same player");
        ledger.createGame(GID, white, white, 0, 300, 3, bytes32(0));
    }

    function test_CreateGame_OnlyReferee() public {
        vm.prank(address(0x99));
        vm.expectRevert("not referee");
        ledger.createGame(GID, white, black, 0, 300, 3, bytes32(0));
    }

    // ── correct colour writes ─────────────────────────────────────────────────

    function test_Move_WhitePlaysOddPly() public {
        _create();
        vm.prank(white);
        ledger.move(GID, 1, 0x0C04); // e2e4
    }

    function test_Move_BlackPlaysEvenPly() public {
        _create();
        vm.prank(black);
        ledger.move(GID, 2, 0x2C34); // e7e5
    }

    function test_Move_WrongColourReverts() public {
        _create();
        vm.prank(black);
        vm.expectRevert("wrong player");
        ledger.move(GID, 1, 0x0C04);
    }

    // ── duplicate ply ────────────────────────────────────────────────────────

    function test_Move_DuplicatePlyReverts() public {
        _create();
        vm.prank(white);
        ledger.move(GID, 1, 0x0C04);
        vm.prank(white);
        vm.expectRevert("ply already recorded");
        ledger.move(GID, 1, 0x0C04);
    }

    // ── out-of-order plies ────────────────────────────────────────────────────

    function test_OutOfOrderPlies_Accepted() public {
        _create();
        // Black's ply 2 lands before White's ply 1
        vm.prank(black);
        ledger.move(GID, 2, 0x2C34);
        vm.prank(white);
        ledger.move(GID, 1, 0x0C04);
        assertEq(ledger.pliesRecorded(GID), 2);
    }

    // ── endGame blocks if ply missing ────────────────────────────────────────

    function test_EndGame_RevertsOnMissingPly() public {
        _create();
        vm.prank(white);
        ledger.move(GID, 1, 0x0C04);
        // ply 2 is missing
        vm.prank(ref_);
        vm.expectRevert("missing plies");
        ledger.endGame(GID, FinalMoveLedger.Result.White, 0, 2, bytes32(0));
    }

    function test_EndGame_Succeeds() public {
        _create();
        vm.prank(white); ledger.move(GID, 1, 0x0C04);
        vm.prank(black); ledger.move(GID, 2, 0x2C34);
        vm.prank(ref_);
        ledger.endGame(GID, FinalMoveLedger.Result.White, 0, 2, keccak256("fen"));
        (FinalMoveLedger.Status s, FinalMoveLedger.Result r,,,) = ledger.resultOf(GID);
        assertEq(uint(s), uint(FinalMoveLedger.Status.Ended));
        assertEq(uint(r), uint(FinalMoveLedger.Result.White));
    }

    // ── relay ─────────────────────────────────────────────────────────────────

    function test_RelayMove_EmitsRelayed() public {
        _create();
        vm.prank(ref_);
        vm.expectEmit(true, true, false, true);
        emit FinalMoveLedger.Move(GID, 1, 0x0C04, white, true);
        ledger.relayMove(GID, 1, 0x0C04);
    }

    function test_RelayMove_OnlyReferee() public {
        _create();
        vm.prank(white);
        vm.expectRevert("not referee");
        ledger.relayMove(GID, 1, 0x0C04);
    }

    // ── fuzz: random ply orders always produce a complete record ─────────────

    function testFuzz_RandomPlyOrder(uint8 n, uint256 seed) public {
        n = uint8(bound(n, 1, 20));
        _create();

        // Build a shuffled ply list
        uint16[] memory plies = new uint16[](n);
        for (uint16 i = 0; i < n; i++) plies[i] = i + 1;
        // Fisher-Yates shuffle with seed
        for (uint256 i = n - 1; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % (i + 1);
            (plies[i], plies[j]) = (plies[j], plies[i]);
        }

        for (uint256 i = 0; i < n; i++) {
            uint16 ply = plies[i];
            address player = (ply % 2 == 1) ? white : black;
            vm.prank(player);
            ledger.move(GID, ply, 0);
        }

        assertEq(ledger.pliesRecorded(GID), n);

        // endGame should succeed
        vm.prank(ref_);
        ledger.endGame(GID, FinalMoveLedger.Result.Draw, 4, n, bytes32(0));
        (FinalMoveLedger.Status s,,,,) = ledger.resultOf(GID);
        assertEq(uint(s), uint(FinalMoveLedger.Status.Ended));
    }

    // ── owner: no path to funds ───────────────────────────────────────────────

    function test_Owner_CannotEndGame() public {
        _create();
        vm.prank(owner);
        vm.expectRevert("not referee");
        ledger.endGame(GID, FinalMoveLedger.Result.White, 0, 0, bytes32(0));
    }

    function test_Paused_BlocksNewGames() public {
        vm.prank(owner);
        ledger.setPaused(true);
        vm.prank(ref_);
        vm.expectRevert("paused");
        ledger.createGame(GID, white, black, 0, 300, 3, bytes32(0));
    }

    function test_Paused_DoesNotBlockEndGame() public {
        _create();
        vm.prank(white); ledger.move(GID, 1, 0);
        // Pause after game is live — endGame still works
        vm.prank(owner);
        ledger.setPaused(true);
        vm.prank(ref_);
        ledger.endGame(GID, FinalMoveLedger.Result.White, 0, 1, bytes32(0));
    }
}
