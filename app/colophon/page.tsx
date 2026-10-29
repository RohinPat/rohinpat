import type { Metadata } from "next";
import Link from "next/link";
import CodeBlock from "@/components/writeup/CodeBlock";
import LiveMetrics from "@/components/LiveMetrics";
import OnThisPage from "@/components/writeup/OnThisPage";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Colophon",
  description: "How this site is built: the stack, the phone link, the canvas pieces, accessibility testing, privacy, and live numbers measured in your browser.",
  alternates: { canonical: "/colophon" },
};

// Quoted from components/offhours/useCanvas.ts in this repo.
const LOOP_EXCERPT = `
const run = () => {
  cancelAnimationFrame(raf);
  if (visible && !document.hidden && !still() && !optsRef.current.paused) {
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
            How this site is built.
          </p>
        </header>

        <div className="prose mt-14">
          <h2 className="!mt-0">Stack</h2>
          <p>
            Next.js 14 with the App Router, React 18, TypeScript and Tailwind CSS, hosted on
            Vercel. There are nine runtime dependencies. Four build the pages: <code>next</code>,{" "}
            <code>react</code>, <code>react-dom</code>, and <code>three</code> for the 3D exploded
            views, which only loads when one of those pieces is on screen. Five are for the{" "}
            <Link href="/projects/phone-link">phone link</Link>: <code>ws</code>, <code>redis</code>{" "}
            and <code>@vercel/functions</code> on the server, <code>qrcode-generator</code> to draw
            the pairing code, and <code>jsqr</code>, which only the hidden lab pages use. Two typefaces: Archivo, whose width
            axis does both the condensed titles and the text you&apos;re reading, and DM Mono.
            next/font downloads them at build time and serves them from this domain.
          </p>

          <h2>No animation library</h2>
          <p>
            Everything that moves is CSS transitions, CSS 3D or <code>requestAnimationFrame</code>.
            The home screen&apos;s app launch is one element growing from the icon to the window;
            the Duo&apos;s fold is a two-faced layer turned 180° on its hinge. With{" "}
            <code>prefers-reduced-motion</code> set, the entrances, the launch and the previews
            hold still.
          </p>

          <h2>Your phone, as a controller</h2>
          <p>
            On a laptop, scan the QR code on the home screen and your phone tilts the replica,
            unlocks it and plays the nine Off hours pieces as a motion controller. The two devices
            talk through a WebSocket relay on this site&apos;s own server, with Redis between
            server instances and a direct WebRTC connection tried on top. Every page works the
            same without a phone. A link only starts on the home page, or when someone presses
            Pair on Off hours.
          </p>
          <p>
            The write-up: <Link href="/projects/phone-link">A website your phone can drive</Link>.
          </p>

          <h2>Nine pieces, written from scratch</h2>
          <p>
            Each piece on the <Link href="/interests">Off hours</Link> page is written for the
            browser with no game engine, physics or audio library. The exploded views use three.js
            for rendering only; every model in them is generated in code:
          </p>
          <ul>
            <li>
              <strong>Maze:</strong> a DDA raycaster with ordered Bayer dithering, and solvers you
              can watch: BFS, DFS, A*, a wall follower and tabular Q-learning that learns the
              maze episode by episode.
            </li>
            <li>
              <strong>Basketball, penalties, golf, skiing:</strong> small physics models in real
              units — gravity, rim and glass collisions, a verlet-cloth net, a spring-grid goal
              net, rolling friction on a height map, drag and lift on a golf ball, powder as 3D
              particles.
            </li>
            <li>
              <strong>Sound:</strong> every noise is synthesized with the Web Audio API — the
              V8&apos;s firing note, the ratchet in the watch, the drum machine, which renders one
              bar offline and plays it through an AudioWorklet at the speed the record is
              turning.
            </li>
            <li>
              <strong>Watch and keyboard:</strong> physically based 3D in a virtual photo studio
              (softbox reflections, soft shadows). Every part is built in code: lathe-turned case,
              crystal and bezel; extruded wheels, bridges and hands; and sculpted, dished keycaps.
              Each part explodes along its own vector, and the labels track the parts on screen.
            </li>
          </ul>
          <p>
            The canvases share one hook, <code>useCanvas</code>: sharp on dense screens, keyboard
            focus with arrow keys, and a frame loop that only runs while you can see it (the tile
            previews also pause while a piece is open full screen):
          </p>
          <CodeBlock
            code={LOOP_EXCERPT}
            lang="ts"
            file="components/offhours/useCanvas.ts"
            href={`${site.repo}/blob/main/components/offhours/useCanvas.ts`}
          />

          <h2>Accessibility</h2>
          <p>
            Every page is scanned with axe against the WCAG 2.2 A and AA rules, in Playwright,
            on every pull request and every push to main; one violation fails the run. The same suite checks that the skip
            link moves focus, and that every Off hours piece opens from the keyboard, takes focus,
            and gives it back when Escape closes it. Text and background pairs are chosen to clear
            4.5:1. Automated checks only catch some problems.
          </p>

          <h2>Privacy</h2>
          <p>
            No cookies, no local storage, no analytics, and no third-party scripts, embeds or
            font requests. The phone link talks only to this site&apos;s own relay. A test plays with
            the Off hours pieces and fails if the page contacts any other host or writes a cookie or
            a local-storage key. Response headers switch off the microphone and location
            everywhere, and the camera everywhere but the home screen (its camera names colours
            when you ask, in your browser) and the hidden lab pages. Pages refuse to be framed.
            More on the <Link href="/privacy">privacy page</Link>.
          </p>

          <h2>Measured in your browser</h2>
          <p>
            From your browser&apos;s Performance API, on this page, right now.
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
      <OnThisPage />
    </main>
  );
}
