import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import Exploded3D from "@/components/offhours/Exploded3D";
import { StagePhaseContext, type StagePhase } from "@/components/offhours/stagePhase";
import type { Model } from "@/components/offhours/three/viewer";

// A piece that makes a WebGL context (the keyboard and the watch both, through Exploded3D) must not start it while
// its stage is still growing: the grow would wait on the shader compile and the model. Counted, never timed.

const { createViewer } = vi.hoisted(() => ({
  createViewer: vi.fn(() => ({ setExplode() {}, setSolo() {}, setPaused() {}, onLabels() {}, dispose() {} })),
}));
vi.mock("@/components/offhours/three/viewer", () => ({ createViewer }));

const model = { parts: [{ id: "a", label: "A", note: "" }] } as unknown as Model;

function piece(build: () => Promise<Model>, phase?: StagePhase) {
  const el = (
    <Exploded3D build={build} explode={0} interactive preview={false} />
  );
  return phase ? <StagePhaseContext.Provider value={phase}>{el}</StagePhaseContext.Provider> : el;
}

describe("a piece boots its WebGL context only once its stage is open", () => {
  it("does not create the context while the stage is opening, or closing before it ever opened", async () => {
    createViewer.mockClear();
    const build = vi.fn(async () => model);
    const { rerender } = render(piece(build, "opening"));
    // let any boot that would have started run its course
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(build).not.toHaveBeenCalled();
    expect(createViewer).not.toHaveBeenCalled();
    rerender(piece(build, "closing"));
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(createViewer).not.toHaveBeenCalled();
  });

  it("boots once the stage is open, and only once", async () => {
    createViewer.mockClear();
    const build = vi.fn(async () => model);
    const { rerender } = render(piece(build, "opening"));
    rerender(piece(build, "open"));
    await waitFor(() => expect(createViewer).toHaveBeenCalledTimes(1));
    rerender(piece(build, "open"));
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("a piece outside any stage (a standalone page or a tile) is open at once", async () => {
    createViewer.mockClear();
    render(piece(async () => model));
    await waitFor(() => expect(createViewer).toHaveBeenCalledTimes(1));
  });
});
