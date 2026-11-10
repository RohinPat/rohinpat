// The course while it loads: the forest and the first fairway, out of focus. The title's 3D scene fades in over it, so
// the page never shows an empty sky. Drawn by the server with the page, and again under the course.

const BG = [
  // the fairway, across the middle as the title camera sees it
  "linear-gradient(23deg, transparent 45%, rgba(124,180,88,0.4) 49.5%, rgba(140,196,100,0.5) 53%, rgba(124,180,88,0.4) 56.5%, transparent 61%)",
  // the forest, lighter where the sun is
  "radial-gradient(120% 90% at 35% 25%, #2d5f31 0%, #224a27 55%, #183a1d 100%)",
].join(", ");

export default function Backdrop() {
  return <div aria-hidden="true" className="absolute inset-0" style={{ background: BG }} />;
}
