# MacroDaddy foundation adoption

MacroDaddy implements DaddysVibe Mobile App Foundation version 8 as specified by `/home/daddydingus/stacks/daddysvibe/docs/MOBILE_APP_FOUNDATION.md`.

Foundation v8 preserves the exact live top-edge colour across focus and applies native and web colours immediately so neither surface can lag and expose a transient seam. The compact app-themed APK update banner, shared publish gate, signing, backup, and exact live-APK verification remain mandatory. MacroDaddy's health integrations remain product-specific.

## Preserved identity

- Live origin: `https://macrodaddy.tail984e80.ts.net`
- Tailscale node: `macrodaddy.tail984e80.ts.net` (`100.121.156.68`)
- Authentik application/client: `macrodaddy`
- Android application ID: `net.daddysserver.macrotrack`
- Android release: `1.10` (`versionCode` 11)
- Android signing certificate SHA-256: `47:5B:41:46:3F:7A:B7:C9:6E:EA:25:54:FB:84:E6:3E:13:8A:09:54:53:DD:D9:8B:BA:57:05:4F:16:E6:AF:9D`
- Persistent SQLite path: `/app/data/macrotrack.sqlite`
- Historical internal `macrotrack` database, Docker, signing, export, storage, and package identifiers remain unchanged.

## Version 2 authentication

Authentik `2026.8.0` provides the existing public `macrodaddy` OIDC client with Authorization Code + S256 PKCE and immutable UUID subjects. Its configured back-channel URI is `https://macrodaddy.tail984e80.ts.net/api/auth/backchannel-logout`.

Migration `0041_foundation_v2_sessions.sql` adds `app_sessions` without altering user or application data. Cookies now carry random 256-bit bearer tokens while SQLite stores only SHA-256 hashes. Rows carry the Authentik OIDC session ID, expire after 365 days without authenticated use, and roll forward at most once per 24 hours. Local logout deletes only the presented row. Local administrator blocking deletes all rows for that account.

The back-channel endpoint accepts form-encoded `logout_token` values. It verifies the issuer JWKS signature, issuer, audience, expiration, issued-at time, JWT ID, token type, logout event, absence of `nonce`, and presence of `sub` or `sid`. Valid tokens revoke by immutable OIDC subject and/or session ID. Invalid tokens return `400` without revoking sessions.

## Intentional deviations

1. The established Tailscale Serve configuration retains `AllowFunnel=true`. This preserves the household's existing off-Tailnet install and access path while Authentik remains the application identity/access boundary. Do not silently remove Funnel; changing reachability requires an explicit household decision.
2. This repository has no formal test suite or lint command. The migration used disposable production-image integration checks, cryptographic logout-token cases, package builds, a signed Android build, real Authentik task dispatch, and live deployment verification instead of inventing an unrelated test framework.

## Verification

Verified on 2026-08-24 with:

- frontend TypeScript/Vite production build and generated PWA service worker;
- backend TypeScript production build inside the real Docker image;
- forward migration against an online backup of the production database, preserving sampled row counts;
- WAL, `synchronous=NORMAL`, 5000 ms busy timeout, and foreign-key pragma checks;
- random token hashing, one-year expiry, rate-limited rolling renewal, production cookie attributes, and presented-session-only local logout;
- rejection of wrong signature/type/issuer/audience/expiry/event and nonce-bearing logout tokens;
- Authentik's own signed asynchronous back-channel task, with subject-wide and exact-session revocation plus invalid-token non-revocation, repeated after the 2026.8 upgrade;
- Authentik `2026.8.0` post-upgrade token generation emitting signed canonical `typ=logout+jwt`, followed by removal of the legacy `typ=JWT` compatibility;
- OIDC authorization-code/S256 PKCE initiation and advertised JWKS/back-channel metadata;
- PWA manifest/icons, content-hashed assets, no-cache bootstrap files, auto-update service worker, canonical sharing, and manual refresh implementation;
- signed Android `1.10` release build, permanent application ID/certificate, WebView file selection, safe external links, downloads, Back behavior, and update flow;
- Docker rebuild/replacement, live HTTPS health, data persistence, current APK/version endpoints, automatic database/photo backup, and unchanged Tailscale identity.
- current database snapshot, photos, permanent Android signing pair, and Tailscale identity archived off-server to Backblaze B2 with matching hashes and verified AES-256 SSE-B2 response headers.

See `SETUP.md` for deployment and disaster recovery. The v2 session migration intentionally invalidated legacy self-contained cookies; each device signs in through Authentik once to obtain its new server-side session.
