import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Hand-rolled drag-to-reorder, shared by the Dashboard tile list
// (DashboardCustomizeScreen) and the two shortcut lists in the quick-actions
// Edit view. Still no DnD library anywhere — this only factors out the
// pointer bookkeeping the two had already re-derived separately.
//
// It deliberately does NOT use setPointerCapture, which is what the two
// copies did and what made a drag "stick" (reported 2026-08-20). Committing a
// move re-renders the list, React moves the dragged row's DOM node to its new
// index, and `insertBefore` takes the node out of the document for the
// instant it takes to reinsert it — which implicitly releases pointer
// capture. Every later pointermove/pointerup then goes to whatever happens to
// be under the finger instead, so the row froze mid-gesture and, since the
// handler that clears the drag state never ran, kept its translate after the
// finger lifted. Window-level listeners have no such lifetime tie to the node
// being reordered.
//
// `touch-action: none` on the handle is what stops the page panning during a
// drag (preventDefault on pointerdown does not — see CLAUDE.md), so callers
// must keep that class on the element these handlers are spread onto.
export interface ReorderDrag {
  key: string;
  offset: number;
}

interface Session {
  key: string;
  pointerId: number;
  startIndex: number;
  currentIndex: number;
  startY: number;
  rowHeight: number;
  maxIndex: number;
}

export function useDragReorder(onReorder: (key: string, toIndex: number) => void) {
  const [drag, setDrag] = useState<ReorderDrag | null>(null);
  const session = useRef<Session | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  useEffect(() => () => detach.current?.(), []);

  function start(
    e: ReactPointerEvent<HTMLElement>,
    key: string,
    index: number,
    maxIndex: number,
    // The element whose height is one step of this list. Defaults to the
    // nearest [data-reorder-row] ancestor of the handle; pass one explicitly
    // when the row that moves isn't that element.
    rowEl?: HTMLElement | null,
  ) {
    e.preventDefault();
    const row = rowEl ?? (e.currentTarget.closest("[data-reorder-row]") as HTMLElement | null);
    const rowHeight = row?.getBoundingClientRect().height || 52;
    session.current = {
      key,
      pointerId: e.pointerId,
      startIndex: index,
      currentIndex: index,
      startY: e.clientY,
      rowHeight,
      maxIndex,
    };
    setDrag({ key, offset: 0 });

    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      const deltaY = ev.clientY - s.startY;
      const shift = Math.round(deltaY / s.rowHeight);
      const newIndex = Math.min(Math.max(s.startIndex + shift, 0), s.maxIndex);
      if (newIndex !== s.currentIndex) {
        s.currentIndex = newIndex;
        reorderRef.current(s.key, newIndex);
      }
      setDrag({ key: s.key, offset: deltaY - (newIndex - s.startIndex) * s.rowHeight });
    };
    const onEnd = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      session.current = null;
      detach.current?.();
      setDrag(null);
    };

    detach.current?.();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      detach.current = null;
    };
  }

  return { drag, start };
}
