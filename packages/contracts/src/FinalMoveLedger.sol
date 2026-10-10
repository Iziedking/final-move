// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FinalMoveLedger
/// @notice Permanent on-chain record of every Final Move game and every ply.
///         The contract does not validate chess legality; the referee server does.
///         Moves may land out of order — ply numbers define the sequence.
contract FinalMoveLedger {
    // ── Types ────────────────────────────────────────────────────────────────

    enum Status { None, Live, Ended }

    /// result: 1 White wins, 2 Black wins, 3 draw, 4 aborted
    enum Result { None, White, Black, Draw, Aborted }

    struct GameRecord {
        address white;
        address black;
        uint8   gameClass;          // 0 Open, 1 Human
        uint32  baseSec;
        uint16  incSec;
        bytes32 escrowMatchId;
        Status  status;
        uint16  totalPlies;         // set by endGame
        Result  result;
        uint8   reason;             // 0–9 matching GameEndReason enum
        bytes32 finalFenHash;
        // ply recorded bitmap: slot i covers plies (i*256)+1 .. (i*256)+256
        mapping(uint256 => uint256) plyBits;
        uint256 pliesRecorded;      // running count
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    address public referee;
    address public owner;

    mapping(bytes32 => GameRecord) private _games;

    // ── Events ───────────────────────────────────────────────────────────────

    event GameCreated(
        bytes32 indexed gameId,
        address indexed white,
        address indexed black,
        uint8 gameClass,
        uint32 baseSec,
        uint16 incSec,
        bytes32 escrowMatchId
    );

    event Move(
        bytes32 indexed gameId,
        uint16  indexed ply,
        uint16  uci,
        address player,
        bool    relayed
    );

    event Resigned(bytes32 indexed gameId, address player);
    event DrawOffered(bytes32 indexed gameId, address player);
    event DrawAccepted(bytes32 indexed gameId, address player);

    event GameEnded(
        bytes32 indexed gameId,
        Result  result,
        uint8   reason,
        uint16  totalPlies,
        bytes32 finalFenHash
    );

    event RefereeChanged(address indexed oldReferee, address indexed newReferee);
    event Paused(bool paused);

    // ── Access control ───────────────────────────────────────────────────────

    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyReferee() {
        require(msg.sender == referee, "not referee");
        _;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _owner, address _referee) {
        require(_owner != address(0), "zero owner");
        require(_referee != address(0), "zero referee");
        owner = _owner;
        referee = _referee;
    }

    // ── Owner actions ────────────────────────────────────────────────────────

    function setReferee(address _referee) external onlyOwner {
        require(_referee != address(0), "zero referee");
        emit RefereeChanged(referee, _referee);
        referee = _referee;
    }

    /// @notice Pause prevents new games. Already-live games continue.
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    // ── Referee actions ──────────────────────────────────────────────────────

    function createGame(
        bytes32 gameId,
        address white,
        address black,
        uint8   gameClass,
        uint32  baseSec,
        uint16  incSec,
        bytes32 escrowMatchId
    ) external onlyReferee notPaused {
        require(white != address(0) && black != address(0), "zero player");
        require(white != black, "same player");
        GameRecord storage g = _games[gameId];
        require(g.status == Status.None, "game exists");

        g.white = white;
        g.black = black;
        g.gameClass = gameClass;
        g.baseSec = baseSec;
        g.incSec = incSec;
        g.escrowMatchId = escrowMatchId;
        g.status = Status.Live;

        emit GameCreated(gameId, white, black, gameClass, baseSec, incSec, escrowMatchId);
    }

    /// @notice Called by the mover's own wallet. Odd plies = White, even plies = Black.
    function move(bytes32 gameId, uint16 ply, uint16 uci) external {
        GameRecord storage g = _games[gameId];
        require(g.status == Status.Live, "not live");
        require(ply >= 1, "ply < 1");
        address expected = (ply % 2 == 1) ? g.white : g.black;
        require(msg.sender == expected, "wrong player");
        _recordPly(g, ply);
        emit Move(gameId, ply, uci, msg.sender, false);
    }

    /// @notice Referee relay when player tx failed three times.
    function relayMove(bytes32 gameId, uint16 ply, uint16 uci) external onlyReferee {
        GameRecord storage g = _games[gameId];
        require(g.status == Status.Live, "not live");
        require(ply >= 1, "ply < 1");
        address player = (ply % 2 == 1) ? g.white : g.black;
        _recordPly(g, ply);
        emit Move(gameId, ply, uci, player, true);
    }

    function resign(bytes32 gameId) external {
        GameRecord storage g = _games[gameId];
        require(g.status == Status.Live, "not live");
        require(msg.sender == g.white || msg.sender == g.black, "not a player");
        emit Resigned(gameId, msg.sender);
    }

    function offerDraw(bytes32 gameId) external {
        GameRecord storage g = _games[gameId];
        require(g.status == Status.Live, "not live");
        require(msg.sender == g.white || msg.sender == g.black, "not a player");
        emit DrawOffered(gameId, msg.sender);
    }

    function acceptDraw(bytes32 gameId) external {
        GameRecord storage g = _games[gameId];
        require(g.status == Status.Live, "not live");
        require(msg.sender == g.white || msg.sender == g.black, "not a player");
        emit DrawAccepted(gameId, msg.sender);
    }

    function endGame(
        bytes32 gameId,
        Result  result,
        uint8   reason,
        uint16  totalPlies,
        bytes32 finalFenHash
    ) external onlyReferee {
        GameRecord storage g = _games[gameId];
        require(g.status == Status.Live, "not live");
        require(result != Result.None, "invalid result");
        // Every ply 1..totalPlies must be recorded
        require(g.pliesRecorded == totalPlies, "missing plies");
        for (uint16 i = 1; i <= totalPlies; i++) {
            require(_plyRecorded(g, i), "ply not recorded");
        }

        g.status = Status.Ended;
        g.result = result;
        g.reason = reason;
        g.totalPlies = totalPlies;
        g.finalFenHash = finalFenHash;

        emit GameEnded(gameId, result, reason, totalPlies, finalFenHash);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function resultOf(bytes32 gameId)
        external
        view
        returns (
            Status  status,
            Result  result,
            address white,
            address black,
            bytes32 escrowMatchId
        )
    {
        GameRecord storage g = _games[gameId];
        return (g.status, g.result, g.white, g.black, g.escrowMatchId);
    }

    function pliesRecorded(bytes32 gameId) external view returns (uint256) {
        return _games[gameId].pliesRecorded;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _recordPly(GameRecord storage g, uint16 ply) private {
        uint256 slot = (ply - 1) / 256;
        uint256 bit  = (ply - 1) % 256;
        require(g.plyBits[slot] & (1 << bit) == 0, "ply already recorded");
        g.plyBits[slot] |= (1 << bit);
        g.pliesRecorded++;
    }

    function _plyRecorded(GameRecord storage g, uint16 ply) private view returns (bool) {
        uint256 slot = (ply - 1) / 256;
        uint256 bit  = (ply - 1) % 256;
        return g.plyBits[slot] & (1 << bit) != 0;
    }
}
