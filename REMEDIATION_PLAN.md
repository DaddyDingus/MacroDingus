# MacroDingus — Phase 3 Remediation Plan

**Date:** 2026-08-07
**Depends on:** [`SECURITY_AND_DEPLOYMENT_REVIEW.md`](SECURITY_AND_DEPLOYMENT_REVIEW.md)
**Branch:** `homelab-hardening` (fork `zriec1/MacroDingus`, baseline `8a6201a`)
**Status:** Awaiting approval. **Nothing in this document has been implemented.**

## Decisions taken (2026-08-07)

| # | Decision | Chosen |
|---|---|---|
| D-1 | Host | **CT100**, joined to `proxy`, **no published port**, Authentik forward-auth |
| D-2 | Image | **GitHub Actions → `ghcr.io/zriec1/macrodingus`**, pinned tags |
| D-3 | Hostname | `macros.nyxcloud.com.au` *(proposed — say if you want another)* |
| D-4 | Auth model | Forward-auth now; in-app OIDC not attempted |
| D-5 | Signup | Disabled after the first account is created |
| — | F-01 app hardening | **Promoted to required-before-deploy** — forward-auth may prove PWA-incompatible (it broke the HA companion app and Jellyfin iOS), so the app's own login must not be the weak point if the gate has to come off |

## Two repositories, two PRs

Work splits cleanly and the split matters for blast radius:

| Repo | Contents | Risk |
|---|---|---|
| `zriec1/MacroDingus` (this fork) | App code, Dockerfile, compose, CI workflow, docs | **Self-contained.** Touches no running service |
| `zriec1/homelab` | Stack file, alert allowlist, backup job + freshness target, runbook, service catalog | **Touches shared infra** — see §5 |

**A deliberate reduction:** because CT100 services configure Traefik via container labels, the
per-app security-headers middleware goes on the MacroDingus container itself. **`traefik.yml` is
not modified at all.** That avoids editing the single most outage-prone shared file in the
homelab (gotcha #20) and removes an entire class of rollback risk.

---

# 1. Required before deployment

Ordered as I intend to commit them. Each is independently revertable.

---

### R1 · Remove the Tailscale sidecar

**Problem.** Dead infrastructure carrying `NET_ADMIN`, `NET_RAW` and `/dev/net/tun`. You don't
use Tailscale for this, and the sidecar is *also* the app's only access control — so it must be
removed in lockstep with R2/R6, never before.

**Files.** `compose.yaml` (delete `macrotrack-tailscale`), delete `tailscale-config/serve.json`,
`.gitignore` / `.dockerignore` (drop `tailscale-state/`), `.env.example` (drop `TS_*`),
`README.md`.

**Behavioural impact.** No HTTPS hostname from the app itself. Until R6 lands, the app is
reachable only over the `proxy` Docker network — which is the intended end state anyway.

**Test.** `docker compose config` parses and lists exactly one service. `grep -ri tailscale .`
returns only historical mentions in review docs.

**Rollback.** `git revert`. The sidecar is stateless apart from `tailscale-state/`, which is
gitignored and was never populated in this clone.

---

### R2 · SSRF guard on recipe import — **F-02**

**Problem.** `fetchPageText` validates only the URL scheme, follows redirects, and returns
distinguishable errors — an authenticated user can scan and partially read the homelab from a
container sitting on the `proxy` network beside Traefik, Authentik and Portainer.

**Files.** `backend/src/engine/recipeImport.ts` (new `assertPublicUrl()` helper + rework of
`fetchPageText`).

**Approach.**
1. Resolve the hostname with `dns.promises.lookup(host, { all: true })`; reject if **any**
   resolved address is loopback, private, link-local, CGNAT, unique-local or multicast
   (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `100.64/10`, `0/8`, `::1`,
   `fc00::/7`, `fe80::/10`), including IPv4-mapped IPv6 (`::ffff:a.b.c.d`).
2. Allow ports 80/443 only.
3. `redirect: "manual"`; re-validate each hop, maximum 3.
4. Collapse every failure to one generic message — kills the port-scanner signal.
5. Cap the response body at ~2 MB while streaming, rather than buffering the whole page.

**Behavioural impact.** Importing a recipe from a public site is unchanged. Importing from a
LAN/localhost URL now fails with a generic error. No effect on any other feature.

**Test.** A small script exercising `assertPublicUrl` directly (no network, no framework):
`http://127.0.0.1:3000/`, `http://192.168.20.50:9000/`, `http://authentik-server:9000/`,
`http://169.254.169.254/`, `http://[::1]/`, `http://[::ffff:127.0.0.1]/` → all rejected;
`https://www.taste.com.au/recipes/...` → accepted. Post-deploy: check **V-8**.

**Rollback.** `git revert` — one self-contained file, no schema or config dependency.

**Residual.** A public host that resolves to a public IP and *then* redirects is caught by the
per-hop check. A TOCTOU DNS-rebind between validation and `fetch` remains theoretically possible;
closing it fully needs a pinned-IP custom agent, which I judge disproportionate here. Documented,
not fixed.

---

### R3 · Session cookie hardening — **F-06**

**Problem.** No `Secure` flag; 30-day stateless sessions that cannot be revoked, not even by a
password change.

**Files.** `backend/src/auth.ts`.

**Approach.** `secure: true` on `setCookie`; `SESSION_MS` 30 d → 7 d; read the signing key from
`MACRODINGUS_COOKIE_SECRET` (existing `COOKIE_SECRET` env support is already there — this only
renames and documents it) falling back to the current file behaviour.

**Behavioural impact.** Re-login every 7 days instead of 30. The cookie stops being sent over
plain HTTP — **which means `http://macrodingus:3000` direct testing can no longer authenticate.**
That's intended, and V-6 accounts for it by asserting `401`, not by logging in.

**Test.** `curl -i` the login response; assert `Secure`, `HttpOnly`, `SameSite=Lax` on
`Set-Cookie`. Confirm login still works through the HTTPS route.

**Rollback.** `git revert`. Existing sessions survive (the secret is unchanged); only the flags
differ.

**Deliberately not done now:** the `tokenVersion` column for true revocation. It needs a
migration, and migrations are forward-only in this app — see §3.

---

### R4 · Login throttle + signup lockdown — **F-01, F-03**

**Problem.** Unlimited password guesses against a bare-password login that `bcrypt.compare`s
every user row. Also a CPU-exhaustion vector: ~40 req/s saturates libuv's 4-thread pool.

**Files.** `backend/package.json` (add `@fastify/rate-limit`), `backend/src/index.ts` (register),
`backend/src/auth.ts` (per-route limits + signup gate).

**Approach.**
- `@fastify/rate-limit` — global 300/min (matching Traefik's existing `ratelimit` middleware),
  with a tight bucket on `/api/auth/login` and `/api/auth/signup`: **5 attempts per 15 min per
  IP**, `ban` after repeated violation.
- `MACRODINGUS_ALLOW_SIGNUP` (default `false`). When false, `POST /api/auth/signup` returns
  `404` — not `403`, so the endpoint's existence isn't confirmed. Set `true` once, create the
  account, set it back.
- Keep the constant `"Incorrect password"` response already used — it correctly avoids
  distinguishing failure modes.

**Behavioural impact.** Sixth wrong password in 15 minutes is rejected without a bcrypt call
(also fixing the DoS). Signup unreachable in normal operation. `@fastify/rate-limit` is
in-memory — restarts reset counters, which is fine for one user and avoids adding Redis.

**Important:** behind Traefik every request carries CT100's Docker gateway IP unless
`trustProxy` is set. Fastify must be configured with `trustProxy: true` so the limiter keys on
the real client IP from `X-Forwarded-For`, or **one hostile client would lock out everyone**.
This is the single most likely thing to get subtly wrong in this plan.

**Test.** 6× wrong-password `curl` in a loop → 6th returns `429`. `POST /api/auth/signup` → `404`.
Then set `MACRODINGUS_ALLOW_SIGNUP=true`, confirm `201`, set it back. Verify the limiter keys on
the client IP by checking `X-Forwarded-For` handling in the reply headers.

**Rollback.** `git revert`, or set `MACRODINGUS_ALLOW_SIGNUP=true` and redeploy — no data change.

---

### R5 · Container least-privilege — **F-12**

**Problem.** Runs as root, no memory/CPU cap, no health check, full capability set.

**Files.** `Dockerfile` (add `USER node`, `chown` the app dir), `compose.yaml`.

**Approach.**
```yaml
security_opt: [ "no-new-privileges:true" ]
cap_drop: [ ALL ]
read_only: false          # SQLite WAL + photo writes need /app/data writable
deploy:
  resources:
    limits: { cpus: '0.5', memory: 256m }
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 20s
```
Plus `USER node` (uid 1000) in the runtime stage. The named volume is initialised with correct
ownership on first boot via a small entrypoint `chown` guarded to run only when needed.

**Behavioural impact.** Files in `data/` become uid 1000 rather than root — which also fixes the
inconvenience upstream documents at `CLAUDE.md:122`. Memory cap is generous: a Node + SQLite
process with `sharp` typically sits near 120 MB. **`sharp` is the one thing that could push past
256 MiB** under a large image decode; if the container OOMs during a label scan, raise to 384m —
this is the most likely tuning adjustment after deploy.

**Test.** `docker exec macrodingus id -u` → `1000`. `docker inspect` health → `healthy`. Upload a
photo and scan a label to exercise `sharp` under the cap.

**Rollback.** `git revert` and redeploy the previous image tag. If ownership breaks the volume,
`docker run --rm -v macrodingus_data:/d alpine chown -R 0:0 /d` restores the old state.

---

### R6 · Homelab compose stack + Traefik/Authentik wiring — **F-05, D-1..D-5**

**Problem.** No deployment exists; the app needs an access boundary and security headers.

**Files.** *(homelab repo)* new `docker/portainer/macrodingus.yml`.
**`docker/portainer/traefik.yml` is NOT touched** — headers ride on container labels.

**Approach — key labels:**
```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.macrodingus.rule=Host(`macros.${DOMAIN}`)
  - traefik.http.routers.macrodingus.entrypoints=web
  # Router-level, never entrypoint-level (gotcha #20). Order matters: bouncer first.
  - traefik.http.routers.macrodingus.middlewares=crowdsec-bouncer@docker,https-headers@docker,error-pages@docker,ratelimit@docker,authentik@docker,macrodingus-headers@docker
  - traefik.http.services.macrodingus.loadbalancer.server.port=3000
  - traefik.http.middlewares.macrodingus-headers.headers.frameDeny=true
  - traefik.http.middlewares.macrodingus-headers.headers.contentTypeNosniff=true
  - traefik.http.middlewares.macrodingus-headers.headers.referrerPolicy=strict-origin-when-cross-origin
networks: [ proxy ]          # proxy only — no observability, app exports no metrics
volumes: [ macrodingus_data:/app/data ]
# no `ports:` key at all
```
Plus, outside the repo: a new Authentik Proxy Provider + application gated on `homelab-admins`,
and a Cloudflare CNAME for `macros` → existing tunnel.

**Behavioural impact.** `https://macros.nyxcloud.com.au` redirects to Authentik when
unauthenticated; authenticated `homelab-admins` members reach the app's own login. Nothing
listens on any LAN interface.

**Test.** V-1 … V-5, V-13 from the review's verification plan.

**Rollback.** Delete the Portainer stack; remove the Authentik application + provider; delete the
Cloudflare record; revert the homelab PR. The volume survives deliberately.

---

### R7 · Alert allowlist — **D-9**

**Problem.** An unlisted container fires a **critical** `UnexpectedContainer` Discord alert within
2 minutes.

**Files.** *(homelab repo)* `docker/portainer/observability.yml` — add `|macrodingus` to the
`name!~` regex at line ~820.

**Behavioural impact.** None, beyond suppressing a false alarm.

**Test.** Regex parses (`promtool check rules`, or Prometheus reload without error). No
`UnexpectedContainer` firing 10 min post-deploy (**V-15**).

**Rollback.** `git revert` — a one-token regex change.

**⚠ Shared-infra change.** This edits the file holding *all* Prometheus alert rules. A malformed
regex could break rule evaluation fleet-wide. **Mitigation:** validate before merge, redeploy the
observability stack in a window where you can watch it, and confirm existing alerts still
evaluate. See §5.

---

### R8 · CI build → GHCR — **D-2**

**Problem.** No image exists, and `build:` on CT100 would put build load on the busiest guest and
give Renovate nothing to pin.

**Files.** *(fork)* new `.github/workflows/macrodingus.yml` — `workflow_dispatch` with a `version`
input, mirroring `nyx-pockets-v2.yml`.

**Behavioural impact.** Produces `ghcr.io/zriec1/macrodingus:<version>`.

**Test.** Run the workflow; confirm the package appears and CT100 can pull it.

**Rollback.** Delete the workflow; fall back to `build: .` on CT100 (which works there).

**Two known traps, both already documented in your CLAUDE.md:**
- **Never reuse a version tag** (gotcha #24) — a re-run silently overwrites the tag and Portainer
  has no signal the image moved underneath it.
- **GHCR package Actions-access** (memory `ghcr-package-actions-access-gotcha`) — a new repo's
  workflow has no write grant to the package until you add it under the package's *Manage Actions
  access* in the web UI. **This will fail on first run and it is not a bug.**

---

### R9 · Configuration hygiene — **F-08, F-09**

**Problem.** `ANTHROPIC_API_KEY` and `WEIGHT_SYNC_*` are exfiltration paths one typo away from
active; `APP_TIME_ZONE` defaults to Brisbane (no DST) and would drift day boundaries by an hour
for half the year.

**Files.** `compose.yaml` (drop `WEIGHT_SYNC_*` and `ANTHROPIC_API_KEY` entirely — an absent
variable is safer than an empty one), `.env.example` (placeholders only, never a real `.env`),
*(homelab)* `docker/portainer/macrodingus.yml` with `APP_TIME_ZONE=Australia/Sydney`.

**Behavioural impact.** Weight relay permanently off. AI features work only via the per-account
key entered in **More → AI features** — the better path anyway (file-backed, `0600`, validated,
never returned by any API, never sent to the browser).

**Test.** **V-11** — `docker exec macrodingus env | grep -E 'WEIGHT_SYNC|ANTHROPIC_API_KEY'`
returns nothing.

**Rollback.** Re-add the variables in Portainer. No code change needed.

---

### R10 · README + fork documentation — **F-15**

**Problem.** The README documents a Tailscale install that won't exist. `CLAUDE.md:9` points at
`/home/daddydingus/screenshots`. `AGENTS.md` and `CLAUDE.md` are near-duplicates that have
already drifted apart.

**Files.** `README.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`.

**Approach.** Rewrite the README's install / proxy-integration / HTTPS / access-restriction /
backup / upgrade / rollback / security-model sections. Replace the author's personal path. Keep
upstream's excellent architecture and gotcha notes with clear attribution — they're genuinely
valuable, and deleting them would be vandalism of someone else's good work.

**Test.** Follow the fresh-install steps literally on a scratch container; they must work with no
undocumented step.

**Rollback.** Documentation only.

---

# 2. Recommended before relying on the app for personal data

Not deployment blockers. **F-10 should be done within days, not weeks** — it is the highest
expected-cost item in the review because it needs no attacker.

| # | Change | Problem | Files | Test | Rollback |
|---|---|---|---|---|---|
| **R11** | **Tier-1 backup to R2** — `VACUUM INTO` + tar of `photos/`+`secrets/`, nightly 17:30 AEST, **with a minimum-archive-size assertion** | **F-10.** No backup at all. Naive tar of a live WAL database yields a torn copy. The size assert exists because the Actual Budget job produced a **1 673-byte** archive while `BackupStaleTier1` stayed green | *(homelab)* new `n8n-workflows/macrodingus-backup.json` | Run once manually; unpack the R2 object; open the SQLite copy read-only and count rows | Disable the n8n node |
| **R12** | Add `macrodingus` to `scripts/r2-backup-freshness.sh` `TARGETS` (line 63) | Backup failures otherwise silent | *(homelab)* `scripts/r2-backup-freshness.sh` | Run the script; confirm the Pushgateway series appears | Revert the one-line change |
| **R13** | **Restore rehearsal into a scratch instance** | An untested backup is a hypothesis | none — procedure only | Review §10.3; confirm logs/weights/photos present | n/a |
| **R14** | `Origin` header check on mutating methods | **F-07.** `SameSite=Lax` is the only CSRF control | `backend/src/auth.ts` (~10 lines in the existing `preHandler`) | Cross-origin `POST` → `403`; same-origin unaffected | `git revert` |
| **R15** | Redact query strings on `/api/foods*`; log `err.message` not the error object | **F-11.** Dietary search terms accumulate in Loki | `backend/src/index.ts` + `req.log.error` call sites | `docker logs \| grep 'q='` → no match after a search | `git revert` |
| **R16** | Delete the Anthropic key on account-data reset | **F-16.** A "clean slate" leaves a live billable key on disk | `backend/src/routes/account.ts` (one line) | Set a key, reset, confirm `secrets/anthropic/<id>` gone | `git revert` |
| **R17** | Cap `q` at 120 chars | **F-17.** Unbounded query builds a huge synchronous SQL statement | `backend/src/routes/foods.ts` | 10 000-char `q` → `400`, process stays responsive | `git revert` |
| **R18** | `npm audit fix` in `frontend/` (`brace-expansion`, `fast-uri` only) | **F-13.** Both non-breaking, both build-time-only | `frontend/package-lock.json` | `npm run build` succeeds; audit shows 2 remaining | Restore the lockfile |
| **R19** | Runbook + service catalog entries | Convention; an undocumented service is unmaintainable | *(homelab)* `docs/runbooks/macrodingus.md`, `docs/reference/services.md`, CLAUDE.md URL + secrets tables | Peer-read | Revert |
| **R20** | Bring the fork under Renovate | Ongoing dependency coverage | *(homelab)* `renovate.json` | Renovate opens a PR next cycle | Revert |

**Deliberately excluded from R18:** `react-router` (the RSC-mode CSRF advisory does not apply —
this is a plain SPA with no React Server Components, and the "fix" is a downgrade) and
`drizzle-kit` (devDependency, and `npm prune --omit=dev` in `Dockerfile:17` keeps it out of the
runtime image entirely).

---

# 3. Deferred until public or multi-user exposure

| Item | Finding | Why deferred | Trigger |
|---|---|---|---|
| `createdByUserId` on `foods` + write authz | **F-04** | Any account can currently rewrite any food, retroactively changing every historical log that references it. Harmless at one user | **A second account.** This is the hard gate |
| Per-user scoping of AI candidate foods | **F-18** | Two-line fix, zero impact at one user | Same |
| `tokenVersion` for true session revocation | **F-06** | Needs a migration, and migrations here are **forward-only** — every schema change permanently raises the cost of the rollback path in §10.5. Not worth it for one user with a break-glass secret rotation available | Multi-user, or a suspected compromise |
| Full CSP | **F-05** | Must be validated against the service worker and MediaPipe WASM (`wasm-unsafe-eval`). Headers deliver most of the value now | After a `Content-Security-Policy-Report-Only` run |
| `@fastify/csrf-protection` | **F-07** | R14's `Origin` check plus `SameSite=Lax` plus Authentik cover this. Token plumbing through every SPA mutation is real, permanent complexity | Public exposure |
| Test suite | **F-19** | Upstream has none. Tests in a fork you intend to rebase create permanent merge friction in every file they cover | Before substantial feature work of your own |
| Error boundary in `App.tsx` | **F-19** | Genuinely worth doing — `CLAUDE.md:88` records a blank-screen crash with nothing to catch it — but it's an upstream improvement, not a deployment blocker | Consider contributing upstream |
| Transactions around multi-step writes | **F-19** | Single-writer SQLite, one user | Multi-user |
| App `/metrics` + Grafana dashboard | — | Traefik access logs and container health already cover this | If it becomes load-bearing |

---

# 4. Explicitly rejected as unnecessary complexity

| Rejected | Why |
|---|---|
| Kubernetes, microservices, service mesh | One Node process and a SQLite file. Nothing here justifies an orchestrator |
| Postgres instead of SQLite | SQLite is the *correct* choice for one user. Migrating would add a container, a backup path, and a failure mode in exchange for nothing |
| Redis / external session store | Only needed for multi-instance session sharing. There is one instance |
| Job queue / worker | Every operation is request-scoped. AI calls are synchronous by design and the UI expects that |
| Second replica, load balancer, autoscaling | One user. A second replica would actively break SQLite's single-writer model |
| CDN | Cloudflare already fronts it. Static assets are a few hundred KB and the service worker caches them |
| Additional WAF beyond CrowdSec AppSec | Already deployed and already inspects this traffic |
| Rewriting auth to username+password or in-app OIDC | The genuinely "correct" fix, and still rejected: it is a real feature in the most rebase-sensitive file in the repo. Authentik + R4 achieves the security outcome at a fraction of the permanent maintenance cost |
| Encrypting Anthropic keys at rest | The decryption key would live on the same disk with the same permissions. Buys the appearance of security, not security |
| Per-request application audit log | Traefik access logs → Loki already cover the request layer for one user |
| Moving other homelab apps off CT106 | **Explicitly rejected.** CT106's published ports are a sound design given one Traefik and no overlay network; Phase 8g firewalls them. Concentrating services on CT100 would worsen blast radius and memory pressure. MacroDingus is a special case because *its own auth is weak*, not because CT106 is deficient |

---

# 5. Shared-infrastructure changes — blast radius and approval

Per your instruction, every change touching existing infrastructure, stated explicitly. **None of
these will be made without your go-ahead at the time.**

| Change | Blast radius | Mitigation | Rollback |
|---|---|---|---|
| **`observability.yml` allowlist regex** (R7) | Holds *all* Prometheus alert rules. A malformed regex could break rule evaluation fleet-wide | Validate before merge; redeploy while watching; confirm existing alerts still evaluate | `git revert` + redeploy. ~2 min |
| **New Authentik application + Proxy Provider** (R6) | Adding an application shouldn't affect others, but they share the embedded outpost. A bad outpost edit affects **every** gated service | Add only — change no existing provider, and do **not** touch outpost advanced settings (gotcha #10) | Delete the application + provider. Immediate |
| **Cloudflare DNS CNAME** (R6) | New hostname only | Zone-wide AU geo-block applies automatically (gotcha #40) | Delete the record |
| **`scripts/r2-backup-freshness.sh`** (R12) | Drives `BackupStaleTier1` for 8 existing targets. A syntax error breaks freshness monitoring for *all* of them | `bash -n` before commit; run manually; confirm all 9 series push | `git revert` |
| **New n8n workflow** (R11) | Additive. But n8n runs the other Tier-1 jobs — scheduled at 17:30, clear of the 16:00/17:00/17:15 jobs | Import via the **CLI recipe**, never the UI's Import-from-File (memory `n8n-workflow-git-sync`: UI import *merges* a duplicate copy — 12→24 nodes, two live triggers) | Disable the node |
| **CT100 resource use** | +256 MiB against 4.2 GiB available; inside CT100's existing 7168 MiB allocation, so **host overcommit is unchanged** | Hard memory limit; verified before/after with `free -h` | Stop the stack |

**Not touched:** `traefik.yml`, any firewall rule, any existing stack, any existing Authentik
provider, any Docker network definition, UniFi, or the Cloudflare tunnel configuration.

---

# 6. Commit sequence

| # | Commit | Repo |
|---|---|---|
| 1 | `chore: remove tailscale sidecar and config` (R1) | fork |
| 2 | `fix(security): block SSRF in recipe URL import` (R2) | fork |
| 3 | `fix(security): harden session cookie flags and lifetime` (R3) | fork |
| 4 | `feat(security): rate-limit auth routes and gate signup` (R4) | fork |
| 5 | `chore(docker): run as non-root with limits and a health check` (R5) | fork |
| 6 | `ci: build and publish to GHCR` (R8) | fork |
| 7 | `docs: rewrite README for homelab deployment` (R9, R10) | fork |
| 8 | `feat: add macrodingus stack, alert allowlist, backup + runbook` (R6, R7, R11, R12, R19) | homelab |

Commits 1–7 change nothing running. Commit 8 is the only one that touches live infrastructure,
and I will not open it without your say-so.

---

# 7. What remains unverifiable until it runs

Stated plainly rather than glossed:

1. **F-14 — the auth-prefix bypass — is still unproven.** Authorisation is decided by
   `req.raw.url.startsWith("/api/")` while routing is done separately by find-my-way. I reason
   the obvious candidates won't route, but **check V-6 is a gate, not a formality.** If any
   variant returns `200`, stop and escalate — that would be critical and would change this plan.
2. **Whether Authentik forward-auth breaks the PWA.** It broke the HA companion app and the
   Jellyfin iOS app. A browser-installed PWA uses the browser's cookie jar and should be fine,
   but the service worker's background update fetches against a `302` are untested. **This is the
   most likely thing to force a design change after first deploy** — and the reason R4 is
   required rather than recommended.
3. **Whether 256 MiB is enough under `sharp`.** Most likely tuning adjustment. Symptom: container
   OOM-kills during a label scan or photo upload. Fix: raise to 384m.
4. **Whether `trustProxy` is correctly configured for the rate limiter.** If wrong, every request
   appears to come from CT100's Docker gateway and one hostile client locks out everyone. Called
   out in R4 because it is the subtlest failure mode in this plan.
5. **No code has been executed.** Your workstation has no node, npm or Docker. Build,
   type-check and Docker build will run on a homelab host, as the dependency audit did.

---

# 8. Approval

Nothing proceeds without an explicit go-ahead. On approval I will implement **commits 1–7 only**
(fork, nothing running), run the build and type-check gates, and come back with results before
proposing commit 8 or any deployment.
