# GEMINI.md

Gemini CLI reads this file's name specifically — it does not pick up `CLAUDE.md` automatically. This repo's actual guidance lives there; read it in full before making changes.

See: `./CLAUDE.md`

The single most important rule in it, repeated here since it's the one most likely to get missed: **editing source is not enough.** This app runs as a single Docker container the user checks on their phone. After any change:

run the `macrodingus.yml` GitHub Actions workflow with a **new** version number, then bump the pinned image tag in the homelab repo's stack file so Portainer redeploys. This fork is NOT deployed with `docker compose` on the host.

Skipping this means the user's phone keeps showing the old build no matter how hard they refresh — indistinguishable from "the fix didn't work," which wastes further debugging attempts on both sides. Reusing a version number has the same symptom for a different reason: the registry overwrites the tag, and Portainer's GitOps diff sees no change.
