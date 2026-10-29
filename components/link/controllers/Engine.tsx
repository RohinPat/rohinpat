"use client";

import { useEffect, useState } from "react";
import { parseEngineMode, type EngineMode } from "@/components/offhours/engineRemote";
import EngineDrag from "./EngineDrag";
import EngineNight from "./EngineNight";
import { useShellNote } from "./Shell";
import type { ControllerProps } from "./types";

// Cars' controller picks which of its two controllers to show by what the
// laptop says is up ("engine-mode"): a steering wheel for Night run, the
// throttle grip for the drag strip. It asks on mount and hears again whenever
// the laptop switches. Until it hears it shows Night run, the default.

export default function EngineController(props: ControllerProps) {
  const { send, subscribe } = props;
  const [mode, setMode] = useState<EngineMode | null>(null);

  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "engine-mode") return;
      const next = parseEngineMode(m.data);
      if (next) setMode(next);
    });
    send({ type: "gesture", name: "engine-sync", data: {} });
    // a laptop that never answers is on Night run
    const t = window.setTimeout(() => setMode((m) => m ?? "night"), 1200);
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [send, subscribe]);

  useShellNote(mode === "drag" ? "Drag strip" : mode === "night" ? "Night run" : null);

  if (mode === "drag") return <EngineDrag {...props} />;
  if (mode === "night") return <EngineNight {...props} />;
  return (
    <div className="flex-1 grid place-items-center" data-testid="engine-waiting" role="status">
      <p className="text-[1.1rem] text-[#c9c6b6]">Waiting for the laptop…</p>
    </div>
  );
}
