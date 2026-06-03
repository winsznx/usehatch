// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC5643} from "./IERC5643.sol";

/// Minimal slice of Story Protocol's deployed LicenseToken at 0xFe38…
/// Used to inherit dispute-driven auto-expiry: if the underlying subscription
/// License Token is revoked, the pass expires immediately.
interface ILicenseToken {
    function isLicenseTokenRevoked(uint256 tokenId) external view returns (bool);
}

/// HatchSubscriptionPass — ERC-721 + ERC-5643 subscription NFT.
/// Each pass is bound to a publisher's root IP and the Story License Token
/// minted at subscribe-time. Adds:
///   - 48h post-mint transfer cooldown (anti-flip)
///   - 5% transfer fee to publisherRoot on resales (native IP)
///   - Lend/unlend (Unlock-style) for sharing without a sale
/// Mint is gated to a settable minter (e.g. HatchSubscriptionManager).
contract HatchSubscriptionPass is ERC721, Ownable, IERC5643 {
    uint64 public constant TRANSFER_COOLDOWN = 48 hours;
    uint96 public constant TRANSFER_FEE_BPS = 500; // 5%
    uint96 private constant BPS = 10_000;

    ILicenseToken public immutable LICENSE_TOKEN;
    IERC20 public immutable WIP; // ERC20 used to pay the transfer fee
    address public minter;
    bool private _internalMove; // set true inside lend/unlend to bypass rules

    // Per-token state
    mapping(uint256 => uint64) private _expiresAt;
    mapping(uint256 => address) public publisherRoot;     // IP id the pass entitles to
    mapping(uint256 => uint256) public subLicenseTokenId; // paired Story License Token
    mapping(uint256 => uint64)  public mintedAt;          // for grandfather rule
    mapping(uint256 => uint256) public subPriceWei;       // basis for 5% transfer fee
    mapping(uint256 => address) public lender;            // non-zero iff currently lent

    uint256 public nextTokenId = 1;

    error NotMinter();
    error TokenDoesNotExist();
    error WithinCooldown(uint64 readyAt);
    error LentTokenLocked();
    error NotLender();
    error InvalidDuration();
    error FeeTransferFailed();

    event MinterUpdated(address indexed minter);
    event PassMinted(
        uint256 indexed tokenId,
        address indexed to,
        address indexed publisherRoot,
        uint256 subLicenseTokenId,
        uint64 expiresAt,
        uint256 subPriceWei
    );
    event Lent(uint256 indexed tokenId, address indexed lender, address indexed borrower);
    event Unlent(uint256 indexed tokenId, address indexed lender, address indexed borrower);

    constructor(address licenseToken, address wip, address initialMinter, address owner_)
        ERC721("Hatch Subscription Pass", "HATCHPASS")
        Ownable(owner_)
    {
        LICENSE_TOKEN = ILicenseToken(licenseToken);
        WIP = IERC20(wip);
        minter = initialMinter;
        emit MinterUpdated(initialMinter);
    }

    // ----- admin -----
    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    // ----- mint -----
    function mint(
        address to,
        address publisherRoot_,
        uint256 subLicenseTokenId_,
        uint64 duration,
        uint256 subPriceWei_
    ) external returns (uint256 tokenId) {
        if (msg.sender != minter) revert NotMinter();
        if (duration == 0) revert InvalidDuration();

        tokenId = nextTokenId++;
        publisherRoot[tokenId] = publisherRoot_;
        subLicenseTokenId[tokenId] = subLicenseTokenId_;
        mintedAt[tokenId] = uint64(block.timestamp);
        subPriceWei[tokenId] = subPriceWei_;
        uint64 exp = uint64(block.timestamp) + duration;
        _expiresAt[tokenId] = exp;

        _safeMint(to, tokenId);
        emit PassMinted(tokenId, to, publisherRoot_, subLicenseTokenId_, exp, subPriceWei_);
        emit SubscriptionUpdate(tokenId, exp);
    }

    // ----- ERC-5643 -----
    function expiresAt(uint256 tokenId) public view returns (uint64) {
        _requireOwned(tokenId);
        // Dispute auto-expiry: if the underlying sub License Token is revoked,
        // this pass is effectively expired.
        if (LICENSE_TOKEN.isLicenseTokenRevoked(subLicenseTokenId[tokenId])) return 0;
        return _expiresAt[tokenId];
    }

    function isRenewable(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return !LICENSE_TOKEN.isLicenseTokenRevoked(subLicenseTokenId[tokenId]);
    }

    function renewSubscription(uint256 tokenId, uint64 duration) external payable {
        if (duration == 0) revert InvalidDuration();
        address owner_ = _requireOwned(tokenId);
        // Renew is owner- (or approved-) initiated; gate it.
        require(
            msg.sender == owner_ ||
                isApprovedForAll(owner_, msg.sender) ||
                getApproved(tokenId) == msg.sender ||
                msg.sender == minter,
            "Not authorized"
        );
        uint64 base = _expiresAt[tokenId] > uint64(block.timestamp)
            ? _expiresAt[tokenId]
            : uint64(block.timestamp);
        uint64 newExp = base + duration;
        _expiresAt[tokenId] = newExp;
        emit SubscriptionUpdate(tokenId, newExp);
    }

    function cancelSubscription(uint256 tokenId) external payable {
        address owner_ = _requireOwned(tokenId);
        require(msg.sender == owner_ || msg.sender == minter, "Not authorized");
        _expiresAt[tokenId] = 0;
        emit SubscriptionUpdate(tokenId, 0);
    }

    // ----- isValidFor (used by HatchCondition) -----
    function isValidFor(uint256 tokenId, address publisherRoot_) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        if (publisherRoot[tokenId] != publisherRoot_) return false;
        if (LICENSE_TOKEN.isLicenseTokenRevoked(subLicenseTokenId[tokenId])) return false;
        return _expiresAt[tokenId] > block.timestamp;
    }

    // ----- lend / unlend (no fee, no cooldown) -----
    function lend(uint256 tokenId, address borrower) external {
        address owner_ = _requireOwned(tokenId);
        require(msg.sender == owner_, "Not owner");
        require(lender[tokenId] == address(0), "Already lent");
        require(borrower != owner_ && borrower != address(0), "Bad borrower");
        lender[tokenId] = owner_;
        _internalMove = true;
        _transfer(owner_, borrower, tokenId);
        _internalMove = false;
        emit Lent(tokenId, owner_, borrower);
    }

    function unlend(uint256 tokenId) external {
        address recordedLender = lender[tokenId];
        if (recordedLender == address(0)) revert("Not lent");
        if (msg.sender != recordedLender) revert NotLender();
        address borrower = _ownerOf(tokenId);
        lender[tokenId] = address(0);
        _internalMove = true;
        _transfer(borrower, recordedLender, tokenId);
        _internalMove = false;
        emit Unlent(tokenId, recordedLender, borrower);
    }

    // ----- _update chokepoint: cooldown + WIP fee on real transfers -----
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = _ownerOf(tokenId);
        // mints (from==0), burns (to==0), and internal lend/unlend moves skip rules
        if (from != address(0) && to != address(0) && !_internalMove) {
            if (lender[tokenId] != address(0)) revert LentTokenLocked();

            uint64 readyAt = mintedAt[tokenId] + TRANSFER_COOLDOWN;
            if (uint64(block.timestamp) < readyAt) revert WithinCooldown(readyAt);

            uint256 fee = (subPriceWei[tokenId] * TRANSFER_FEE_BPS) / BPS;
            if (fee > 0) {
                // auth = caller of transferFrom (operator or owner)
                address payer = auth == address(0) ? from : auth;
                bool ok = WIP.transferFrom(payer, publisherRoot[tokenId], fee);
                if (!ok) revert FeeTransferFailed();
            }
        }
        // call parent _update for the actual ledger move + auth check
        return super._update(to, tokenId, auth);
    }

    // ----- ERC-165 -----
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5643).interfaceId || super.supportsInterface(interfaceId);
    }
}
