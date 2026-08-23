FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/fleet-client/package.json packages/fleet-client/package.json
COPY apps/slack/package.json apps/slack/package.json
RUN pnpm install --frozen-lockfile
COPY packages/fleet-client packages/fleet-client
COPY apps/slack apps/slack
RUN pnpm build:slack

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/fleet-client ./packages/fleet-client
COPY --from=build /app/apps/slack ./apps/slack
CMD ["node", "apps/slack/dist/main.js"]
