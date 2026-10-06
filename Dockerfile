# ---------- frontend build ----------
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# ---------- backend build ----------
FROM node:22-alpine AS backend
WORKDIR /app/backend
RUN corepack enable
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY backend/ ./
RUN pnpm build

# ---------- runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=backend /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist ./frontend/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
