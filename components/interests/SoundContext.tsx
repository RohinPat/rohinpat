"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SoundCtx = {
  enabled: boolean;
  toggle: () => void;
  set: (v: boolean) => void;
};

const Ctx = createContext<SoundCtx>({
  enabled: false,
  toggle: () => {},
  set: () => {},
});

const STORAGE_KEY = "interests-sound";

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "1") setEnabled(true);
  }, []);

  const set = useCallback((v: boolean) => {
    setEnabled(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* no-op */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* no-op */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ enabled, toggle, set }), [enabled, toggle, set]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSound() {
  return useContext(Ctx);
}
