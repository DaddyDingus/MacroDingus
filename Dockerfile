# --- frontend build ---
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- backend build (needs toolchain to compile better-sqlite3) ---
FROM node:24-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build
RUN npm prune --omit=dev

# --- runtime ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The source default (`__dirname/../../data`) is correct when running from
# backend/src in development, but resolves to /data from /app/dist in this
# image — outside WORKDIR and outside any sane volume mount. Upstream's compose
# always set DATA_DIR explicitly so it never surfaced, but as root the app
# would happily create /data and write the database somewhere the volume does
# not cover, losing everything on the next `docker run`. Declaring it here
# means the image is correct on its own and compose cannot forget it.
ENV DATA_DIR=/app/data

# `node` (uid/gid 1000) ships with the base image. Running as root here bought
# nothing — the process binds an unprivileged port and only ever writes inside
# its own data directory — while making any RCE (most plausibly through
# sharp/libvips decoding an untrusted image) a root compromise, and leaving
# every file in the data volume root-owned.
COPY --from=backend-build --chown=node:node /app/backend/package*.json ./
COPY --from=backend-build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/backend/dist ./dist
COPY --from=frontend-build --chown=node:node /app/frontend/dist ./public

# Created here so a fresh named volume mounted over it inherits node ownership
# rather than root's. Without this the first boot cannot write its database.
RUN mkdir -p /app/data/photos && chown -R node:node /app/data

USER node

EXPOSE 3000

# Compose declares its own healthcheck, but having one in the image means
# `docker run` and any other runtime get it too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
