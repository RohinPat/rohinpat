import MirrorPhone from "@/components/lab/mirror/MirrorPhone";
import Portal from "@/components/lab/mirror/Portal";

export const metadata = { title: "Mirror lab: phone" };

export default function Page() {
  return (
    <Portal>
      <MirrorPhone />
    </Portal>
  );
}
