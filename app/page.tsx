import Hero from "@/components/Hero";
import NowStrip from "@/components/NowStrip";
import SelectedWork from "@/components/SelectedWork";
import SelectedInterests from "@/components/SelectedInterests";
import HomeFooter from "@/components/HomeFooter";
import CursorSpotlight from "@/components/CursorSpotlight";

export default function Home() {
  return (
    <main className="relative">
      <CursorSpotlight />
      <Hero />
      <NowStrip />
      <SelectedWork />
      <SelectedInterests />
      <HomeFooter />
    </main>
  );
}
