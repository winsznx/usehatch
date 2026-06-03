// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// ERC-5643 Subscription NFTs — interface id 0x8c65f84d
/// (XOR of expiresAt, isRenewable, renewSubscription, cancelSubscription selectors)
interface IERC5643 {
    /// Emitted when a subscription's expiration is updated.
    event SubscriptionUpdate(uint256 indexed tokenId, uint64 expiration);

    /// Returns the expiration date of a subscription as a unix timestamp.
    function expiresAt(uint256 tokenId) external view returns (uint64);

    /// Returns whether the subscription can be renewed.
    function isRenewable(uint256 tokenId) external view returns (bool);

    /// Renews a subscription for `duration` additional seconds. Payable per EIP.
    function renewSubscription(uint256 tokenId, uint64 duration) external payable;

    /// Cancels a subscription (does NOT burn the token; just expires it).
    function cancelSubscription(uint256 tokenId) external payable;
}
