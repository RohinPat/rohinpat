import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookies",
  description: "This site sets no cookies and stores nothing in your browser.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Cookies"
      title="Cookie policy"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          This site sets <strong className="text-[var(--fg)]">no cookies</strong>, stores
          nothing in your browser, and runs no analytics, advertising or third-party
          embeds. That&apos;s why there&apos;s no cookie banner.
        </p>
      }
    >
      <h2>What runs in your browser</h2>
      <p>
        The interactive pieces on the <Link href="/interests">Off hours</Link> page (and
        the heart-rate lab on the homepage) are drawn by code that runs on your device.
        They don&apos;t save anything, and nothing they do is sent to me or anyone
        else. Reload the page and they start fresh.
      </p>

      <h2>Links to other sites</h2>
      <p>
        Some links go to other sites, such as Spotify, GitHub and LinkedIn. Those
        sites only load if you click through, and they have their own cookie
        policies.
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
