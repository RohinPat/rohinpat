import type { Metadata } from "next";
import Backdrop from "@/components/golf3d/Backdrop";
import Golf3D from "@/components/golf3d/Golf3D";

// The course in 3D, full screen. Off hours' golf (the range and the putting green) links here.
export const metadata: Metadata = {
  title: "Golf",
  description: "Nine holes, in 3D.",
};

const HIDE_SITE = "body > nav, body > footer, body > .skip-link { display: none !important; }";

/**
 * The page is the course. Until its code has loaded, the server's own picture of it: the bar and the course, out of
 * focus. The site's navigation and footer are not shown (nor are their links fetched ahead) while it is up.
 */
export default function GolfPage() {
  return (
    <>
      {/* as HTML: React would escape the ">" in text, and the rule would not parse */}
      <style dangerouslySetInnerHTML={{ __html: HIDE_SITE }} />
      <div aria-hidden="true" className="fixed inset-0 z-[60] flex flex-col bg-[#0d100e]">
        <div className="flex items-center px-2 py-1.5">
          <span className="h-8 inline-flex items-center px-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8ad9a8]">Golf</span>
        </div>
        <div className="relative flex-1">
          <Backdrop />
        </div>
      </div>
      <Golf3D />
    </>
  );
}
