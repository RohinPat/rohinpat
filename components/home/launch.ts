// iOS-style app launch / close for the home screen.
//
// launch(): the tapped icon grows into a full-screen sheet in the page's
// colour, then we navigate. When you come back to Home, closeInto() plays
// it in reverse: a full-screen sheet shrinks into the icon you opened.
//
// The "which app is open" note lives in module memory only — it survives
// in-site navigation and nothing is written to the browser (the privacy page
// promises no storage).

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"; // close to iOS's spring
const MS = 420;

let open: { app: string; href: string; color: string } | null = null;

export function forgetLaunch() {
  open = null;
}

export function launchedHref() {
  return open?.href ?? null;
}

function sheet(rect: DOMRect, radius: number, bg: string) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: `${radius}px`,
    background: bg,
    zIndex: "80",
    pointerEvents: "none",
    willChange: "left, top, width, height, border-radius",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Grow `icon` to full screen in `color`, then call `go` to navigate. */
export function launch(icon: HTMLElement, app: string, href: string, color: string, go: () => void) {
  open = { app, href, color };
  if (reducedMotion()) return go();
  const r = icon.getBoundingClientRect();
  const bg = getComputedStyle(icon).backgroundColor;
  const el = sheet(r, r.width * 0.225, bg);
  el.getBoundingClientRect(); // commit the start frame
  Object.assign(el.style, {
    transition: `all ${MS}ms ${EASE}`,
    left: "0px",
    top: "0px",
    width: `${window.innerWidth}px`,
    height: `${window.innerHeight}px`,
    borderRadius: "0px",
    background: color,
  });
  window.setTimeout(go, MS - 60);
  // the sheet outlives the home screen just long enough to hand over
  window.setTimeout(() => {
    el.style.transition = "opacity 220ms ease";
    el.style.opacity = "0";
    window.setTimeout(() => el.remove(), 240);
  }, MS + 260);
}

/** On returning Home: shrink a full-screen sheet into the app's icon. */
export function closeInto(findIcon: (app: string) => HTMLElement | null) {
  if (!open) return;
  const { app, color } = open;
  open = null;
  const icon = findIcon(app);
  if (!icon || reducedMotion()) return;
  const r = icon.getBoundingClientRect();
  const el = sheet(new DOMRect(0, 0, window.innerWidth, window.innerHeight), 0, color);
  el.getBoundingClientRect();
  Object.assign(el.style, {
    transition: `all ${MS}ms ${EASE}, opacity 160ms ease ${MS - 120}ms`,
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: `${r.width * 0.225}px`,
    background: getComputedStyle(icon).backgroundColor,
    opacity: "0",
  });
  window.setTimeout(() => el.remove(), MS + 80);
}
