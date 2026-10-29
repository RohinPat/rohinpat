import { buildVcard } from "@/lib/vcard";

// "Save contact" on /contact. Static: built once, at build time.
export const dynamic = "force-static";

export function GET() {
  return new Response(buildVcard(), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'attachment; filename="rohin-patel.vcf"',
    },
  });
}
