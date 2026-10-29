// The nine pieces on /interests, as plain data. Everything that only needs to
// know *which* games exist (the tiles, the Stage's header, and the phone's game
// list, which must not pull any game code) reads from here.

export type PieceId = "watch" | "maze" | "hoops" | "penalty" | "decks" | "engine" | "keyboard" | "golf" | "powder";

export type PieceMeta = {
  id: PieceId;
  index: number;
  label: string;
  line: string;
  title: string;
  how: string[];
};

export const PIECE_META: PieceMeta[] = [
  {
    id: "watch",
    index: 1,
    label: "Watches",
    line: "A little useless, a little perfect.",
    title: "Wind it, then take it apart",
    how: ["Drag the crown round to wind", "Drag the slider to explode the movement", "Drag the watch to turn it"],
  },
  {
    id: "maze",
    index: 2,
    label: "Gaming",
    line: "1-bit, and the machines play too.",
    title: "Solve the maze, or watch them learn",
    how: ["Walk it yourself (arrows, WASD or drag), or pick a solver", "New maze any time"],
  },
  {
    id: "hoops",
    index: 3,
    label: "Basketball",
    line: "Hornets. Through whatever.",
    title: "30 seconds on the clock",
    how: ["Swipe up on the ball to shoot (keyboard: arrows aim, hold Space)", "Three in a row doubles your points"],
  },
  {
    id: "penalty",
    index: 4,
    label: "Barça",
    line: "Més que un club.",
    title: "Penalty shootout",
    how: ["Pick a shot (keys 1-7)", "Aim, hold to power up, let go", "Best of five, then sudden death"],
  },
  {
    id: "decks",
    index: 5,
    label: "Music",
    line: "Headphones on, most of the day.",
    title: "Make a beat, then scratch it",
    how: ["Click steps to build the beat", "Grab the record to scratch", "Hold the fader to cut"],
  },
  {
    id: "engine",
    index: 6,
    label: "Cars",
    line: "A canyon road, after midnight.",
    title: "Night run",
    how: [
      "←/→ steer, ↑ gas, ↓ brake, Shift handbrake",
      "Brake into a corner to drift. Drifting scores; a rail hit loses it",
      "Beat the ghost to the last checkpoint",
    ],
  },
  {
    id: "keyboard",
    index: 7,
    label: "Keyboards",
    line: "Hand-built, 65%, lubed.",
    title: "Built in layers",
    how: ["Drag the slider to pull it apart", "Type to snap it back together", "Drag to turn it"],
  },
  {
    id: "golf",
    index: 8,
    label: "Golf",
    line: "Read the break, then rip one.",
    title: "Putt, drive, read",
    how: ["Putt: pull back and let go", "Range: drag down, then swing up", "Read green: pour water to see the break"],
  },
  {
    id: "powder",
    index: 9,
    label: "Skiing",
    line: "Vermont weekends.",
    title: "Giant slalom",
    how: ["Carve through every gate", "Tuck on the straights", "Left/right in the air spins"],
  },
];

export const PIECE_IDS: PieceId[] = PIECE_META.map((p) => p.id);

export function isPieceId(s: string): s is PieceId {
  return (PIECE_IDS as string[]).includes(s);
}

/** The `open` message app string for a piece ("piece:golf"); "piece:list" means the grid. */
export const pieceApp = (id: PieceId | "list") => `piece:${id}` as const;

/** Parse an `open` app string: a piece id, "list", or null when it isn't a piece message. */
export function parsePieceApp(app: string): PieceId | "list" | null {
  if (!app.startsWith("piece:")) return null;
  const id = app.slice(6);
  return id === "list" ? "list" : isPieceId(id) ? id : null;
}
