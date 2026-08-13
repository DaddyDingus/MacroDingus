# GEMINI.md

Gemini CLI reads this file's name specifically — it does not pick up `CLAUDE.md` automatically. This repo's actual guidance lives there; read it in full before making changes.

See: `./CLAUDE.md`

The production brand and canonical URL are MacroDaddy at
`https://macrodaddy.tail984e80.ts.net/`, using shared Authentik at
`https://auth.tail984e80.ts.net/`. Android 1.9 keeps both hosts in one WebView.
Historical internal `macrotrack` identifiers remain compatibility contracts;
do not rename them. The old MacroTrack URLs are migration fallbacks only.

The single most important rule in it, repeated here since it's the one most likely to get missed: **editing source is not enough.** This app runs as a single Docker container the user checks on their phone. After any change:

```
docker compose build && docker compose up -d
```

then confirm with `docker ps` + a health check. Skipping this means the user's phone keeps showing the old build no matter how hard they refresh — indistinguishable from "the fix didn't work," which wastes further debugging attempts on both sides.

For Android/APK work, follow `CLAUDE.md`'s **Web and Android workflow** in
full, including version matching, signed build, deployment verification, and
the clickable APK link in the user handoff.
