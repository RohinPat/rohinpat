"use client";

import { useEffect } from "react";

// Catches errors in the root layout itself. Must include its own <html>/<body>
// because the normal layout never gets a chance to render.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0a0a0a",
          color: "#ededed",
          minHeight: "100vh",
          margin: 0,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <main style={{ maxWidth: 640, margin: "0 auto" }}>
          <p
            style={{
              color: "#a50044",
              fontFamily: "ui-monospace, monospace",
              textTransform: "uppercase",
              letterSpacing: 4,
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            red card · the whole match stopped
          </p>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 600,
              letterSpacing: -1.5,
              lineHeight: 1.05,
              margin: "12px 0 24px",
            }}
          >
            Something went very wrong.
          </h1>
          <p style={{ color: "#9ca3af", fontSize: 18, marginBottom: 24 }}>
            The root layout itself crashed. Reloading usually clears it.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "12px 20px",
              background: "#ededed",
              color: "#0a0a0a",
              border: 0,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
