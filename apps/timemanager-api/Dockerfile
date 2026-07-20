# Build from monorepo root:
#   docker build -f apps/timemanager-api/Dockerfile -t timemanager-api:local .
#
# Serve:     docker run -p 3000:3000 --env-file ... timemanager-api:local
# Migrate:   docker run --env-file ... timemanager-api:local deno task migrate
#
# Use the Debian-based Bun image (not Alpine): Deno's official binary is
# glibc-linked and fails with exit 127 on musl.
FROM oven/bun:1.2 AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL=/root/.deno
ENV PATH="${DENO_INSTALL}/bin:${PATH}"
WORKDIR /app
COPY apps/timemanager-api/package.json apps/timemanager-api/deno.json ./
COPY apps/timemanager-api/deno.lock* ./
RUN bun install
COPY apps/timemanager-api/ ./
RUN bunx pylon build

FROM oven/bun:1.2 AS runner
COPY --from=build /root/.deno /root/.deno
ENV DENO_INSTALL=/root/.deno
ENV PATH="${DENO_INSTALL}/bin:${PATH}"
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Serve the prebuilt Hono app from `pylon build` (see .pylon/). Do not use
# `pylon start` / `pylon dev` here — those rebuild the schema on every boot and
# lose the ALB health-check race on small Fargate tasks.
# Override command for one-shot migrations: deno task migrate
CMD ["bun", "run", ".pylon/index.js"]
