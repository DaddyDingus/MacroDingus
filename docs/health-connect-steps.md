# Health Connect steps payload contract

MacroDaddy's steps webhook is pinned to the official **Health Connect Webhook
v1.9.14** release (`650c4cc84972700200ed74497894c30994321eba`) plus the minimal
reviewable `health-connect-bridge/macrodaddy-v1.9.14.patch`. The verified
receiver contract is named `health-connect-webhook/v1.9.14-md2` in the API.

Verified upstream sources:

- `docs/webhook.md` at tag `v1.9.14`
- `HealthConnectManager.kt`, `SyncManager.kt`, `WebhookManager.kt`,
  `SyncWorker.kt`, `WebhookConfig.kt`, and `PreferencesManager.kt` at that tag
- official release asset `app-foss-release.apk`, published 2026-07-02, upstream
  SHA-256 `8febb4a35f9679f52f3c41c368289a52f0c95dec9922c05ea5be009ebe2f13a0`

The accepted POST body is deliberately narrower than the upstream schema:

```json
{
  "timestamp": "2026-08-15T07:00:00Z",
  "app_version": "1.9.14-md2",
  "steps": [
    {
      "count": 8421,
      "start_time": "2026-08-13T14:00:00Z",
      "end_time": "2026-08-14T14:00:00Z"
    }
  ]
}
```

Only `timestamp`, `app_version`, and optional `steps` are accepted. Other
health arrays are rejected. Released source may add step provenance under the
optional `metadata` object; MacroDaddy retains only `data_origin` as source
identity and never exposes it as health information.

Use Steps **Daily** resolution. A daily record is keyed by its Brisbane date,
so retries and today's changing partial end time upsert the same logical row.
Raw records fall back to a hash of data origin plus exact interval. Daily
totals are rebuilt from intervals after every delivery, not incremented.

## Upstream limitations

The v1.9.14 base reads a rolling 48-hour window for normal sync, retries each webhook
up to three times with exponential backoff, and uses a per-type end-time
watermark after a successful delivery. Explicit manual ranges bypass that
watermark. WorkManager interval sync has Android's 15-minute minimum and is
best-effort; Samsung battery management can delay it.

The incremental filter is based on a record's `endTime`, not Health Connect's
`lastModifiedTime`. A correction whose interval ends before the saved cursor
may therefore require a manual date-range backfill. The receiver safely
upserts that backfill, but the phone app is responsible for actually sending
it.

The unpatched release filters step totals to `> 0`, omits empty arrays, sends no
webhook when the whole result is empty, and does not state the queried coverage
window. Consequently, an all-zero day cannot be distinguished from unavailable
data by any standards-compliant receiver. MacroDaddy never guesses: no record
means `missing`; a received zero record means `complete` with zero. A future
upstream payload must explicitly report coverage or zero records before this
gap can be closed without a patch. The `md2` build makes Daily resolution emit
all aggregates including zero. It also queries each complete calendar-day
aggregation while retaining the real sync time as today's emitted end time;
this avoids Health Connect proportionally clipping Samsung Health's
00:00–23:59 cumulative record during a mid-day sync.

The payload has no Health Connect record ID. Daily resolution provides a stable
calendar identity; changing to raw/bucketed resolution is unsupported for the
guaranteed correction semantics and can make coincident intervals ambiguous.

Webhook URLs and custom headers are stored in the app's private, unencrypted
`SharedPreferences`; the `md2` manifest disables Android cloud backup to keep
them out of device backups. Treat the bearer token like a password, keep the
phone lock enabled, do not export/share the bridge's settings file, and revoke
the token from MacroDaddy if the phone is compromised. FeedbackJar is contacted
only when the user explicitly submits feedback; that submission includes app
and device metadata. The optional unauthenticated local HTTP server should stay
disabled for this integration.

## Isolation contract

Steps tables are queried only by the steps routes and account export/reset.
Coaching, adaptive TDEE, check-ins, expenditure, energy balance, targets,
goals, programs, and nutrition code must never import or query them.
