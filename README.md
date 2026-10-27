# Distributed URL Shortener

A production-style URL shortener REST API built with **Node.js, TypeScript, Express, PostgreSQL (Drizzle ORM) and Redis**.

It takes long URLs and returns short links (`https://your-domain.com/abc123`) that redirect to the original URL — the same core problem behind bit.ly and TinyURL, designed here with the building blocks of a distributed system: a relational source of truth, a Redis cache on the hot redirect path, atomic rate limiting, and stateless app instances that can be scaled horizontally.

## Features

| Feature | Description |
| --- | --- |
| **Short URL creation** | Random, collision-safe short codes generated with `crypto.randomBytes`, with automatic retry on the rare unique-constraint collision. |
| **Custom aliases** | Optionally pick your own short code (4–12 chars: letters, numbers, `-`, `_`). Returns `409 Conflict` if it is already taken or reserved. |
| **Fast redirects** | Cache-aside pattern: redirects are served from Redis when available, falling back to PostgreSQL (which then repopulates the cache). |
| **Click analytics** | Every redirect atomically increments a Redis counter (`INCR`) without adding latency; a background job flushes counters into PostgreSQL, so `GET /stats` reports lifetime clicks that survive a Redis restart. |
| **URL expiration** | Optional expiry (1–365 days). Expired links return `410 Gone`; the cache TTL is clamped so it never outlives the link. |
| **Deactivation** | `DELETE` deactivates a link **and evicts its Redis cache entry**, so a disabled link is never served stale. |
| **Rate limiting** | Distributed, fixed-window limiter implemented as an atomic Lua script (Redis-side `INCR` + `EXPIRE`) with standard `RateLimit-*` headers and `429 Too Many Requests`. |
| **Validated inputs** | Zod schemas for env config and request bodies; only `http`/`https` URLs are accepted. |

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe. |
| `POST` | `/api/v1/urls` | Create a short URL. Body: `{ url, expiresInDays?, customCode? }`. |
| `GET` | `/:shortCode` | Redirect (302) to the original URL. `404` unknown, `410` expired. |
| `GET` | `/api/v1/urls/:shortCode/stats` | Click count for a short URL. |
| `DELETE` | `/api/v1/urls/:shortCode` | Deactivate a short URL (204). |

### Examples

```bash
# Create a short URL
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://github.com/trending", "expiresInDays": 7, "customCode": "gh-trend" }'

# Response
{
  "shortCode": "gh-trend",
  "originalUrl": "https://github.com/trending",
  "shortUrl": "http://localhost:3000/gh-trend",
  "expiresAt": "2026-11-03T00:00:00.000Z"
}

# Redirect
curl -i http://localhost:3000/gh-trend

# Click stats
curl http://localhost:3000/api/v1/urls/gh-trend/stats
```

## Architecture

```mermaid
flowchart LR
    C[Client] --> N[Nginx / Load Balancer]
    N --> A1[App instance 1]
    N --> A2[App instance 2]
    A1 --> R[(Redis)]
    A2 --> R
    A1 --> P[(PostgreSQL)]
    A2 --> P
```

- **App instances are stateless** — any instance can serve any request, so they scale horizontally behind a load balancer.
- **PostgreSQL** is the source of truth (`urls` table: short code, original URL, expiry, active flag, click count).
- **Redis** serves two roles:
  - **Redirect cache** — cache-aside with a 60s TTL, clamped to the link's expiry time.
  - **Hot counters** — clicks are counted with atomic `INCR`/Lua scripts and flushed to Postgres in the background (write-behind), keeping the redirect path fast.

### Design decisions

- **Collision handling:** short codes are 8-char random values; a unique index is the guard, and an insert that violates it simply retries with a new code (up to 3 attempts). Correctness comes from the database, not from hoping.
- **Cache invalidation:** codes are immutable, so cached entries never go stale — except on deactivation, which explicitly deletes the cache key before responding.
- **Fail-open Redis:** if Redis is briefly unavailable, redirects and rate limiting degrade to PostgreSQL / unlimited instead of failing requests — the cache is an optimization, not a dependency.
- **Atomic rate limiting:** `INCR` and `EXPIRE` happen inside one Lua script, so the window is correct even under concurrent requests or multiple app instances sharing Redis.

## Project structure

```
src/
├── app.ts                      # Express app (routes, middleware wiring)
├── server.ts                   # Entry point + background flush + graceful shutdown
├── config/                     # Zod-validated env, Redis client
├── controllers/                # HTTP layer: request/response mapping
├── services/                   # Business logic: urls, cache, click stats
├── routes/                     # Route definitions
├── middleware/                 # Rate limiting, error handling
├── validators/                 # Zod request schemas
├── db/                         # Drizzle schema + pooled connection
└── utils/                      # Short code generation
tests/                          # Vitest + Supertest endpoint tests
drizzle/                        # Generated SQL migrations
Dockerfile                      # Multi-stage build: runtime image + one-shot migrate image
docker-compose.yml              # nginx + app × N + postgres + redis topology
nginx/nginx.conf                # Load balancer with Docker-DNS re-resolution
```

## Getting started

**Prerequisites:** Node.js 20+, a PostgreSQL database, and a Redis instance.

```bash
git clone https://github.com/Tirth-955/Distributed-URL-Shortner.git
cd Distributed-URL-Shortner
npm install

cp .env.example .env   # fill in your values
npm run db:migrate     # create/upgrade the schema
npm run dev            # start in watch mode
```

Environment variables (see `.env.example`):

| Variable | Description |
| --- | --- |
| `PORT` | Server port (default 3000). |
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATABASE_SSL` | `true` for cloud Postgres (Neon/Supabase), `false` for local/Docker Postgres. |
| `BASE_URL` | Public base URL used to build short links. |
| `REDIS_URL` | Redis connection string. |

## Running the full distributed stack (Docker Compose)

One command starts the complete topology from the architecture diagram — Nginx, multiple stateless app instances, PostgreSQL and Redis:

```bash
docker compose up --build -d --scale app=2
```

| Service | Role |
| --- | --- |
| `nginx` | The only public entry point (`http://localhost:8080`); round-robins across app replicas. |
| `app` | Stateless API instances (scale with `--scale app=N`). Not exposed directly. |
| `migrate` | One-shot container that applies Drizzle migrations before the app starts. |
| `postgres` | Source of truth (data persisted in a named volume). |
| `redis` | Redirect cache, distributed rate limiting, pending click counters. |

### Verifying the distributed behavior

Each app instance identifies itself in `/health` (its container hostname), which makes the scaling properties observable:

1. **Load balancing** — `GET /health` repeatedly through Nginx: responses alternate between instance IDs (e.g. a 50/50 split across 2 replicas).
2. **High availability** — `docker compose stop app-2` mid-traffic: requests keep succeeding on the surviving instance with no manual intervention; start it back any time.
3. **Distributed rate limiting** — create URLs until `429`, restart *both* app instances, continue: the counter lives in shared Redis, so the 11th request in the 60s window still gets `429` regardless of which instance serves it.
4. **Cross-instance analytics** — redirects served by different instances produce one correct total in `GET /api/v1/urls/:shortCode/stats`.

### A note on the Nginx config

Nginx caches DNS results, which would silently break round-robin over scaled replicas. The config uses Docker's embedded DNS resolver (`127.0.0.11`) with a 10s re-resolution TTL, so the upstream set tracks the live replicas.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the API in watch mode. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run the compiled build. |
| `npm test` | Run the test suite (no database or Redis required — external services are mocked). |
| `npm run db:generate` | Generate a migration from the Drizzle schema. |
| `npm run db:migrate` | Apply migrations. |

## Roadmap

- [x] Docker Compose setup (Nginx + app × N + Postgres + Redis) — `docker compose up --build -d --scale app=2`
- [x] Graceful shutdown (drain in-flight requests, close pools/connections)
- [ ] GitHub Actions CI
- [ ] Per-URL analytics details (clicks over time, referrers)
