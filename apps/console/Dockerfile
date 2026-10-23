# Pitwall console. Build from the repository root:  docker build -f apps/console/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/console/package.json apps/console/
COPY examples/demo-product/package.json examples/demo-product/
RUN pnpm install --frozen-lockfile --filter @pitwall/console... 
COPY packages/sdk packages/sdk
COPY apps/console apps/console
RUN pnpm --filter @pitwall/sdk build && pnpm --filter @pitwall/console build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3200 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/console/.next/standalone ./
COPY --from=build /repo/apps/console/.next/static ./apps/console/.next/static
USER node
EXPOSE 3200
CMD ["node", "apps/console/server.js"]
