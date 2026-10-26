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
    how: ["Pick a solver: you, BFS, DFS, A*, wall follower, Q-learning", "You: arrows, WASD, or drag to walk", "New maze any time"],
  },
  {
    id: "hoops",
    index: 3,
    label: "Basketball",
    line: "Hornets. Through whatever.",
    title: "30 seconds on the clock",
    how: ["Swipe up on the ball to shoot", "Three in a row: on fire, double points", "10 points and the hoop starts moving", "Keyboard: arrows aim, hold Space"],
  },
  {
    id: "penalty",
    index: 4,
    label: "Barça",
    line: "Més que un club.",
    title: "Penalty shootout",
    how: ["Pick a shot: placed, driven, curl, dipper, knuckle, Panenka (keys 1-7)", "Aim with the pointer, hold to power up, let go", "Beat a keeper who reads you. Best of five, then sudden death"],
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
    line: "Redline, then shift.",
    title: "Rev and shift",
    how: ["Hold the pedal (or Space) to rev", "Shift on the green light (or ↑)", "Quarter mile, 0–60 split"],
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
    how: ["Putt: pull back from the ball and let go", "Range: drag down, then swing up through the ball", "Read green: pour water to see the break"],
  },
  {
    id: "powder",
    index: 9,
    label: "Skiing",
    line: "Vermont weekends.",
    title: "Giant slalom",
    how: ["Carve through every gate", "Tuck on the straights, don't skid", "Left/right in the air spins"],
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
