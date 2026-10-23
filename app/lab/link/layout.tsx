import type { Metadata } from "next";

// Lab prototype: not for indexing, not linked from the site.
export const metadata: Metadata = {
  title: "Link lab",
  robots: { index: false, follow: false },
};

export default function LinkLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
