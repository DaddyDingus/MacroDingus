import { useEffect, useRef, useState } from "react";
import { Download, X, Check, Loader2, AlertTriangle } from "lucide-react";
import { apiFetch } from "../api/client";

export const ANDROID_UPDATE_CHECK_EVENT = "macrotrack:check-android-update";

// How long the two transient outcomes ("up to date", "couldn't check") stay
// on screen before clearing themselves. They replaced window.alert(), which
// is an OS dialog: unstyled, centred, and needing a tap to get rid of — it
// read as a different app interrupting this one.
const TRANSIENT_MS = 3200;

interface AndroidRelease {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
}

// Only one of these is ever on screen. "checking" and the two transient
// outcomes are manual-check-only; a background check that finds nothing stays
// silent, exactly as it did when the outcomes were alerts.
type Notice =
  | { kind: "checking" }
  | { kind: "available"; release: AndroidRelease }
  | { kind: "upToDate"; version: string }
  | { kind: "failed" };

interface MacroTrackAndroidBridge {
  getVersionName(): string;
  openUpdate(url: string): void;
  isNativeApp(): boolean;
  // Optional: absent in APKs built before 1.6 (see lib/theme.tsx).
  setThemeColor?(color: string): void;
}

declare global {
  interface Window {
    MacroTrackAndroid?: MacroTrackAndroidBridge;
  }
}

function isNewer(candidate: string, installed: string): boolean {
  const left = candidate.split(".").map((part) => Number(part) || 0);
  const right = installed.split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  }
  return false;
}

export default function AndroidUpdatePrompt() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const lastCheckedAt = useRef(0);

  useEffect(() => {
    const bridge = window.MacroTrackAndroid;
    if (!bridge?.getVersionName) return;

    const check = async (manual: boolean) => {
      if (manual) setNotice({ kind: "checking" });
      try {
        const available = await apiFetch<AndroidRelease>("/android/version");
        const installed = bridge.getVersionName();
        lastCheckedAt.current = Date.now();
        if (isNewer(available.versionName, installed)) {
          if (manual || sessionStorage.getItem("macrotrack-dismissed-update") !== available.versionName) {
            setNotice({ kind: "available", release: available });
          } else if (manual) {
            setNotice(null);
          }
        } else if (manual) {
          setNotice({ kind: "upToDate", version: installed });
        } else {
          setNotice(null);
        }
      } catch {
        setNotice(manual ? { kind: "failed" } : null);
      }
    };

    const onManualCheck = () => void check(true);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheckedAt.current >= 6 * 60 * 60_000) {
        void check(false);
      }
    };
    window.addEventListener(ANDROID_UPDATE_CHECK_EVENT, onManualCheck);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setTimeout(() => void check(false), 1_000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(ANDROID_UPDATE_CHECK_EVENT, onManualCheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // "Available" is the one outcome that waits for a decision; the rest are
  // acknowledgements and clear themselves.
  useEffect(() => {
    if (!notice || notice.kind === "available" || notice.kind === "checking") return;
    const timer = window.setTimeout(() => setNotice(null), TRANSIENT_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-md rounded-2xl border border-line bg-surface-raised/95 p-3 shadow-2xl backdrop-blur-xl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            notice.kind === "failed" ? "bg-protein/15 text-protein" : "bg-accent/15 text-accent"
          }`}
        >
          {notice.kind === "checking" && <Loader2 size={17} strokeWidth={2.4} className="animate-spin" />}
          {notice.kind === "available" && <Download size={17} strokeWidth={2.4} />}
          {notice.kind === "upToDate" && <Check size={17} strokeWidth={2.6} />}
          {notice.kind === "failed" && <AlertTriangle size={17} strokeWidth={2.4} />}
        </span>

        <div className="min-w-0 flex-1">
          {notice.kind === "checking" && (
            <>
              <p className="text-sm font-semibold">Checking for an update…</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">Asking the server what the latest build is.</p>
            </>
          )}
          {notice.kind === "upToDate" && (
            <>
              <p className="text-sm font-semibold">MacroDaddy {notice.version} is up to date</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">You already have the latest build installed.</p>
            </>
          )}
          {notice.kind === "failed" && (
            <>
              <p className="text-sm font-semibold">Couldn't check for an update</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                The server didn't answer. Check your connection and try again.
              </p>
            </>
          )}
          {notice.kind === "available" && (
            <>
              <p className="text-sm font-semibold">MacroDaddy {notice.release.versionName} is available</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Download it here, then Android will ask you to confirm the update.
              </p>
              <button
                type="button"
                className="mt-2 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-black active:opacity-75"
                onClick={() => {
                  window.MacroTrackAndroid?.openUpdate(
                    new URL(notice.release.downloadUrl, window.location.href).toString(),
                  );
                  setNotice(null);
                }}
              >
                Download update
              </button>
            </>
          )}
        </div>

        {notice.kind !== "checking" && (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-white/10"
            aria-label="Dismiss"
            onClick={() => {
              if (notice.kind === "available") {
                sessionStorage.setItem("macrotrack-dismissed-update", notice.release.versionName);
              }
              setNotice(null);
            }}
          >
            <X size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
