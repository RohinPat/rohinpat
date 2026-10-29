import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CodeBlock from "@/components/writeup/CodeBlock";
import Cover from "@/components/writeup/Cover";
import OnThisPage from "@/components/writeup/OnThisPage";
import { PairingDiagram, SwingDiagram, TransportDiagram } from "@/components/writeup/PhoneLinkDiagrams";
import { projectBySlug } from "@/lib/projects";
import { site } from "@/lib/site";

// Case study. Every factual sentence is checked against this repo at the
// commit below, and code is quoted verbatim apart from "// …" elisions and
// trimmed indentation. The latency and pairing numbers are the ones Rohin
// measured on the live site; the rest are constants read from the code.
// Opinions are drafts for Rohin to confirm (see TODO(Rohin) notes).

const REPO = site.repo;
const SHA = "efd82566c239f3ea50b64c8c45ef2de85a309e03";
const src = (path: string, lines: string) => `${REPO}/blob/${SHA}/${path}#${lines}`;

export const metadata: Metadata = {
  title: "A website your phone can drive",
  description:
    "How this site's phone link works: a QR code pairs your real phone, a WebSocket relay with Redis carries it, WebRTC speeds it up, and recognisers turn motion into game controls.",
  alternates: { canonical: "/projects/phone-link" },
};

const WS_FIX_EXCERPT = `
experimental: {
  // The phone link's relay (app/api/link) runs \`ws\`. Bundled, its optional
  // native helper resolves to a stub, and any frame of 32 bytes or more then
  // throws "unmask is not a function" and kills the function. Loaded from
  // node_modules at runtime, ws falls back to plain JS as it should.
  serverComponentsExternalPackages: ["ws"],
},
`;

const WS_UNMASK_EXCERPT = `
if (!process.env.WS_NO_BUFFER_UTIL) {
  try {
    const bufferUtil = require('bufferutil');
    // …
    module.exports.unmask = function (buffer, mask) {
      if (buffer.length < 32) _unmask(buffer, mask);
      else bufferUtil.unmask(buffer, mask);
    };
  } catch (e) {
    // Continue regardless of the error.
  }
}
`;

const SESSION_EXCERPT = `
export interface LinkSession {
  readonly role: Role;
  readonly state: LinkState;
  readonly path: LinkPath | null;
  /** host only: short code and the URL its QR encodes */
  readonly code: string | null;
  readonly pairUrl: string | null;
  stats(): LinkStats;
  send(msg: LinkMsg): void;
  sendOrient(o: Orient): void;
  onMessage(cb: (msg: LinkMsg) => void): () => void;
  onOrient(cb: (o: Orient) => void): () => void;
  onState(cb: (state: LinkState, path: LinkPath | null) => void): () => void;
  close(): void;
}
`;

const GOLF_EXCERPT = `
const r = runs.findIndex((run) => p >= run.start && p <= run.end);
if (r < 0) return { ok: false, reason: "no-peak-run" };
if (r === 0) return { ok: false, reason: "no-backswing", incomplete: true };
if (r > 1) return { ok: false, reason: "multi-lobe", detail: \`\${r} lobes before the downswing\` };
const back = runs[0];
if (back.sign !== -1) return { ok: false, reason: "no-backswing" };
const backPeak = back.peakAbs;
if (backPeak / peak > 0.85) return { ok: false, reason: "symmetric", detail: "backswing as fast as downswing" };
`;

const FACTS: [string, React.ReactNode][] = [
  ["Parts", "The laptop hosts, a page at /p on the visitor's phone joins, and a relay sits between them"],
  ["Transport", "A WebSocket relay on a Vercel Function, Upstash Redis between instances, and WebRTC data channels on top when they open"],
  ["Input", "DeviceOrientation and DeviceMotion on the phone; seven recognisers in plain TypeScript, no ML"],
  ["Tests", "82 Playwright tests in eight link specs, and a BroadcastChannel stand-in so two tabs of one browser can pair"],
  ["Timeline", "Pairing, tilt, unlock and the first controllers on 26 October 2026; all nine games, and Back to the home screen, by the 27th; still being tuned on real phones"],
];

export default function PhoneLinkCaseStudy() {
  const entry = projectBySlug("phone-link");
  if (!entry) notFound();

  return (
    <main className="paper relative pt-28 pb-24 px-4 md:px-10">
      <article>
        <header className="max-w-[56rem] mx-auto">
          <p className="mb-8 text-sm">
            <Link href="/projects" className="inline-flex items-center gap-1.5 py-1 muted hover:text-[var(--fg)] transition-colors">
              <span aria-hidden="true">←</span> Work
            </Link>
          </p>
          <h1 className="!mb-6">A website your phone can drive</h1>
          <div className="grid md:grid-cols-[1fr_13rem] gap-x-12 gap-y-10 items-end">
            <div>
              <p className="text-xl md:text-2xl leading-snug max-w-[44ch] text-pretty">
                The home screen of this site is a replica phone. Scan its QR code with your real
                one, and the real phone tilts the replica, unlocks it, then plays the Off hours
                games as a motion controller.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <a
                  href={`${REPO}/tree/${SHA}/lib/link`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--ink)] text-[var(--paper)] font-medium hover:bg-[var(--signal)] transition-colors"
                >
                  Read the code on GitHub <span aria-hidden="true">↗</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <span className="text-sm muted">TypeScript, Next.js</span>
              </div>
            </div>
            <Cover entry={entry} compact />
          </div>

          <dl className="mt-12 border-t border-[var(--border-strong)]">
            {FACTS.map(([k, v]) => (
              <div key={k} className="py-3.5 border-b border-[var(--border)] grid grid-cols-[5.5rem_1fr] sm:grid-cols-[8rem_1fr] gap-4 text-[0.9375rem] leading-snug">
                <dt className="muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="prose mt-16">
          <h2 className="!mt-0">The idea</h2>
          {/* TODO(Rohin): confirm the motivation is yours, in your words. */}
          <p>
            A portfolio is mostly something you read. I wanted one thing on mine that you can
            pick up. The home page is an iPhone mockup with a lock screen, and the lock screen
            says &ldquo;This phone&apos;s a replica. Pick up yours.&rdquo; Beside it is a QR code.
          </p>
          <p>
            Scan it and your phone joins the page. Tilt the phone and the mockup tilts with it.
            Swipe up and the laptop&apos;s phone unlocks. After that the phone is a controller for
            the nine games on the Off hours page: swing it like a golf club, flick it to shoot a
            basketball, hold it like a wheel to drive or ski, tilt it to roll a maze, twist it to
            wind a watch.
          </p>
          <p>
            Every page still works with a mouse and a keyboard, and with no phone paired nothing
            about the site changes.
          </p>

          <h2>What it had to live with</h2>
          <ul>
            <li>
              <strong>Nothing stored, nothing third-party.</strong> The site sets no cookies, uses
              no browser storage and makes no third-party requests. So the secret that keeps a
              seat lives in memory, and the link can&apos;t borrow someone else&apos;s signalling
              server.
            </li>
            <li>
              <strong>Networks I don&apos;t control.</strong> A visitor&apos;s laptop and phone
              might share Wi-Fi, or one might be on cellular, a campus network or a VPN.
            </li>
            <li>
              <strong>No server code to start with.</strong> Until the relay, this site had none.
              The privacy page now says what the relay sees.
            </li>
          </ul>

          <h2>Pairing</h2>
          <p>
            The laptop opens a WebSocket to <code>/api/link</code> and sends{" "}
            <code>{`{"t":"host"}`}</code>. The relay picks a five-character code from a 31-symbol
            alphabet with no 0, O, 1, I or L, so it survives being read off a screen, reserves it
            in Redis for 120 seconds, and answers with the code and a secret for the host&apos;s
            seat.
          </p>
          <figure className="wide">
            <PairingDiagram />
            <figcaption className="note">
              The code is an example. Steps 7 and 8 come after pairing: messages start on the
              relay, then the direct connection is tried.
            </figcaption>
          </figure>
          <p>
            The QR holds <code>/p#c=CODE</code>. The code is in the URL fragment, so it never
            appears in a request to a server. The phone page has one big Connect button, because
            iOS only gives a page motion data if it asks inside a tap. That tap raises the
            permission prompt and joins: the relay checks the code, gives the phone the other seat
            and tells the laptop a peer joined.
          </p>
          <p>
            A room is two seats. A socket that takes one gets a key, kept in memory, and if its
            connection drops it resumes the seat with that key; the relay holds it for 20 seconds.
            A socket that sends four bad joins is closed.
          </p>

          <h2>Relay first, direct when it can</h2>
          <p>
            The obvious design is WebRTC alone: no server in the data path, a few milliseconds. I
            prototyped that first, in the hidden <code>/lab</code> pages. But before building it I
            read that direct connections fail often on cellular, guest Wi-Fi, campus networks and
            VPNs, which is where a stranger&apos;s phone tends to be. So the relay is the base
            path, and the direct connection is a speed-up tried on top.
          </p>
          <figure className="wide">
            <TransportDiagram />
          </figure>
          <p>
            The relay is a Vercel Function that upgrades to a WebSocket, a feature in public beta.
            One problem is specific to serverless: a WebSocket is pinned to the instance that
            accepted it, and the two devices can land on different instances. So room records live
            in Redis, updated with a compare-and-set script so two phones scanning one code
            can&apos;t both win, and a frame for a socket on another instance goes through a Redis
            publish/subscribe channel. When both sockets share an instance, Redis is skipped. For
            the frames it forwards, the relay reads only the one-letter type and logs nothing from
            inside them.
          </p>
          <p>
            The direct path comes after pairing. The laptop offers a WebRTC connection, with the
            offer and answer carried over the relay and <code>iceServers</code> left empty: no
            STUN or TURN server, so no third party. The cost is that it opens only when the two
            devices can reach each other on their own networks. Orientation goes on an unordered
            channel with no retransmits, because a stale pose is worse than a missing one. If the
            direct channel opens within 8 seconds, traffic moves to it and orientation can run at
            60 Hz instead of 30. If not, or if it dies later, everything stays on, or falls back
            to, the relay. A pill beside the laptop&apos;s phone shows which path is in use.
          </p>
          <p>The UI only sees one interface:</p>
          <CodeBlock
            code={SESSION_EXCERPT}
            lang="ts"
            file="lib/link/session.ts"
            href={src("lib/link/session.ts", "L52-L66")}
          />
          <p>
            A session only starts in two places, both on a wide screen with a mouse: the home
            page, once it&apos;s idle, so the QR is ready before anyone scans it; and the Pair
            button on Off hours, when pressed. The games and every other page only look for an
            existing one with <code>peekHost()</code>, which returns it or <code>null</code>.
          </p>

          <h2>A bug that only existed in production</h2>
          <p>
            I deployed the relay on 26 October. Pairing worked: the laptop got a code, the phone
            joined, both said linked. Then nothing got through. The logs showed{" "}
            <code>TypeError: t.unmask is not a function</code> and the function exiting with
            status 129.
          </p>
          <p>
            Short messages worked, which made it confusing. Asking for a room is 12 bytes and
            joining about 25. The first real message, a hello that carries the phone&apos;s
            user-agent string, runs past a hundred and killed the function. Redis was not the
            culprit: two local relays sharing the real Upstash delivered every message type in 25
            to 50 ms. Local relays never failed because they run as plain Node.
          </p>
          <p>
            The cause is in <code>ws</code>. Browsers mask the frames they send, and the server
            unmasks them. Below 32 bytes <code>ws</code> does that in JavaScript. From 32 up it
            calls an optional native helper, <code>bufferutil</code>, inside a <code>try</code>{" "}
            so that a missing helper falls back to plain JS:
          </p>
          <CodeBlock
            code={WS_UNMASK_EXCERPT}
            lang="ts"
            file="ws/lib/buffer-util.js (8.22.0)"
            href="https://github.com/websockets/ws/blob/8.22.0/lib/buffer-util.js#L115-L131"
          />
          <p>
            Next&apos;s bundler pulled <code>ws</code> into the function and resolved that optional{" "}
            <code>require</code> to a stub instead of letting it throw. So the <code>try</code>{" "}
            succeeded, the wrapper was installed, and every frame of 32 bytes or more called a
            function that didn&apos;t exist. The orientation frame the phone streams is 33 bytes.
          </p>
          <p>The fix is seven lines of config: stop bundling it and load it at runtime.</p>
          <CodeBlock
            code={WS_FIX_EXCERPT}
            lang="ts"
            file="next.config.mjs"
            href={src("next.config.mjs", "L4-L10")}
          />
          <p>
            File tracing still ships the package, and no bundled copy of its decoder is left in the
            build. On the live site a laptop and phone now pair in about 2 seconds, and relayed
            messages arrive in 50 to 95 ms.
            {/* TODO(Rohin): confirm how those two numbers were measured (a real phone, or two scripted clients?) and say so. */}
          </p>
          <p>
            A bundler that can&apos;t tell a missing optional dependency from an empty one breaks
            that <code>catch</code>, and only in production. My relay tests run the same code under
            plain Node, so they couldn&apos;t have caught it.
          </p>

          <h2>Turning motion into input</h2>
          <p>
            Raw sensor data is noisy and differs on every phone. So the rule from the start was to
            recognise gestures on the phone and send finished events, not motion. A golf swing
            crosses the wire as three numbers, about a hundred bytes. That makes the slower relay
            fine for everything except steering, which is designed around it.
          </p>
          <p>
            The phone has seven recognisers in <code>lib/motion</code>: golf, flick, swipe, twist,
            tilt, wheel and a still-gate. Each is a plain function of a sample stream, with no DOM
            and no timers, which makes them testable, and only the active game&apos;s runs. A{" "}
            <code>gesture</code> is a finished event that has to arrive. An <code>axis</code> is a
            continuous control like a steering angle: the phone sends it only when it changes, in
            steps of 0.02, at most 30 times a second, and the last value always goes out. The
            laptop eases toward the latest value every frame, so 30 messages a second don&apos;t
            look like steps.
          </p>
          <p>
            The golf swing shows why it uses the gyroscope and not the accelerometer. The
            code&apos;s own comment does the arithmetic: a swing reaches 20 to 30 rad/s at the
            hands, which at about 0.7 m is over 300 m/s², far past a phone accelerometer&apos;s 8
            to 16 g. The gyro tops out at 34.9 rad/s and survives. So the recogniser reads
            rotation rate alone:
          </p>
          <ol>
            <li>
              <strong>Address.</strong> The smoothed rotation speed stays under 0.7 rad/s for 0.3
              seconds. The average reading in that window is the gyro&apos;s bias.
            </li>
            <li>
              <strong>Swing.</strong> The speed leaves the quiet band. Every sample is kept, plus
              up to 0.8 seconds from before, because a slow swing starts moving well before it
              clears the threshold.
            </li>
            <li>
              <strong>Peak.</strong> The speed passes 6 rad/s, then falls to 60% of its peak. That
              is just after impact, about a tenth of a second after the ball would have been
              struck, which is why the relay&apos;s extra 50 to 95 ms doesn&apos;t matter here.
            </li>
            <li>
              <strong>Analyse.</strong> Project the rotation onto the swing plane and split it into
              lobes. A swing is one negative lobe, the backswing, then a taller, shorter positive
              one. Anything else is rejected with a reason the phone shows: a shake is many equal
              lobes, a put-down is one, walking never goes quiet.
            </li>
          </ol>
          <figure className="wide">
            <SwingDiagram />
            <figcaption className="note">
              A drawn swing, not a recording: the shape the recogniser expects.
            </figcaption>
          </figure>
          <CodeBlock
            code={GOLF_EXCERPT}
            lang="ts"
            file="lib/motion/golf.ts"
            href={src("lib/motion/golf.ts", "L188-L195")}
          />
          <p>
            Out come three numbers: speed (peak rotation rate times an assumed 1.4 m
            pivot-to-clubhead radius), tempo (backswing time over downswing time) and face angle
            (the twist about the shaft, from address to impact). The game turns speed into power
            per club. Its constants live in one object, <code>GOLF_CAL</code>, and every other
            game has a <code>*_CAL</code> of its own.
          </p>
          <p>
            The flick that shoots a basketball is a different problem: one sharp upward pulse in
            the accelerometer. A pulse under 45 ms wide is a table bump, one over 450 ms is a slow
            pick-up, and a similar pulse within 0.7 seconds means walking or shaking. It then waits
            0.25 seconds so a second stroke of a shake can still cancel the shot.
          </p>

          <h2>Testing two devices in one browser</h2>
          <p>
            Setting <code>NEXT_PUBLIC_LINK_MOCK=1</code> swaps in a session built on
            BroadcastChannel, with the same interface as the real client, so two pages of one
            Playwright browser context pair with a code. The phone&apos;s tilt is faked through the
            DevTools device-orientation override, and motion samples are pushed into the
            recogniser from the same synthetic traces the unit tests use. Most of the 82 Playwright
            tests in the eight link specs run on that. In the flick spec the laptop&apos;s reply is
            read back off the phone, so a shot that &ldquo;happened&rdquo; really made the round
            trip.
          </p>
          <p>
            The networking has its own spec: the relay code in a standalone Node server and two
            browser contexts, covering pairing, the direct upgrade, forcing it closed, dropped
            sockets resuming their seats, expiry and the 30 Hz throttle. The recognisers run on
            synthetic motion from a rigid-body model. The assertions include at least 97% of 200
            swings detected, and no false alarms in 800 trials across eight confounders, such as
            walking, a pocket, a table bump and shaking.
          </p>

          <h2>What&apos;s still rough</h2>
          {/* TODO(Rohin): drafts built from the repo and its pull requests. Rewrite in your voice, cut any you don't stand behind. */}
          <ul>
            <li>
              <strong>Not tuned on real hands.</strong> The test generator&apos;s own header says
              its swings are smooth textbook curves, not real ones. Steering feel, the flick
              detector, wheel angles and the audio mix still need many real phones, and every
              number to change is in a <code>*_CAL</code> object.
            </li>
            <li>
              <strong>iPhones can&apos;t vibrate from a web page.</strong> Controllers buzz on
              Android; on an iPhone the screen glows instead.
            </li>
            <li>
              <strong>The direct path is a bonus.</strong> The latency numbers above are the
              relay&apos;s. How often the direct connection opens between a real laptop and phone
              depends on the network, and I haven&apos;t counted.
            </li>
            <li>
              <strong>A beta platform feature.</strong> If WebSockets on Vercel Functions change,
              the link stops and the site carries on without it.
            </li>
            <li>
              <strong>No test for the bug that got out.</strong> Nothing yet builds the route and
              checks that <code>ws</code> stays external.
            </li>
          </ul>

          <hr />
          <p className="flex flex-wrap gap-x-8 gap-y-3 text-base">
            <a href={`${REPO}/tree/${SHA}/lib/link`} target="_blank" rel="noopener noreferrer">
              The code, on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <Link href="/">Try it on the home page</Link>
            <Link href="/projects">Everything else I&apos;ve made</Link>
          </p>
        </div>
      </article>
      <OnThisPage />
    </main>
  );
}
