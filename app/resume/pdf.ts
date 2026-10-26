import { existsSync } from "node:fs";
import path from "node:path";

/**
 * True when public/resume.pdf exists. Called from a server component, so on
 * a static build it is answered once, at build time: drop the PDF in
 * /public, rebuild, and the "Download PDF" link appears. No file, no link.
 */
export function resumePdfExists(root: string = process.cwd()): boolean {
  return existsSync(path.join(root, "public", "resume.pdf"));
}
