// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal open read condition for CDR vaults: anyone may read.
/// Implements the on-chain CDR condition interface as called by the precompile:
/// checkReadCondition(uint32 uuid, bytes accessAuxData, bytes conditionData, address caller)
contract OpenCondition {
    function checkReadCondition(uint32, bytes calldata, bytes calldata, address)
        external
        pure
        returns (bool)
    {
        return true;
    }
}
