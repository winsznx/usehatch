# Backend service Dockerfile. Build context = repo root.
# Each sub-package has its own pnpm-lock.yaml (this is NOT a pnpm workspace).
# Backend references the SDK via `link:../sdk` in its package.json, which pnpm
# resolves as a symlink at install time. So the SDK directory must already
# exist when backend's install runs.
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Build the SDK first so the `link:../sdk` reference from backend resolves to
# a directory with a built `dist/`.
COPY sdk/package.json sdk/pnpm-lock.yaml ./sdk/
RUN cd sdk && pnpm install --frozen-lockfile
COPY sdk/ ./sdk/
RUN cd sdk && pnpm build

# Now install backend. pnpm sees `link:../sdk` and symlinks /app/sdk.
COPY backend/package.json backend/pnpm-lock.yaml ./backend/
RUN cd backend && pnpm install --frozen-lockfile
COPY backend/ ./backend/

# Runtime stage. Slim Node base. Copy the built workspace tree.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY --from=builder /app/sdk ./sdk
COPY --from=builder /app/backend ./backend

EXPOSE 4011
WORKDIR /app/backend
CMD ["pnpm", "exec", "tsx", "src/runner.ts"]
