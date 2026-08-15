import { useMemo, useState } from "react";
import { Check, Clipboard, Download, Footprints, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCreateStepsToken, useRevokeStepsToken, useStepsStatus } from "../api/steps";

function formatSync(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

export default function HealthConnectScreen() {
  const status = useStepsStatus();
  const create = useCreateStepsToken();
  const revoke = useRevokeStepsToken();
  const [name, setName] = useState("My phone");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const webhookUrl = useMemo(() => `${window.location.origin}/api/steps/webhook`, []);
  const headerValue = revealedToken ? `Bearer ${revealedToken}` : null;

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied((current) => current === label ? null : current), 2_000);
  }

  function createToken() {
    create.mutate(name, { onSuccess: (result) => setRevealedToken(result.token) });
  }

  function downloadBridge() {
    const url = new URL("/api/android/health-connect-apk?v=1.9.14-md2", window.location.origin).toString();
    if (window.MacroTrackAndroid?.openUpdate) {
      window.MacroTrackAndroid.openUpdate(url);
      return;
    }
    window.location.assign(url);
  }

  const activeTokens = (status.data?.tokens ?? []).filter((token) => !token.revokedAt);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <p className="text-[11px] text-muted">More</p>
        <h1 className="text-lg font-medium text-center -mt-4">Health Connect</h1>
      </header>
      <main className="px-4 space-y-4 max-w-md mx-auto">
        <section className="border border-line bg-surface rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-carbs/10 text-carbs flex items-center justify-center shrink-0">
              <Footprints size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold">Steps are informational only</p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Health Connect Webhook is the bridge from your phone. Step counts never change expenditure, check-ins,
                energy balance, nutrition targets, goals, programs, or food calculations.
              </p>
            </div>
          </div>
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <RefreshCw size={15} className="text-muted" />
            <p className="text-sm font-medium">Connection status</p>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 gap-3 text-xs">
            <div><p className="text-muted">Last successful sync</p><p className="mt-1">{formatSync(status.data?.sync?.lastSuccessfulSyncAt)}</p></div>
            <div><p className="text-muted">App version</p><p className="mt-1">{status.data?.sync?.lastAppVersion ?? `Expected ${status.data?.supportedAppVersion ?? "1.9.14"}`}</p></div>
            <div><p className="text-muted">Active tokens</p><p className="mt-1">{activeTokens.length}</p></div>
            <div><p className="text-muted">Payload contract</p><p className="mt-1 break-all">{status.data?.contract ?? "health-connect-webhook/v1.9.14"}</p></div>
          </div>
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <KeyRound size={15} className="text-muted" />
            <p className="text-sm font-medium">Webhook token</p>
          </div>
          <div className="p-4">
            <label className="block text-xs text-muted mb-1.5" htmlFor="steps-token-name">Connection name</label>
            <div className="rounded-xl border border-line focus-within:border-accent bg-dashboardBg px-3">
              <input
                id="steps-token-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                className="w-full bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
            <button
              type="button"
              onClick={createToken}
              disabled={create.isPending || !name.trim()}
              className="w-full mt-3 py-2.5 rounded-full bg-accent text-black text-sm font-semibold disabled:opacity-50"
            >
              {create.isPending ? "Creating…" : "Create token"}
            </button>
            {revealedToken && (
              <div className="mt-4 rounded-xl border border-carbs/30 bg-carbs/5 p-3">
                <p className="text-xs font-medium flex items-center gap-1.5"><ShieldCheck size={14} className="text-carbs" /> Copy this now</p>
                <p className="text-[11px] text-muted mt-1">The token is shown once. MacroDaddy stores only its hash.</p>
                <code className="block mt-2 text-[11px] break-all select-all">{revealedToken}</code>
              </div>
            )}
          </div>
          {activeTokens.map((token) => (
            <div key={token.id} className="px-4 py-3 border-t border-line/60 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{token.name}</p>
                <p className="text-xs text-muted mt-0.5">{token.tokenPrefix} · last used {formatSync(token.lastUsedAt)}</p>
              </div>
              <button type="button" aria-label={`Revoke ${token.name}`} onClick={() => revoke.mutate(token.id)} className="p-2 text-protein">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line"><p className="text-sm font-medium">Webhook settings</p></div>
          {[
            ["url", "Webhook URL", webhookUrl],
            ["header-name", "Header name", "Authorization"],
            ["header-value", "Header value", headerValue ?? "Create a token above first"],
          ].map(([id, label, value]) => (
            <div key={id} className="px-4 py-3 border-b border-line/60 last:border-b-0">
              <p className="text-xs text-muted">{label}</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="text-[11px] break-all flex-1 select-all">{value}</code>
                <button type="button" disabled={id === "header-value" && !headerValue} onClick={() => copy(id, value)} className="p-2 text-accent disabled:opacity-30" aria-label={`Copy ${label}`}>
                  {copied === id ? <Check size={16} /> : <Clipboard size={16} />}
                </button>
              </div>
            </div>
          ))}
        </section>

        <section className="border border-line bg-surface rounded-2xl p-4">
          <p className="text-sm font-medium">Phone setup</p>
          <ol className="mt-2 space-y-2 text-xs text-muted leading-relaxed list-decimal pl-4">
            <li>Install MacroDaddy Health Connect v1.9.14-md2 from the link below.</li>
            <li>Add the URL and the complete custom Authorization header shown above.</li>
            <li>Enable only <span className="text-ink">Steps</span>, grant Steps plus background/history access, and leave Steps resolution on Daily.</li>
            <li>Choose Interval mode at 30–60 minutes, save, then run Sync Now once.</li>
            <li>Allow background activity and exclude the app from Samsung battery optimisation.</li>
          </ol>
          <button
            type="button"
            onClick={downloadBridge}
            className="mt-3 flex w-full min-w-0 items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-xs font-semibold text-black active:opacity-75"
          >
            <Download size={14} className="shrink-0" />
            <span className="min-w-0 truncate">Download bridge v1.9.14-md2</span>
          </button>
          <p className="text-[11px] text-muted mt-3 leading-relaxed">
            This reproducible build is the pinned official source with a minimal patch that emits explicit zero-step days and disables Android cloud backup. Missing data and recorded zero remain distinct.
          </p>
        </section>
      </main>
    </div>
  );
}
