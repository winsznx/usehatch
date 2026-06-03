import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icons } from "./icons.jsx";
import { Avatar, Button, lc, pubDisplay, shortAddr } from "./primitives.jsx";
import { useFollowsQuery, usePublishersQuery } from "../lib/hooks.js";
import { useSiweSession } from "../lib/siwe.js";
import { api } from "../api.js";
import { qk } from "../lib/queries.js";

function Publishers({ onNearestState }) {
  const I = Icons;
  const qc = useQueryClient();
  const { session } = useSiweSession();
  const pubsQ = usePublishersQuery();
  const followsQ = useFollowsQuery(session?.wallet);
  React.useEffect(() => { onNearestState && onNearestState("public"); }, []);

  const followedSet = React.useMemo(() => {
    const s = new Set();
    for (const r of followsQ.data ?? []) s.add(lc(r));
    return s;
  }, [followsQ.data]);

  const followMut = useMutation({
    mutationFn: async ({ root, currentlyFollowing }) => {
      if (!session?.token) throw new Error("Sign in required");
      if (currentlyFollowing) await api.unfollow(root, session.token);
      else await api.follow(root, session.token);
    },
    onSuccess: () => {
      if (session?.wallet) qc.invalidateQueries({ queryKey: qk.follows(session.wallet) });
    },
  });

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Users size={13} /> Publishers</span>
        <h1 className="c-d1">Everyone publishing on Hatch.</h1>
        <div className="mast-summary">{pubsQ.data?.length ?? 0} publisher{(pubsQ.data?.length ?? 0) === 1 ? "" : "s"} on the registry</div>
      </div>

      <div className="pending" style={{ marginTop: 12 }}>
        {pubsQ.isLoading && <div className="body-sm ink-soft" style={{ padding: 16 }}>Loading…</div>}
        {!pubsQ.isLoading && (pubsQ.data?.length ?? 0) === 0 && (
          <div className="body-sm ink-soft" style={{ padding: 16 }}>No publishers registered yet.</div>
        )}
        {(pubsQ.data ?? []).map((p) => {
          const disp = pubDisplay(p);
          const root = lc(p.publisherRootIp);
          const isFollowing = followedSet.has(root);
          const pending = followMut.isPending && followMut.variables?.root === root;
          return (
            <div className="pending-row" key={root}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <Avatar pub={disp} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="t">{disp.handle}</div>
                  <div className="m mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(root)}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button
                  variant={isFollowing ? "outline" : "primary"}
                  size="md"
                  disabled={!session?.token || pending}
                  onClick={() => followMut.mutate({ root, currentlyFollowing: isFollowing })}
                >
                  {pending ? "…" : isFollowing ? "Following" : "Follow"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {!session?.token && (
        <div className="body-sm ink-soft" style={{ marginTop: 16, padding: 12 }}>
          Sign in to follow publishers.
        </div>
      )}
    </div>
  );
}
export { Publishers };
