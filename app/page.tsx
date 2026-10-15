import LockScreenHero from "@/components/home/LockScreenHero";
import DisciplineMarquee from "@/components/home/DisciplineMarquee";
import SignalLab from "@/components/home/SignalLab";
import WorkFilmstrip from "@/components/home/WorkFilmstrip";
import ExperienceIndex from "@/components/home/ExperienceIndex";

// paper → ink → signal → ink → paper → (ink footer)
export default function Home() {
  return (
    <main className="relative">
      <LockScreenHero />
      <DisciplineMarquee />
      <SignalLab />
      <WorkFilmstrip />
      <ExperienceIndex />
    </main>
  );
}
