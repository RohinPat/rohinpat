"use client";

import { createContext, useContext } from "react";

// Where the stage a piece is shown in is: the grow, open, or the shrink. A piece with a heavy start (a WebGL
// context, a shader compile, a model) waits for "open", so the grow runs on a free main thread.
export type StagePhase = "opening" | "open" | "closing";

// outside any stage (a tile, a standalone page) there is no grow to wait for: the piece is open at once
export const StagePhaseContext = createContext<StagePhase>("open");

export function useStagePhase() {
  return useContext(StagePhaseContext);
}
