"use client";

import { useEffect, useRef } from "react";
import { phoneBezel } from "@/components/writeup/PhoneFrame";

// A short, muted screen recording that plays only while it is on screen.
// It never starts under prefers-reduced-motion (the controls still work), and
// it stops again when scrolled away. If the reader pauses it themselves, it
// stays paused. The file is not requested until the video is near the
// viewport, so it can't hold up the page's load event; until then (and
// without JS) it is a poster.

export default function DemoVideo({
  src,
  poster,
  alt,
  width,
  height,
}: {
  src: string;
  poster: string;
  alt: string;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let ours = false; // true while a pause is ours, not the reader's
    let readerPaused = false;

    const pause = () => {
      ours = true;
      video.pause();
    };
    const sync = () => {
      if (visible && !reduced.matches && !readerPaused) {
        video.play().catch(() => {});
      } else if (!video.paused) {
        pause();
      }
    };
    const onPause = () => {
      if (!ours && visible) readerPaused = true;
      ours = false;
    };

    const near = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        video.src = src;
        near.disconnect();
      },
      { rootMargin: "300px" },
    );
    near.observe(video);

    const seen = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (!visible) readerPaused = false;
        sync();
      },
      { threshold: 0.5 },
    );
    seen.observe(video);
    video.addEventListener("pause", onPause);
    // the file may arrive after the video has already scrolled into view
    video.addEventListener("canplay", sync);
    reduced.addEventListener("change", sync);
    return () => {
      near.disconnect();
      seen.disconnect();
      video.removeEventListener("pause", onPause);
      video.removeEventListener("canplay", sync);
      reduced.removeEventListener("change", sync);
    };
  }, [src]);

  return (
    <div className={phoneBezel}>
      <video
        ref={ref}
        controls
        muted
        loop
        playsInline
        preload="metadata"
        poster={poster}
        width={width}
        height={height}
        aria-label={alt}
        className="block w-full h-auto rounded-[1.4rem]"
      />
    </div>
  );
}
