import type { Metadata } from "next";
import Link from "next/link";
import CodeBlock from "@/components/writeup/CodeBlock";
import LiveMetrics from "@/components/LiveMetrics";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Colophon",
  description: "How this site is built: the stack, the canvas pieces, accessibility testing, privacy, and live numbers measured in your browser.",
  alternates: { canonical: "/colophon" },
};

// Quoted from components/offhours/useCanvas.ts in this repo.
const LOOP_EXCERPT = `
const run = () => {
  cancelAnimationFrame(raf);
  if (visible && !document.hidden && !reduce) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
};
// …
const io = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  run();
});
io.observe(canvas);
document.addEventListener("visibilitychange", run);
`;

export default function ColophonPage() {
  return (
    <main className="paper relative pt-28 pb-24 px-4 md:px-10">
      <article>
        <header className="max-w-[56rem] mx-auto">
          <h1 className="!mb-6">Colophon</h1>
          <p className="text-xl md:text-2xl leading-snug max-w-[40ch] text-pretty">
            How this site is built, with numbers you can check from your own browser.
          </p>
        </header>

        <div className="prose mt-14">
          <h2 className="!mt-0">Stack</h2>
          <p>
            Next.js 14 with the App Router, React 18, TypeScript and Tailwind CSS, hosted on
            Vercel. There are three runtime dependencies: <code>next</code>,{" "}
            <code>react</code> and <code>react-dom</code>. Two typefaces: Archivo, whose width
            axis does both the condensed titles and the text you&apos;re reading, and DM Mono.
            next/font downloads them at build time and serves them from this domain.
          </p>

          <h2>No animation library</h2>
          <p>
            Everything that moves is CSS keyframes or <code>requestAnimationFrame</code>. The
            homepage&apos;s name and phone respond to scrolling through a single CSS variable,
            written by one passive scroll listener, so nothing re-renders while you scroll. With{" "}
            <code>prefers-reduced-motion</code> set, the entrances, the scroll effects and the
            rotating notifications all hold still.
          </p>

          <h2>Nine pieces, one hook</h2>
          <p>
            The <Link href="/interests">Off hours</Link> page has nine interactive pieces. Six
            are canvases, and they share one hook, <code>useCanvas</code>, which handles
            everything that isn&apos;t drawing:
          </p>
          <ul>
            <li>
              <strong>Sharp on dense screens.</strong> The canvas is sized to the device pixel
              ratio, capped at 2, and redrawn whenever its box changes size.
            </li>
            <li>
              <strong>Runs only when you can see it.</strong> Pieces that are off screen, or in a
              background tab, stop their frame loop entirely.
            </li>
            <li>
              <strong>Reduced motion means still.</strong> Nothing animates on its own; a piece
              redraws only in response to you.
            </li>
            <li>
              <strong>Works from a keyboard.</strong> Every canvas takes focus. Arrow keys move
              its pointer (hold Shift for bigger steps), and Enter or Space presses.
            </li>
          </ul>
          <p>The pausing is a few lines:</p>
          <CodeBlock
            code={LOOP_EXCERPT}
            lang="ts"
            file="components/offhours/useCanvas.ts"
            href={`${site.repo}/blob/main/components/offhours/useCanvas.ts`}
          />
          <p>
            The watch and the record are SVG, so they use a smaller sibling hook with the same
            on-screen rule. The keyboard is plain HTML.
          </p>

          <h2>Accessibility</h2>
          <p>
            Every page is scanned with axe against the WCAG 2.2 A and AA rules, in Playwright,
            on every pull request and every push to main; one violation fails the run. The same suite checks that the skip
            link moves focus, that the canvases take keyboard focus, and that arrow keys move a
            piece instead of scrolling the page. Text and background pairs are chosen to clear
            4.5:1. Automated checks catch a fraction of real problems, so they&apos;re a floor,
            not a certificate.
          </p>

          <h2>Privacy</h2>
          <p>
            No cookies, no local storage, no analytics, and no third-party scripts, embeds or
            font requests. A test plays with the Off hours pieces and fails if the page contacts
            any other host or writes a cookie or a local-storage key. Response headers switch off
            camera, microphone and location access and refuse to be framed. The{" "}
            <Link href="/privacy">privacy page</Link> says the same thing in fewer words.
          </p>

          <h2>Measured in your browser</h2>
          <p>
            These numbers come from your browser&apos;s Performance API, on this page, right
            now. They&apos;re computed here and go nowhere.
          </p>
          <div className="wide">
            <LiveMetrics />
          </div>

          <h2>Source</h2>
          <p>
            The code is on{" "}
            <a href={site.repo} target="_blank" rel="noopener noreferrer">
              GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
            , MIT licensed. The tests live in <code>e2e/</code> and <code>tests/</code>.
          </p>
        </div>
      </article>
    </main>
  );
}
