import Link from "next/link";
import Tile from "@/components/offhours/Tile";
import Watch from "@/components/offhours/Watch";
import Trails from "@/components/offhours/Trails";
import Blaugrana from "@/components/offhours/Blaugrana";

// Three live pieces from Off hours, right on the homepage — the UI does the
// talking. They're the same components (and pause off-screen the same way).
export default function OffHoursPreview() {
  return (
    <section aria-labelledby="oh-title" className="px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
          <h2 id="oh-title" className="display t-l">
            Off hours
          </h2>
          <Link href="/interests" className="group inline-flex items-center gap-2 font-medium link-underline py-1">
            All nine <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 auto-rows-[300px] gap-3 md:gap-4">
          <Tile as="h3" index={1} label="Watches" line="A little useless, a little perfect." hint="Hold" className="md:col-span-3 lg:col-span-4 md:row-span-2">
            <Watch />
          </Tile>
          <Tile as="h3" index={2} label="Cars" line="Long exposure, late drive." hint="Move · Hold" touchHint="Hold" className="md:col-span-3 lg:col-span-8">
            <Trails />
          </Tile>
          <Tile as="h3" index={3} label="Barça" line="Més que un club." hint="Move" touchHint="Drag" className="md:col-span-6 lg:col-span-8">
            <Blaugrana />
          </Tile>
        </div>
      </div>
    </section>
  );
}
