import LockScreenHero from "@/components/home/LockScreenHero";
import SelectedWork from "@/components/home/SelectedWork";
import OffHoursPreview from "@/components/home/OffHoursPreview";

// Home is the UI-heavy page: the phone, the work as visual cards, three live
// pieces. Detail lives on /projects, the case study and the colophon.
// cream (who) → green (work) → ink (off hours) → ink footer
export default function Home() {
  return (
    <main className="relative">
      <LockScreenHero />
      <SelectedWork />
      <OffHoursPreview />
    </main>
  );
}
