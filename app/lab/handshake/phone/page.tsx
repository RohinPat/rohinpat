import type { Metadata } from "next";
import PhonePanel from "@/components/lab/handshake/PhonePanel";

export const metadata: Metadata = {
  title: "Handshake lab (phone)",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PhonePanel />;
}
