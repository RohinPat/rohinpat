import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navigation from "@/components/Navigation";
import ScrollProgress from "@/components/ScrollProgress";
import SiteEasterEggs from "@/components/SiteEasterEggs";

export const metadata: Metadata = {
  metadataBase: new URL("https://rohinpatel.com"),
  title: {
    default: "Rohin Patel",
    template: "%s — Rohin Patel",
  },
  description:
    "iOS Engineer at WHOOP. NEU CS '26, full-time inbound. Building software, then going skiing.",
  authors: [{ name: "Rohin Patel" }],
  openGraph: {
    title: "Rohin Patel",
    description:
      "iOS Engineer at WHOOP. NEU CS '26, full-time inbound. Building software, then going skiing.",
    type: "website",
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
