FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @implementation-orchestrator/database run generate
RUN pnpm --filter @implementation-orchestrator/contracts... --filter @implementation-orchestrator/worker... run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
CMD ["node", "dist/worker.js"]
