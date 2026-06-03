// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IPublisherRegistry {
    function slash(address publisher, uint256 amount, address beneficiary) external;
}

/// HatchOracle — operator-signed outcome attestations for Hatch.
/// v1 trust model: owner-managed operator allowlist + owner-arbitrated challenge
/// resolution. TEE-attested multi-operator quorum is the roadmap.
///
/// Each hatchId resolves once: an operator signs an EIP-712 Attestation,
/// anyone can challenge within the window by posting a bond, owner adjudicates.
/// Aggregator/SDK consumers read getOutcome().
contract HatchOracle is EIP712, Ownable {
    using ECDSA for bytes32;

    enum Status { None, Pending, Disputed, Finalized }

    struct Attestation {
        bytes32 hatchId;
        bytes32 outcomeHash;   // commitment to off-chain payload
        int256  outcomeValue;  // signed scaled int (price / score / boolean as 0/1)
        uint64  observedAt;    // when the operator observed the outcome
        uint256 nonce;
    }

    struct Record {
        Attestation att;
        address signer;        // operator who signed
        uint64  submittedAt;
        Status  status;
        address challenger;
        uint256 bond;
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 hatchId,bytes32 outcomeHash,int256 outcomeValue,uint64 observedAt,uint256 nonce)"
    );

    mapping(address => bool) public isOperator;
    mapping(uint256 => bool) public usedNonces;
    mapping(bytes32 => Record) private _records;

    uint64 public challengeWindow;     // seconds
    uint256 public challengeBond;      // wei (native)
    IPublisherRegistry public registry; // set by owner; can be zero (then auto-slash skipped)

    event OperatorUpdated(address indexed operator, bool added);
    event ChallengeWindowSet(uint64 window);
    event ChallengeBondSet(uint256 bond);
    event RegistrySet(address indexed registry);
    event AttestationSubmitted(bytes32 indexed hatchId, address indexed operator, bytes32 outcomeHash, int256 outcomeValue, uint64 observedAt, uint256 nonce);
    event Challenged(bytes32 indexed hatchId, address indexed challenger, uint256 bond);
    event Finalized(bytes32 indexed hatchId);
    event Resolved(bytes32 indexed hatchId, bool operatorWins);
    event SlashRecommended(bytes32 indexed hatchId, address indexed publisher, uint256 amount, address indexed beneficiary);

    error NotOperator();
    error NonceUsed();
    error AlreadySubmitted();
    error WindowOpen();
    error NotPending();
    error NotDisputed();
    error WindowClosed();
    error BondTooLow();
    error TransferFailed();

    constructor(address owner_, uint64 initialWindow, uint256 initialBond)
        EIP712("HatchOracle", "1")
        Ownable(owner_)
    {
        challengeWindow = initialWindow;
        challengeBond = initialBond;
        emit ChallengeWindowSet(initialWindow);
        emit ChallengeBondSet(initialBond);
    }

    // ───────────────────── admin
    function addOperator(address op) external onlyOwner {
        isOperator[op] = true;
        emit OperatorUpdated(op, true);
    }
    function removeOperator(address op) external onlyOwner {
        isOperator[op] = false;
        emit OperatorUpdated(op, false);
    }
    function setChallengeWindow(uint64 w) external onlyOwner {
        challengeWindow = w;
        emit ChallengeWindowSet(w);
    }
    function setChallengeBond(uint256 b) external onlyOwner {
        challengeBond = b;
        emit ChallengeBondSet(b);
    }
    function setRegistry(address r) external onlyOwner {
        registry = IPublisherRegistry(r);
        emit RegistrySet(r);
    }

    // ───────────────────── EIP-712 digest helper
    function _hashAttestation(Attestation calldata a) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            ATTESTATION_TYPEHASH,
            a.hatchId, a.outcomeHash, a.outcomeValue, a.observedAt, a.nonce
        ));
    }

    function attestationDigest(Attestation calldata a) external view returns (bytes32) {
        return _hashTypedDataV4(_hashAttestation(a));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ───────────────────── submit
    function submitAttestation(Attestation calldata a, bytes calldata signature) external {
        if (_records[a.hatchId].status != Status.None) revert AlreadySubmitted();
        if (usedNonces[a.nonce]) revert NonceUsed();

        bytes32 digest = _hashTypedDataV4(_hashAttestation(a));
        address signer = digest.recover(signature);
        if (!isOperator[signer]) revert NotOperator();

        usedNonces[a.nonce] = true;
        _records[a.hatchId] = Record({
            att: a,
            signer: signer,
            submittedAt: uint64(block.timestamp),
            status: Status.Pending,
            challenger: address(0),
            bond: 0
        });

        emit AttestationSubmitted(a.hatchId, signer, a.outcomeHash, a.outcomeValue, a.observedAt, a.nonce);
    }

    // ───────────────────── challenge
    function challenge(bytes32 hatchId) external payable {
        Record storage r = _records[hatchId];
        if (r.status != Status.Pending) revert NotPending();
        if (block.timestamp >= r.submittedAt + challengeWindow) revert WindowClosed();
        if (msg.value < challengeBond) revert BondTooLow();

        r.status = Status.Disputed;
        r.challenger = msg.sender;
        r.bond = msg.value;

        emit Challenged(hatchId, msg.sender, msg.value);
    }

    // ───────────────────── finalize (unchallenged)
    function finalize(bytes32 hatchId) external {
        Record storage r = _records[hatchId];
        if (r.status != Status.Pending) revert NotPending();
        if (block.timestamp < r.submittedAt + challengeWindow) revert WindowOpen();
        r.status = Status.Finalized;
        emit Finalized(hatchId);
    }

    // ───────────────────── resolve (owner arbitration, v1)
    /// @param publisher optional — passed when the slash should be wired through to the Registry.
    /// @param slashAmount stake to move to the challenger on operator-loss; 0 to skip.
    function resolveChallenge(
        bytes32 hatchId,
        bool operatorWins,
        address publisher,
        uint256 slashAmount
    ) external onlyOwner {
        Record storage r = _records[hatchId];
        if (r.status != Status.Disputed) revert NotDisputed();

        if (operatorWins) {
            // bond → operator (the original attester)
            r.status = Status.Finalized;
            (bool ok, ) = r.signer.call{value: r.bond}("");
            if (!ok) revert TransferFailed();
        } else {
            r.status = Status.Finalized;
            (bool ok, ) = r.challenger.call{value: r.bond}("");
            if (!ok) revert TransferFailed();
            emit SlashRecommended(hatchId, publisher, slashAmount, r.challenger);
            if (address(registry) != address(0) && slashAmount > 0) {
                registry.slash(publisher, slashAmount, r.challenger);
            }
        }
        emit Resolved(hatchId, operatorWins);
    }

    // ───────────────────── view
    function getOutcome(bytes32 hatchId) external view returns (
        int256 outcomeValue, bytes32 outcomeHash, uint64 observedAt, address operator, uint8 status
    ) {
        Record storage r = _records[hatchId];
        return (r.att.outcomeValue, r.att.outcomeHash, r.att.observedAt, r.signer, uint8(r.status));
    }

    function getRecord(bytes32 hatchId) external view returns (Record memory) {
        return _records[hatchId];
    }
}
