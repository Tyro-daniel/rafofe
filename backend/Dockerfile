# =============================================================================
# Backend — production image
# Multi-stage isn't strictly needed here (no build step: plain JS, no
# TypeScript compile) but we still separate dependency install from the
# runtime layer so Docker's layer cache means `npm install` only re-runs
# when package.json actually changes, not on every source edit.
# =============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# npm install (not `ci`) because there is deliberately no package-lock.json
# committed yet — see README "Moving to production" for switching to `ci`
# once a lockfile is generated and committed for reproducible builds.
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app

# Run as a non-root user — the base image ships a "node" user for exactly
# this purpose. Running containers as root is a common, avoidable
# security gap.
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node db ./db

ENV NODE_ENV=production
EXPOSE 4000

# Basic container-level healthcheck hitting the app's own /health route —
# lets `docker compose ps` and orchestrators (Swarm/Kubernetes) know when
# the API is actually ready to serve traffic, not just that the process
# started.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
