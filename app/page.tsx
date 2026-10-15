import LockScreenHero from "@/components/home/LockScreenHero";
import SignalLab from "@/components/home/SignalLab";
import WorkFilmstrip from "@/components/home/WorkFilmstrip";

// cream → green → ink → (ink footer)
export default function Home() {
  return (
    <main className="relative">
      <LockScreenHero />
      <SignalLab />
      <WorkFilmstrip />
    </main>
  );
}
