// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Slice of Story Protocol's deployed LicenseToken at 0xFe38… (impl 0xE553aA53).
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
        external view returns (LicenseTokenMetadata memory);
}

interface IHatchSubscriptionPass {
    function ownerOf(uint256 tokenId) external view returns (address);
    function isValidFor(uint256 tokenId, address publisherRoot) external view returns (bool);
    function mintedAt(uint256 tokenId) external view returns (uint64);
}

/// HatchCondition v2.1 — dual-mode embargo gate with **separated ipId and publisherRoot slots**
/// so a derivative signal (per-hatch licensor) can coexist with a publisher root (subscription
/// authority) in a single vault's conditionData. Both LicenseToken and Pass are immutables —
/// addresses live on the contract, not in the encoded data.
///
/// conditionData = abi.encode(
///     uint8 mode,           // 0 per-hatch, 1 subscription, 2 dual
///     address ipId,         // signal's licensor (per-hatch route)
///     address publisherRoot,// publisher's root IP (subscription route)
///     uint64  embargoStart,
///     uint64  revealAt
/// )
///
/// accessAuxData = abi.encode(uint8 kind, bytes payload)
///   kind 0: payload = abi.encode(uint256[] licenseTokenIds)
///   kind 1: payload = abi.encode(uint256 passId)
contract HatchConditionV2_1 {
    uint8 public constant MODE_PER_HATCH    = 0;
    uint8 public constant MODE_SUBSCRIPTION = 1;
    uint8 public constant MODE_DUAL         = 2;

    uint8 public constant KIND_PER_HATCH    = 0;
    uint8 public constant KIND_SUBSCRIPTION = 1;

    ILicenseToken public immutable LICENSE_TOKEN;
    IHatchSubscriptionPass public immutable PASS;

    constructor(address licenseToken, address pass) {
        LICENSE_TOKEN = ILicenseToken(licenseToken);
        PASS = IHatchSubscriptionPass(pass);
    }

    function checkReadCondition(
        uint32,
        bytes calldata accessAuxData,
        bytes calldata conditionData,
        address caller
    ) external view returns (bool) {
        (uint8 mode, address ipId, address publisherRoot, uint64 embargoStart, uint64 revealAt) =
            abi.decode(conditionData, (uint8, address, address, uint64, uint64));

        if (block.timestamp >= revealAt) return true;
        if (block.timestamp < embargoStart) return false;

        if (accessAuxData.length == 0) return false;
        (uint8 kind, bytes memory payload) = abi.decode(accessAuxData, (uint8, bytes));

        if (mode != MODE_DUAL && kind != mode) return false;

        if (kind == KIND_PER_HATCH)    return _checkPerHatch(ipId, caller, payload);
        if (kind == KIND_SUBSCRIPTION) return _checkSubscription(publisherRoot, embargoStart, caller, payload);
        return false;
    }

    function checkWriteCondition(
        uint32,
        bytes calldata,
        bytes calldata conditionData,
        address caller
    ) external pure returns (bool) {
        address owner = abi.decode(conditionData, (address));
        return caller == owner;
    }

    function _checkPerHatch(address ipId, address caller, bytes memory payload) internal view returns (bool) {
        uint256[] memory tokenIds = abi.decode(payload, (uint256[]));
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (LICENSE_TOKEN.ownerOf(id) != caller) continue;
            if (LICENSE_TOKEN.isLicenseTokenRevoked(id)) continue;
            if (LICENSE_TOKEN.getLicenseTokenMetadata(id).licensorIpId == ipId) return true;
        }
        return false;
    }

    function _checkSubscription(address publisherRoot, uint64 embargoStart, address caller, bytes memory payload)
        internal view returns (bool)
    {
        uint256 passId = abi.decode(payload, (uint256));
        if (PASS.ownerOf(passId) != caller) return false;
        if (!PASS.isValidFor(passId, publisherRoot)) return false;
        if (PASS.mintedAt(passId) > embargoStart) return false;
        return true;
    }
}
