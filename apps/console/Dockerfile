# Pitwall console. Build from the repository root:  docker build -f apps/console/Dockerfile .
FROM node:26-alpine AS build
# O Node 25+ não traz mais o corepack; ele lê a versão do pnpm do packageManager do package.json.
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/console/package.json apps/console/
COPY examples/demo-product/package.json examples/demo-product/
RUN pnpm install --frozen-lockfile --filter @pitwall/console... 
COPY packages/sdk packages/sdk
COPY apps/console apps/console
RUN pnpm --filter @pitwall/sdk build && pnpm --filter @pitwall/console build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3200 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/console/.next/standalone ./
COPY --from=build /repo/apps/console/.next/static ./apps/console/.next/static
# The standalone output leaves public/ out on purpose: without this, the login photos answer 404.
COPY --from=build /repo/apps/console/public ./apps/console/public
USER node
EXPOSE 3200
CMD ["node", "apps/console/server.js"]
