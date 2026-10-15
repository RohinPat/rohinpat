import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL_UPDATED } from "@/lib/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What this site collects (almost nothing) and why.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy policy"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          Short version: this is a personal portfolio. There are no accounts, no
          analytics, no ads, no tracking pixels and no forms that send data to me.
          This page explains the little that does happen.
        </p>
      }
    >
      <h2>Who runs this site</h2>
      <p>
        {site.name}, an individual based in {site.location}. It isn&apos;t a business
        and nothing is sold here. Questions about this policy:{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>

      <h2>What I collect</h2>
      <ul>
        <li>
          <strong>Nothing through the site itself.</strong> The contact page composes an
          email in your own mail app. Whatever you type there stays in your browser
          until you choose to send it.
        </li>
        <li>
          <strong>Emails you send me.</strong> If you do email me, I receive your email
          address, name (if your mail app includes it) and whatever you write. I use it
          only to read and reply to you.
        </li>
      </ul>

      <h2>Hosting and server logs</h2>
      <p>
        The site is hosted on Vercel. Like any web host, Vercel processes technical
        request data (such as IP address, browser user agent, the page requested and
        the time) to deliver the site and protect it from abuse. I don&apos;t use that
        data to identify or profile visitors. See{" "}
        <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
          Vercel&apos;s privacy policy
        </a>
        .
      </p>

      <h2>Cookies and browser storage</h2>
      <p>
        This site sets no cookies. A few games on the Interests page remember your
        settings and high scores in your browser&apos;s local storage, only after you
        interact with them. That data never leaves your device. The optional Spotify
        player loads only if you click to load it. Details are in the{" "}
        <Link href="/cookies">cookie policy</Link>.
      </p>

      <h2>Sharing</h2>
      <p>
        I don&apos;t sell, rent or share your personal information. I would only
        disclose an email if the law required me to.
      </p>

      <h2>How long I keep it</h2>
      <p>
        Emails stay in my inbox for as long as they&apos;re useful for staying in
        touch. Ask me to delete our correspondence and I will.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask to see, correct or delete anything I hold about you by emailing{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>. You can clear this site&apos;s
        local storage at any time from your browser settings.
      </p>

      <h2>Links to other sites</h2>
      <p>
        This site links to other places, including GitHub, LinkedIn, Spotify and
        live demos of my projects. Those sites have their own privacy practices,
        which this policy doesn&apos;t cover.
      </p>

      <h2>Children</h2>
      <p>
        This site isn&apos;t directed at children under 13, and I don&apos;t knowingly
        collect information from them.
      </p>

      <h2>Changes</h2>
      <p>
        If anything here changes, for example if I add analytics, I&apos;ll update this
        page and the date at the top before it goes live.
      </p>
    </LegalPage>
  );
}
