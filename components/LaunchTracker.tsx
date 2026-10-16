"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { forgetLaunch, launchedHref } from "@/components/home/launch";

// If you wander from a launched page to some other page, coming Home
// shouldn't "close" into the first app's icon any more.
export default function LaunchTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const href = launchedHref();
    if (href && pathname !== "/" && pathname !== href) forgetLaunch();
  }, [pathname]);
  return null;
}
