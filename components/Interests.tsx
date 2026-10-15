import Tile from "@/components/offhours/Tile";
import Watch from "@/components/offhours/Watch";
import Trails from "@/components/offhours/Trails";
import Blaugrana from "@/components/offhours/Blaugrana";
import Vinyl from "@/components/offhours/Vinyl";
import Ridgelines from "@/components/offhours/Ridgelines";
import Dither from "@/components/offhours/Dither";
import ShotChart from "@/components/offhours/ShotChart";
import Contours from "@/components/offhours/Contours";
import Keyboard from "@/components/offhours/Keyboard";

const PLAYLIST = "https://open.spotify.com/playlist/364G4Hr4KtJzhWpoHz4MFf";

// /interests — "Off hours". Nine things I like, each made into a small
// piece you can poke at. No scores, no settings, nothing saved.
export default function Interests() {
  return (
    <section className="px-4 md:px-10 pb-16 md:pb-24">
      <div className="max-w-6xl mx-auto">
        <h1>Off hours.</h1>
        <p className="-mt-6 mb-10 md:mb-14 text-lg md:text-xl muted max-w-xl text-pretty">
          Nine things I&apos;m into, each turned into something you can poke at.
          Everything here moves. Go on.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 auto-rows-[300px] gap-3 md:gap-4">
          <Tile index={1} label="Watches" line="A little useless, a little perfect." hint="Hold" className="md:col-span-6 lg:col-span-5 md:row-span-2">
            <Watch />
          </Tile>
          <Tile index={2} label="Cars" line="Long exposure, late drive." hint="Move · Hold" touchHint="Hold" className="md:col-span-6 lg:col-span-7">
            <Trails />
          </Tile>
          <Tile index={3} label="Barça" line="Més que un club." hint="Move" touchHint="Drag" className="md:col-span-3 lg:col-span-4">
            <Blaugrana />
          </Tile>
          <Tile index={4} label="Music" line="Headphones on, most of the day." hint="Spin" className="md:col-span-3 lg:col-span-3">
            <Vinyl playlistUrl={PLAYLIST} />
          </Tile>
          <Tile index={5} label="Skiing" line="Vermont weekends." hint="Move" touchHint="Drag" className="md:col-span-6 lg:col-span-6">
            <Ridgelines />
          </Tile>
          <Tile index={6} label="Gaming" line="1-bit, forever." hint="Move" touchHint="Drag" className="md:col-span-3 lg:col-span-3">
            <Dither />
          </Tile>
          <Tile index={7} label="Basketball" line="Hornets. Through whatever." hint="Shoot" touchHint="Tap" className="md:col-span-3 lg:col-span-3">
            <ShotChart />
          </Tile>
          <Tile index={8} label="Golf" line="Read the break." hint="Click" touchHint="Tap" className="md:col-span-6 lg:col-span-4">
            <Contours />
          </Tile>
          <Tile index={9} label="Keyboards" line="Hand-built, 65%, lubed." hint="Type" touchHint="Tap" className="md:col-span-6 lg:col-span-8">
            <Keyboard />
          </Tile>
        </div>
      </div>
    </section>
  );
}
