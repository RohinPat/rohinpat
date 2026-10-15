import LockScreenHero from "@/components/home/LockScreenHero";
import SignalLab from "@/components/home/SignalLab";
import WorkFilmstrip from "@/components/home/WorkFilmstrip";
import ShopLab from "@/components/home/ShopLab";

// cream → green → ink → cream → (ink footer)
export default function Home() {
  return (
    <main className="relative">
      <LockScreenHero />
      <SignalLab />
      <WorkFilmstrip />
      <ShopLab />
    </main>
  );
}
