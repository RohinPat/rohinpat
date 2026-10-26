import type { Metadata } from "next";
import LaptopPanel from "@/components/lab/handshake/LaptopPanel";

export const metadata: Metadata = {
  title: "Handshake lab (laptop)",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <LaptopPanel />;
}
