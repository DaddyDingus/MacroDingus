# MacroDaddy Health Connect bridge build

This is a minimal patch/build wrapper around the official Health Connect
Webhook v1.9.14 source. It does not implement another Health Connect client.

Pinned upstream:

- tag: `v1.9.14`
- commit: `650c4cc84972700200ed74497894c30994321eba`
- MacroDaddy build: `1.9.14-md2` (`versionCode` 10915)
- application ID: `com.macrodaddy.healthconnectwebhook`

The patch makes Daily Steps emit explicit zero totals and reads the complete
calendar-day aggregation so Samsung Health's full-day cumulative record is not
proportionally clipped when today is queried before midnight. It still emits
the actual sync time as today's interval end, preserving partial-day status.
It also disables Android cloud backup so the custom Authorization header is
not copied into device backups. A distinct application ID and permanent local
signing key keep this build independent from the paid/official signing track.

Run `./build.sh` to clone the pinned source, verify its commit, apply the
reviewable patch, and produce `health-connect-webhook.apk`. It uses the
existing permanent MacroDaddy signing key, so that key and its password remain
the update identity for both Android packages. Never regenerate them.
