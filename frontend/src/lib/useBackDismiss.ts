import { useEffect, useRef } from "react";

// A history "trap" for a sheet/modal/dialog so Android's hardware or
// gesture back button closes *this* overlay instead of skipping straight
// past it to whatever the browser would otherwise do underneath — the
// previous screen, or a straight app-exit if there's no more history.
// Nothing in this app pushed a history entry for an open sheet before this
// existed, so back fell all the way through every one of them.
//
// Nested traps are a real case here (AddFoodSheet's own trap stays mounted
// the whole time it's open, while its unlogged-plate warning mounts a
// second trap on top of it), so this can't just be "each hook instance
// attaches its own popstate listener" — every listener attached to
// `window` fires on every popstate regardless of which trap's entry
// actually got popped, and a plain per-instance implementation double-fires
// (or fires the wrong layer) the moment two of these are active at once.
// Instead there's one shared listener and an in-memory stack of active
// trap ids; only the topmost (most recently activated) one reacts to a
// given pop, same as a real modal stack — an outer sheet still mounted
// underneath a nested dialog leaves its own entry untouched, waiting for a
// later press once the dialog above it is gone.
interface TrapEntry {
  id: symbol;
  dismiss: () => void;
}
const trapStack: TrapEntry[] = [];
let listenerAttached = false;
// A trap's own cleanup calls history.back() to unwind a dummy entry it no
// longer needs (closed via its X button, not the back gesture) — that
// call fires a popstate exactly like a real back press would, so it has to
// self-identify and get silently absorbed here rather than being
// misread as a fresh user gesture by whichever trap is now on top.
let pendingProgrammaticPops = 0;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("popstate", () => {
    if (pendingProgrammaticPops > 0) {
      pendingProgrammaticPops--;
      return;
    }
    const top = trapStack[trapStack.length - 1];
    if (!top) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    top.dismiss();
    // A real back press consumes exactly one history entry — re-push
    // immediately so the *same* trap keeps catching subsequent presses too
    // (e.g. AddFoodSheet's `open` never flips false just because its
    // warning popped up over it, so a second press with the session still
    // active must still be caught rather than falling through).
    //
    // Spreads the *existing* history.state rather than replacing it wholesale
    // — react-router's own history object stores its own bookkeeping there
    // (a `{ usr, key, idx }` shape, roughly) on every entry it creates via
    // its own push/replace. A plain `pushState({ __backDismiss: true }, "")`
    // wipes that out, and the next time this entry's popped — even by a
    // completely unrelated real back-navigation later, anywhere else in the
    // app — react-router's own popstate handler reads back a `state` missing
    // the fields it expects, can't match it to a location it already knows
    // about, and has to mint a *new* one instead of reusing whichever one
    // was actually current. That's what was making `location.key`/
    // `useNavigationType()` unreliable for a stretch after any sheet had
    // been opened and closed at all — not just while a trap was active.
    history.pushState({ ...history.state, __backDismiss: true }, "");
  });
}

export function useBackDismiss(active: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const idRef = useRef<symbol>();
  if (!idRef.current) idRef.current = Symbol("backDismiss");

  useEffect(() => {
    if (!active) return;
    ensureListener();
    const entry: TrapEntry = { id: idRef.current!, dismiss: () => onDismissRef.current() };
    trapStack.push(entry);
    // See the other pushState call's comment — merges with whatever
    // react-router already stored here instead of overwriting it.
    history.pushState({ ...history.state, __backDismiss: true }, "");

    return () => {
      const idx = trapStack.findIndex((e) => e.id === entry.id);
      if (idx !== -1) trapStack.splice(idx, 1);
      // Closed some other way (X button, completing the flow) rather than
      // via the back button — our dummy entry is still sitting on top of
      // history and has to be unwound here, or back would need pressing
      // twice next time and forward could resurrect a phantom entry.
      if (history.state?.__backDismiss) {
        pendingProgrammaticPops++;
        history.back();
      }
    };
  }, [active]);
}
