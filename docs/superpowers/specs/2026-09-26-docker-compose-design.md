# Docker Compose for trade-tools — Design

Date: 2026-09-26
Status: approved by user in chat

## Goal

Run the application in a single Docker container via `docker compose up --build`,
against the existing hosted Supabase project (Postgres + Auth). No application code changes.

## Constraints discovered

- `scripts/serve.mjs` serves static files from the container working directory:
  `index.html`, `tokens.css`, `src/styles.css`, `dist/**`, and `node_modules/three/**`
  (the browser importmap in `index.html` loads three straight from `node_modules/`).
  The image therefore must ship source, `dist/`, and `node_modules`.
- Runtime requires Supabase Postgres (`DATABASE_URL`) and Supabase Auth
  (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`); `AUTH_MODE=disabled` is rejected.
  No database container in compose.
- Server listens on `PORT` (default 4173). `GET /health` is public and usable as a healthcheck.
- Secrets must never be baked into the image; they arrive at runtime via `env_file: .env`.

## Components

### 1. Dockerfile (single stage, `node:22-alpine`)

```
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build          # tsc -> dist/
EXPOSE 4173
CMD ["node", "scripts/serve.mjs"]
```

Single stage is deliberate: prod and dev deps plus `node_modules` all ship anyway
(browser importmap), so a prune stage buys little.

### 2. .dockerignore

Exclude: `node_modules` (image runs its own `npm ci`), `dist` (rebuilt in image),
`.git`, `.env`, `.env.*` with `!.env.example`, `test/`, `docs/`, `data/`, `supabase/`.
Excluding `docs/` and `supabase/` also keeps those paths from being served by the
static handler at runtime.

### 3. docker-compose.yml

```yaml
services:
  trade-tools:
    build: .
    ports: "4173:4173"
    env_file: .env
    restart: unless-stopped
    healthcheck: GET /health via wget, 30s interval, 3 retries
```

### 4. Documentation

One short "Docker" section in `docs/SUPABASE.md`: prerequisites (populated `.env`
from `.env.example`), `docker compose up --build`, stop with `docker compose down`.

## Error handling

Missing/invalid environment variables fail fast at startup with the app's existing
errors; the container exits and compose surfaces the log. No new error handling needed.

## Verification

1. `docker compose up --build -d` exits 0 and container becomes healthy.
2. `curl localhost:4173/health` returns `{"status":"ok"}`.
3. `curl -I localhost:4173/` returns 200 and `/tokens.css`, `/src/styles.css`,
   `/node_modules/three/build/three.module.js` fetch 200 (browser asset path intact).
4. `npm test` still passes (no repo files removed beyond exclusions).

## Out of scope

- Local Postgres/Supabase containers, CI/CD publishing, HTTPS/reverse proxy,
  multi-container dev overrides.
