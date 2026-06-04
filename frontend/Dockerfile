# Frontend service Dockerfile. Builds the SDK + the Vite app, then serves the
# bundled dist with vite preview. Two stage so the runtime image is small.
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY sdk/package.json ./sdk/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN pnpm install --frozen-lockfile

COPY sdk/ ./sdk/
COPY frontend/ ./frontend/
COPY docs/ ./docs/

# Bake build-time env vars from Railway secrets into the Vite bundle.
# Each VITE_* var Railway injects at build time is read by Vite via import.meta.env.
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

RUN pnpm --filter @usehatch/sdk build && pnpm --filter frontend build

# Runtime stage. We still need pnpm + the workspace structure because
# `vite preview` is the simplest static-ish server option that's already
# in the dep tree. For higher traffic, swap to nginx with frontend/dist.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/sdk ./sdk
COPY --from=builder /app/frontend ./frontend

EXPOSE 5173
CMD ["sh", "-c", "pnpm --filter frontend exec vite preview --port ${PORT:-5173} --host 0.0.0.0"]
