/* TanStack Query hooks for Hatch surfaces.
 *
 * Each hook wraps `api.*` with a `qk.*` key and the right enablement guard
 * (e.g., user-specific queries are disabled until SIWE produces a wallet).
 * Keep this file dependency-light: hooks return raw API payloads — UI
 * adapters live next to the components that need them. */
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import {
  api,
  type Dispute,
  type DisputeStatus,
  type DisputeStatusSummary,
  type GroupMember,
  type GroupSummary,
  type HatchStatus,
  type HatchSummary,
  type PublisherClaimable,
  type PublisherMetrics,
  type PublisherSummary,
  type QueueItem,
  type ResolutionRow,
  type TimelineEvent,
  type TrackRecord,
} from "../api.js";
import { useSiweSession } from "./siwe.js";
import { qk } from "./queries.js";

export function usePublishersQuery() {
  return useQuery({
    queryKey: qk.publishers(),
    queryFn: async () => (await api.publishers()).publishers,
  });
}

export function usePublisherQuery(rootIp: Address | undefined) {
  return useQuery({
    queryKey: rootIp ? qk.publisher(rootIp) : qk.publishers(),
    queryFn: () => api.publisher(rootIp as Address),
    enabled: !!rootIp,
  });
}

export function usePublisherResolutionsQuery(rootIp: Address | undefined) {
  return useQuery({
    queryKey: rootIp ? [...qk.publisher(rootIp), "resolutions"] : qk.publishers(),
    queryFn: async () => (await api.publisherResolutions(rootIp as Address)).resolutions,
    enabled: !!rootIp,
  });
}

export function usePublisherMetricsQuery(rootIp: Address | undefined) {
  return useQuery({
    queryKey: rootIp ? [...qk.publisher(rootIp), "metrics"] : qk.publishers(),
    queryFn: () => api.publisherMetrics(rootIp as Address),
    enabled: !!rootIp,
  });
}

export function usePublisherClaimableQuery(rootIp: Address | undefined, claimer?: Address) {
  return useQuery({
    queryKey: rootIp ? [...qk.publisher(rootIp), "claimable", claimer ?? rootIp] : qk.publishers(),
    queryFn: () => api.publisherClaimable(rootIp as Address, claimer),
    enabled: !!rootIp,
    staleTime: 15_000,
  });
}

export function usePublisherDisputeStatusQuery(rootIp: Address | undefined) {
  return useQuery({
    queryKey: rootIp ? [...qk.publisher(rootIp), "dispute-status"] : qk.publishers(),
    queryFn: () => api.publisherDisputeStatus(rootIp as Address),
    enabled: !!rootIp,
    staleTime: 30_000,
  });
}

export function useGroupsQuery(opts?: { publisher?: Address; owner?: Address; limit?: number }) {
  const key = ["groups", opts?.publisher ?? "", opts?.owner ?? "", opts?.limit ?? 50];
  return useQuery({
    queryKey: key,
    queryFn: async () => (await api.groups(opts)).groups,
    staleTime: 30_000,
  });
}

export function useGroupQuery(groupId: Address | undefined) {
  return useQuery({
    queryKey: groupId ? ["group", groupId.toLowerCase()] : ["group", "none"],
    queryFn: () => api.group(groupId as Address),
    enabled: !!groupId,
  });
}

export function useDisputesQuery(opts?: { targetIpId?: Address; publisher?: Address; hatchUuid?: number; status?: DisputeStatus; limit?: number }) {
  const key = ["disputes", opts?.targetIpId ?? "", opts?.publisher ?? "", opts?.hatchUuid ?? "", opts?.status ?? "", opts?.limit ?? 50];
  return useQuery({
    queryKey: key,
    queryFn: async () => (await api.disputes(opts)).disputes,
    staleTime: 30_000,
  });
}

export function useHatchesQuery(opts?: { status?: HatchStatus; publisher?: Address; limit?: number }) {
  return useQuery({
    queryKey: qk.hatches(opts),
    queryFn: async () => (await api.hatches(opts)).hatches,
  });
}

export function useHatchQuery(uuid: number | undefined) {
  return useQuery({
    queryKey: uuid !== undefined ? qk.hatch(uuid) : qk.hatches(),
    queryFn: async () => (await api.hatch(uuid as number)).hatch,
    enabled: uuid !== undefined,
  });
}

export function useHatchRevealQuery(uuid: number | undefined, enabled = true) {
  return useQuery({
    queryKey: uuid !== undefined ? qk.hatchReveal(uuid) : qk.hatches(),
    queryFn: async () => (await api.hatchReveal(uuid as number)).revealedContent,
    enabled: uuid !== undefined && enabled,
    retry: false,
  });
}

export function useFollowsQuery(wallet: Address | undefined) {
  return useQuery({
    queryKey: wallet ? qk.follows(wallet) : qk.publishers(),
    queryFn: async () => (await api.follows(wallet as Address)).publishers,
    enabled: !!wallet,
  });
}

export function useMyQueueQuery() {
  const { session } = useSiweSession();
  return useQuery({
    queryKey: session?.wallet ? ["me", "queue", session.wallet] : ["me", "queue", "anon"],
    queryFn: async () => (await api.myQueue(session!.token)).items,
    enabled: !!session?.token,
  });
}

export function useMyTimelineQuery() {
  const { session } = useSiweSession();
  return useQuery({
    queryKey: session?.wallet ? ["me", "timeline", session.wallet] : ["me", "timeline", "anon"],
    queryFn: async () => (await api.myTimeline(session!.token)).items,
    enabled: !!session?.token,
  });
}

export type { HatchSummary, PublisherSummary, TrackRecord, QueueItem, TimelineEvent, ResolutionRow, PublisherMetrics, PublisherClaimable, Dispute, DisputeStatus, DisputeStatusSummary, GroupSummary, GroupMember };
