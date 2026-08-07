# MacroDingus — Security & Deployment Review

**Reviewer:** Claude (senior appsec / homelab operator / TypeScript review)
**Date:** 2026-08-07
**Upstream:** https://github.com/DaddyDingus/MacroDingus (public, ISC, default branch `master`)
**Baseline commit:** `8a6201af904c51a215b7840a23a8f44ce06c9ffb` (2026-08-06 22:37 +1000)
**Fork:** https://github.com/zriec1/MacroDingus
**Branch:** `homelab-hardening`
**Scope:** Full repository review prior to any code or infrastructure change. No application
code, compose file, or infrastructure has been modified. Nothing has been deployed.

---

## 1. Executive finding

**Yes, with conditions.**

The application is genuinely well built for what it is. Its data model is coherent, its
per-account authorisation is applied consistently and correctly across ten of eleven route
modules, and its most privacy-sensitive asset — the Anthropic API key — is handled better than
most self-hosted projects manage (file-backed at `0600` under a `0700` directory, validated
before persist, never returned by any API, never placed in the browser-readable settings blob).
Progress photos are stripped of EXIF/GPS on ingest. Outbound integrations are default-off.

It is **not** safe to run as-shipped, for three reasons that are structural rather than
cosmetic:

1. **Authentication is password-only with no username and no rate limiting.** `POST
   /api/auth/login` accepts a bare password and iterates every user row with `bcrypt.compare`
   until one matches (`backend/src/auth.ts:87-102`). The upstream author is explicit that
   "access control is at the network layer (Tailscale), not the app layer". Removing Tailscale
   without replacing that boundary removes the *only* real access control.
2. **Server-Side Request Forgery in recipe import.** An authenticated user can make the
   container issue arbitrary `GET` requests to any internal address, follow redirects, and read
   back status codes (`backend/src/engine/recipeImport.ts:101-137`). The container would sit on
   the same Docker `proxy` network as Traefik, Authentik and Portainer.
3. **No security headers, no CSRF defence beyond `SameSite=Lax`, no rate limiting, and the
   container runs as root.** There is no CSP, no `X-Frame-Options`, no `X-Content-Type-Options`
   anywhere in the app or its Dockerfile.

All three are fixable with small, auditable changes, and the existing homelab already supplies
most of the missing controls (Authentik, CrowdSec, Traefik rate-limiting, per-guest firewall).
The conditions are enumerated in §7 (MVP hardening checklist). **My assessment is that with the
§7 items done, this is appropriate for a single-user private homelab deployment behind
Authentik.** It is not appropriate for public internet exposure, and it should not be
multi-user until the shared-food-library authorisation gap (F-04) is addressed.

---

## 2. Environment alignment

This section reconciles MacroDingus against the established `zriec1/homelab` operating model.
Facts below were verified against the repo **and** the live environment (read-only) on
2026-08-07, not assumed from documentation.

### 2.1 Existing conventions (verified)

| Layer | Established convention | Evidence |
|---|---|---|
| **Reverse proxy** | Traefik on CT100 (`192.168.20.50`), entrypoint `web:80`. CT100-resident services use **Docker labels**; services on other guests use **file-based routers** in `docker/portainer/traefik.yml` targeting `http://<guest-ip>:<port>`. | `docker/portainer/traefik.yml`; live `docker ps` on CT100 shows `traefik 0.0.0.0:80->80/tcp` |
| **Public edge** | Cloudflare → Cloudflare Tunnel (`cloudflared` on CT100) → Traefik :80. TLS terminates at Cloudflare; the tunnel leg is the HTTPS boundary. Zone geo-blocks all non-AU traffic at the edge (gotcha #40). | `traefik.yml` deployment notes: "all public hostnames should point to `http://192.168.20.50:80`" |
| **Docker networks (CT100)** | `proxy` (external, `172.27.0.0/16`) shared by Traefik and everything it routes to; `observability` for Prometheus scrape targets; per-stack `*_default` for databases. | live `docker network inspect proxy` |
| **Identity / access control** | Authentik forward-auth via `authentik@docker` middleware, applied **at router level** (never entrypoint level — gotcha #20). Group gate `homelab-admins`. Custom apps may instead self-authenticate via Authentik OIDC (R-033 pattern: nyx-patch, nyx-pockets-v2). | `traefik.yml:144-147`; CLAUDE.md External subdomain URLs table |
| **Shared middlewares** | Every router gets `https-headers@docker`, `error-pages@docker`, `crowdsec-bouncer@docker`; plus `authentik@docker` / `ratelimit@docker` as needed. Per-app response headers follow the `nyx-pockets-security-headers@file` pattern. | `traefik.yml:103-157`, `:510-520` |
| **Secrets** | Never in the repo. Portainer stack environment variables per endpoint, with a `0600` reference copy at `/home/zac/<app>-portainer.env` on CT100. Documented in the CLAUDE.md secrets table. | CLAUDE.md "Secrets Management" |
| **Deployment** | Portainer git-stack pointed at this repo, GitOps polling on. Compose `build:` works **only on CT100** (agent endpoints break BuildKit over the tunnel) — custom apps normally build in GitHub Actions and publish to `ghcr.io/zriec1/*`. | memory `gitops-ghcr-facts`; `docker/apps/nyx-pockets-v2.yml` header |
| **Image policy** | Never `latest`. Explicit pins. Renovate opens bump PRs; Watchtower is monitor-only on all hosts. Locally-built/registry-less images need **both** `com.centurylinklabs.watchtower.enable=false` **and** `wud.watch=false` (gotcha #36). | CLAUDE.md "Image versioning", gotcha #36 |
| **Backups** | Tier 1 = nightly n8n job → Cloudflare R2, 14-day rolling. SQLite services use `VACUUM INTO` (nyx-pockets v1); volume-based services tar the volume over SSH (nyx-dash). Freshness is monitored separately by `scripts/r2-backup-freshness.sh` → Pushgateway → `BackupStaleTier1`. | CLAUDE.md "Backup Strategy"; `n8n-workflows/nyx-dash-backup.json`; `scripts/r2-backup-freshness.sh:63` |
| **Monitoring** | Prometheus + Grafana + Loki + Alertmanager on CT100 `observability` network. **Any new container must be added to the `UnexpectedContainer` alert allowlist or it fires a critical Discord alert within 2 minutes.** | `docker/portainer/observability.yml:816-826` |
| **Guest firewall** | Proxmox per-guest default-deny at the NIC (Phase 8g). Services on non-CT100 guests need an explicit CT100-source allow rule in `/etc/pve/firewall/<vmid>.fw`. Symptom if forgotten: Traefik 504. | CLAUDE.md checklist step 6; `docs/runbooks/proxmox-firewall.md` |
| **Least privilege** | Current best-practice exemplar sets `security_opt: no-new-privileges:true`, `cap_drop: ALL`, and `deploy.resources.limits` (cpu + memory). | `docker/apps/nyx-pockets-v2.yml` |

### 2.2 Verified live capacity (2026-08-07)

| Host | Physical | Available | Disk free | Note |
|---|---|---|---|---|
| Proxmox | 31 GiB | 9.7 GiB | — | 9.3 GiB of 15 GiB swap in use |
| CT100 | 7.0 GiB | **4.2 GiB** | 50 G | 34 containers running |
| CT106 | 4.0 GiB | 3.0 GiB | 17 G | 14 containers running |

Sum of configured guest memory is **37 GiB against 31 GiB physical (~122% overcommit)** —
worse than the ~112% recorded in CLAUDE.md gotcha #32. A 256 MiB-limited container fits inside
CT100's existing 7168 MiB allocation and therefore **does not change host overcommit at all**;
no Proxmox memory change is proposed.

> ⚠️ **Documentation drift found (homelab repo, not this one — reported, not changed):**
> CLAUDE.md's Quick Reference table lists CT100 as 5 GB and CT106 as 6 GB. Live values are
> **CT100 = 7.0 GiB, CT106 = 4.0 GiB** — the table was not updated after the 2026-07-27/28
> right-sizing. Worth a one-line fix in the homelab repo; I have not touched it.

### 2.3 Proposed integration — host choice

**Recommendation: deploy on CT100, not CT106.** This is a deliberate, reasoned divergence from
the "CT106 = personal apps" convention, and it is the single decision I most want signed off.

| | **CT100 (recommended)** | CT106 (convention) |
|---|---|---|
| Port `3000` published to host | **No** — container joins `proxy`, Traefik reaches it by container DNS | **Yes, unavoidably** — Traefik lives on another host and must reach it over the LAN (`8098:3000` is exactly what nyx-pockets-v2 does) |
| Traefik wiring | Docker labels (native to the app's own compose) | File-based router + Proxmox firewall rule |
| Compose `build:` | Works | Broken (BuildKit over agent tunnel) — would force a GHCR pipeline first |
| Memory headroom | 4.2 GiB available | 3.0 GiB available |
| Matches app's upstream design | Yes — upstream compose already declares `networks: proxy: external: true` | No |

Your brief states as a hard constraint: *"do not publish the application port to the host"* and
*"join the existing approved proxy network"*. On CT106 that is **not achievable** — every CT106
app is reachable on a LAN port by design, restrained only by the Proxmox NIC firewall. On CT100
it is achievable exactly and with zero custom plumbing, because the app's own compose file was
already written for that topology.

**Divergence:** MacroDingus becomes a personal app living on CT100 rather than CT106.
**Risk introduced:** CT100 is the busiest, most security-critical guest (Traefik, Authentik,
CrowdSec, Portainer, n8n). A compromised MacroDingus container would sit on the `proxy` network
alongside them — which is precisely why F-02 (SSRF) is rated High and is a
**required-before-deployment** fix rather than a deferred one.
**Mitigation:** `cap_drop: ALL`, `no-new-privileges`, non-root user, memory/CPU limits, SSRF
allow-listing, and *not* joining the `observability` network (the app exports no metrics, so it
has no reason to).
**Rollback:** the stack is self-contained — delete the Portainer stack, remove the Cloudflare
DNS record, remove the Authentik application/provider. No shared config is mutated.

If you would rather keep the CT106 convention and accept a LAN-published port, say so and I
will re-plan around a file-based Traefik router plus a `/etc/pve/firewall/106.fw` rule. **I am
not proceeding with either until you choose.**

### 2.4 Complete resource inventory (proposed)

Nothing in this table exists yet. Every item is a proposal requiring your approval.

| Item | Value | Notes |
|---|---|---|
| Host | CT100 `192.168.20.50` | Portainer endpoint "local" |
| Stack file | `docker/portainer/macrodingus.yml` *(in homelab repo)* | Portainer git-stack, GitOps polling on |
| Container name | `macrodingus` | Must be added to `UnexpectedContainer` allowlist **in the same PR** |
| Image | `ghcr.io/zriec1/macrodingus:<pinned>` **or** local `build:` | See §9 decision D-2 |
| Host-published ports | **none** | Verified post-deploy per §11 |
| Container port | `3000` (internal only, reached as `macrodingus:3000`) | |
| Docker networks | `proxy` only | **Not** `observability` — app exposes no metrics |
| Named volume | `macrodingus_data` → `/app/data` | SQLite + WAL, `photos/`, `.cookie-secret`, `secrets/anthropic/` |
| Host path | none (named volume, per nyx-dash convention) | Backed up via SSH tar + `VACUUM INTO`, §10 |
| External URL | `https://macros.nyxcloud.com.au` | Name TBC — your call |
| DNS | Cloudflare CNAME → existing tunnel | New public hostname mapped to `http://192.168.20.50:80` |
| Traefik router | `macrodingus` — `Host(macros.${DOMAIN})`, entrypoint `web` | |
| Router middlewares | `https-headers@docker`, `error-pages@docker`, `crowdsec-bouncer@docker`, `ratelimit@docker`, `authentik@docker` | Router-level, never entrypoint-level (gotcha #20) |
| Authentik | New Proxy Provider + application, group gate `homelab-admins` | Forward-auth, matching the Nyx Patch/Pockets access posture |
| Portainer env vars | `DOMAIN`, `APP_TIME_ZONE`, `MACRODINGUS_COOKIE_SECRET` | Reference copy `/home/zac/macrodingus-portainer.env` (0600) |
| Deliberately unset | `ANTHROPIC_API_KEY`, `WEIGHT_SYNC_RELAY_URL`, `WEIGHT_SYNC_USER_NAME`, `TS_AUTHKEY` | See F-08, F-09 |
| Backup target | `macrodingus` added to `scripts/r2-backup-freshness.sh:63` `TARGETS` | Plus an n8n node modelled on `nyx-dash-backup.json` |
| Firewall | **No change** — CT100 needs no per-guest rule for a non-published port | |

### 2.5 Confirmation of non-exposure

Under this design, at the point of deployment:

- **No host port is published.** The compose file will contain no `ports:` key at all. Verified
  post-deploy by `docker ps` and `ss -ltnp` (§11 checks V-1/V-2).
- **The backend is not directly reachable from the LAN.** The only path is
  `proxy` network → Traefik → router → middleware chain.
- **HTTPS is preserved end-to-end at the public edge.** Cloudflare terminates TLS; the tunnel
  carries traffic to Traefik. The app never sees plain HTTP from outside.
- **Access is gated by Authentik** before any request reaches the app, plus the zone's existing
  AU-only geo-block and the CrowdSec bouncer.
- **Camera/photo/AI features are HTTPS-gated** because the only reachable origin is HTTPS
  (browser secure-context requirement is satisfied by the public URL, not by the app).

### 2.6 Restore procedure for this application's persistent data

Full procedure with commands in §10. Summary: everything that matters lives in the single
`macrodingus_data` volume — SQLite database, photos, cookie-signing secret, and per-account
Anthropic keys. Restore = stop container → replace volume contents from the R2 archive → start
container. Migrations are idempotent and run on boot.

---

## 3. Architecture summary

### 3.1 Runtime

Single Node 24 process (Fastify 5) serving both the API and the built React SPA from one
container on port 3000. SQLite via `better-sqlite3` in WAL mode, Drizzle ORM, migrations run
automatically at startup (`backend/src/index.ts:33`). No separate database, cache, queue or
worker. Frontend is a Vite/React 18 PWA with a Workbox service worker and TanStack Query
persisted to IndexedDB.

This is an appropriate architecture for one user and should not be complicated.

### 3.2 Trust boundaries

```
 ┌─ Internet ──────────────────────────────────────────────────────────┐
 │  Cloudflare edge:  TLS termination · AU-only geo-block · WAF        │
 └──────────────────────────────┬──────────────────────────────────────┘
                                │  Cloudflare Tunnel (outbound-only)
 ┌─ CT100 (192.168.20.50) ──────┴──────────────────────────────────────┐
 │  cloudflared ──► Traefik :80                                        │
 │                    │  crowdsec-bouncer · ratelimit · https-headers  │
 │                    │  ► authentik@docker  ◄── TRUST BOUNDARY 1      │
 │                    ▼            (identity established here)         │
 │        ┌───────── proxy network (172.27.0.0/16) ─────────┐          │
 │        │  macrodingus:3000                               │          │
 │        │    ├─ app session cookie  ◄── TRUST BOUNDARY 2  │          │
 │        │    └─ req.userId → per-row scoping ◄─ BOUNDARY 3│          │
 │        │  traefik · authentik-server · nyx-patch · …     │          │
 │        └─────────────────────────────────────────────────┘          │
 │                    │ named volume                                   │
 │              macrodingus_data ── SQLite · photos · secrets          │
 └─────────────────────────────────────────────────────────────────────┘
                     │ outbound (egress, unrestricted today)
                     ▼
      api.anthropic.com · world.openfoodfacts.org · ANY URL (F-02)
```

**Boundary 1 — Authentik forward-auth.** Proposed; does not exist upstream. This becomes the
primary access control, replacing Tailscale.

**Boundary 2 — application session.** Signed `mt_session` cookie, `userId.expiryMs`, HMAC via
`@fastify/cookie`. Stateless: no server-side session store, therefore **no revocation**.

**Boundary 3 — per-row authorisation.** `req.userId` set by a single `preHandler` hook
(`backend/src/auth.ts:117-127`) and applied per query. Correct in ten of eleven route modules;
`foods` is the exception (shared by design — F-04).

### 3.3 Data flows

| Flow | Direction | Data | Trigger |
|---|---|---|---|
| Logging / weights / photos | Browser → app → SQLite/disk | Full dietary + body-composition history, progress photos | User action |
| OpenFoodFacts search | App → `world.openfoodfacts.org` | Search terms, barcodes | Debounced search / barcode scan |
| Anthropic (label scan, describe meal, recipe import, photo compare, check-in narrative) | App → `api.anthropic.com` | Label photos, plate photos, **progress photos**, meal text, page text, candidate food names | Opt-in, only if a key is configured |
| Recipe import fetch | App → **arbitrary URL** | — | User-supplied URL (**F-02**) |
| Weight sync relay | App → arbitrary URL | Full weight history | Only if both env vars set (**default off**) |

**Note on AI privacy:** progress photos — the most sensitive asset in the app — are transmitted
to Anthropic when photo comparison is used. `engine/photoCompare.ts` deliberately withholds
weight/scale numbers, which is thoughtful, but the images themselves leave the network. This is
inherent to the feature, disclosed in the README, and entirely opt-in. Not a defect; worth
knowing before enabling.

### 3.4 What is persisted in `data/`

| Path | Contents | Sensitivity |
|---|---|---|
| `macrotrack.sqlite` (+ `-wal`, `-shm`) | Users, bcrypt hashes, logs, weights, measurements, goals, programs, check-ins, recipes, settings, search stats | **High** |
| `photos/<userId>/<uuid>.jpg` | Progress photos, EXIF/GPS stripped, max 1600px | **High** |
| `.cookie-secret` | 32-byte hex HMAC key, mode `0600` | **Critical** — forges any session |
| `secrets/anthropic/<userId>` | Plaintext Anthropic API key, mode `0600` in `0700` dir | **Critical** — billable credential |

Every backup of this directory is a credential store. It must be treated as such.

---

## 4. Deployment assessment — removing Tailscale

### 4.1 What Tailscale currently provides

The sidecar (`compose.yaml:32-55`) provides *all three* of: HTTPS certificate + termination, a
routable hostname, and **the app's entire access control**. The README is unambiguous: *"Network
access is the primary security boundary. Anyone who can reach the app can use the self-service
signup screen."*

Deleting the sidecar without replacing item three would leave a self-service signup page whose
only protection is a shared password with no rate limit. **The Tailscale removal and the
Authentik gate are one atomic change, not two.**

### 4.2 Required changes

| # | Change | Why |
|---|---|---|
| D-1 | Delete the `macrotrack-tailscale` service, `tailscale-config/serve.json`, `tailscale-state/` from `.gitignore`/`.dockerignore`, and `TS_*` from `.env.example` | Not used; carries `NET_ADMIN`, `NET_RAW`, `/dev/net/tun` |
| D-2 | Front the app with the existing Traefik + **Authentik forward-auth** on CT100 | Restores the access boundary Tailscale provided |
| D-3 | Join `proxy`; publish **no** host ports | Brief constraint; also the app's native topology |
| D-4 | Add `healthcheck` against `/api/health` | Compose/Portainer convention; enables `depends_on` and honest `docker ps` status |
| D-5 | Add `security_opt: no-new-privileges`, `cap_drop: ALL`, `deploy.resources.limits` | nyx-pockets-v2 least-privilege convention |
| D-6 | Run as non-root (`USER node` + volume ownership) | Dockerfile sets no `USER`; CLAUDE.md even documents the symptom ("the `.sqlite` file is root-owned from inside the container") |
| D-7 | Named volume `macrodingus_data`, not `./data` bind mount | nyx-dash convention; survives stack recreation; simplifies non-root ownership |
| D-8 | Set `MACRODINGUS_COOKIE_SECRET` explicitly | Makes the session key a managed secret rather than a file auto-generated on first boot (see F-06) |
| D-9 | Add `macrodingus` to the `UnexpectedContainer` allowlist **in the same PR** | Otherwise a critical Discord alert fires within 2 minutes |
| D-10 | Add `wud.watch=false` + `com.centurylinklabs.watchtower.enable=false` if built locally | Gotcha #36 — otherwise WUD 401-spams Docker Hub every poll |

### 4.3 Conflicts between upstream guidance and this brief

Called out explicitly, as required:

| Upstream says | This brief says | Resolution |
|---|---|---|
| README: "Copy `.env.example` to `.env` and add a fresh `TS_AUTHKEY`" | No Tailscale | Ignore; remove the sidecar entirely |
| README: "point your proxy at the `macrotrack` service on port 3000" | Don't publish 3000 | Compatible — Docker-network DNS, no host publish |
| `CLAUDE.md:43`: "Access control is at the network layer (Tailscale), not the app layer" | App must be restricted via existing access-control layer | Authentik forward-auth replaces it. **The app's own auth remains too weak to stand alone** — this is the crux of the review |
| `CLAUDE.md:9`: "inspect the newest file in `/home/daddydingus/screenshots`" | — | Upstream author's personal path. Must be removed from the fork's agent instructions |
| `CLAUDE.md:27`: "No lint script or test suite — don't invent one" | Brief asks for tests/lint/type-check | Genuine conflict. Type-check + build exist and will be used. I recommend **not** importing a full test framework for a single-user fork, but adding a small smoke-test script (§8, deferred item) |
| README: "there is no ... login rate limiting" (stated as fact, not intent) | Rate limiting where exposure warrants | Traefik `ratelimit@docker` provides an edge control; app-level login throttling still recommended (F-03) |
| Compose default `APP_TIME_ZONE=Australia/Brisbane` | — | Should be `Australia/Sydney` for this household — Brisbane has no DST, so day boundaries would drift by an hour for ~half the year |

---

## 5. Threat model

### 5.1 Assets

| Asset | Value |
|---|---|
| Dietary + body-composition history | High — health data, long retention, not replaceable |
| Progress photos | **Highest** — body imagery |
| `.cookie-secret` | Critical — forges any session indefinitely |
| Anthropic API key(s) | Critical — billable, exfiltratable |
| Account password hashes (bcrypt cost 10) | High |
| The CT100 `proxy` network position | **Critical** — adjacency to Traefik, Authentik, Portainer, n8n |

### 5.2 Actors

| Actor | Capability | Relevance |
|---|---|---|
| Internet scanner / opportunistic attacker | Unauthenticated HTTPS requests | Blocked by Cloudflare geo-block + Authentik + CrowdSec |
| Authenticated Authentik user outside `homelab-admins` | — | Blocked by group policy |
| Malicious/compromised browser session (XSS, stolen cookie) | Full app privileges as that user | **No session revocation exists** (F-06) |
| Malicious website the user visits | Cross-site requests | `SameSite=Lax` blocks cross-site POST; no CSRF token behind it (F-07) |
| Compromised third party (OpenFoodFacts, a recipe site, Anthropic) | Returns hostile content | Content is parsed/LLM-processed, not executed; some data-integrity risk |
| Second household member (future) | Authenticated app user | **Can edit/delete any food in the shared library, including another user's recipes** (F-04) |

### 5.3 Entry points

`https://macros.nyxcloud.com.au/*` (all API + SPA), the recipe-import URL field (**F-02**), file
uploads to `/api/photos`, `/api/foods/scan-label`, `/api/foods/describe-meal` (sharp/libvips
decode of untrusted images), and `/api/foods/barcode/:barcode` (outbound to OpenFoodFacts).

### 5.4 Threats and mitigations

| # | Threat | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| T1 | Credential brute force against password-only login | Medium (low behind Authentik) | Full account takeover | Authentik gate; CrowdSec; app-level login throttle (F-03) | **Accepted-low** once gated |
| T2 | SSRF pivot from the app into the homelab | Low (needs auth) | **High** — `proxy` network adjacency | Deny-list private ranges + no-redirect (F-02) | Low after fix |
| T3 | Session cookie theft → 30 days of undetectable access | Low | High | `Secure` flag; shorter TTL; revocation (F-06) | Medium — full revocation is deferred |
| T4 | Cross-account data tampering via shared food library | **Certain if multi-user** | Medium (silent nutrition corruption) | Single-user for now; F-04 before adding a second account | **Accepted** while single-user |
| T5 | XSS → session theft | Low (React escapes by default; no `dangerouslySetInnerHTML` found) | High | CSP at Traefik (F-05) | Low |
| T6 | Clickjacking | Low | Medium | `frameDeny` (F-05) | Negligible |
| T7 | Malicious image → libvips RCE/DoS | Low | High | Keep `sharp` current; 20 MB cap; memory limit; non-root | Low |
| T8 | Anthropic key exfiltration via `data/` backup | Low | High (billable) | Treat backups as secret; R2 is private | Accepted |
| T9 | Data loss (torn SQLite copy, disk failure) | Medium | **High** — irreplaceable history | `VACUUM INTO` backup + R2 + freshness alert (F-10) | Low after fix |
| T10 | Log-based disclosure of dietary search terms | Medium | Low | Query-string redaction (F-11) | Accepted-low |

### 5.5 Accepted residual risks

1. **The shared food library remains globally writable by any authenticated account.** Correct
   for one user; must be revisited before a second account exists.
2. **Sessions cannot be revoked server-side without rotating `.cookie-secret`** (which logs
   everyone out). Acceptable at one user; the rotation procedure is documented in §10.
3. **Progress photos and meal photos leave the network when AI features are used.** Inherent,
   opt-in, disclosed.
4. **Anthropic keys are stored plaintext-at-rest** (file, `0600`). Encrypting them would require
   a key that also lives on the same disk; this buys little. Accepted.
5. **No app-level audit log.** Traefik access logs + Loki cover the request layer. Acceptable.

---

## 6. Findings register

Severity reflects **this deployment** (single user, behind Authentik, on CT100). Where the
rating would differ for a public or multi-user deployment, that is stated.

---

### F-01 · Password-only authentication with no rate limiting — **HIGH**
*(Critical if ever exposed without a proxy gate)*

**Files:** `backend/src/auth.ts:87-102`, `backend/src/auth.ts:52-55`

**Evidence:**
```ts
app.post("/api/auth/login", async (req, reply) => {
  const body = req.body as { password?: string };
  if (!body?.password) { reply.code(401); return { error: "Incorrect password" }; }
  const allUsers = await db.select().from(users);
  for (const user of allUsers) {
    if (await bcrypt.compare(body.password, user.passwordHash)) {
      signSession(reply, user.id);
      return { ok: true, user: { id: user.id, name: user.name } };
    }
  }
```

**Impact.** Four distinct problems in nine lines:
1. **No username.** The credential is a bare password. There is no identity claim to verify
   against, so an attacker needs only to guess *any* password held by *any* account — the search
   space weakens linearly with each account added.
2. **No rate limiting, lockout, or backoff.** Nothing in the app or the upstream compose
   throttles attempts. The README states this plainly as a known property.
3. **Password collision = account confusion.** If two accounts ever share a password, the first
   matching row wins. The user silently logs into someone else's account.
4. **CPU amplification / DoS.** Every attempt runs `bcrypt.compare` (cost 10, ~100 ms) against
   *every* user row, on libuv's 4-thread pool. Roughly 40 req/s exhausts it and stalls the whole
   process — including legitimate requests.

Also: `signupSchema` enforces only `min(8)` with no complexity or breach check
(`backend/src/auth.ts:52-55`).

**Remediation.** Do not attempt to rewrite the auth model. Instead:
- **Put Authentik forward-auth in front of it** (this is the real fix — it moves the boundary to
  a mature IdP with MFA, exactly as Nyx Patch and Nyx Pockets do).
- Add a small in-process login throttle: fixed delay + attempt cap per source IP.
- Set a long, high-entropy password on the single account, stored in 1Password.
- Consider disabling `POST /api/auth/signup` after the first account is created.

**Required before deployment: YES** (the Authentik gate and signup lockdown; the throttle is
strongly recommended and cheap).

---

### F-02 · Server-Side Request Forgery in recipe import — **HIGH**

**Files:** `backend/src/engine/recipeImport.ts:101-137`, `backend/src/routes/recipes.ts:108-124`

**Evidence:**
```ts
if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
  throw new Error("Only http/https links are supported");
}
...
res = await fetch(parsed.toString(), { signal: controller.signal, redirect: "follow", ... });
...
if (!res.ok) throw new Error(`That link returned an error (${res.status})`);
```
The **only** validation is the protocol. There is no check on hostname, resolved IP, or port.

**Impact.** An authenticated user (or anyone who has taken over the single session) can make the
container issue arbitrary `GET` requests from inside the `proxy` network and learn the outcome:

- `http://127.0.0.1:3000/`, `http://traefik:8082/metrics`, `http://authentik-server:9000/…`,
  `http://192.168.20.50:9000/api/…` (Portainer), `http://socket-proxy:2375/…` — all reachable.
- The distinct error strings (`"Couldn't reach that link"` vs `"That link returned an error
  (403)"`) turn this into a **blind port and host scanner** for the whole LAN.
- Fetched page text is sent to Anthropic and the structured extraction is returned to the
  caller, so it is a partial **content exfiltration** channel, not merely blind.
- `redirect: "follow"` means an allow-list on the *initial* hostname alone is insufficient — a
  public URL can 302 to `http://169.254.169.254/` or an internal host.

This is the finding that most concerns me about placing the container on CT100's `proxy`
network, and it is why I rate it High despite requiring authentication.

**Remediation.** In `fetchPageText`:
1. Resolve the hostname and reject any address in a private/loopback/link-local/CGNAT/multicast
   range (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `100.64/10`, `::1`, `fc00::/7`,
   `fe80::/10`), including IPv4-mapped IPv6.
2. Set `redirect: "manual"` and re-validate each hop (cap at ~3), closing the DNS-rebinding and
   redirect bypasses.
3. Restrict to ports 80/443.
4. Collapse the error messages to one generic string so the scanner signal disappears.
5. Cap the response body size (currently the whole body is read before slicing to 40 000 chars).

**Required before deployment: YES.**

---

### F-03 · No rate limiting anywhere in the application — **MEDIUM**

**Files:** `backend/package.json` (no `@fastify/rate-limit`), `backend/src/index.ts:35-54`

**Evidence.** Dependency list contains no rate-limiting plugin; no manual throttle exists.
Unauthenticated `POST /api/auth/login` and `POST /api/auth/signup` are wide open, as are the
AI endpoints (each of which costs real money per call) and the OpenFoodFacts proxy
(`/api/foods/remote` — reputational risk for the homelab's egress IP if abused).

**Impact.** Brute force (F-01), CPU exhaustion, unbounded Anthropic spend, and third-party abuse.

**Remediation.** Two layers, both cheap:
- Traefik `ratelimit@docker` on the router (already exists: 300/min average, 200 burst) — a blunt
  but free edge control.
- `@fastify/rate-limit` with a tight bucket on `/api/auth/*` and a modest one on the AI routes.

**Required before deployment:** Traefik middleware **YES**; app-level plugin recommended.

---

### F-04 · Shared food library has no authorisation on write or delete — **MEDIUM**
*(Low while single-user; High the moment a second account exists)*

**Files:** `backend/src/routes/foods.ts:420-458`

**Evidence:**
```ts
app.patch("/api/foods/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const parsed = foodInput.partial().safeParse(req.body);
  ...
  await db.update(foods).set({ ... }).where(eq(foods.id, id));   // ← no userId, no ownership check
```
`DELETE /api/foods/:id` (line 444) is likewise unscoped. The `foods` table has no `userId`
column at all (`backend/src/db/schema.ts`), by documented design.

**Impact.** Any authenticated account can rewrite or hide **any** food row, including the
materialised `foods` row backing another user's recipe. Because nutrition is computed live and
never snapshotted onto log entries (documented in `CLAUDE.md:124`), a single PATCH silently and
**retroactively** rewrites the nutrition of every historical log entry referencing that food,
for every user. There is no audit trail and no undo.

Note this also *bypasses* the ownership check that `PATCH /api/recipes/:id` correctly performs —
`/api/foods/:id` reaches the same underlying row without it.

**Remediation (only when a second account is added).** Add `createdByUserId` to `foods`;
restrict PATCH/DELETE to the creator for `source IN ('custom','recipe')`; leave `afcd`/
`openfoodfacts` rows editable by all or by nobody. Requires a migration.

**Required before deployment: NO** (single-user). **Required before adding a second account: YES.**

---

### F-05 · No security headers, no CSP — **MEDIUM**

**Files:** `backend/src/index.ts` (no `@fastify/helmet`), `frontend/index.html`, `traefik.yml`

**Evidence.** A repository-wide search for `content-security-policy|helmet|x-frame-options|
frame-ancestors|x-content-type` returns nothing in `backend/src`, `frontend/index.html`, or
`vite.config.ts`. The shared `https-headers@docker` middleware sets **HSTS only**
(`traefik.yml:103-107`).

**Impact.** No CSP means an XSS anywhere becomes full session compromise with no second barrier.
No `X-Frame-Options`/`frame-ancestors` permits clickjacking. No `X-Content-Type-Options` permits
MIME sniffing on user-uploaded content served from `/api/photos/:id/file`.

Mitigating context: React escapes by default and I found no `dangerouslySetInnerHTML` in the
frontend, so there is no *known* XSS today. This is defence-in-depth, not an active exploit.

**Remediation.** Follow the established `nyx-pockets-security-headers@file` convention — add a
`macrodingus-security-headers` middleware with `frameDeny`, `contentTypeNosniff`,
`referrerPolicy: strict-origin-when-cross-origin`. Add a CSP once verified against the PWA
(`'self'` plus whatever the service worker and MediaPipe WASM require — note
`frontend/public/mediapipe/wasm/` needs `wasm-unsafe-eval`).

**Required before deployment:** headers **YES**; full CSP recommended, may follow.

---

### F-06 · Sessions are unrevocable and the cookie lacks `Secure` — **MEDIUM**

**Files:** `backend/src/auth.ts:29-37`, `:104-107`, `backend/src/routes/account.ts:45-63`

**Evidence:**
```ts
reply.setCookie(COOKIE_NAME, `${userId}.${Date.now() + SESSION_MS}`, {
  path: "/", httpOnly: true, sameSite: "lax", signed: true, maxAge: SESSION_MS / 1000,
});                                        // ← no `secure: true`
```
`SESSION_MS` is 30 days. Logout only calls `reply.clearCookie` — a client-side action. There is
no session table, no token version, and `PATCH /api/account/password` updates the hash without
invalidating anything.

**Impact.**
- A stolen cookie is valid for up to 30 days and **cannot be revoked**, even by changing the
  password. The only remedy is deleting `.cookie-secret`, which invalidates every session.
- Missing `Secure` allows the cookie over plain HTTP. Largely academic here (the only reachable
  origin is HTTPS), but it is one proxy misconfiguration away from mattering, and it costs
  nothing to set.

**Remediation.** Add `secure: true`; reduce `SESSION_MS` to ~7 days; add a `tokenVersion` integer
on `users`, embed it in the cookie, and bump it on password change (small, no new dependency).
Set `MACRODINGUS_COOKIE_SECRET` from Portainer so rotation is a stack variable change rather
than a file deletion.

**Required before deployment:** `secure: true` + managed secret **YES**; `tokenVersion`
recommended.

---

### F-07 · CSRF defence relies solely on `SameSite=Lax` — **LOW**

**Files:** `backend/src/auth.ts:29-37`

**Evidence.** No CSRF token, no `Origin`/`Referer` validation. `sameSite: "lax"` is the only
control.

**Impact.** `Lax` does block cross-site `POST`/`PATCH`/`DELETE` in all current browsers, so this
is genuinely mitigated for state-changing requests. Residual exposure is limited to any
state-changing `GET` (I found none) and to browsers/webviews with weaker `SameSite` handling.
Authentik in front adds a further barrier: a cross-site request without an Authentik session is
rejected at the proxy.

**Remediation.** Add `Origin` header validation on mutating methods — ~10 lines in the existing
`preHandler`, no new dependency. Prefer this over `@fastify/csrf-protection`, which would require
token plumbing through every mutation in the SPA for little extra benefit.

**Required before deployment: NO.** Recommended.

---

### F-08 · Weight-sync relay is a silent full-history exfiltration path — **LOW**

**Files:** `backend/src/routes/weights.ts:13-32`, `compose.yaml:20-21`, `.env.example:9-10`

**Evidence.** When `WEIGHT_SYNC_RELAY_URL` and `WEIGHT_SYNC_USER_NAME` are both set, **every**
weight mutation POSTs the account's entire weight history to that URL, best-effort, swallowing
all errors (`catch {}`).

**Impact.** Correctly default-off and well documented — this is good design, not a bug. But it is
an env-var typo away from streaming body-composition data to an arbitrary host, and its failure
mode is completely silent.

**Remediation.** Leave both unset. Do not add them to the Portainer stack at all (an absent
variable is safer than an empty one). Document the fact in the stack file header.

**Required before deployment: YES** — as a verification step (confirm unset), not a code change.

---

### F-09 · Installation-wide `ANTHROPIC_API_KEY` fallback — **LOW**

**Files:** `backend/src/engine/anthropicClient.ts:39-44`, `compose.yaml:17`

**Evidence.** `resolvedKey()` falls back to `process.env.ANTHROPIC_API_KEY` for any account
without its own key.

**Impact.** Any account on the instance can spend that key. Harmless at one user; a shared
liability at two.

**Remediation.** Leave unset. Use the per-account key via **More → AI features**, which is the
better-designed path anyway (file-backed, `0600`, validated, never returned by the API).

**Required before deployment: YES** — verification step.

---

### F-10 · No backup coverage exists, and naive tar of live SQLite can produce a torn copy — **MEDIUM**

**Files:** `README.md:103-113`, `backend/src/db/index.ts:12-14`

**Evidence.** Upstream guidance is `docker compose stop && cp -a data`. The database opens with
`journal_mode = WAL` (`db/index.ts:13`), so a copy taken while the container is running can
capture the main DB without its WAL and be inconsistent. Nothing in the homelab's Tier-1 backup
covers this app — `scripts/r2-backup-freshness.sh:63` lists eight targets, none of them this one.

This is the failure mode CLAUDE.md already records the hard way: the Actual Budget decommission
left a backup job producing a **1 673-byte** archive while `BackupStaleTier1` stayed green,
because freshness only proves *an object landed*, not that it contains anything.

**Impact.** Total, unrecoverable loss of irreplaceable multi-year health history on volume or
disk failure. This is, in my judgement, the highest *expected-cost* finding in this review —
higher than any of the security items, because it needs no attacker.

**Remediation.** Follow the established convention:
- `VACUUM INTO` for the SQLite file (the Nyx Pockets v1 pattern) — atomic and WAL-safe.
- Tar `photos/` and `secrets/` separately.
- New n8n node modelled on `n8n-workflows/nyx-dash-backup.json`, staggered clear of the 17:00
  and 17:15 jobs.
- Add `macrodingus` to `TARGETS` in `scripts/r2-backup-freshness.sh`.
- **Assert a minimum archive size** in the backup job, so the Actual Budget failure mode cannot
  repeat.
- Perform one real restore into a scratch instance before trusting it (§11 V-9).

**Required before relying on the app for personal data: YES.** Not a blocker for first boot.

---

### F-11 · Request logging may capture dietary search terms and upstream error payloads — **LOW**

**Files:** `backend/src/index.ts:35`, and every `req.log.error(err)` call site

**Evidence.** `Fastify({ logger: true })` logs method, URL **including query string**, and status
for every request. `GET /api/foods?q=<term>` therefore writes food-search terms to stdout →
Docker logs → Loki. Additionally `req.log.error(err)` on Anthropic/OFF failures logs SDK error
objects whose shape is not controlled by this codebase.

**Impact.** Dietary detail is health-adjacent personal data accumulating in centralised logs
with a different retention policy from the app. I found no path that logs a password or an API
key — request bodies are not logged, and the Anthropic SDK does not place the key in error
messages — but the error payloads are third-party-shaped and not audited.

**Remediation.** Configure Fastify's serialiser to redact query strings on `/api/foods*`, and log
`err.message` rather than the whole error object at those call sites.

**Required before deployment: NO.**

---

### F-12 · Container runs as root with no resource limits or health check — **MEDIUM**

**Files:** `Dockerfile:19-29`, `compose.yaml:1-27`

**Evidence.** The runtime stage sets no `USER` (so PID 1 is root), the compose service declares no
`healthcheck`, no `deploy.resources.limits`, no `security_opt`, and no `cap_drop`. CLAUDE.md
line 122 confirms the consequence: *"the `.sqlite` file is root-owned from inside the container."*

**Impact.** Any RCE (most plausibly through `sharp`/libvips on untrusted images, T7) yields root
in a container attached to the `proxy` network. No memory cap means an image-decode bomb or a
runaway query can pressure CT100 — which matters on a host already at ~122% memory overcommit.
No health check means Portainer/`docker ps` cannot distinguish "running" from "serving".

**Remediation.** `USER node` in the Dockerfile; `cap_drop: ALL`; `no-new-privileges:true`;
`deploy.resources.limits` (256 MiB / 0.5 CPU is ample); `healthcheck` on `/api/health`. Volume
ownership is handled once via `chown -R node:node` on first boot, or by initialising the volume
with correct ownership.

**Required before deployment: YES.**

---

### F-13 · Dependency vulnerabilities — **LOW**

**Evidence** — `npm audit --package-lock-only`, run 2026-08-07 in a disposable `node:24-alpine`
container (no Node toolchain exists on the workstation):

**Backend — 4 moderate, all `drizzle-kit` → `@esbuild-kit/*` → `esbuild ≤0.24.2`
(GHSA-67mh-4wv8-2f99).** `drizzle-kit` is a `devDependency`, and the Dockerfile runs
`npm prune --omit=dev` (`Dockerfile:17`) before the runtime stage — **none of these ship in the
production image.** The advisory concerns the esbuild dev server, which is never run here.

**Frontend — 4 high:**

| Package | Advisory | Ships to browser? | Assessment |
|---|---|---|---|
| `react-router` 7.12.0–8.2.0 | GHSA-qwww-vcr4-c8h2 — RSC-mode CSRF bypass | **Yes** | **Not exploitable here** — this is a plain SPA with no React Server Components. Fix is a downgrade to 7.11.0; not worth it |
| `brace-expansion` | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 — DoS | No — build-time | Fix via `npm audit fix` (non-breaking) |
| `fast-uri` 3.0.0–3.1.4 | GHSA-7p8r-x3mc-p8w7 — host confusion | No — build-time | Fix via `npm audit fix` (non-breaking) |

**Impact.** Low. Nothing exploitable reaches the running container or the browser.

**Remediation.** Run `npm audit fix` in `frontend/` for the two non-breaking transitive bumps.
Leave `react-router` and `drizzle-kit` as-is with the reasoning recorded here. Bring the fork
under the existing Renovate configuration for ongoing coverage.

**Required before deployment: NO.**

---

### F-14 · Auth gating is by raw-URL string prefix rather than route registration — **LOW (unverified)**

**Files:** `backend/src/auth.ts:117-127`, `backend/src/index.ts:82-88`

**Evidence:**
```ts
app.addHook("preHandler", async (req, reply) => {
  const url = req.raw.url ?? "";
  if (!url.startsWith("/api/")) return;              // ← unauthenticated if this misses
  if (url.startsWith("/api/auth/") || url === "/api/health") return;
```
Authorisation is decided by string-matching `req.raw.url` — the raw, undecoded, unnormalised
request target — while *routing* is done separately by Fastify's radix tree. Any input those two
layers disagree about is a potential bypass (e.g. `//api/foods`, `/%61pi/foods`, `/./api/foods`).

**Impact.** Would be Critical if a divergence exists. I reason that Fastify's `find-my-way` does
not percent-decode static path segments and is case-sensitive by default, so the obvious
candidates should fail to route at all and fall through to the SPA handler — but **I have not
been able to execute this test**, because the workstation has no Node, npm, or Docker (verified:
all three are absent from `PATH`).

**Remediation.** Regardless of the test outcome, prefer a structural fix over a string check:
register authenticated routes under a Fastify plugin scope carrying the `preHandler`, so a route
cannot exist outside the guard. This removes the class of bug rather than the instance.

**Required before deployment:** the **test** is required (§11 V-6). The refactor is recommended.

---

### F-15 · Fork carries the upstream author's personal agent instructions — **INFORMATIONAL**

**Files:** `CLAUDE.md:9`, `AGENTS.md`, `GEMINI.md`

**Evidence.** `CLAUDE.md:9`: *"inspect the newest file in `/home/daddydingus/screenshots`"*.
`AGENTS.md` (34 808 B) and `CLAUDE.md` (34 696 B) are near-duplicates with different checksums —
they have drifted.

**Impact.** No security impact. Operationally confusing, and the path is meaningless here.

**Remediation.** Replace with fork-specific guidance describing *this* deployment. If the fork is
later open-sourced, note that the upstream `CLAUDE.md` is a genuinely high-quality engineering
document and is worth preserving as attribution rather than deleting outright.

**Required before deployment: NO.**

---

### F-16 · Account data reset does not delete the account's Anthropic key — **LOW**

**Files:** `backend/src/routes/account.ts:65-87`

**Evidence.** `DELETE /api/account/data` deletes eleven tables and `data/photos/<userId>/`, but
never touches `data/secrets/anthropic/<userId>`.

**Impact.** A user who resets their account expecting a clean slate leaves a live, billable API
key on disk. The README states that removing the key *in settings* deletes the file — which is
true — but a full account reset does not, and nothing tells the user that.

**Remediation.** One line: call `removeAnthropicApiKey(userId)` in the reset handler.

**Required before deployment: NO.**

---

### F-17 · Unbounded search query length and LIKE-wildcard passthrough — **LOW**

**Files:** `backend/src/routes/foods.ts:96-183`, `backend/src/engine/foodSearch.ts:30-41`

**Evidence.** `GET /api/foods?q=…` applies no maximum length to `q` (contrast
`/api/foods/search-selection`, which correctly caps at 120 chars, line 212). `localFoodCondition`
builds one `OR (name LIKE ? OR brand LIKE ?)` pair **per word**, so query complexity grows
linearly with the input. Normalisation strips `%`/`_` (`foodSearch.ts:27` reduces to
`[a-z0-9 ]`), so LIKE-wildcard injection is **not** possible — a point in the code's favour.

**Impact.** A multi-thousand-word `q` generates a very large SQL statement. `better-sqlite3` is
synchronous, so this blocks the event loop. The code comments already record a related
production incident ("overloaded better-sqlite3's native binding and terminated the process").
Low severity given authentication, but it is a self-inflicted DoS with a trivial fix.

**No SQL injection exists anywhere in this codebase.** All queries go through Drizzle with bound
parameters; the two raw `sql\`\`` usages (`foods.ts:87-88`, `goals.ts:44`) interpolate only
Drizzle column references and a locally-computed integer.

**Remediation.** Cap `q` at 120 characters, matching the sibling route.

**Required before deployment: NO.**

---

### F-18 · Cross-account food-name disclosure into AI prompts — **INFORMATIONAL**

**Files:** `backend/src/engine/describeMeal.ts:127-136`, `backend/src/engine/recipeImport.ts:145-156`

**Evidence:**
```ts
const loggedRows = await db.selectDistinct({ foodId: logs.foodId }).from(logs);
```
No `userId` filter — the candidate set spans **every** account's logged foods, and is then sent
to Anthropic under the *requesting* user's API key.

**Impact.** Nil at one user. With two accounts it leaks "which foods someone here has eaten" —
weak but real dietary inference — to a third party, billed to the wrong person.

**Remediation.** Add `.where(eq(logs.userId, userId))`. Both functions already receive `userId`
at their call sites, so this is a two-line change.

**Required before deployment: NO.** Required before a second account.

---

### F-19 · Correctness and code-quality observations — **INFORMATIONAL**

Reviewed for the brief's "product and code quality" scope; none are security findings.

- **Macro/nutrition handling is sound.** Per-100 g storage with conversion at the display
  boundary, `microsJson` consistently in g/100 g, fat subtypes as real columns, live computation
  from `foods` rather than snapshotting. The `hiddenAt` soft-delete correctly prevents history
  corruption on delete.
- **Concurrency.** `better-sqlite3` is synchronous and single-writer; WAL is enabled. Safe at one
  user. Multi-step operations (recipe create/update, `performCheckin`) are **not wrapped in
  transactions**, so an error mid-sequence can leave a partially-written recipe. Low impact at
  this scale; worth noting.
- **Migrations.** 28 sequential Drizzle migrations, applied automatically at boot, forward-only
  with **no down-migrations**. Rollback therefore means restore-from-backup, which makes F-10 a
  prerequisite for safe upgrades. Three snapshot files (`0015`–`0017`) are missing from
  `migrations/meta/` while their `.sql` files exist — harmless at runtime (the journal drives
  application) but it will break `drizzle-kit generate` for new migrations.
- **Tests.** None. No test framework, no lint config. Type-checking via `tsc` is the only
  automated gate — and `CLAUDE.md:88` documents a class of bug (hook-after-early-return) that
  `tsc` provably cannot catch and that produced a blank-screen crash with **no error boundary
  anywhere in the app** to contain it.
- **`AddFoodSheet.tsx` is 2 584 lines.** The single largest maintainability risk in the frontend.
- **`APP_TIME_ZONE` defaults to `Australia/Brisbane`** — must be `Australia/Sydney` here, or
  calendar-day boundaries drift by an hour through DST.

---

### Findings summary

| ID | Finding | Severity | Required before deploy? |
|---|---|---|---|
| F-01 | Password-only auth, no rate limiting | High | **Yes** (via Authentik + signup lockdown) |
| F-02 | SSRF in recipe import | High | **Yes** |
| F-03 | No rate limiting | Medium | **Yes** (Traefik layer) |
| F-04 | Shared food library unauthorised writes | Medium | No (single-user) |
| F-05 | No security headers / CSP | Medium | **Yes** (headers) |
| F-06 | Unrevocable sessions, no `Secure` flag | Medium | **Yes** (`secure` + managed secret) |
| F-07 | CSRF relies on `SameSite=Lax` alone | Low | No |
| F-08 | Weight-relay exfiltration path | Low | **Yes** (verify unset) |
| F-09 | Instance-wide Anthropic key | Low | **Yes** (verify unset) |
| F-10 | No backups; torn-SQLite risk | Medium | Before trusting with data |
| F-11 | Logs capture search terms | Low | No |
| F-12 | Root container, no limits, no health check | Medium | **Yes** |
| F-13 | Dependency CVEs | Low | No |
| F-14 | Auth gating by URL prefix | Low (unverified) | Test **yes**, refactor no |
| F-15 | Upstream personal agent instructions | Info | No |
| F-16 | Reset leaves Anthropic key | Low | No |
| F-17 | Unbounded query length | Low | No |
| F-18 | Cross-account names in AI prompts | Info | No |
| F-19 | Code-quality observations | Info | No |

---

## 7. MVP hardening checklist

The smallest set of changes for a safe single-user private deployment. Nothing here is
speculative; each maps to a finding above.

**Access control**
- [ ] Authentik application + Proxy Provider, group gate `homelab-admins` *(F-01)*
- [ ] `authentik@docker` on the router, **router-level** *(F-01, gotcha #20)*
- [ ] `ratelimit@docker` + `crowdsec-bouncer@docker` on the router *(F-03)*
- [ ] Create the single account, then disable `POST /api/auth/signup` *(F-01)*
- [ ] Long random password in 1Password *(F-01)*

**Application**
- [ ] SSRF guard in `fetchPageText`: private-IP deny-list, manual redirects, port allow-list,
      generic errors *(F-02)*
- [ ] `secure: true` on the session cookie; `SESSION_MS` → 7 days *(F-06)*
- [ ] `MACRODINGUS_COOKIE_SECRET` as a Portainer stack variable *(F-06)*

**Container / compose**
- [ ] Remove the Tailscale sidecar and all `TS_*` configuration *(D-1)*
- [ ] `USER node` in the Dockerfile *(F-12)*
- [ ] `cap_drop: ALL`, `security_opt: no-new-privileges:true` *(F-12)*
- [ ] `deploy.resources.limits`: 256 MiB / 0.5 CPU *(F-12)*
- [ ] `healthcheck` on `/api/health` *(F-12)*
- [ ] Join `proxy` only; **no `ports:` key** *(brief, §2.3)*
- [ ] Named volume `macrodingus_data`; start from an empty `data/` *(brief)*
- [ ] `APP_TIME_ZONE=Australia/Sydney` *(F-19)*
- [ ] Confirm `ANTHROPIC_API_KEY`, `WEIGHT_SYNC_*` are **absent** *(F-08, F-09)*

**Proxy / edge**
- [ ] `macrodingus-security-headers@file`: `frameDeny`, `contentTypeNosniff`, `referrerPolicy` *(F-05)*
- [ ] Cloudflare CNAME → existing tunnel *(§2.4)*

**Homelab integration**
- [ ] Add `macrodingus` to the `UnexpectedContainer` allowlist, **same PR** *(D-9)*
- [ ] Add `wud.watch=false` + Watchtower label if built locally *(D-10, gotcha #36)*
- [ ] Add the service to `docs/reference/services.md` and the CLAUDE.md URL table *(convention)*

**Backup**
- [ ] n8n Tier-1 job: `VACUUM INTO` + tar photos/secrets → R2 *(F-10)*
- [ ] Add `macrodingus` to `scripts/r2-backup-freshness.sh` `TARGETS` *(F-10)*
- [ ] Minimum-archive-size assertion in the job *(F-10, Actual Budget lesson)*
- [ ] One verified restore into a scratch instance *(F-10)*

---

## 8. Deferred hardening

Worthwhile, but **not** justified for a single-user private deployment. Recorded so the decision
is deliberate rather than forgotten.

| Item | Why deferred | Revisit when |
|---|---|---|
| `createdByUserId` on `foods` + write authorisation *(F-04)* | No second account exists | A second account is added |
| Per-user scoping of AI candidate foods *(F-18)* | Same | Same |
| Server-side session store / `tokenVersion` *(F-06)* | One user; secret rotation is an adequate break-glass | Multi-user, or any suspected compromise |
| Full CSP *(F-05)* | Needs validation against the service worker + MediaPipe WASM; headers give most of the value | After a measured `Content-Security-Policy-Report-Only` run |
| `@fastify/csrf-protection` *(F-07)* | `SameSite=Lax` + Authentik cover it; token plumbing through every SPA mutation is real complexity | Public exposure |
| Full test suite | Upstream has none; adding one to a fork you also want to rebase onto upstream creates permanent merge friction | Before any substantial feature work of your own |
| Error boundary in `App.tsx` | Genuinely worth doing (`CLAUDE.md:88` documents a blank-screen crash), but it is an upstream improvement, not a deployment blocker | Consider contributing upstream |
| Structured logging → Loki labels, app metrics → Prometheus | The app exposes no `/metrics`; Traefik access logs already cover request-level observability | If the app becomes load-bearing |
| Transactions around multi-step writes *(F-19)* | Single-writer SQLite, one user, low concurrency | Multi-user |
| PBS / Tier-3 snapshots | Blocked on Phase 6c hardware; Tier-1 R2 covers this app's data completely | Phase 6c |

**Explicitly rejected as unnecessary complexity:** Kubernetes; microservices; Redis or any
external session store; a job queue; Postgres (SQLite is correct here); a second replica or load
balancer; a CDN (Cloudflare already fronts it); WAF rules beyond the existing CrowdSec AppSec;
per-request audit logging; secret-management infrastructure beyond Portainer env vars + 1Password.

---

## 9. Open decisions requiring your sign-off

| # | Decision | My recommendation |
|---|---|---|
| **D-1** | **Host: CT100 or CT106?** | **CT100** — the only option that satisfies "no published port" and matches the app's native compose topology (§2.3). Accepts a documented divergence from "personal apps live on CT106". |
| **D-2** | **Image: compose `build:` on CT100, or GitHub Actions → GHCR?** | **GHCR**, matching nyx-patch / nyx-dash / nyx-pockets-v2. Slower to set up, but keeps CT100 out of the build path and gives Renovate something to pin. `build:` on CT100 is acceptable for a first cut if you want it running sooner. |
| **D-3** | **Hostname** | `macros.nyxcloud.com.au`. Your call — `macrodingus.` or `food.` work equally well. |
| **D-4** | **Authentik forward-auth, or OIDC inside the app (R-033 pattern)?** | **Forward-auth** for now. The app has no OIDC support; adding it is a real feature, not a config change. Forward-auth gets the boundary in place today. |
| **D-5** | **Keep `POST /api/auth/signup` after first account?** | **Disable it.** One user, no need, removes the entire self-registration attack surface. |

---

## 10. Backup, restore, upgrade, rollback

### 10.1 What must be backed up

The single named volume `macrodingus_data` — nothing else. It contains the database, photos, the
cookie secret, and Anthropic keys. **Every backup is a credential store; treat it accordingly.**

### 10.2 Backup (nightly, n8n Tier-1 → R2)

Modelled on `n8n-workflows/nyx-dash-backup.json`, scheduled clear of the 17:00 / 17:15 jobs
(17:30 AEST proposed). Executed over SSH on CT100:

```bash
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
STAGE=$(mktemp -d)

# 1. Atomic, WAL-safe SQLite snapshot — never a plain cp of a live WAL database.
docker exec macrodingus node -e "
  const D=require('better-sqlite3');
  const db=new D('/app/data/macrotrack.sqlite',{readonly:true});
  db.exec(\"VACUUM INTO '/tmp/macrotrack-backup.sqlite'\");
"
docker cp macrodingus:/tmp/macrotrack-backup.sqlite "$STAGE/macrotrack.sqlite"
docker exec macrodingus rm -f /tmp/macrotrack-backup.sqlite

# 2. Photos + per-account API keys (small; tar is fine — these are write-once files).
docker run --rm -v macrodingus_data:/data:ro -v "$STAGE":/out alpine \
  tar czf /out/assets.tar.gz -C /data photos secrets

tar czf "/tmp/macrodingus_${TS}.tar.gz" -C "$STAGE" .
SIZE=$(stat -c%s "/tmp/macrodingus_${TS}.tar.gz")

# 3. Guard against the Actual Budget failure mode: a green metric over an empty archive.
[ "$SIZE" -gt 51200 ] || { echo "FATAL: archive only ${SIZE}B — refusing to upload"; exit 1; }

rclone copy "/tmp/macrodingus_${TS}.tar.gz" r2:homelab-backups/macrodingus/
rm -rf "$STAGE" "/tmp/macrodingus_${TS}.tar.gz"
```

Then add `macrodingus` to `TARGETS` in `scripts/r2-backup-freshness.sh:63` so `BackupStaleTier1`
(>30 h) covers it.

> **Note the rclone version trap** — memory `rclone-old-version-r2-501-bug`: apt's rclone 1.60.1
> returns HTTP 501 on R2 `rcat`. Confirm CT100's rclone version before first run.

### 10.3 Restore into a clean instance

```bash
# 1. Stop the app (Portainer, or on CT100 directly).
docker stop macrodingus

# 2. Fetch and unpack the chosen archive.
rclone copy r2:homelab-backups/macrodingus/macrodingus_<TS>.tar.gz /tmp/
mkdir -p /tmp/restore && tar xzf /tmp/macrodingus_<TS>.tar.gz -C /tmp/restore

# 3. Replace volume contents. Renaming the old volume first is the rollback path.
docker volume rm macrodingus_data || true
docker volume create macrodingus_data
docker run --rm -v macrodingus_data:/data -v /tmp/restore:/in alpine sh -c '
  cp /in/macrotrack.sqlite /data/macrotrack.sqlite &&
  tar xzf /in/assets.tar.gz -C /data &&
  chown -R 1000:1000 /data && chmod 700 /data/secrets/anthropic &&
  chmod 600 /data/secrets/anthropic/* /data/.cookie-secret 2>/dev/null || true
'

# 4. Start. Migrations run automatically and are idempotent.
docker start macrodingus
docker exec macrodingus node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
```

**Note:** the restored `.cookie-secret` means existing sessions remain valid. To force a full logout
during an incident, delete `/app/data/.cookie-secret` before step 4 — it is regenerated on boot.

### 10.4 Upgrade

1. `git fetch upstream && git merge upstream/master` on `homelab-hardening`; resolve conflicts.
2. Review new/changed migrations — they are **forward-only**, so this is the point of no return.
3. **Take a fresh backup** (§10.2) — not the previous night's.
4. Build and push a new pinned image tag (never reuse a tag — gotcha #24).
5. Bump the tag in the stack file → PR → merge → Portainer GitOps redeploys.
6. Verify per §11.

### 10.5 Rollback

- **Application only (no migration ran):** revert the stack file's `image:` tag to the previous
  pin and redeploy. ~1 minute.
- **A migration ran:** there are no down-migrations. Rollback = restore §10.3 from the pre-upgrade
  backup, then pin the old image. This is why step 3 above is mandatory.
- **Whole deployment:** delete the Portainer stack, remove the Cloudflare DNS record, remove the
  Authentik application/provider, revert the homelab-repo PR. The volume can be retained as a
  safety net. No shared infrastructure is mutated by this deployment, so there is nothing else
  to unwind.

---

## 11. Verification plan

Run after deployment. Every check has an explicit pass condition.

| # | Check | Command | Pass |
|---|---|---|---|
| V-1 | Port 3000 not host-published | `docker ps --filter name=macrodingus --format '{{.Ports}}'` (CT100) | Empty, or `3000/tcp` **without** a `0.0.0.0:` mapping |
| V-2 | Not listening on the LAN | `ss -ltnp \| grep 3000` (CT100) | No match |
| V-3 | Not reachable from another host | `curl -m 5 http://192.168.20.50:3000/api/health` (from CT106) | Connection refused / timeout |
| V-4 | Container healthy | `docker inspect --format '{{.State.Health.Status}}' macrodingus` | `healthy` |
| V-5 | Health via the intended route | `curl -sI https://macros.nyxcloud.com.au/api/health` | `302` to Authentik **when unauthenticated** — proving the gate is live |
| V-6 | **Auth-prefix bypass (F-14)** | From inside `proxy`: `curl -s -o /dev/null -w '%{http_code}\n' http://macrodingus:3000/api/logs` and the same for `//api/logs`, `/%61pi/logs`, `/./api/logs`, `/API/logs` — all **without** a cookie | Every one returns `401` or `404`. **Any `200` is a critical bypass — stop and escalate** |
| V-7 | Cross-account isolation | Create two throwaway accounts; from A's session `GET /api/logs/:id`, `/api/photos/:id/file`, `/api/weights`, `/api/goals`, `/api/recipes/:id`, `/api/measurements`, `/api/cookware`, `/api/settings` using B's ids | `404` on every one. Delete both accounts afterwards |
| V-8 | SSRF blocked | `POST /api/recipes/import-url` with `http://127.0.0.1:3000/api/health`, `http://192.168.20.50:9000/`, `http://authentik-server:9000/` | Rejected before any fetch; identical generic error for all three |
| V-9 | **Backup restores** | Run §10.2, then §10.3 into a scratch volume/container. Log in; confirm logs, weights, photos, goals present | Data matches; `/api/health` OK. **This is the check that actually matters** |
| V-10 | No secrets in logs | `docker logs macrodingus 2>&1 \| grep -iE 'sk-ant\|password\|passwordHash\|cookie-secret\|Bearer '` | No match |
| V-11 | Relay + shared key unset | `docker exec macrodingus env \| grep -E 'WEIGHT_SYNC\|ANTHROPIC_API_KEY'` | No output |
| V-12 | Non-root | `docker exec macrodingus id -u` | Non-zero |
| V-13 | Security headers present | `curl -sI https://macros.nyxcloud.com.au/` (authenticated) | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` |
| V-14 | Auth works; signup disabled | Log in normally; then `POST /api/auth/signup` | Login succeeds; signup `404`/`403` |
| V-15 | No alert storm | Grafana/Alertmanager, 10 min after deploy | No `UnexpectedContainer` firing |
| V-16 | Build gates | `cd backend && npm run build`; `cd frontend && npm run build`; `docker compose config` | All exit 0 |

### What cannot be verified yet, and why

Stated plainly, as required:

1. **Nothing has been executed.** No build, no test, no container run. The workstation has **no
   Node, no npm, and no Docker** on `PATH` (verified). All application findings above are from
   static reading of the source; the dependency audit is the one exception — it was run in a
   disposable `node:24-alpine` container on CT106, and its temporary directory was removed.
2. **F-14 (auth-prefix bypass) is unverified** and is the single most important open question in
   this review. It is reasoned to be safe but not proven. V-6 must run before you trust the app
   with real data.
3. **Runtime behaviour of the Authentik gate against the PWA is unproven.** Forward-auth is known
   to break native clients (it broke the Home Assistant companion app and the Jellyfin iOS app —
   both documented in CLAUDE.md). A browser-installed PWA should be fine because it uses the
   browser's cookie jar, but the service worker's background update fetches may behave
   differently against a `302`-to-Authentik. **This needs a real device test, and it is the most
   likely thing to require a design change after first deploy.**
4. **SSRF exploitability is reasoned from source, not demonstrated.** I did not attempt to fetch
   an internal URL through the running app, because the app is not running.
5. **The `sharp`/libvips threat (T7) is theoretical.** No fuzzing was performed.

---

## 12. Recommendation

Proceed, in this order:

1. **Confirm the five decisions in §9** — particularly D-1 (CT100 vs CT106), which determines the
   whole shape of the compose file.
2. I produce the ordered remediation plan (**Phase 3**) against your answers.
3. On your approval, implement in small separated commits (**Phase 4**).
4. Deploy only on explicit authorisation, then run §11 in full — with **V-6 and V-9 treated as
   gates**, not formalities.

Two things I would push back on if you were inclined to skip them: **F-10 (backups)** is the
highest expected-cost item in this document despite not being a security finding — it needs no
attacker to ruin your day. And **F-02 (SSRF)** is what makes CT100 placement defensible; without
that fix I would recommend CT106 with a published port instead, despite the brief.
