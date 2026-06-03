// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

/// Hatch compound embargo condition.
/// Invoked by the Story CDR precompile as:
/// (uint32 uuid, bytes accessAuxData, bytes conditionData, address caller).
contract HatchCondition {
    function checkReadCondition(
        uint32,
        bytes calldata accessAuxData,
        bytes calldata conditionData,
        address caller
    ) external view returns (bool) {
        // conditionData = abi.encode(address licenseToken, address ipId,
        //                            uint64 embargoStart, uint64 revealAt)
        (address licenseToken, address ipId, uint64 embargoStart, uint64 revealAt) =
            abi.decode(conditionData, (address, address, uint64, uint64));

        if (block.timestamp >= revealAt) return true;          // post-reveal: open
        if (block.timestamp < embargoStart) return false;      // pre-window: nobody

        // active window: caller must hold a non-revoked license token issued for THIS ip
        // accessAuxData = abi.encode(uint256[] licenseTokenIds)
        if (accessAuxData.length == 0) return false;
        uint256[] memory tokenIds = abi.decode(accessAuxData, (uint256[]));

        ILicenseToken lt = ILicenseToken(licenseToken);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (lt.ownerOf(id) != caller) continue;
            if (lt.isLicenseTokenRevoked(id)) continue;
            if (lt.getLicenseTokenMetadata(id).licensorIpId == ipId) return true;
        }
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
}
