import type { Metadata } from "next";
import Contact from "@/components/Contact";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Rohin Patel.",
};

export default function ContactPage() {
  return (
    <main className="relative">
      <Contact />
    </main>
  );
}
