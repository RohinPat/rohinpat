"use client";

import Portal from "@/components/lab/mirror/Portal";
import css from "./link.module.css";

/** A plain list: two device tests, exact steps, and what to report back. */
export default function LabIndex() {
  return (
    <Portal>
      <main className={`${css.root} ${css.index}`}>
        <div className={css.wrap} style={{ maxWidth: 760 }}>
          <h1>Lab</h1>
          <p className={css.lede}>
            Device tests for the idea that your real phone can drive the on-screen phone and the games. Not part of the site, not linked from it, and nothing here
            stores anything or talks to a third party. Run these on the HTTPS preview link, not on localhost: phones only give motion data to secure pages.
          </p>

          <h2>Test 1: motion sensors and gestures (phone alone)</h2>
          <p>
            Page: <a href="/lab/swing">/lab/swing</a>. Question: do the phone&apos;s sensors give clean enough data, and do the golf and flick recognisers work on real
            swings?
          </p>
          <ol className={css.steps}>
            <li>On the iPhone, open the preview link plus <code>/lab/swing</code> in Safari itself (not inside another app&apos;s browser).</li>
            <li>Tap &ldquo;Turn on motion sensors&rdquo; and tap Allow. Read the line under the button and note the Hz and the accelerometer sign message.</li>
            <li>
              Under &ldquo;Test the recognisers&rdquo; tap Start testing. Hold the phone like a club grip, keep still for a second, and do five golf swings. Then five
              upward flicks like a basketball shot. Then walk around for 20 seconds with the phone in your hand.
            </li>
            <li>
              Under Record, pick &ldquo;Golf swing&rdquo; and record three swings, then &ldquo;Flick up&rdquo; and &ldquo;Walking, phone in hand&rdquo;. Tap Download
              JSON for each.
            </li>
          </ol>
          <p>
            <b>Report back:</b> the Hz shown, the accelerometer sign line, how many of your 5 swings and 5 flicks were detected, how many false detections while walking, any
            &ldquo;gyro clipped&rdquo; notes, the iPhone model and iOS version, and the downloaded JSON files.
          </p>

          <h2>Test 2: pairing and live link (laptop plus phone)</h2>
          <p>
            Pages: <a href="/lab/link">/lab/link</a> on the laptop, which then sends the phone to <code>/lab/link/phone</code>. Question: do the two real devices connect
            directly, and does the tilt, unlock, tap and swing link feel right?
          </p>
          <ol className={css.steps}>
            <li>
              Put the laptop and the iPhone on the same Wi-Fi. On the laptop open the preview link plus <code>/lab/link</code>. Allow the camera when the browser asks. A
              QR code appears.
            </li>
            <li>On the iPhone, point the Camera app at that QR code and tap the link. It opens the phone page in Safari.</li>
            <li>
              On the phone tap &ldquo;Pair with laptop&rdquo; and tap Allow on the motion prompt (it should ask only once). The phone now shows a big code that says
              &ldquo;Hold this up to your laptop&apos;s camera&rdquo;.
            </li>
            <li>
              Turn the phone&apos;s brightness up and hold the screen toward the laptop&apos;s camera, about a forearm away, until the laptop switches to the live view. Note
              roughly how many seconds the scan took.
            </li>
            <li>
              Tilt the phone: the phone on the laptop should tilt with it. If it tilts the wrong way, tick the matching &ldquo;flip&rdquo; box under &ldquo;If it tilts the
              wrong way&rdquo; and note which one fixed it.
            </li>
            <li>Swipe up on the phone: the laptop&apos;s phone should unlock. Then tap the phone&apos;s screen: ripples should land in the same spot on the laptop.</li>
            <li>
              On the phone tap &ldquo;Swing test&rdquo;, pick Golf, hold still and swing a few times, then pick Flick and flick a few times. The laptop shows each result in
              big text.
            </li>
            <li>Keep moving the phone for about 30 seconds so the numbers settle, then on the laptop tap &ldquo;Copy results&rdquo; and paste the text back.</li>
            <li>
              Optional extra runs, each a useful data point: Wi-Fi off on the phone (cellular only), a VPN on the laptop, and a guest or campus network. Expect failures
              there; the message you get and the copied results are the answer.
            </li>
          </ol>
          <p>
            <b>Report back:</b> the pasted results (they include connection time, which ICE candidate types were used, round-trip time median and 95th percentile,
            orientation message rate and loss, the phone&apos;s real devicemotion interval and both user agents), plus: laptop and phone models and browsers, which network,
            whether the tilt felt laggy or smooth, whether the golf and flick numbers looked plausible, and anything that failed or confused you.
          </p>

          <h2>Test 3: air pointer (laptop plus phone)</h2>
          <p>
            Page: <a href="/lab/pointer">/lab/pointer</a> on the laptop. Question: can the phone, held like a TV remote, point at and click things on the laptop,
            and does the dot drift?
          </p>
          <ol>
            <li>Open /lab/pointer on the laptop and scan its QR code with the phone. Tap Connect and allow motion.</li>
            <li>Point the top of the phone at the middle of the laptop screen and tap Center on the phone.</li>
            <li>Start the drill and click about 20 targets by tapping the phone. Try the sliders if the dot is too fast, too slow or shaky.</li>
            <li>Tap Center again, then Drift test, and hold the phone still on the middle for 30 seconds.</li>
          </ol>
          <p>
            <b>Report back:</b> the drill table (hits, misses and median time for each size), the drift result, the slider values that felt best, and the phone model.
          </p>
        </div>
      </main>
    </Portal>
  );
}
