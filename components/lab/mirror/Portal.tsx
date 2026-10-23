"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The lab pages are full-screen. The site layout wraps page content in a
 * stacking context that sits under the nav, so render into <body> instead.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
