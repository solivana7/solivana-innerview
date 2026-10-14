FROM node:20-alpine AS base
WORKDIR /app

# All deps (incl. dev) for build
FROM base AS deps
COPY package.json package-lock.json ./
# npm has a long-standing bug where optionalDependencies for the host platform
# are silently skipped (https://github.com/npm/cli/issues/4828). Rollup's
# Linux-musl native binary is the most common casualty on Alpine. We install
# the main tree first, then explicitly fetch the binary.
RUN npm install --no-audit --include=optional \
 && npm install --no-save --no-audit @rollup/rollup-linux-x64-musl@4.55.1

# Production deps only — slimmer runtime image
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm install --omit=dev --prefer-offline --no-audit

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache wget tini
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
