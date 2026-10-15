import { description, site } from "@/lib/site";

// Schema.org Person JSON-LD. Helps search engines + LinkedIn render a rich card.
export default function PersonJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: site.name,
    url: site.url,
    email: `mailto:${site.email}`,
    jobTitle: site.role,
    description,
    worksFor: {
      "@type": "Organization",
      name: site.employer,
      url: site.employerUrl,
    },
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: site.school,
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
      "PyTorch",
      "Mobile commerce",
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
