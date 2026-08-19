import { useState } from "react";
import { ChefHat, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useCreateIntegrationToken, useIntegrationTokens, useRevokeIntegrationToken } from "../api/integrations";

function formatWhen(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

/**
 * Tokens that let another of this household's apps write on your behalf —
 * currently DaddysRecipes logging a cooked serving.
 *
 * Same shape as the Health Connect screen's tokens, and deliberately a
 * separate list: a steps token can't write food, and revoking one here never
 * affects the other.
 */
export default function IntegrationsScreen() {
  const tokens = useIntegrationTokens();
  const create = useCreateIntegrationToken();
  const revoke = useRevokeIntegrationToken();
  const [name, setName] = useState("DaddysRecipes");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  const list = tokens.data?.tokens ?? [];

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <p className="text-[11px] text-muted">More</p>
        <h1 className="text-lg font-medium text-center -mt-4">Integrations</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        <section className="border border-line bg-surface rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-carbs/10 text-carbs flex items-center justify-center shrink-0">
              <ChefHat size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold">Log a cooked recipe here</p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                DaddysRecipes can estimate a recipe's nutrition and send a serving straight to your
                food diary. Create a token below and paste it there, in More → MacroDaddy.
              </p>
            </div>
          </div>
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-sm font-medium flex items-center gap-1.5"><KeyRound size={14} /> Tokens</p>
          </div>

          <div className="px-4 py-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="What is this for?"
                className="flex-1 min-w-0 rounded-lg border border-line bg-dashboardCard px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate(name.trim(), { onSuccess: (result) => setRevealedToken(result.token) })}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black active:opacity-80 disabled:opacity-40"
              >
                {create.isPending ? "Creating…" : "Create"}
              </button>
            </div>

            {create.isError && (
              <p className="mt-2 text-xs text-protein">{(create.error as Error).message}</p>
            )}

            {revealedToken && (
              <div className="mt-4 rounded-xl border border-carbs/30 bg-carbs/5 p-3">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-carbs" /> Copy this now
                </p>
                <p className="text-[11px] text-muted mt-1">
                  Shown once — MacroDaddy stores only its hash and can never show it again.
                </p>
                <code className="block mt-2 text-[11px] break-all select-all">{revealedToken}</code>
                <button
                  type="button"
                  onClick={copyToken}
                  className="mt-2 rounded-full border border-line px-3 py-1.5 text-xs active:bg-surface-raised"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>

          {list.map((token) => (
            <div key={token.id} className="px-4 py-3 border-t border-line/60 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{token.name}</p>
                <p className="text-xs text-muted mt-0.5">
                  {token.tokenPrefix} · last used {formatWhen(token.lastUsedAt)}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Revoke ${token.name}`}
                onClick={() => revoke.mutate(token.id)}
                className="p-2 text-protein active:opacity-70"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          {list.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted border-t border-line/60">
              No tokens yet.
            </p>
          )}
        </section>

        <p className="px-1 text-[11px] text-muted leading-relaxed">
          A token can create food entries and log them to your diary. It cannot read your data, change
          your goals, or create another token. Revoke one here and it stops working immediately.
        </p>
      </main>
    </div>
  );
}
