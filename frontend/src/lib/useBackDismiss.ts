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
//
// THE RULE THIS FILE EXISTS TO ENFORCE, learned the hard way (see the long
// note on the popstate listener below): one active trap owns exactly one
// history entry, that entry is pushed at the moment the user's own tap creates
// the level it represents, and a back press consumes it permanently. Nothing
// here ever pushes a history entry while handling a popstate. A UI that needs
// to absorb N back presses holds N entries via useBackDismissDepth rather than
// one trap that re-arms itself.
//
// Callers that replace one trapped overlay with another (e.g.
// QuickActionsSheet swapping its own menu for QuickActionFlow's overlay once
// an action is picked) should call armTrapHandoff() first — see that function.
interface TrapEntry {
  id: symbol;
  dismiss: () => void;
  shouldBlock?: () => boolean;
  onBlocked?: () => void;
  bypassBlockOnce: boolean;
  restoring: boolean;
  proceedAfterRestore: boolean;
  // Set when a real back press pops this trap's entry. The entry is gone at
  // that point, so the cleanup below must NOT try to unwind it again — that's
  // what distinguishes "closed by back" from "closed by an X button".
  consumed: boolean;
}
const trapStack: TrapEntry[] = [];
let listenerAttached = false;
// A trap's own cleanup calls history.back() to unwind a dummy entry it no
// longer needs (closed via its X button, not the back gesture) — that
// call fires a popstate exactly like a real back press would, so it has to
// self-identify and get silently absorbed here rather than being
// misread as a fresh user gesture by whichever trap is now on top.
let pendingProgrammaticPops = 0;
// A blocker cancels a back traversal by going forward to the exact entry the
// browser just left. That forward traversal also fires popstate, so remember
// which entry it belongs to and absorb that one event without involving the
// trap underneath.
let pendingRestoredTrap: TrapEntry | null = null;
function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("popstate", () => {
    if (pendingRestoredTrap) {
      const restored = pendingRestoredTrap;
      pendingRestoredTrap = null;
      restored.restoring = false;
      if (restored.proceedAfterRestore && trapStack.includes(restored)) {
        restored.proceedAfterRestore = false;
        restored.bypassBlockOnce = true;
        history.back();
      }
      return;
    }
    if (pendingProgrammaticPops > 0) {
      pendingProgrammaticPops--;
      return;
    }
    // Nothing left to catch this press — it leaves the app, correctly.
    const top = trapStack[trapStack.length - 1];
    if (!top) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // An opt-in blocker can veto this traversal without creating any new
    // history. Go forward to the exact entry that was just popped, then keep
    // owning it. This is fundamentally different from pushState-in-popstate:
    // no new entry is created without user activation, so Chrome's History
    // Manipulation Intervention has nothing to mark as skippable.
    if (!top.bypassBlockOnce && top.shouldBlock?.()) {
      top.onBlocked?.();
      top.restoring = true;
      pendingRestoredTrap = top;
      history.forward();
      return;
    }
    top.bypassBlockOnce = false;
    // This entry is gone for good now — the cleanup below must not unwind it,
    // and it comes off the stack immediately rather than when its owner gets
    // round to unmounting. The stack has to mirror entries that actually still
    // exist: a sheet whose close is animated stays mounted for another ~320ms
    // after being dismissed, and a second press inside that window must fall
    // through to the level underneath instead of re-dismissing this one (which
    // would no-op while the browser silently popped somebody else's entry).
    top.consumed = true;
    trapStack.pop();
    top.dismiss();
    // DO NOT push a replacement entry here. This handler used to re-push
    // immediately so one trap could keep catching press after press, and that
    // single line was the whole bug behind "the back gesture exits the app":
    //
    // Chrome's History Manipulation Intervention marks the entry a page
    // navigates *away from* as `should_skip_on_back_forward_ui` whenever the
    // page pushes an entry without user activation. A back gesture is browser
    // chrome, not a page interaction, so it grants no activation — meaning a
    // pushState from inside this handler silently poisoned whatever entry sat
    // underneath (usually the app's own initial one). The next back press then
    // found nothing non-skippable behind it and left the app, without firing
    // popstate at all.
    //
    // That flag is scoped to back/forward *UI*, which is why this was
    // invisible to every scripted reproduction: a programmatic history.back()
    // ignores it and traverses happily. Five fixes were built and shipped
    // against desktop tests that could not, even in principle, observe the
    // failure — the device trace that caught it showed the tell, a `hidden`
    // event with no preceding popstate while history.length was still 2.
    //
    // A trap that must survive more than one press is therefore N stacked
    // traps (useBackDismissDepth below), each pushed by the tap that created
    // its level, where user activation genuinely exists. Corollary: nothing
    // may open a *new* overlay in response to a back press — there is no way
    // to give it an entry. Chrome has effectively outlawed that pattern.
  });
}

// Swapping one trapped overlay for another (the "+" menu handing off to the
// overlay for the action just picked; the recipe list handing off to
// AddFoodSheet) would otherwise unwind the outgoing trap's entry with
// history.back() and immediately push a fresh one for the incoming trap.
// Instead the outgoing trap leaves its entry exactly where it is and the
// incoming trap adopts it — only the in-memory trapStack changes hands, and
// the swap becomes invisible to the browser.
//
// Worth being clear about what this is and isn't: it is a simplification (two
// history operations become zero), NOT the fix for the back-gesture bug. This
// machinery was built across several attempts on the theory that the handoff
// was what exited the app, and it wasn't — the culprit was the re-push in the
// popstate listener above, which is why the Dashboard's pinned-shortcut path
// (no handoff at all) failed identically once tested at the same depth. Kept
// because fewer history operations is genuinely better here, not because
// removing it is known to break anything.
//
// Two independent flags rather than one, so this doesn't depend on whether
// React happens to run the outgoing cleanup before the incoming setup — each
// side consumes its own and the result is the same in either order.
let handoffSkipUnwind = false;
let handoffAdoptEntry = false;
let handoffResetTimer: ReturnType<typeof setTimeout> | undefined;
// Generous next to the ~320ms sheet close animation, but armTrapHandoff is
// called at the swap itself rather than when it's first decided, so in
// practice this only has to survive a single commit. If the incoming overlay
// never arrives (its owner unmounted mid-animation), the flags just expire —
// deliberately without any corrective history call, since the cost of being
// wrong there is one harmless extra back press, versus a spurious real
// navigation.
const HANDOFF_WINDOW_MS = 2000;

// Call immediately before the state update that unmounts one trapped overlay
// and mounts another in its place.
export function armTrapHandoff() {
  handoffSkipUnwind = true;
  handoffAdoptEntry = true;
  clearTimeout(handoffResetTimer);
  handoffResetTimer = setTimeout(() => {
    handoffSkipUnwind = false;
    handoffAdoptEntry = false;
  }, HANDOFF_WINDOW_MS);
}

// Claims one history entry and puts `entry` on top of the trap stack.
function acquireTrapEntry(
  onDismiss: () => void,
  blocker?: { shouldBlock: () => boolean; onBlocked: () => void }
): TrapEntry {
  ensureListener();
  const entry: TrapEntry = {
    id: Symbol("backDismiss"),
    dismiss: onDismiss,
    shouldBlock: blocker?.shouldBlock,
    onBlocked: blocker?.onBlocked,
    bypassBlockOnce: false,
    restoring: false,
    proceedAfterRestore: false,
    consumed: false,
  };
  trapStack.push(entry);
  {
    // Mid-handoff (see armTrapHandoff): the overlay being replaced left its
    // dummy entry in place for this one to take over, so there's nothing to
    // push — adopting it is the whole point.
    const adopting = handoffAdoptEntry && history.state?.__backDismiss === true;
    handoffAdoptEntry = false;
    if (!adopting) {
      // The one and only place this module creates a history entry — and it
      // runs from the tap that opened this overlay, so user activation is
      // present and Chrome won't mark the entry underneath as skippable.
      //
      // Spreads the *existing* history.state rather than replacing it
      // wholesale — react-router's own history object stores its bookkeeping
      // there (a `{ usr, key, idx }` shape, roughly) on every entry it
      // creates. A plain `pushState({ __backDismiss: true }, "")` wipes that
      // out, and the next time this entry is popped — even by a completely
      // unrelated back-navigation later, anywhere in the app — react-router's
      // popstate handler reads back a `state` missing the fields it expects,
      // can't match it to a location it knows about, and mints a *new* one
      // instead of reusing whichever was actually current. That's what made
      // `location.key`/`useNavigationType()` unreliable for a stretch after
      // any sheet had been opened and closed at all.
      history.pushState({ ...history.state, __backDismiss: true }, "");
    }
  }
  return entry;
}

// Gives back whatever `acquireTrapEntry` claimed. Returns true if this entry
// is still standing in the browser's history and needs traversing away from —
// the caller batches those into one history.go(-n), since dropping several
// levels at once (a wizard jumping from its last input step to "generating")
// would otherwise fire a burst of individual history.back() calls.
function releaseTrapEntry(entry: TrapEntry): boolean {
  const idx = trapStack.findIndex((e) => e.id === entry.id);
  if (idx !== -1) trapStack.splice(idx, 1);
  // Mid-handoff: hand the entry to the incoming trap untouched rather
  // than unwinding it just for that trap to push an identical one back.
  if (handoffSkipUnwind) {
    handoffSkipUnwind = false;
    return false;
  }
  // Closed some other way (X button, completing the flow) rather than by a
  // back press — our dummy entry is still sitting on top of history and has to
  // be unwound here, or back would need pressing twice next time and forward
  // could resurrect a phantom entry.
  //
  // Keyed off this trap's own `consumed` flag rather than sniffing
  // `history.state.__backDismiss`: with several traps stacked, that state check
  // answers "is *an* entry of ours current", not "is *mine* still standing", so
  // a nested trap dismissed by back could unwind the entry belonging to the
  // trap underneath it. That was survivable only because the popstate handler
  // used to immediately re-push a replacement — the very thing that turned out
  // to be poisoning the back button.
  return !entry.consumed;
}

// One traversal for however many entries were just given up. history.go(-n)
// fires a single popstate regardless of n, so exactly one absorbed pop is
// expected back — not n of them.
function unwindTrapEntries(count: number) {
  if (count <= 0) return;
  pendingProgrammaticPops++;
  history.go(-count);
}

// The general form: an overlay that can absorb `depth` back presses before it
// closes holds `depth` history entries. Growing happens in the React commit
// triggered by the tap that deepened the UI, which is what keeps user
// activation present on the pushState — see the popstate listener above for
// why that matters more than anything else in this file.
//
// The contract for ordinary callers: **every dismiss must reduce depth by
// exactly one.** The optional outer blocker below is the sole exception: it
// cancels the traversal with history.forward() and therefore leaves both the
// UI depth and the browser depth unchanged. It never pushes a replacement.
export function useBackDismissDepth(
  depth: number,
  onDismiss: () => void,
  blocker?: { shouldBlock: () => boolean; onBlocked: () => void }
) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const ownedRef = useRef<TrapEntry[]>([]);

  useEffect(() => {
    const owned = ownedRef.current;
    const target = Math.max(0, depth);
    while (owned.length < target) {
      // Only the bottom/outermost entry can block. Any entries above it still
      // represent real sub-steps and must be consumed normally before an
      // attempted sheet close reaches the dirty-state confirmation.
      const isOutermost = owned.length === 0;
      owned.push(acquireTrapEntry(
        () => onDismissRef.current(),
        isOutermost && blockerRef.current
          ? {
              shouldBlock: () => blockerRef.current?.shouldBlock() ?? false,
              onBlocked: () => blockerRef.current?.onBlocked(),
            }
          : undefined
      ));
    }
    // Top-down, so the entries come off history in the reverse order they
    // went on, then one traversal for all of them.
    let unwind = 0;
    while (owned.length > target) if (releaseTrapEntry(owned.pop()!)) unwind++;
    unwindTrapEntries(unwind);
  }, [depth]);

  // Unmounting releases whatever is still held. Separate from the effect above
  // (which deliberately has no cleanup — a depth *change* must not tear down
  // the levels that are staying).
  useEffect(() => {
    const owned = ownedRef.current;
    return () => {
      let unwind = 0;
      while (owned.length) if (releaseTrapEntry(owned.pop()!)) unwind++;
      unwindTrapEntries(unwind);
    };
  }, []);

  // Used by a confirmation's explicit "Close anyway" button. If the
  // browser is still completing the forward traversal that restored the
  // blocked entry, queue the proceed until that traversal lands; otherwise
  // consume the entry now. The normal pop handler then calls onDismiss.
  return () => {
    const outermost = ownedRef.current[0];
    if (!outermost || outermost.consumed) return;
    if (outermost.restoring) {
      outermost.proceedAfterRestore = true;
      return;
    }
    outermost.bypassBlockOnce = true;
    history.back();
  };
}

// The common single-level case: one overlay, one entry, one back press.
export function useBackDismiss(active: boolean, onDismiss: () => void) {
  useBackDismissDepth(active ? 1 : 0, onDismiss);
}
