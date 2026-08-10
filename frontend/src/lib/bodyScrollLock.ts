// Shared reference-counted page-scroll lock for BottomSheet/AddFoodSheet —
// each independently saving/restoring document.body styles (the previous
// approach) broke whenever two sheets were mounted at once, e.g. DayMenuSheet's
// "Carry Forward" row opens CarryForwardSheet in the same click that starts
// DayMenuSheet's own close animation, so both are briefly mounted together.
// The inner sheet's effect ran after the outer one had already locked, so it
// captured the *locked* styles as its own "previous" value; when the outer
// sheet finished its close animation and unmounted, its cleanup restored the
// true original (unlocked) styles — while the inner sheet was still open —
// and then the inner sheet's own close later restored to the locked styles
// it had wrongly captured, permanently stranding the page unscrollable until
// a full reload. A module-level counter fixes this the way any nested-lock
// problem is fixed: only the 0-to-1 transition captures and applies the
// lock, only the 1-to-0 transition restores it; an overlapping second lock
// just increments/decrements without touching the saved snapshot.
let lockCount = 0;
let saved: { htmlOverflow: string; position: string; top: string; width: string; scrollY: number } | null = null;

export function lockBodyScroll() {
  lockCount++;
  if (lockCount > 1) return;
  const scrollY = window.scrollY;
  saved = {
    htmlOverflow: document.documentElement.style.overflow,
    position: document.body.style.position,
    top: document.body.style.top,
    width: document.body.style.width,
    scrollY,
  };
  // `<html>`, not `<body>`, is the real scrolling box in standards mode, so
  // it still needs `overflow: hidden` to actually stop background
  // touch-driven scroll/rubber-band — `position: fixed` on body alone isn't
  // enough (confirmed: dropping this too let scrolling inside a sheet's own
  // content, e.g. AiSettingsSheet's provider list, chain through to the page
  // behind it). Deliberately does NOT also set `document.body.style.overflow
  // = "hidden"` though — that specific one (body, not html) is what made
  // Android Chrome restore its collapsed address bar the moment a sheet
  // opened, resizing the visual viewport mid-open and visibly shifting any
  // `position: sticky` header on the screen underneath (confirmed on
  // TodayScreen's sticky macro-bar header opening DayMenuSheet).
  document.documentElement.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
}

export function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0 || !saved) return;
  const { htmlOverflow, position, top, width, scrollY } = saved;
  saved = null;
  document.documentElement.style.overflow = htmlOverflow;
  document.body.style.position = position;
  document.body.style.top = top;
  document.body.style.width = width;
  window.scrollTo(0, scrollY);
}
