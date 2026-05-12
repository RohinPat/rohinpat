"use client";

import { useEffect, useState } from "react";

export type Track = {
  title: string;
  artist: string;
  album: string;
  albumArt: string | null;
  url: string | null;
};

type State = {
  tracks: Track[] | null;
  configured: boolean;
  loading: boolean;
};

type Range = "short_term" | "medium_term" | "long_term";

export function useTopTracks(range: Range = "medium_term", limit = 5): State {
  const [state, setState] = useState<State>({
    tracks: null,
    configured: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/spotify/top-tracks?range=${range}&limit=${limit}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancelled) return;
        if (json?.configured) {
          setState({ tracks: json.tracks, configured: true, loading: false });
        } else {
          setState({ tracks: null, configured: false, loading: false });
        }
      } catch {
        if (!cancelled) setState({ tracks: null, configured: false, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, limit]);

  return state;
}
