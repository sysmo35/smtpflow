# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --silent
COPY frontend/ .
RUN npm run build

# ── Stage 2: Production image ────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY backend/package*.json ./
RUN npm install --production --silent

# Copy backend source
COPY backend/ .

# Copy built frontend
COPY --from=frontend-builder /frontend/dist /app/public

ENV FRONTEND_PATH=/app/public
ENV NODE_ENV=production

EXPOSE 3000 587 465

CMD ["node", "src/index.js"]
