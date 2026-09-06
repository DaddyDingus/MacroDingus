import { useState } from "react";
import { Ban, ExternalLink, ShieldCheck, Trash2, UserCheck, Undo2 } from "lucide-react";
import { useAdminUsers, useSetAccountAccess, type AdminUser } from "../api/admin";
import { useAuthStatus } from "../api/auth";
import DeleteAccountSheet from "../components/DeleteAccountSheet";
import { formatDayLabel } from "../lib/date";
import { staggerStyle } from "../lib/stagger";

function formatSeen(value: string | null): string {
  if (!value) return "Never opened the app";
  return `Last opened ${new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function activityLine(user: AdminUser): string {
  if (!user.logCount && !user.weightCount && !user.photoCount) return "No data yet";
  const parts: string[] = [];
  if (user.logCount) parts.push(`${user.logCount} ${user.logCount === 1 ? "entry" : "entries"}`);
  if (user.weightCount) parts.push(`${user.weightCount} ${user.weightCount === 1 ? "weigh-in" : "weigh-ins"}`);
  if (user.photoCount) parts.push(`${user.photoCount} ${user.photoCount === 1 ? "photo" : "photos"}`);
  if (user.lastLoggedDate) parts.push(`last logged ${formatDayLabel(user.lastLoggedDate)}`);
  return parts.join(" · ");
}

function Badge({ label, tone }: { label: string; tone: "accent" | "warn" | "muted" }) {
  const styles =
    tone === "accent"
      ? "text-accent border-accent/30 bg-accent/10"
      : tone === "warn"
        ? "border-transparent"
        : "text-muted border-line";
  return (
    <span
      className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border ${styles}`}
      style={tone === "warn" ? { color: "#D95926", background: "rgba(217,89,38,0.12)" } : undefined}
    >
      {label}
    </span>
  );
}

export default function AdminUsersScreen() {
  const authStatus = useAuthStatus();
  const isAdmin = authStatus.data?.user?.role === "admin";
  const accounts = useAdminUsers(isAdmin);
  const setAccess = useSetAccountAccess();
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);

  const accountManagerUrl = accounts.data?.accountManagerUrl ?? null;
  let block = 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <p className="text-[11px] text-muted">More</p>
        <h1 className="text-lg font-medium text-center -mt-4">Accounts</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        {!isAdmin ? (
          <section className="border border-line bg-surface rounded-2xl p-4">
            <p className="text-sm">Administrator access is required to manage accounts.</p>
          </section>
        ) : (
          <>
            <section className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  <ShieldCheck size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Authentik owns who can sign in</p>
                  <p className="text-xs text-muted mt-1 leading-relaxed">
                    Accounts here are created automatically the first time someone signs in with Authentik. Names,
                    passwords, and whether a person exists at all are managed there — this screen manages their
                    MacroDaddy data and access.
                  </p>
                  {accountManagerUrl && (
                    <a
                      href={accountManagerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-accent mt-2"
                    >
                      <ExternalLink size={13} />
                      Open Authentik
                    </a>
                  )}
                </div>
              </div>
            </section>

            {accounts.isLoading && <p className="text-xs text-muted text-center py-4">Loading accounts…</p>}
            {accounts.isError && (
              <p className="text-xs text-red-400 text-center py-4">Couldn't load accounts — try again.</p>
            )}

            {accounts.data?.users.map((user) => {
              const blocked = Boolean(user.disabledAt);
              return (
                <section
                  key={user.id}
                  className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden"
                  style={staggerStyle(block++, 60, 5)}
                >
                  <div className="px-4 py-3.5 flex items-center gap-3">
                    <span
                      className={`shrink-0 w-11 h-11 rounded-full border flex items-center justify-center text-base font-semibold ${
                        blocked ? "border-line text-muted bg-surface-raised" : "bg-accent/15 border-accent/40 text-accent"
                      }`}
                    >
                      {user.name.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold truncate">{user.name}</p>
                        {user.isSelf && <Badge label="You" tone="accent" />}
                        {user.role === "admin" && <Badge label="Admin" tone="muted" />}
                        {blocked && <Badge label="Blocked" tone="warn" />}
                      </div>
                      <p className="text-xs text-muted mt-0.5 truncate">{activityLine(user)}</p>
                      <p className="text-[11px] text-muted mt-0.5 truncate">{formatSeen(user.lastSeenAt)}</p>
                    </div>
                  </div>

                  {/* An unlinked account is a live claim slot, not an idle
                      row: auth.ts hands it to whoever next signs in under a
                      matching name. Worth stating plainly rather than showing
                      an ambiguous "not linked". */}
                  {!user.authentikLinked && (
                    <p className="px-4 pb-3 text-[11px] text-muted leading-relaxed">
                      Not linked to Authentik yet — the next person to sign in as “{user.name}” will take over this
                      account and its data.
                    </p>
                  )}

                  {!user.isSelf && (
                    <div className="border-t border-line flex">
                      <button
                        onClick={() => setAccess.mutate({ id: user.id, disabled: !blocked })}
                        disabled={setAccess.isPending}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium active:bg-surface-raised disabled:opacity-50"
                      >
                        {blocked ? <Undo2 size={14} /> : <Ban size={14} />}
                        {blocked ? "Allow" : "Block"}
                      </button>
                      <button
                        onClick={() => setPendingDelete(user)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium border-l border-line active:bg-surface-raised"
                        style={{ color: "#D95926" }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  )}
                </section>
              );
            })}

            <section className="border border-line bg-surface rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-surface-raised text-muted flex items-center justify-center shrink-0">
                  <UserCheck size={17} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Block vs delete</p>
                  <p className="text-xs text-muted mt-1 leading-relaxed">
                    <span className="text-ink">Block</span> keeps their data but refuses sign-in, and signs them out
                    everywhere immediately. <span className="text-ink">Delete</span> erases their data — but they can
                    sign in again and start fresh, so it isn't a way to remove access.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {pendingDelete && (
        <DeleteAccountSheet
          user={pendingDelete}
          accountManagerUrl={accountManagerUrl}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
