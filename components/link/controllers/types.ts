import type { LinkMsg } from "@/lib/link/session";
import type { Motion } from "@/lib/link/permission";
import type { PieceId } from "@/components/offhours/pieces";

/**
 * What every phone controller gets. A controller is a React component that
 * renders the controls for one game, inside the shell (Back button, game name).
 * Register it in controllers/index.tsx.
 */
export type ControllerProps = {
  piece: PieceId;
  /** send to the laptop: `send({ type: "gesture", name, data })`, `send({ type: "axis", name, v })` */
  send: (m: LinkMsg) => void;
  /** messages from the laptop's game (it can send `gesture`s back, e.g. to sync state) */
  subscribe: (cb: (m: LinkMsg) => void) => () => void;
  /** what the visitor answered when the phone connected */
  motion: Motion | null;
  /** motion data can be expected: granted, or this browser needs no permission. False = offer a touch fallback. */
  motionOk: boolean;
};
