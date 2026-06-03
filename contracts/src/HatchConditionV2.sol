// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Slice of Story Protocol's deployed LicenseToken at 0xFe38… (impl 0xE553aA53)
/// Verified against storyscan on Day 0 — 4-arg getLicenseTokenMetadata returns
/// a tuple whose first field is licensorIpId.
interface ILicenseToken {
    struct LicenseTokenMetadata {
        address licensorIpId;
        address licenseTemplate;
        uint256 licenseTermsId;
        bool transferable;
        uint32 commercialRevShare;
    }

    function ownerOf(uint256 tokenId) external view returns (address);
    function isLicenseTokenRevoked(uint256 tokenId) external view returns (bool);
    function getLicenseTokenMetadata(uint256 tokenId)
        external
        view
        returns (LicenseTokenMetadata memory);
}

interface IHatchSubscriptionPass {
    function ownerOf(uint256 tokenId) external view returns (address);
    function isValidFor(uint256 tokenId, address publisherRoot) external view returns (bool);
    function mintedAt(uint256 tokenId) external view returns (uint64);
}

/// HatchCondition v2 — multi-mode embargo gate for Story CDR vaults.
///
/// Implements the on-chain CDR condition interface as the precompile calls it:
///   checkReadCondition(uint32 uuid, bytes accessAuxData, bytes conditionData, address caller)
///   checkWriteCondition(uint32, bytes, bytes, address)
/// (4-arg, verified Day 0 — `uuid` first, `caller` last.)
///
/// conditionData = abi.encode(
///     uint8  mode,                    // 0=per-hatch, 1=subscription, 2=dual
///     address licenseTokenOrPass,     // mode 0 → LicenseToken; mode 1 → SubscriptionPass; mode 2 → unused (we use immutables)
///     address ipIdOrPublisherRoot,    // the IP the access is bound to
///     uint64  embargoStart,
///     uint64  revealAt
/// )
///
/// accessAuxData = abi.encode(uint8 kind, bytes payload)
///   kind 0 (per-hatch):    payload = abi.encode(uint256[] licenseTokenIds)
///   kind 1 (subscription): payload = abi.encode(uint256 passId)
contract HatchConditionV2 {
    uint8 public constant MODE_PER_HATCH    = 0;
    uint8 public constant MODE_SUBSCRIPTION = 1;
    uint8 public constant MODE_DUAL         = 2;

    uint8 public constant KIND_PER_HATCH    = 0;
    uint8 public constant KIND_SUBSCRIPTION = 1;

    /// The HatchSubscriptionPass used by subscription / dual modes.
    /// Immutable: no admin migration path, no governance surface.
    IHatchSubscriptionPass public immutable PASS;

    constructor(address pass) {
        PASS = IHatchSubscriptionPass(pass);
    }

    // ─────────────────────────────────────── READ
    function checkReadCondition(
        uint32,
        bytes calldata accessAuxData,
        bytes calldata conditionData,
        address caller
    ) external view returns (bool) {
        (uint8 mode, address tokenOrPass, address ipOrRoot, uint64 embargoStart, uint64 revealAt) =
            abi.decode(conditionData, (uint8, address, address, uint64, uint64));

        // post-reveal: open to anyone
        if (block.timestamp >= revealAt) return true;
        // pre-window: nobody (kills intra-window front-run)
        if (block.timestamp < embargoStart) return false;

        if (accessAuxData.length == 0) return false;
        (uint8 kind, bytes memory payload) = abi.decode(accessAuxData, (uint8, bytes));

        // mode gating
        if (mode != MODE_DUAL && kind != mode) return false;

        if (kind == KIND_PER_HATCH) {
            // tokenOrPass = LicenseToken contract, ipOrRoot = signal's ipId
            return _checkPerHatch(tokenOrPass, ipOrRoot, caller, payload);
        } else if (kind == KIND_SUBSCRIPTION) {
            // tokenOrPass param ignored here (we use immutable PASS),
            // ipOrRoot = publisherRoot ipId
            return _checkSubscription(ipOrRoot, embargoStart, caller, payload);
        }
        return false;
    }

    // ─────────────────────────────────────── WRITE
    function checkWriteCondition(
        uint32,
        bytes calldata,
        bytes calldata conditionData,
        address caller
    ) external pure returns (bool) {
        address owner = abi.decode(conditionData, (address));
        return caller == owner;
    }

    // ─────────────────────────────────────── INTERNAL
    function _checkPerHatch(
        address licenseToken,
        address ipId,
        address caller,
        bytes memory payload
    ) internal view returns (bool) {
        uint256[] memory tokenIds = abi.decode(payload, (uint256[]));
        ILicenseToken lt = ILicenseToken(licenseToken);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (lt.ownerOf(id) != caller) continue;
            if (lt.isLicenseTokenRevoked(id)) continue;
            if (lt.getLicenseTokenMetadata(id).licensorIpId == ipId) return true;
        }
        return false;
    }

    function _checkSubscription(
        address publisherRoot,
        uint64 embargoStart,
        address caller,
        bytes memory payload
    ) internal view returns (bool) {
        uint256 passId = abi.decode(payload, (uint256));
        // ownerOf must match caller
        if (PASS.ownerOf(passId) != caller) return false;
        // valid (within expiry, matching publisherRoot, underlying license not revoked)
        if (!PASS.isValidFor(passId, publisherRoot)) return false;
        // grandfather rule: subscription must precede the embargo opening
        if (PASS.mintedAt(passId) > embargoStart) return false;
        return true;
    }
}
