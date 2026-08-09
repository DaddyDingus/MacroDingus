# macrotrack

macrotrack is a self-hosted nutrition, weight, coaching, recipe, measurement,
and progress-photo PWA intended for a person or small household. The backend
uses SQLite and serves the built React frontend from the same container.

This is personal software, not a hosted service. Review the security and
privacy notes below before exposing an installation to anyone else.

## Requirements

- Docker with the Compose plugin
- A Docker network named `proxy`
- For the included private HTTPS setup: a Tailscale account and auth key
- Optional AI features: each user can supply their own Anthropic API key

Create the network once if your server does not already have it:

```sh
docker network create proxy
```

## Fresh installation

1. Clone the repository. Do not copy another installation's working folder or
   `data/` directory; those contain accounts, nutrition history, photos, and
   session secrets.
2. Copy `.env.example` to `.env` and add a fresh `TS_AUTHKEY`. Tailscale fills
   `${TS_CERT_DOMAIN}` in the included Serve config from that installation's
   own tailnet and `TS_HOSTNAME`.
3. Build and start the containers:

   ```sh
   docker compose build
   docker compose up -d
   docker ps
   docker exec macrotrack node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.text()).then(console.log)"
   ```

4. Open the Tailscale HTTPS address and create the first account.

The compose file expects the included Tailscale sidecar. If you already use a
different HTTPS reverse proxy, remove that service and point your proxy at the
`macrotrack` service on port 3000. Do not expose plain port 3000 to the public
internet.

## AI features and API keys

AI is optional. Without a key, ordinary food logging, coaching calculations,
recipes, weights, measurements, and photos continue to work. Claude powers:

- nutrition-label scanning;
- meal text/photo descriptions;
- recipe URL imports;
- progress-photo comparisons; and
- check-in narratives.

The recommended setup is per-account: open **More → AI features**, paste an
Anthropic API key, and let the server validate it. The key is stored under
`data/secrets/anthropic/` with restrictive file permissions. It is never
returned by the API or stored in the PWA/browser. Removing it in settings
deletes the server-side file.

`ANTHROPIC_API_KEY` in `.env` is an optional installation-wide fallback. Any
account without its own key uses that shared key, so leave it blank if every
person should pay for their own usage. Set usage limits with Anthropic and
revoke a key immediately if the server or a backup containing it is exposed.

AI requests send the relevant text or images to Anthropic. Recipe import also
fetches the supplied webpage, and food/barcode search contacts OpenFoodFacts.

## Access and account model

Network access is the primary security boundary. Anyone who can reach the app
can use the self-service signup screen; there is no administrator approval,
email identity, public-internet hardening, or login rate limiting. Restrict the
Tailscale node with appropriate sharing/ACL rules. Do not publish this app
directly on the open internet as-is.

Foods are shared between accounts on one installation. Logs, weights,
profiles, goals, programs, check-ins, measurements, recipes, photos, settings,
and AI keys are account-scoped except where the code explicitly documents a
shared food-library relationship.

## Optional integrations

### Health Connect

Android Health Connect is exposed through the native Jetpack SDK, not a web
or PWA API. A direct PWA integration is therefore not possible. The backend
provides authenticated `POST /api/weights/import` batch upserts as the bridge
target for a future minimal Android companion or Trusted Web Activity shell:
the native layer reads permitted `WeightRecord` values, normalizes them to
one kg value per household date, and passes them to the signed-in web layer.
No Health Connect permission or health data leaves the phone until the user
explicitly grants it and initiates sync.

Weight relay syncing is disabled unless both of these values are configured:

```env
WEIGHT_SYNC_RELAY_URL=http://your-relay:3000/api/weight-sync
WEIGHT_SYNC_USER_NAME=Account Name
```

Every weight mutation for that exact account name sends a best-effort full
snapshot to the relay. Leave both values blank for a normal installation.

The repository includes an AFCD import script but not its transformed source
dataset. A fresh installation therefore begins without the original
installation's pre-seeded AFCD library and builds its library from custom
foods, recipes, barcode/OpenFoodFacts results, and any separately supplied
AFCD import.

## Backups and updates

Back up the complete `data/` directory while the container is stopped, or use
a SQLite-aware backup process. It contains the database, photos, cookie signing
secret, and per-account AI keys. Treat every backup as sensitive.

```sh
docker compose stop macrotrack
cp -a data /your/secure/backup/location/
docker compose start macrotrack
```

To update a fork, merge or rebase changes from its upstream repository, then
rebuild and restart:

```sh
docker compose build
docker compose up -d
```

Migrations run automatically on startup. Keep a backup before updating.

## Development

There is no root npm package and no test suite. Type-check/build each package:

```sh
cd backend && npm install && npm run build
cd ../frontend && npm install && npm run build
```

Development servers use `npm run dev` in each package. The frontend Vite server
proxies `/api` to the backend address configured in `frontend/vite.config.ts`.

## License

The application source is available under the [ISC License](LICENSE). External
datasets and services retain their own terms; check the applicable AFCD,
OpenFoodFacts, Anthropic, and dependency terms for your use and distribution.
