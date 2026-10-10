// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TournamentPool
/// @notice Prize pool for the weekly Saturday Cup. Entry fees require stakesEnabled.
///         Sponsor funding (fund()) works regardless of stakesEnabled.
contract TournamentPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 private constant BPS_DENOM = 10_000;
    uint256 private constant CANCEL_GRACE = 7 days;

    // ── Types ────────────────────────────────────────────────────────────────

    struct Tournament {
        uint256 entryFee;
        uint16[] splitsBps;         // sum must be 10_000; index 0 = 1st place
        uint64  regClose;
        uint256 pool;               // total USDC in the pool
        bool    finalized;
        bool    cancelled;
        address[] entrants;
        mapping(address => bool)    registered;
        mapping(address => uint256) funded;     // funder -> amount contributed
        address[] funders;
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    bool    public immutable stakesEnabled;
    IERC20  public immutable usdc;
    address public immutable owner;
    address public referee;

    mapping(bytes32 => Tournament) private _tournaments;

    // ── Events ───────────────────────────────────────────────────────────────

    event TournamentCreated(bytes32 indexed tid, uint256 entryFee, uint64 regClose);
    event Funded(bytes32 indexed tid, address indexed funder, uint256 amount);
    event Registered(bytes32 indexed tid, address indexed player);
    event Finalized(bytes32 indexed tid, address[] placements, uint256[] amounts);
    event Cancelled(bytes32 indexed tid);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyReferee() {
        require(msg.sender == referee, "not referee");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        IERC20  _usdc,
        bool    _stakesEnabled,
        address _owner,
        address _referee
    ) {
        usdc          = _usdc;
        stakesEnabled = _stakesEnabled;
        owner         = _owner;
        referee       = _referee;
    }

    // ── Referee ──────────────────────────────────────────────────────────────

    function create(
        bytes32  tid,
        uint256  entryFee,
        uint16[] calldata splitsBps,
        uint64   regClose
    ) external onlyReferee {
        require(_tournaments[tid].regClose == 0, "exists");
        require(splitsBps.length > 0, "no splits");
        if (entryFee > 0) require(stakesEnabled, "StakesDisabled");

        uint256 sum;
        for (uint256 i = 0; i < splitsBps.length; i++) sum += splitsBps[i];
        require(sum == BPS_DENOM, "splits != 10000");

        Tournament storage t = _tournaments[tid];
        t.entryFee = entryFee;
        t.regClose = regClose;
        for (uint256 i = 0; i < splitsBps.length; i++) t.splitsBps.push(splitsBps[i]);

        emit TournamentCreated(tid, entryFee, regClose);
    }

    // ── Anyone ───────────────────────────────────────────────────────────────

    /// @notice Sponsor or operator funds the prize pool.
    function fund(bytes32 tid, uint256 amount) external nonReentrant {
        Tournament storage t = _tournaments[tid];
        require(t.regClose != 0, "not found");
        require(!t.finalized && !t.cancelled, "over");

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        t.pool += amount;
        if (t.funded[msg.sender] == 0) t.funders.push(msg.sender);
        t.funded[msg.sender] += amount;

        emit Funded(tid, msg.sender, amount);
    }

    function register(bytes32 tid) external nonReentrant {
        Tournament storage t = _tournaments[tid];
        require(t.regClose != 0, "not found");
        require(!t.finalized && !t.cancelled, "over");
        require(block.timestamp < t.regClose, "reg closed");
        require(!t.registered[msg.sender], "already registered");

        t.registered[msg.sender] = true;
        t.entrants.push(msg.sender);

        if (t.entryFee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), t.entryFee);
            t.pool += t.entryFee;
        }

        emit Registered(tid, msg.sender);
    }

    // ── Referee finalisation ─────────────────────────────────────────────────

    function finalize(bytes32 tid, address[] calldata placements) external nonReentrant onlyReferee {
        Tournament storage t = _tournaments[tid];
        require(t.regClose != 0, "not found");
        require(!t.finalized && !t.cancelled, "over");
        require(block.timestamp >= t.regClose, "reg not closed");
        require(placements.length == t.splitsBps.length, "placements mismatch");

        // All placements must be registered entrants
        for (uint256 i = 0; i < placements.length; i++) {
            require(t.registered[placements[i]], "not an entrant");
        }

        t.finalized = true;
        uint256 pool = t.pool;
        uint256[] memory amounts = new uint256[](placements.length);
        uint256 distributed;

        for (uint256 i = 0; i < placements.length; i++) {
            uint256 share;
            if (i == placements.length - 1) {
                // Rounding dust goes to the last-split (first place usually)
                share = pool - distributed;
            } else {
                share = (pool * t.splitsBps[i]) / BPS_DENOM;
            }
            amounts[i] = share;
            distributed += share;
            if (share > 0) usdc.safeTransfer(placements[i], share);
        }

        emit Finalized(tid, placements, amounts);
    }

    // ── Cancel ───────────────────────────────────────────────────────────────

    function cancel(bytes32 tid) external nonReentrant {
        Tournament storage t = _tournaments[tid];
        require(t.regClose != 0, "not found");
        require(!t.finalized && !t.cancelled, "over");

        bool isReferee = msg.sender == referee;
        bool isPastGrace = block.timestamp >= t.regClose + CANCEL_GRACE;
        require(isReferee || isPastGrace, "not authorised");

        t.cancelled = true;

        // Refund entry fees to each entrant
        for (uint256 i = 0; i < t.entrants.length; i++) {
            if (t.entryFee > 0) {
                usdc.safeTransfer(t.entrants[i], t.entryFee);
            }
        }

        // Refund funder contributions
        for (uint256 i = 0; i < t.funders.length; i++) {
            address f = t.funders[i];
            uint256 contrib = t.funded[f];
            if (contrib > 0) {
                t.funded[f] = 0;
                usdc.safeTransfer(f, contrib);
            }
        }

        emit Cancelled(tid);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function entrantCount(bytes32 tid) external view returns (uint256) {
        return _tournaments[tid].entrants.length;
    }

    function isRegistered(bytes32 tid, address player) external view returns (bool) {
        return _tournaments[tid].registered[player];
    }

    function poolBalance(bytes32 tid) external view returns (uint256) {
        return _tournaments[tid].pool;
    }
}
