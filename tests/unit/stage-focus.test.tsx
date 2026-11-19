import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import Stage from "@/components/offhours/Stage";

// The piece takes focus when the stage has grown, read from the clip-path transition, never from a timer:
// a fixed delay lands early on a slow machine (keys typed before it are lost) and late on a fast one.

const meta = { index: 1, label: "Test", title: "Test piece", how: [] };
const origin = { top: 100, left: 100, right: 200, bottom: 200, width: 100, height: 100, x: 100, y: 100, toJSON() {} } as DOMRect;
const Piece = () => <button data-autofocus>game</button>;

function endTransition(el: Element, propertyName: string, type = "transitionend") {
  const ev = new Event(type, { bubbles: true });
  Object.defineProperty(ev, "propertyName", { value: propertyName });
  el.dispatchEvent(ev);
}

describe("Stage focus hand-off", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    delete (document as { hidden?: boolean }).hidden;
  });

  it("waits for the grow to end, however long a timer would have said", () => {
    // a grow that is still running: the browser reports one animation on the stage
    HTMLElement.prototype.getAnimations = () => [{} as Animation];
    render(
      <Stage meta={meta} origin={origin} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-stage", "opening");
    expect(screen.getByText("game")).not.toHaveFocus();

    act(() => endTransition(dialog, "clip-path"));
    expect(dialog).toHaveAttribute("data-stage", "open");
    expect(screen.getByText("game")).toHaveFocus();
  });

  it("ignores a child's transition and other properties", () => {
    HTMLElement.prototype.getAnimations = () => [{} as Animation];
    render(
      <Stage meta={meta} origin={origin} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    const dialog = screen.getByRole("dialog");
    act(() => endTransition(dialog, "opacity"));
    act(() => endTransition(screen.getByText("game"), "clip-path"));
    expect(dialog).toHaveAttribute("data-stage", "opening");
    expect(screen.getByText("game")).not.toHaveFocus();
  });

  it("with no grow to run, the piece has focus once the stage has shown", async () => {
    // no origin rect: the clip-path is the whole window from the start, so no transition happens.
    // The stage shows on the next animation frame, which fake timers do not run, so wait on state.
    vi.useRealTimers();
    render(
      <Stage meta={meta} origin={null} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("data-stage", "open"));
    expect(screen.getByText("game")).toHaveFocus();
  });

  it("a close during the grow keeps focus out of the piece, even when the shrink ends later", () => {
    HTMLElement.prototype.getAnimations = () => [{} as Animation];
    render(
      <Stage meta={meta} origin={origin} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    const dialog = screen.getByRole("dialog");
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog).toHaveAttribute("data-stage", "closing");
    act(() => endTransition(dialog, "clip-path"));
    expect(dialog).toHaveAttribute("data-stage", "closing");
    expect(screen.getByText("game")).not.toHaveFocus();
  });
  it("a cancelled grow still hands focus over (transitioncancel), and a child's cancel does not", () => {
    HTMLElement.prototype.getAnimations = () => [{} as Animation];
    render(
      <Stage meta={meta} origin={origin} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    const dialog = screen.getByRole("dialog");
    act(() => endTransition(screen.getByText("game"), "clip-path", "transitioncancel"));
    expect(screen.getByText("game")).not.toHaveFocus();
    act(() => endTransition(dialog, "clip-path", "transitioncancel"));
    expect(dialog).toHaveAttribute("data-stage", "open");
    expect(screen.getByText("game")).toHaveFocus();
  });

  it("a grow with zero duration runs no animation, so the piece has focus once the stage shows", async () => {
    // origin given, but CSS sets the duration to 0: the browser runs no transition and sends no transitionend
    HTMLElement.prototype.getAnimations = () => [];
    vi.useRealTimers();
    render(
      <Stage meta={meta} origin={origin} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("data-stage", "open"));
    expect(screen.getByText("game")).toHaveFocus();
  });

  it("a stage opened in a hidden tab settles at once: no frame will show it", () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    HTMLElement.prototype.getAnimations = () => [{} as Animation];
    render(
      <Stage meta={meta} origin={origin} onClose={() => {}}>
        <Piece />
      </Stage>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-stage", "open");
    expect(screen.getByText("game")).toHaveFocus();
  });
});
