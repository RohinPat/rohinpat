import { site } from "@/lib/site";

// Schema.org Person JSON-LD. Helps search engines + LinkedIn render a rich card.
export default function PersonJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: site.name,
    url: site.url,
    email: `mailto:${site.email}`,
    jobTitle: "iOS Engineer (Incoming, WHOOP, July 2026)",
    description:
      "Incoming iOS Engineer at WHOOP (July 2026). Northeastern CS '26. Building solo projects in the meantime.",
    worksFor: {
      "@type": "Organization",
      name: "WHOOP",
      url: "https://whoop.com",
    },
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: "Northeastern University",
      sameAs: "https://www.northeastern.edu",
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Boston",
      addressRegion: "MA",
      addressCountry: "US",
    },
    sameAs: [site.github, site.linkedin],
    knowsAbout: [
      "iOS Development",
      "SwiftUI",
      "Machine Learning",
      "Computer Vision",
      "TensorFlow",
      "Bluetooth Low Energy",
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
