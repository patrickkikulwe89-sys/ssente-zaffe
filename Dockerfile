# The two Node services (reports API, USSD gateway). The reader needs no runtime —
# it is static files, deployed separately.
#
# Deliberately holds no data and no keys: bundles, the trust list and the database are
# mounted at /data, so the image carries nothing secret and nothing that expires.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests first, so dependency install caches independently of source changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json      packages/core/
COPY packages/ingest/package.json    packages/ingest/
COPY packages/reports/package.json   packages/reports/
COPY packages/ussd/package.json      packages/ussd/
COPY apps/reader/package.json        apps/reader/
RUN npm ci --omit=dev --ignore-scripts

# Node 22 runs the TypeScript directly, so there is no build step and no tsx in production.
COPY packages ./packages

ENV SSENTE_ROOT=/app \
    BUNDLE_DIR=/data/bundles \
    TRUSTED_KEYS=/data/keys/trusted.json \
    REPORTS_DB=/data/reports.db

USER node
EXPOSE 8787 8788

# Override for the reports API:
#   docker run … ssente node packages/reports/src/server.ts
CMD ["node", "packages/ussd/src/server.ts"]
