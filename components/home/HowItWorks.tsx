import Link from "next/link";
import PipelineDiagram from "@/components/writeup/PipelineDiagram";

// Home, second screen: the real thing instead of a demo. Closet
// Organizer's architecture, explorable, with the write-up one click away.
export default function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="signal px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-12 gap-x-10 gap-y-5 items-end mb-10 md:mb-14">
          <h2 id="how-title" className="display t-l lg:col-span-7">
            How Closet Organizer works
          </h2>
          <p className="lg:col-span-5 text-lg leading-relaxed text-[var(--fg-muted)] text-pretty max-w-[44ch]">
            A wardrobe app I build and run: one FastAPI backend behind an Expo app and a web
            app. This is the whole system, from a photo to an outfit.
          </p>
        </div>

        <PipelineDiagram />

        <div className="mt-10 md:mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            href="/projects/closet-organizer"
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--paper)] text-[var(--signal)] font-medium hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors"
          >
            Read the write-up
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
          <a
            href="https://github.com/RohinPat/Closet-Org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block py-1 link-underline"
          >
            The code, on GitHub ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
