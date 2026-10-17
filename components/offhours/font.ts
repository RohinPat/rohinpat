"use client";

// Canvas can't read CSS variables, so resolve the site's next/font families
// once and hand canvases a real font string. Display type is Archivo at its
// condensed width, like the headings.

let families: { display: string; mono: string } | null = null;

function resolve() {
  if (!families) {
    const cs = getComputedStyle(document.documentElement);
    families = {
      display: cs.getPropertyValue("--font-display").trim() || "system-ui, sans-serif",
      mono: cs.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
    };
  }
  return families;
}

type Stretchy = CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string };

export function display(ctx: CanvasRenderingContext2D, px: number, weight = 800) {
  const c = ctx as Stretchy;
  c.font = `${weight} ${Math.round(px)}px ${resolve().display}`;
  if ("fontStretch" in c) c.fontStretch = "condensed";
  if ("letterSpacing" in c) c.letterSpacing = "0px";
}

export function mono(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as Stretchy;
  c.font = `${Math.round(px)}px ${resolve().mono}`;
  if ("fontStretch" in c) c.fontStretch = "normal";
  if ("letterSpacing" in c) c.letterSpacing = `${(px * 0.12).toFixed(1)}px`;
}

/** the resolved CSS font-family stacks, for canvases drawn into textures */
export function fontFamilies() {
  return resolve();
}
