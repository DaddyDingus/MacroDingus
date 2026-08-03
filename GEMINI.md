# GEMINI.md

Gemini CLI reads this file's name specifically — it does not pick up `CLAUDE.md` automatically. This repo's actual guidance lives there; read it in full before making changes.

See: `./CLAUDE.md`

The single most important rule in it, repeated here since it's the one most likely to get missed: **editing source is not enough.** This app runs as a single Docker container the user checks on their phone. After any change:

```
docker compose build && docker compose up -d
```

then confirm with `docker ps` + a health check. Skipping this means the user's phone keeps showing the old build no matter how hard they refresh — indistinguishable from "the fix didn't work," which wastes further debugging attempts on both sides.
