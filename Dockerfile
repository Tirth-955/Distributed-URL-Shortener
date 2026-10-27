# ── Stage 1: dependencies (all, including dev tools like drizzle-kit) ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: compile TypeScript ──
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 3: one-shot migration runner ──
# Runs drizzle-kit migrate against the database, then exits.
FROM deps AS migrate
WORKDIR /app
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
CMD ["npm", "run", "db:migrate"]

# ── Stage 4: production runtime ──
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/server.js"]
