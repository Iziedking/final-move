// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FinalMoveLedger} from "./FinalMoveLedger.sol";

/// @title MatchEscrow
/// @notice Holds USDC stakes for a single game. stakesEnabled is immutable;
///         mainnet deploys with false so the code can never accept stakes.
contract MatchEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────────

    struct Match {
        bytes32 gameId;
        address playerA;
        address playerB;
        uint256 amount;         // USDC with 6 decimals
        uint64  fundDeadline;
        uint64  depositedAt;    // timestamp when the 2nd deposit landed
        bool    depositA;
        bool    depositB;
        bool    settled;
        bool    cancelled;
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    bool    public immutable stakesEnabled;
    IERC20  public immutable usdc;
    FinalMoveLedger public immutable ledger;
    address public immutable owner;
    address public referee;

    mapping(bytes32 => Match) public matches;

    uint256 public totalDeposited; // invariant: equals sum of unsettled deposits

    // ── Events ───────────────────────────────────────────────────────────────

    event MatchOpened(bytes32 indexed matchId, bytes32 gameId, address playerA, address playerB, uint256 amount, uint64 fundDeadline);
    event Deposited(bytes32 indexed matchId, address player);
    event MatchCancelled(bytes32 indexed matchId);
    event MatchSettled(bytes32 indexed matchId, address winner, uint256 payout);
    event MatchRefunded(bytes32 indexed matchId);

    // ── Errors ───────────────────────────────────────────────────────────────

    error StakesDisabled();
    error MatchNotFound();
    error AlreadyDeposited();
    error FundDeadlinePassed();
    error FundDeadlineNotPassed();
    error NotAPlayer();
    error GameNotEnded();
    error AlreadySettled();
    error RefundTimeout();
    error FewerThanTwoDeposits();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyReferee() {
        require(msg.sender == referee, "not referee");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        IERC20          _usdc,
        FinalMoveLedger _ledger,
        bool            _stakesEnabled,
        address         _owner,
        address         _referee
    ) {
        usdc          = _usdc;
        ledger        = _ledger;
        stakesEnabled = _stakesEnabled;
        owner         = _owner;
        referee       = _referee;
    }

    // ── Referee ──────────────────────────────────────────────────────────────

    function open(
        bytes32 matchId,
        bytes32 gameId,
        address playerA,
        address playerB,
        uint256 amount,
        uint64  fundDeadline
    ) external onlyReferee {
        if (!stakesEnabled) revert StakesDisabled();
        require(amount > 0, "amount zero");
        require(matches[matchId].amount == 0, "match exists");

        matches[matchId] = Match({
            gameId:       gameId,
            playerA:      playerA,
            playerB:      playerB,
            amount:       amount,
            fundDeadline: fundDeadline,
            depositedAt:  0,
            depositA:     false,
            depositB:     false,
            settled:      false,
            cancelled:    false
        });

        emit MatchOpened(matchId, gameId, playerA, playerB, amount, fundDeadline);
    }

    // ── Players ──────────────────────────────────────────────────────────────

    function deposit(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.amount == 0) revert MatchNotFound();
        if (m.cancelled) revert AlreadySettled();
        if (block.timestamp > m.fundDeadline) revert FundDeadlinePassed();

        bool isA = msg.sender == m.playerA;
        bool isB = msg.sender == m.playerB;
        if (!isA && !isB) revert NotAPlayer();
        if (isA && m.depositA) revert AlreadyDeposited();
        if (isB && m.depositB) revert AlreadyDeposited();

        usdc.safeTransferFrom(msg.sender, address(this), m.amount);
        totalDeposited += m.amount;

        if (isA) m.depositA = true;
        else     m.depositB = true;

        if (m.depositA && m.depositB) {
            m.depositedAt = uint64(block.timestamp);
        }

        emit Deposited(matchId, msg.sender);
    }

    // ── Anyone ───────────────────────────────────────────────────────────────

    function cancelUnfunded(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.amount == 0) revert MatchNotFound();
        if (m.cancelled || m.settled) revert AlreadySettled();
        if (block.timestamp <= m.fundDeadline) revert FundDeadlineNotPassed();
        // Must not have both deposits
        require(!(m.depositA && m.depositB), "both deposited");

        m.cancelled = true;

        if (m.depositA) {
            totalDeposited -= m.amount;
            usdc.safeTransfer(m.playerA, m.amount);
        }
        if (m.depositB) {
            totalDeposited -= m.amount;
            usdc.safeTransfer(m.playerB, m.amount);
        }

        emit MatchCancelled(matchId);
    }

    function settle(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.amount == 0) revert MatchNotFound();
        if (m.settled || m.cancelled) revert AlreadySettled();
        require(m.depositA && m.depositB, "not fully funded");

        // Check ledger result
        (
            FinalMoveLedger.Status status,
            FinalMoveLedger.Result result,
            address white,
            address black,
            /* escrowMatchId */
        ) = ledger.resultOf(m.gameId);

        if (status != FinalMoveLedger.Status.Ended) revert GameNotEnded();

        m.settled = true;
        uint256 pot = m.amount * 2;
        totalDeposited -= pot;

        if (result == FinalMoveLedger.Result.White) {
            usdc.safeTransfer(white, pot);
            emit MatchSettled(matchId, white, pot);
        } else if (result == FinalMoveLedger.Result.Black) {
            usdc.safeTransfer(black, pot);
            emit MatchSettled(matchId, black, pot);
        } else {
            // draw or aborted — refund both
            usdc.safeTransfer(m.playerA, m.amount);
            usdc.safeTransfer(m.playerB, m.amount);
            emit MatchSettled(matchId, address(0), 0);
        }
    }

    function refundAfterTimeout(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.amount == 0) revert MatchNotFound();
        if (m.settled || m.cancelled) revert AlreadySettled();
        require(m.depositA && m.depositB, "not fully funded");
        // 24 hours after both deposits
        require(block.timestamp >= m.depositedAt + 24 hours, "timeout not reached");

        m.settled = true;
        uint256 pot = m.amount * 2;
        totalDeposited -= pot;
        usdc.safeTransfer(m.playerA, m.amount);
        usdc.safeTransfer(m.playerB, m.amount);

        emit MatchRefunded(matchId);
    }
}
