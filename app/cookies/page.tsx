import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookies",
  description: "This site sets no cookies. Here is exactly what it stores, and when.",
  alternates: { canonical: "/cookies" },
};

const storage = [
  {
    key: "fun-mode",
    what: "Whether you switched the Interests page toys on or off",
    when: "When you flip the Fun mode switch",
  },
  {
    key: "interests-sound",
    what: "Whether you turned game sounds on",
    when: "When you flip the Sound switch",
  },
  {
    key: "interests.2048.hi",
    what: "Your best 2048 score",
    when: "When you play 2048 and beat your best",
  },
  {
    key: "interests.ski.best",
    what: "Your best distance in the skiing game",
    when: "When you play and beat your best",
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Cookies"
      title="Cookie policy"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          This site sets <strong className="text-[var(--fg)]">no cookies</strong> and
          runs no analytics or advertising trackers. That&apos;s why there&apos;s no
          cookie banner.
        </p>
      }
    >
      <h2>Local storage</h2>
      <p>
        A few toys on the <Link href="/interests">Interests page</Link> remember things
        in your browser&apos;s local storage. Nothing is written until you interact
        with them, and none of it is ever sent to me or anyone else.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">What it remembers</th>
            <th scope="col">Written</th>
          </tr>
        </thead>
        <tbody>
          {storage.map((row) => (
            <tr key={row.key}>
              <td>
                <code>{row.key}</code>
              </td>
              <td>{row.what}</td>
              <td>{row.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        These entries stay until you clear them. To remove them, clear site data for
        this site in your browser settings.
      </p>

      <h2>Spotify player (optional)</h2>
      <p>
        With Fun mode off, the Interests page offers an embedded Spotify playlist. It
        doesn&apos;t load automatically. Nothing is requested from Spotify until you
        press <strong>Load Spotify player</strong>. Once loaded, Spotify may set its own
        cookies under{" "}
        <a href="https://www.spotify.com/legal/cookies-policy/" target="_blank" rel="noopener noreferrer">
          Spotify&apos;s cookie policy
        </a>
        . You can always use the plain link to open the playlist on Spotify instead.
      </p>

      <h2>Hosting</h2>
      <p>
        The site is served by Vercel, which processes standard request data to deliver
        pages. See the <Link href="/privacy">privacy policy</Link> for details.
      </p>

      <h2>Changes</h2>
      <p>
        If I ever add cookies or analytics, this page will be updated first. If they
        aren&apos;t strictly necessary, I&apos;ll ask for your consent before setting
        them.
      </p>
    </LegalPage>
  );
}
