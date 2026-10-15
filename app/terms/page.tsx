import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL_UPDATED } from "@/lib/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for this personal portfolio site.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms of use"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          This is a personal portfolio. By using it you agree to these terms. If you
          don&apos;t, please don&apos;t use the site.
        </p>
      }
    >
      <h2>What this site is</h2>
      <p>
        An informational site about my work and interests, run by {site.name} as an
        individual. Nothing is sold here and there are no accounts, so there is
        nothing to buy, subscribe to or refund.
      </p>

      <h2>My views are my own</h2>
      <p>
        I write here in a personal capacity. Nothing on this site speaks for any
        current or former employer, school or organization I mention, and none of them
        has reviewed or endorsed it.
      </p>

      <h2>Content and copyright</h2>
      <p>
        The writing, design and original graphics on this site are © {site.name}{" "}
        unless noted otherwise. You&apos;re welcome to link to any page. Please
        don&apos;t republish substantial parts of it as your own.
      </p>
      <p>
        The source code is public on{" "}
        <a href={site.github} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Reuse of the code is governed by the license terms in that repository.
      </p>

      <h2>Trademarks</h2>
      <p>
        Company, club, product and brand names mentioned here (for example WHOOP,
        SiPhox Health, Varidx, Northeastern University, FC Barcelona, Spotify, GitHub
        and LinkedIn) belong to their owners. I use them only to describe my work and
        interests. Their mention doesn&apos;t imply any affiliation or endorsement.
      </p>

      <h2>The interactive pieces</h2>
      <p>
        The pieces on the Off hours page and the homepage lab are for fun. They&apos;re
        provided as they are, with no promises that they work on every device. They
        use motion; if you prefer less, turn on your device&apos;s reduced-motion
        setting and they&apos;ll hold still. The heart-rate lab is synthesized, not
        real data, and isn&apos;t medical information.
      </p>

      <h2>Links to other sites</h2>
      <p>
        Links to other sites, including my project demos, are provided for
        convenience. I&apos;m not responsible for their content or how they handle
        your data.
      </p>

      <h2>Accuracy</h2>
      <p>
        I try to keep everything here accurate and current, but the site is provided
        &ldquo;as is&rdquo; without warranties of any kind. To the extent the law allows,
        I&apos;m not liable for any loss arising from your use of it.
      </p>

      <h2>Privacy</h2>
      <p>
        See the <Link href="/privacy">privacy policy</Link> and{" "}
        <Link href="/cookies">cookie policy</Link>.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the Commonwealth of Massachusetts,
        USA.
      </p>

      <h2>Changes and contact</h2>
      <p>
        I may update these terms. The date at the top shows the latest version.
        Questions: <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
