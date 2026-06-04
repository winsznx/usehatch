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

# Runtime. Serve the dist/ via vite preview (fine for low traffic; swap to
# nginx for high traffic by adding a separate runner stage based on nginx).
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY --from=builder /app/sdk ./sdk
COPY --from=builder /app/frontend ./frontend

EXPOSE 5173
WORKDIR /app/frontend
CMD ["sh", "-c", "pnpm exec vite preview --port ${PORT:-5173} --host 0.0.0.0"]
