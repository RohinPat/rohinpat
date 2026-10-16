import type { Metadata } from "next";
import { Archivo, DM_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import SiteEasterEggs from "@/components/SiteEasterEggs";
import LaunchTracker from "@/components/LaunchTracker";
import PersonJsonLd from "@/components/PersonJsonLd";
import SiteFooter from "@/components/SiteFooter";
import { description, site } from "@/lib/site";

// Two families total. next/font downloads them at build time and serves them
// from this site, so visitors' browsers never contact Google.
// Archivo (variable width) does both jobs: condensed for display, normal for body.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-display",
  display: "swap",
});
const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});


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
    "PyTorch",
    "CLIP",
    "FastAPI",
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
      className={`${archivo.variable} ${mono.variable}`}
    >
      <body className="bg-[var(--bg)] text-[var(--fg)] antialiased font-sans">
        {/*
          PSST — try ↑↑↓↓←→←→ba, or type "siu" / "barca" / "neymar" anywhere.
          Source: https://github.com/RohinPat
        */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <PersonJsonLd />
        <Navigation />
        <div id="main" tabIndex={-1} className="relative z-10 outline-none">
          {children}
        </div>
        <SiteFooter />
        <SiteEasterEggs />
        <LaunchTracker />
      </body>
    </html>
  );
}
