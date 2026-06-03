// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Minimal slice of Story Protocol's IPAccount interface. Each registered IP
/// is an IP Account; `owner()` returns the holder of the underlying NFT.
interface IIPAccount {
    function owner() external view returns (address);
}

/// HatchPublisherRegistry — stake + slash backbone for publisher reputation.
/// Reputation/accuracy is computed OFF-CHAIN (aggregator reads events). This
/// contract only stores the economic backbone: stake (in WIP), verified flag,
/// and the most-recent slash timestamp.
contract HatchPublisherRegistry is Ownable {
    IERC20 public immutable WIP;

    struct Publisher {
        address rootIp;
        uint256 stake;
        uint64  lastSlashAt;
    }

    mapping(address => Publisher) private _publishers;

    address public oracle;          // authorized slasher (in addition to owner)
    uint256 public verifiedThreshold;
    uint64  public slashWindow;     // seconds during which unstake is blocked after a slash

    event PublisherRegistered(address indexed publisher, address indexed rootIp);
    event Staked(address indexed publisher, uint256 amount, uint256 newStake);
    event Unstaked(address indexed publisher, uint256 amount, uint256 newStake);
    event Slashed(address indexed publisher, uint256 amount, address indexed beneficiary, uint64 at);
    event OracleSet(address indexed oracle);
    event VerifiedThresholdSet(uint256 threshold);
    event SlashWindowSet(uint64 window);

    error NotRegistered();
    error AlreadyRegistered();
    error NotIpOwner();
    error InsufficientStake();
    error InSlashWindow(uint64 unlockAt);
    error NotAuthorized();
    error TransferFailed();
    error ZeroAmount();

    constructor(address wip, address owner_, uint256 initialThreshold, uint64 initialSlashWindow)
        Ownable(owner_)
    {
        WIP = IERC20(wip);
        verifiedThreshold = initialThreshold;
        slashWindow = initialSlashWindow;
        emit VerifiedThresholdSet(initialThreshold);
        emit SlashWindowSet(initialSlashWindow);
    }

    // ───────────────────── admin
    function setOracle(address o) external onlyOwner {
        oracle = o;
        emit OracleSet(o);
    }
    function setVerifiedThreshold(uint256 t) external onlyOwner {
        verifiedThreshold = t;
        emit VerifiedThresholdSet(t);
    }
    function setSlashWindow(uint64 w) external onlyOwner {
        slashWindow = w;
        emit SlashWindowSet(w);
    }

    // ───────────────────── publisher lifecycle
    function registerPublisher(address rootIp) external {
        if (_publishers[msg.sender].rootIp != address(0)) revert AlreadyRegistered();
        if (IIPAccount(rootIp).owner() != msg.sender) revert NotIpOwner();
        _publishers[msg.sender].rootIp = rootIp;
        emit PublisherRegistered(msg.sender, rootIp);
    }

    function stake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (_publishers[msg.sender].rootIp == address(0)) revert NotRegistered();
        if (!WIP.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        _publishers[msg.sender].stake += amount;
        emit Staked(msg.sender, amount, _publishers[msg.sender].stake);
    }

    function unstake(uint256 amount) external {
        Publisher storage p = _publishers[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (p.stake < amount) revert InsufficientStake();
        uint64 unlockAt = p.lastSlashAt + slashWindow;
        if (p.lastSlashAt != 0 && uint64(block.timestamp) < unlockAt) revert InSlashWindow(unlockAt);
        p.stake -= amount;
        if (!WIP.transfer(msg.sender, amount)) revert TransferFailed();
        emit Unstaked(msg.sender, amount, p.stake);
    }

    // ───────────────────── slash (oracle OR owner)
    function slash(address publisher, uint256 amount, address beneficiary) external {
        if (msg.sender != oracle && msg.sender != owner()) revert NotAuthorized();
        Publisher storage p = _publishers[publisher];
        if (p.stake < amount) revert InsufficientStake();
        p.stake -= amount;
        p.lastSlashAt = uint64(block.timestamp);
        if (!WIP.transfer(beneficiary, amount)) revert TransferFailed();
        emit Slashed(publisher, amount, beneficiary, p.lastSlashAt);
    }

    // ───────────────────── views
    function isVerified(address publisher) external view returns (bool) {
        Publisher storage p = _publishers[publisher];
        if (p.stake < verifiedThreshold) return false;
        if (p.lastSlashAt != 0 && uint64(block.timestamp) < p.lastSlashAt + slashWindow) return false;
        return true;
    }

    function getPublisher(address publisher) external view returns (
        address rootIp, uint256 stakeAmount, bool verified, uint64 lastSlashAt
    ) {
        Publisher storage p = _publishers[publisher];
        rootIp = p.rootIp;
        stakeAmount = p.stake;
        lastSlashAt = p.lastSlashAt;
        verified = (p.stake >= verifiedThreshold) &&
                   (p.lastSlashAt == 0 || uint64(block.timestamp) >= p.lastSlashAt + slashWindow);
    }
}
