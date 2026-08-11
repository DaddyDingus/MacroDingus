import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { apiFetch } from "../api/client";

export const ANDROID_UPDATE_CHECK_EVENT = "macrotrack:check-android-update";

interface AndroidRelease {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
}

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
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const lastCheckedAt = useRef(0);

  useEffect(() => {
    const bridge = window.MacroTrackAndroid;
    if (!bridge?.getVersionName) return;

    const check = async (manual: boolean) => {
      try {
        const available = await apiFetch<AndroidRelease>("/android/version");
        const installed = bridge.getVersionName();
        lastCheckedAt.current = Date.now();
        if (isNewer(available.versionName, installed)) {
          if (manual || sessionStorage.getItem("macrotrack-dismissed-update") !== available.versionName) {
            setRelease(available);
          }
        } else if (manual) {
          window.alert(`MacroTrack ${installed} is up to date.`);
        }
      } catch {
        if (manual) window.alert("Couldn't check for an app update.");
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

  if (!release) return null;

  return (
    <div className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-md rounded-2xl border border-line bg-surface-raised/95 p-3 shadow-2xl backdrop-blur-xl" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Download size={17} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">MacroTrack {release.versionName} is available</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">Download it here, then Android will ask you to confirm the update.</p>
          <button
            type="button"
            className="mt-2 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-black active:opacity-75"
            onClick={() => {
              window.MacroTrackAndroid?.openUpdate(new URL(release.downloadUrl, window.location.href).toString());
              setRelease(null);
            }}
          >
            Download update
          </button>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-white/10"
          aria-label="Remind me next time"
          onClick={() => {
            sessionStorage.setItem("macrotrack-dismissed-update", release.versionName);
            setRelease(null);
          }}
        >
          <X size={17} />
        </button>
      </div>
    </div>
  );
}
