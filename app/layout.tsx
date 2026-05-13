import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navigation from "@/components/Navigation";
import ScrollProgress from "@/components/ScrollProgress";
import SiteEasterEggs from "@/components/SiteEasterEggs";
import PersonJsonLd from "@/components/PersonJsonLd";
import { site } from "@/lib/site";

const description =
  "Incoming iOS Engineer at WHOOP (July 2026). NEU CS '26. Building solo projects in the meantime.";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.name,
    template: `%s — ${site.name}`,
  },
  description,
  authors: [{ name: site.name, url: site.url }],
  creator: site.name,
  applicationName: site.name,
  category: "portfolio",
  keywords: [
    "Rohin Patel",
    "iOS Engineer",
    "SwiftUI",
    "WHOOP",
    "Northeastern University",
    "Machine Learning",
    "Computer Vision",
    "TensorFlow",
    "BLE",
  ],
  openGraph: {
    title: site.name,
    description,
    url: site.url,
    siteName: site.name,
    type: "profile",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: site.name,
    description,
  },
  alternates: {
    canonical: site.url,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="bg-[var(--bg)] text-[var(--fg)] antialiased font-sans">
        {/*
          PSST — try ↑↑↓↓←→←→ba, or type "siu" / "barca" / "neymar" anywhere.
          Source: https://github.com/RohinPat
        */}
        <PersonJsonLd />
        <div className="grain" />
        <div className="vignette" />
        <ScrollProgress />
        <Navigation />
        <div className="relative z-10">{children}</div>
        <SiteEasterEggs />
      </body>
    </html>
  );
}
