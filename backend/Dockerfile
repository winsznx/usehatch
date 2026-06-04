# Backend service Dockerfile. Builds the SDK then runs the Hono API + workers
# via tsx. Uses pnpm 10 explicitly to avoid Railpack auto-detect quirks.
#
# Multi-stage so the final runtime image carries only what runner.ts needs.
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Copy workspace manifests first so dep layers cache when only source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY sdk/package.json ./sdk/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install every workspace package incl. devDeps (we need tsc to build the SDK).
RUN pnpm install --frozen-lockfile

# Copy source and build the SDK (backend imports @usehatch/sdk via workspace link).
COPY sdk/ ./sdk/
COPY backend/ ./backend/
RUN pnpm --filter @usehatch/sdk build

# Runtime stage. Slim Node base. Copy everything we need from builder.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/sdk ./sdk
COPY --from=builder /app/backend ./backend

EXPOSE 4011
CMD ["pnpm", "--filter", "@usehatch/backend", "exec", "tsx", "src/runner.ts"]
