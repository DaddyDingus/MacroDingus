# MacroDingus

Self-hosted nutrition, weight, coaching, recipe, measurement and progress-photo
PWA for one person or a small household. A Node/Fastify backend serves both the
API and the built React frontend from one container, backed by SQLite.

This is personal software, not a hosted service.

> **This is a hardened fork** of [DaddyDingus/MacroDingus](https://github.com/DaddyDingus/MacroDingus),
> forked at `8a6201a` and adapted to run behind an existing reverse proxy and
> identity provider instead of the upstream Tailscale sidecar. Upstream's
> architecture notes and gotchas in `CLAUDE.md` are its author's work and are
> kept largely intact — they are genuinely good. What changed here, and why, is
> recorded in [`SECURITY_AND_DEPLOYMENT_REVIEW.md`](SECURITY_AND_DEPLOYMENT_REVIEW.md)
> and [`REMEDIATION_PLAN.md`](REMEDIATION_PLAN.md).

## What's different from upstream

| | Upstream | This fork |
|---|---|---|
| Access control | Tailscale ACLs (the app had none of its own) | App-level: username + password, optional OIDC SSO, plus whatever your proxy adds |
| Login | Bare password compared against every user row | Name + password, single indexed lookup |
| Brute force | Nothing | 5 attempts / 15 min, plus a global ceiling |
| Signup | Always open | Off by default; returns `404` when disabled |
| Session cookie | 30 days, no `Secure` | 7 days, `Secure`, `HttpOnly`, `SameSite=Lax` |
| Recipe import | Fetched any URL, followed redirects blindly | Private/loopback/link-local blocked, every redirect hop re-validated |
| Container | root, no limits, no health check | uid 1000, `cap_drop: ALL`, `no-new-privileges`, resource limits, health check |
| `DATA_DIR` | Defaulted outside the volume in the image | Declared in the image |

## Requirements

- Docker with the Compose plugin
- An HTTPS reverse proxy you already run
- Optional: an OIDC provider (Authentik, Keycloak, …) for single sign-on
- Optional: an Anthropic API key, per account, for the AI features

## Installation

**Start with an empty `data/`.** Never copy another installation's working
folder — it contains accounts, nutrition history, photos, the cookie signing
secret and API keys.

```sh
git clone https://github.com/zriec1/MacroDingus.git
cd MacroDingus
cp .env.example .env
```

Generate a signing secret and put it in `.env`:

```sh
openssl rand -hex 32     # -> MACRODINGUS_COOKIE_SECRET
```

Set `MACRODINGUS_ALLOW_SIGNUP=true` for the first boot only, then:

```sh
docker compose build
docker compose up -d
docker compose ps                       # expect "healthy"
curl -fsS http://127.0.0.1:8099/api/health
```

Open the app through your proxy, create your account, then **set
`MACRODINGUS_ALLOW_SIGNUP=false` and `docker compose up -d`** to close
registration. Confirm it is shut:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8099/api/auth/signup
# 404
```

## Reverse proxy integration

The container publishes `127.0.0.1:8099` by default, on the assumption your
proxy runs on the same host. If it runs elsewhere, change the mapping to
`8099:3000` **and firewall the port so only the proxy can reach it** — a
published port with nothing in front of it is the whole attack surface.

The app expects to be reached over HTTPS. It never terminates TLS itself.

**HTTPS is not optional.** The camera (barcode scanning), photo capture and PWA
install all require a browser secure context and will silently not work over
plain HTTP. `Secure` session cookies also will not be stored, so login fails
with no visible error — if you must run without TLS, set
`MACRODINGUS_COOKIE_SECURE=false` deliberately rather than wondering why.

Leave `MACRODINGUS_TRUST_PROXY=true` (the default) when behind a proxy.
Without it the rate limiter sees only the proxy's address and buckets every
request together, so one hostile client locks out everybody — worse than no
limiter at all. Set it to `false` only when there is genuinely no proxy.

Do not expose this app directly to the internet.

## Access control

Three independent layers, in the order a request meets them:

1. **Your proxy** — whatever you put in front of it (forward-auth, an IP
   allow-list, a VPN). Optional, but recommended.
2. **The app's own login** — name + password, rate limited, no self-service
   signup once you have closed it.
3. **Per-account data scoping** — every log, weight, goal, program, recipe,
   measurement, photo and setting is scoped to the authenticated account.

**The shared food library is the deliberate exception.** `foods` has no owner
column: any account can edit or delete any food, including one materialised
from another account's recipe. Nutrition is computed live and never snapshotted
onto log entries, so an edit retroactively changes history for everyone. That is
fine for one person. **Fix it before adding a second account.**

### Single sign-on (optional)

Set all four of `MACRODINGUS_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET` and
`_REDIRECT_URI` to add a "Sign in with …" button. Authorization Code + PKCE;
the ID token's signature is verified against the provider's JWKS with issuer
and audience pinned. `MACRODINGUS_OIDC_REQUIRED_GROUP` restricts sign-in to one
group.

Redirect URI: `https://<your-host>/api/auth/oidc/callback`

**Local password login stays available** as break-glass for when the provider
is down. On first SSO sign-in, an existing local account with a matching name is
adopted (linked by the provider's `sub`) so its history is not stranded; a name
already claimed by a different subject never merges.

## AI features (optional)

Everything except the AI features works with no key at all. Claude powers label
scanning, meal descriptions, recipe imports, photo comparisons and check-in
narratives.

Add a key per account under **More → AI features**. It is validated before
being saved, written `0600` inside `data/secrets/anthropic/`, never returned by
any API and never sent to the browser.

The installation-wide `ANTHROPIC_API_KEY` fallback is deliberately not wired up
in this fork's compose — any account on the instance can spend it.

**What leaves your server when you use these features:** label and meal photos,
**progress photos** (for comparisons), meal text, and fetched recipe page text
all go to Anthropic. Food and barcode search contacts OpenFoodFacts. Recipe
import fetches the page you paste. All opt-in.

## Backup and restore

Everything that matters is in the `macrodingus_data` volume: the database,
photos, the cookie signing secret and per-account API keys. **Every backup is a
credential store — treat it as one.**

### Back up

Do **not** just `cp` the database while the container runs. SQLite is in WAL
mode, so a plain copy can capture the main file without its write-ahead log and
be inconsistent. `VACUUM INTO` takes an atomic snapshot of a live database:

```sh
docker exec macrodingus node -e "
  const D = require('better-sqlite3');
  new D('/app/data/macrotrack.sqlite', { readonly: true })
    .exec(\"VACUUM INTO '/tmp/backup.sqlite'\");
"
docker cp macrodingus:/tmp/backup.sqlite ./macrotrack-$(date +%F).sqlite
docker exec macrodingus rm -f /tmp/backup.sqlite

# photos + API keys
docker run --rm -v macrodingus_data:/data:ro -v "$PWD":/out alpine \
  tar czf /out/assets-$(date +%F).tar.gz -C /data photos secrets
```

Check the archive is not empty before trusting it. A backup job that reports
success while writing a near-zero-byte file is a known way to lose everything
while a monitor stays green.

### Restore

```sh
docker compose stop
docker volume rm macrodingus_data && docker volume create macrodingus_data
docker run --rm -v macrodingus_data:/data -v "$PWD":/in alpine sh -c '
  cp /in/macrotrack-YYYY-MM-DD.sqlite /data/macrotrack.sqlite &&
  tar xzf /in/assets-YYYY-MM-DD.tar.gz -C /data &&
  chown -R 1000:1000 /data &&
  chmod 700 /data/secrets/anthropic 2>/dev/null || true
'
docker compose up -d
```

Migrations run automatically and are idempotent. The restored `.cookie-secret`
means old sessions still work — delete it before starting to force everyone out.

**An untested backup is a guess.** Restore into a scratch instance at least once.

## Upgrades and rollback

```sh
git fetch upstream && git merge upstream/master   # resolve conflicts
# review any new migrations — they are FORWARD-ONLY
# take a fresh backup (see above), not last night's
docker compose build && docker compose up -d
```

Rollback:

- **No migration ran** — redeploy the previous image tag. Under a minute.
- **A migration ran** — there are no down-migrations. Restore from the backup
  you took immediately before upgrading. This is why that step is not optional.

## Security model and known limitations

**What this protects against:** password guessing, session theft over plain
HTTP, cross-site request forgery (via `SameSite=Lax`), SSRF into your private
network, cross-account data access, and privilege escalation out of the
container.

**What it does not:**

- **Sessions cannot be revoked individually.** They are stateless signed
  cookies with no server-side store, so a stolen one is valid until it expires
  (7 days). Changing your password does not invalidate it. The break-glass is
  rotating `MACRODINGUS_COOKIE_SECRET`, which logs everyone out.
- **The shared food library has no write authorisation** (see above).
- **No Content-Security-Policy.** Set one at your proxy. React escapes output
  and there is no `dangerouslySetInnerHTML` in the codebase, but that is one
  layer, not two.
- **AI features send data to a third party.** Opt-in, but includes progress
  photos when you use comparisons.
- **Anthropic keys are stored in plaintext at rest**, `0600`. Encrypting them
  would need a key on the same disk with the same permissions.
- **No error boundary.** A React render error blanks the screen until reload.
  Inherited from upstream.
- **DNS rebinding is not fully closed** in the SSRF guard. Every redirect hop is
  re-validated, but a hostname whose answer changes between check and fetch
  remains theoretically exploitable.

Full analysis: [`SECURITY_AND_DEPLOYMENT_REVIEW.md`](SECURITY_AND_DEPLOYMENT_REVIEW.md).

## Development

No test framework and no lint script — upstream has neither, and adding them to
a fork you intend to rebase creates permanent merge friction. Type-checking via
each package's build is the gate, plus the SSRF guard's own checks:

```sh
cd backend  && npm install && npm run build && node dist/scripts/check-url-guard.js
cd frontend && npm install && npm run build
```

`better-sqlite3` and `bcrypt` are native modules and need a C toolchain; build
in Docker if you do not have one. CI runs all of the above on every push.

Dev servers: `npm run dev` in each package. The Vite server proxies `/api` to
the backend configured in `frontend/vite.config.ts`.

## License

[ISC](LICENSE), as upstream. External datasets and services keep their own
terms — check AFCD, OpenFoodFacts, Anthropic and dependency licensing for your
own use.
