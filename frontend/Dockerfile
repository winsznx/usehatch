# Frontend service Dockerfile. Build context = repo root.
# Same per-package-lockfile pattern as backend.
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# SDK first (frontend imports @usehatch/sdk via link:../sdk).
COPY sdk/package.json sdk/pnpm-lock.yaml ./sdk/
RUN cd sdk && pnpm install --frozen-lockfile
COPY sdk/ ./sdk/
RUN cd sdk && pnpm build

# Frontend deps.
COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/
RUN cd frontend && pnpm install --frozen-lockfile
COPY frontend/ ./frontend/
COPY docs/ ./docs/

# Vite reads VITE_* env vars at build time and inlines them into the bundle.
ARG VITE_BACKEND_URL
ARG VITE_RPC_URL
ARG VITE_CHAIN_ID
ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_PRIVY_APP_ID
ARG VITE_PRIVY_SPONSORSHIP_POLICY_ID
ARG VITE_VAPID_PUBLIC_KEY
ARG VITE_BLUESKY_HANDLE
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_RPC_URL=$VITE_RPC_URL
ENV VITE_CHAIN_ID=$VITE_CHAIN_ID
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID
ENV VITE_PRIVY_SPONSORSHIP_POLICY_ID=$VITE_PRIVY_SPONSORSHIP_POLICY_ID
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
ENV VITE_BLUESKY_HANDLE=$VITE_BLUESKY_HANDLE

RUN cd frontend && pnpm build

# Runtime. Tiny inline Node static server. Avoids sirv-cli's port-collision
# fallback behavior that picked port 5 instead of $PORT under Railway. This
# server does:
#   - gzip + brotli pre-compressed file lookup (sirv pre-built ".gz" / ".br")
#   - cache-control: max-age=31536000, immutable on hashed /assets/* paths
#   - SPA fallback to /index.html for non-asset 404s
#   - bind to $PORT, listen on 0.0.0.0
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/frontend/dist ./dist
COPY frontend/server.mjs ./server.mjs

EXPOSE 5173
CMD ["sh", "-c", "node server.mjs"]
