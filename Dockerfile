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
COPY --from=backend-build /app/backend/package*.json ./
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]
