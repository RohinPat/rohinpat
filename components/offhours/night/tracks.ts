import { ENGINE_CAL } from "../engineRemote";
import { CLIMB_MEDALS, MEDALS, type Medal } from "./medals";

// The two roads Night run has: the canyon (the tile, the attract mode and the default) and the climb. A track is the road's name,
// its medals and the few words that change with the place; the road itself is built by night/road.ts from the track's id, the
// scenery by night/scenery.ts, the sky and the light by night/assets.ts (one renderer, a track config), and the target driver
// by night/target.ts. The visit's best run and score are kept for each track in game.ts (memory only).

export type TrackId = "canyon" | "climb";
export const TRACK_IDS: TrackId[] = ["canyon", "climb"];

export type Track = {
  id: TrackId;
  /** the picker's word for it */
  name: string;
  /** the line over the title on the ready card, in capitals */
  strap: string;
  /** the end card's headline for a finish, in capitals, and the screen reader's line for it */
  cleared: string;
  clearedSpoken: string;
  /** what the canvas is called to the screen reader */
  label: string;
  medals: Medal[];
  /** the run's numbers: the clock, the points, the penalty (ENGINE_CAL.run, with what the track changes) */
  run: typeof ENGINE_CAL.run;
  /** what a slide pays, as a multiple of the canyon's (a road of slower corners pays more, since the pay grows with the square of the speed) */
  driftPay: number;
};

export const TRACKS: Record<TrackId, Track> = {
  canyon: {
    id: "canyon",
    name: "Canyon",
    strap: "A CANYON ROAD, AFTER MIDNIGHT",
    cleared: "CANYON CLEARED",
    clearedSpoken: "You made it out of the canyon.",
    label: "a canyon road after midnight",
    medals: MEDALS,
    run: ENGINE_CAL.run,
    driftPay: 1,
  },
  climb: {
    id: "climb",
    name: "Climb",
    strap: "A SWITCHBACK ROAD, ABOVE THE CLOUDS",
    cleared: "SUMMIT REACHED",
    clearedSpoken: "You reached the summit.",
    label: "a switchback road up a mountain at night",
    medals: CLIMB_MEDALS,
    run: { ...ENGINE_CAL.run, ...ENGINE_CAL.climb.run },
    driftPay: ENGINE_CAL.climb.driftPay,
  },
};
