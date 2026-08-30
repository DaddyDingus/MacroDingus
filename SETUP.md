# MacroDaddy deployment and recovery

MacroDaddy adopts DaddysVibe Mobile App Foundation v8. Its PWA and Android WebView use the same live Fastify deployment at `https://macrodaddy.tail984e80.ts.net`.

This checklist is agent-owned. At the beginning of every task, inspect `.daddysvibe/setup.json` and automatically finish every available pending step. Ask the owner only for an unavailable credential, permission, off-server signing backup destination, or real-device confirmation. Use `npm run publish` for every user-facing release; never manually copy an APK into the runtime image.

## Protected identity and secrets

- Permanent Android package: `net.daddysserver.macrotrack`
- Signing alias: `macrotrack`
- Signing certificate SHA-256: `47:5B:41:46:3F:7A:B7:C9:6E:EA:25:54:FB:84:E6:3E:13:8A:09:54:53:DD:D9:8B:BA:57:05:4F:16:E6:AF:9D`
- Working signing files: `android/macrotrack-release.jks` and `android/.signing-password`
- Persistent application data: `./data` mounted at `/app/data`
- Persistent Tailscale state: `./macrodaddy-tailscale-state` mounted at `/var/lib/tailscale`

The signing files and `.env` must remain mode `0600`; the Tailscale state directory must remain private. They are gitignored. Back up both signing files together in a mode-`0700` directory on protected storage and keep another encrypted copy off this server. Never regenerate the key after an APK has been installed.

Runtime AI keys, the OIDC transaction secret, session hashes, integration keys, and Tailscale credentials must remain outside source control. Account exports intentionally omit photos and secret AI keys.

## Authentik

Authentik `2025.8` or newer is required. MacroDaddy reuses the existing `MacroDaddy` application and public `macrodaddy` provider; do not create duplicates.

Apply `deploy/authentik-blueprint.yaml` to reconcile that existing resource, or configure it directly with:

- issuer: `https://auth.tail984e80.ts.net/application/o/macrodaddy/`
- client ID: `macrodaddy`
- client type: public, UUID subject mode
- strict redirect: `https://macrodaddy.tail984e80.ts.net/api/auth/oidc/callback`
- back-channel logout URI: `https://macrodaddy.tail984e80.ts.net/api/auth/backchannel-logout`
- signing key: the existing Authentik self-signed certificate

The app validates signed form-encoded back-channel logout tokens through issuer discovery/JWKS. The shared Authentik `2026.8.0` issuer emits canonical `typ=logout+jwt`; legacy `typ=JWT` logout tokens are rejected.

Test an invalid token with:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST -H 'content-type: application/x-www-form-urlencoded' \
  --data 'logout_token=invalid' \
  https://macrodaddy.tail984e80.ts.net/api/auth/backchannel-logout
```

It must return `400` and preserve all sessions. For authentication releases, also test subject-wide and `sid`-only revocation using an Authentik-signed token or Authentik's own back-channel task. Administrative session deletion or deactivation must terminate the matching local access.

## Tailscale

The dedicated node is `macrodaddy.tail984e80.ts.net`. Preserve `macrodaddy-tailscale-state`; restoring it preserves the node identity and HTTPS name. `TS_AUTHKEY` is only the initial enrollment credential because `TS_AUTH_ONCE=true`. If the state is irrecoverable, create a reusable non-ephemeral Tailscale key, restore `.env`, and enroll a replacement deliberately rather than while the old node still exists.

`macrodaddy-tailscale-config/serve.json` proxies HTTPS to `macrotrack:3000`. `AllowFunnel=true` is an intentional existing reachability deviation described in `FOUNDATION.md`; do not change it as incidental cleanup.

## Build and deployment

There is no root `package.json` and no formal test/lint suite.

```bash
cd backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd ..
docker compose build
docker compose up -d
docker ps --filter name=macrotrack --filter name=macrodaddy-tailscale
curl -fsS https://macrodaddy.tail984e80.ts.net/api/health
```

Docker Compose on this host requires the Docker Buildx CLI plugin. Web/server changes become live in the PWA and Android WebView after this deployment; do not rebuild the APK for web-only changes.

For changes under `android/`, increment `versionCode` and `versionName` in `android/app/build.gradle.kts`, match `ANDROID_RELEASE` in `backend/src/index.ts`, then build with the permanent key:

```bash
cd android
JAVA_HOME=/home/daddydingus/.local/share/jdks/temurin-17 \
ANDROID_HOME=/home/daddydingus/Android/Sdk \
/home/daddydingus/.gradle/wrapper/dists/gradle-9.1.0-bin/9agqghryom9wkf8r80qlhnts3/gradle-9.1.0/bin/gradle clean assembleRelease
cd ..
docker compose build && docker compose up -d
curl -fsS https://macrodaddy.tail984e80.ts.net/api/android/version
curl -fsSL 'https://macrodaddy.tail984e80.ts.net/api/android/apk?v=<version>' -o /tmp/macrodaddy.apk
/home/daddydingus/Android/Sdk/build-tools/36.0.0/apksigner verify --verbose --print-certs /tmp/macrodaddy.apk
```

Confirm the application ID and certificate fingerprint above before publishing. Test the installed APK's Authentik redirect, file picker/camera, external links, HTTPS download handoff, update/install flow, and Back behavior.

## Backup and recovery

The server uses SQLite online backups every 24 hours and retains 14 under `DATA_DIR/backups`, each with a companion `.photos` tree. More → Data & backups shows status and can trigger one manually. These snapshots remain on the same data volume and are not a substitute for an off-server backup.

For full disaster recovery, copy all of `DATA_DIR`—database, WAL/SHM as applicable, photos, runtime secrets, backups, and integration state—to another disk or machine. Use SQLite's online backup API while the service is running, or stop the service before copying the live database files. Preserve runtime encryption/API key files with that backup.

The verified 2026-08-24 off-server recovery set in Backblaze B2 contains the current online SQLite snapshot, progress photos, both permanent Android signing files, and a dedicated Tailscale identity archive. Local-to-remote hashes matched, and download response headers reported AES-256 SSE-B2 encryption. The regular stack sync deliberately excludes account-level AI provider keys because they are third-party billing credentials; re-enter those keys after recovery. Refresh the dedicated Tailscale archive after an intentional node identity change rather than folding its private state into the generic nightly sync.

To recover Android signing, restore both protected files to `android/`, set mode `0600`, and verify the certificate fingerprint before building. To recover Tailscale, restore the state directory first; use `TS_AUTHKEY` only if no restorable state exists. After recovery, deploy, check `/api/health`, `/api/android/version`, Authentik login/logout, a valid and invalid back-channel logout, row counts, photos, and APK signature.
