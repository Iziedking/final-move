// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/FinalMoveLedger.sol";
import "../src/MatchEscrow.sol";
import "../src/TournamentPool.sol";

/// @notice Deploy all three Final Move contracts.
///
/// Usage (testnet, stakes enabled):
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL \
///     --broadcast --verify \
///     --sig "run(address,address,address,bool)" \
///     $OWNER $REFEREE $USDC_ADDRESS true
///
/// Usage (mainnet, stakes disabled):
///   ... true -> false, owner = Safe address
contract Deploy is Script {
    function run(
        address owner,
        address referee,
        address usdcAddress,
        bool    stakesEnabled
    ) external {
        vm.startBroadcast();

        FinalMoveLedger ledger = new FinalMoveLedger(owner, referee);
        MatchEscrow     escrow = new MatchEscrow(
            IERC20(usdcAddress),
            ledger,
            stakesEnabled,
            owner,
            referee
        );
        TournamentPool  pool   = new TournamentPool(
            IERC20(usdcAddress),
            stakesEnabled,
            owner,
            referee
        );

        vm.stopBroadcast();

        console.log("FinalMoveLedger:", address(ledger));
        console.log("MatchEscrow    :", address(escrow));
        console.log("TournamentPool :", address(pool));
        console.log("stakesEnabled  :", stakesEnabled);
        console.log("Chain ID       :", block.chainid);
    }
}
