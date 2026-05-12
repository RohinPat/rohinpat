import { site } from "@/lib/site";

// Schema.org Person JSON-LD. Helps search engines + LinkedIn render a rich card.
export default function PersonJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: site.name,
    url: site.url,
    email: `mailto:${site.email}`,
    jobTitle: "iOS Engineer",
    description:
      "iOS Engineer at WHOOP. Northeastern CS '26. Building software, then going skiing.",
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
