# Docker Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the trade-tools app in one Docker container via `docker compose up --build` against the hosted Supabase project.

**Architecture:** Single-stage `node:22-alpine` image that ships source, `node_modules`, and built `dist/` because `scripts/serve.mjs` serves browser assets (including `node_modules/three` via the importmap) from its working directory. Compose runs one service, injecting secrets from `.env` at runtime only.

**Tech Stack:** Docker, docker compose, Node 22, existing Node HTTP server (`scripts/serve.mjs`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-26-docker-compose-design.md`.
- No application code changes; only new root files `Dockerfile`, `.dockerignore`, `docker-compose.yml`, plus one docs section.
- Secrets (`.env`) must never be baked into the image; excluded via `.dockerignore`, injected via `env_file`.
- Server port default `4173` (env `PORT`); public health endpoint `GET /health` returns `{"status":"ok"}`.
- Prerequisite for verification: a populated `.env` exists at repo root (per `.env.example`), and the host can reach the Supabase project. Docker Desktop must be running.

---

### Task 1: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: existing `package.json` scripts (`build` = `tsc`, runtime entry `scripts/serve.mjs`).
- Produces: image `trade-tools` that serves the app on container port 4173; consumed by Task 2's `build: .`.

- [ ] **Step 1: Create `.dockerignore`**

```text
node_modules
dist
.git
.env
.env.*
!.env.example
test/
docs/
data/
supabase/
.DS_Store
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 4173

CMD ["node", "scripts/serve.mjs"]
```

Notes for the implementer:
- `npm ci` installs devDependencies too, so `tsc` is available for `npm run build` in the same stage.
- `three` is a production dependency and lands in `node_modules/`, which stays in the image because the browser importmap in `index.html` loads `./node_modules/three/build/three.module.js`.

- [ ] **Step 3: Build the image**

Run: `docker build -t trade-tools-smoke .`
Expected: exits 0, final line like `DONE ... naming to docker.io/library/trade-tools-smoke`.

- [ ] **Step 4: Verify the image excludes secrets and docs**

Run: `docker run --rm trade-tools-smoke sh -c "ls .env 2>&1; ls docs 2>&1; ls node_modules/three/build/three.module.js"`
Expected: `.env: not found` (or No such file), `docs: not found`, and the `three.module.js` path listed successfully.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add single-stage Dockerfile for app container"
```

---

### Task 2: docker-compose.yml + runtime smoke test

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: Task 1 image build (`build: .`), repo-root `.env` for runtime environment.
- Produces: service `trade-tools` on host port 4173 with healthcheck.

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  trade-tools:
    build: .
    ports:
      - "4173:4173"
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:4173/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

`wget` is provided by busybox on alpine, so no extra tool is needed for the healthcheck.

- [ ] **Step 2: Start the stack**

Run: `docker compose up --build -d && docker compose ps`
Expected: container named `trade-tools-...` reported `running (healthy)` within ~45s (re-check once with `docker compose ps` after waiting). If it shows `restarting`, read `docker compose logs trade-tools` — startup fails fast with a clear message when `DATABASE_URL`/auth env is missing or Supabase is unreachable.

- [ ] **Step 3: Smoke-test health and browser asset paths**

Run:
```bash
curl -sf http://localhost:4173/health
for p in / /tokens.css /src/styles.css /dist/app.js /node_modules/three/build/three.module.js; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:4173$p)"
done
```
Expected: health prints `{"status":"ok"}`; every path returns `200`.

- [ ] **Step 4: Verify excluded directories are not served**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/docs/SUPABASE.md`
Expected: `404`.

- [ ] **Step 5: Stop the stack and commit**

Run: `docker compose down`
Expected: container and network removed.

```bash
git add docker-compose.yml
git commit -m "feat: add docker compose service for trade-tools"
```

---

### Task 3: Documentation

**Files:**
- Modify: `docs/SUPABASE.md` (insert new section after "## 3. Start the application" section, before "## Security boundary")

**Interfaces:**
- Consumes: Task 1–2 deliverables.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add Docker section to `docs/SUPABASE.md`**

Insert between the end of the "Start the application" section and "## Security boundary":

```markdown
## Running with Docker Compose

With a populated `.env` (copy `.env.example`) present at the repository root:

```powershell
docker compose up --build -d
```

The image installs dependencies and compiles `dist/` during the build; `.env` is
injected at runtime only and never baked into the image. The app serves on
`http://localhost:4173` with a `GET /health` container healthcheck. Stop with
`docker compose down`. Startup fails fast with a clear error when database or
auth configuration is missing.
```

- [ ] **Step 2: Confirm the repo test suite is untouched**

Run: `npm test`
Expected: all test files pass, `fail 0` in the final summary.

- [ ] **Step 3: Commit**

```bash
git add docs/SUPABASE.md
git commit -m "docs: document docker compose workflow"
```

---

## Self-Review

- Spec coverage: Dockerfile/.dockerignore (Task 1), compose + healthcheck + usage (Task 2), docs section, exclusions verified (Task 2 steps 4), verification checklist items 1–3 mapped to Task 2 steps, `npm test` regression check mapped to Task 3 step 2. Out-of-scope items untouched. ✔
- Placeholders: none. ✔
- Consistency: port 4173, service name `trade-tools`, image build context `.` used identically in both tasks. ✔
