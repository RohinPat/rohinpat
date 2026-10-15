import LockScreenHero from "@/components/home/LockScreenHero";
import HowItWorks from "@/components/home/HowItWorks";
import SelectedWork from "@/components/home/SelectedWork";

// cream (who) → green (how one thing works) → ink (everything else)
export default function Home() {
  return (
    <main className="relative">
      <LockScreenHero />
      <HowItWorks />
      <SelectedWork />
    </main>
  );
}
