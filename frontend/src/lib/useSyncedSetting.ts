import { useEffect, useRef } from "react";
import { useSettings, useUpdateSettings } from "../api/settings";

// Bridges one localStorage-backed preference (still read synchronously on
// mount by the calling Context, for instant paint and pre-auth availability
// — see theme.tsx, which renders on LoginScreen too) with the account-level
// settings endpoint, which becomes the source of truth once it loads.
//
// On first load: if the server already has a valid value for `key`, it wins
// (applied via `apply`, which is whatever the Context already uses to update
// its own state + localStorage). If the server has nothing yet, whatever's
// currently in localStorage on THIS device gets pushed up once — a one-time
// backfill so an existing user's current preferences attach to their account
// the first time they open the app after this shipped, not only after they
// next change the setting.
//
// Every subsequent change goes through the returned `set`, which updates
// local state/localStorage exactly as before AND mirrors it to the server.
export function useSyncedSetting<T>(
  key: string,
  currentValue: T,
  apply: (value: T) => void,
  sanitize: (raw: unknown) => T | null
) {
  const settings = useSettings();
  const update = useUpdateSettings();
  const handled = useRef(false);
  const currentRef = useRef(currentValue);
  currentRef.current = currentValue;

  useEffect(() => {
    if (handled.current || !settings.data) return;
    handled.current = true;
    const fromServer = sanitize(settings.data[key]);
    if (fromServer !== null) {
      apply(fromServer);
    } else {
      update.mutate({ [key]: currentRef.current });
    }
    // Deliberately only [settings.data] — this must run exactly once, the
    // first time the account's settings actually arrive, not on every
    // render or every local change (which would fight the user's own edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  return function set(value: T) {
    apply(value);
    update.mutate({ [key]: value });
  };
}
