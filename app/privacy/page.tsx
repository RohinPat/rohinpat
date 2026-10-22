import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL_UPDATED } from "@/lib/legal";
import { site } from "@/lib/site";

// The whole policy: privacy, cookies (#cookies) and terms of use (#terms).
// /terms and /cookies redirect here (next.config.mjs).

export const metadata: Metadata = {
  title: "Privacy",
  description: "This site collects nothing, sets no cookies and stores nothing in your browser. The details, and the terms of use.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          This site collects nothing about you. No accounts, analytics, ads, tracking,
          cookies or forms. The rest of this page is the detail.
        </p>
      }
    >
      <h2 className="!mt-0">What I collect</h2>
      <p>
        <strong>Nothing through the site.</strong> There are no forms; the contact page just
        opens your own mail app.
      </p>
      <p>
        <strong>Emails you send me.</strong> If you write, I get your address, your name if
        your mail app includes it, and what you wrote. I use it only to read and reply. It
        stays in my inbox for as long as it&apos;s useful for keeping in touch, and I&apos;ll
        delete our correspondence if you ask.
      </p>
      <p>
        <strong>The home screen&apos;s camera.</strong> Its camera button can name the colours of
        whatever you point it at. It only turns on if you tap it and your browser asks and you
        say yes. Frames are read inside your browser, never uploaded or saved, and the camera
        stops when you close it. A photo you pick instead is handled the same way.
      </p>

      <h2>Hosting logs</h2>
      <p>
        The site is hosted on Vercel. Like any host, Vercel processes technical request data
        (IP address, browser user agent, the page requested and the time) to deliver the site
        and protect it from abuse. I don&apos;t use that data to identify or profile anyone.
        See{" "}
        <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
          Vercel&apos;s privacy policy<span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>

      <h2 id="cookies" className="scroll-mt-24">Cookies and browser storage</h2>
      <p>
        None. The site sets no cookies, stores nothing in your browser, and runs no analytics,
        advertising or third-party embeds, which is why there&apos;s no cookie banner. The
        interactive pieces on <Link href="/interests">Off hours</Link> run entirely on your
        device; they save nothing and send nothing, and a reload starts them fresh. The{" "}
        <Link href="/colophon">colophon</Link> will show you the count, measured in your own
        browser.
      </p>
      <p>
        If I ever add cookies or analytics, this page changes first, and anything that
        isn&apos;t strictly necessary will ask for your consent before it&apos;s set.
      </p>

      <h2>Sharing and your choices</h2>
      <p>
        I don&apos;t sell, rent or share personal information, and would only disclose an
        email if the law required it. You can ask to see, correct or delete anything I hold
        about you by emailing <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>

      <h2>Links elsewhere</h2>
      <p>
        Links to GitHub, LinkedIn, Spotify and my project repositories load those sites only
        if you click them. They have their own privacy and cookie policies, which this one
        doesn&apos;t cover. This site isn&apos;t directed at children under 13, and I
        don&apos;t knowingly collect information from them.
      </p>

      <h2 id="terms" className="scroll-mt-24">Terms of use</h2>
      <p>
        Using the site means accepting these terms. It&apos;s a personal site run by {site.name}
        as an individual; nothing is sold here and there are no accounts. I write in a personal capacity: nothing here speaks for, or has
        been reviewed by, any employer, school or organisation I mention. Names such as WHOOP,
        SiPhox Health, Varidx, Northeastern University, FC Barcelona, Spotify, GitHub and
        LinkedIn belong to their owners, and mentioning them implies no affiliation or
        endorsement.
      </p>
      <p>
        The writing, design and original graphics are © {site.name} unless noted. Link to
        anything you like; please don&apos;t republish substantial parts as your own. The{" "}
        <a href={site.repo} target="_blank" rel="noopener noreferrer">
          source code<span className="sr-only"> (opens in a new tab)</span>
        </a>{" "}
        is reusable under the license in its repository.
      </p>
      <p>
        The site and its interactive pieces are provided as they are, without warranties of
        any kind, and to the extent the law allows I&apos;m not liable for any loss from using
        them. These terms are governed by the laws of the Commonwealth of Massachusetts, USA.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If anything here changes, I&apos;ll update this page and the date at the top before it
        takes effect. Questions go to <a href={`mailto:${site.email}`}>{site.email}</a>.
        {" "}This site is run by {site.name} from {site.location}.
      </p>
    </LegalPage>
  );
}
