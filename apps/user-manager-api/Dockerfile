# Build from monorepo root:
#   docker build -f apps/user-manager-api/Dockerfile -t user-manager-api:local .
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/user-manager-api/package.json apps/user-manager-api/
RUN pnpm install --filter @timemanager/user-manager-api... --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY --from=deps /app /app
COPY apps/user-manager-api apps/user-manager-api
WORKDIR /app/apps/user-manager-api
RUN pnpm exec tsc

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/user-manager-api/package.json apps/user-manager-api/
RUN pnpm install --filter @timemanager/user-manager-api... --frozen-lockfile --prod
COPY --from=build /app/apps/user-manager-api/dist apps/user-manager-api/dist
WORKDIR /app/apps/user-manager-api
EXPOSE 3001
CMD ["node", "dist/index.js"]
