# rohinpat

Personal site of Rohin Patel — software engineer at WHOOP on the A&A Shop team, running the in-app shop.

Live at **[rohinpat.vercel.app](https://rohinpat.vercel.app)**.

## Pages

- **/** — lock-screen hero, Closet Organizer's architecture as an explorable diagram, selected work
- **/projects** — things I've made (with code and write-ups) and places I've worked
- **/projects/closet-organizer** — case study: architecture, code excerpts, trade-offs
- **/interests** — "Off hours": nine playable pieces that open full screen (a 3D watch you wind and explode, a 1-bit raycaster maze with BFS/DFS/A*/Q-learning solvers, flick-to-shoot hoops, a penalty shootout, a drum machine you scratch on a turntable, a rev-and-shift quarter mile, a 3D exploded keyboard, golf putt/range/green-reader, powder skiing). All sound is Web Audio synthesis; the 3D views use three.js (loaded on demand) with every model generated in code.
- **/colophon** — how the site is built, with live numbers measured in the visitor's browser
- **/contact**, **/privacy** (`/terms` and `/cookies` redirect into it)

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Canvas 2D / SVG. No animation library, no
analytics, no cookies, no third-party requests. Fonts (Archivo, DM Mono) are self-hosted via `next/font`.

## Editing content

| What | Where |
| --- | --- |
| Name, role, team, point of view, email, links | `lib/site.ts` |
| Projects and jobs (lines, links, write-up, media) | `lib/projects.ts` |
| The Closet Organizer write-up | `app/projects/closet-organizer/page.tsx` |
| Architecture diagram stages | `components/writeup/PipelineDiagram.tsx` |
| Policy "last updated" date | `lib/legal.ts` |

### Screenshots and recordings

Each entry in `lib/projects.ts` takes an optional `media` list (image or video, with
`alt`, `width` and `height`). Put files under `public/work/<slug>/` and reference them by
public path. The first item becomes the cover on the write-up; until there is one, the
project's drawing stands in. A unit test checks every media file exists and has alt text.

### Custom domain

Set `NEXT_PUBLIC_SITE_URL` (e.g. `https://example.com`) in Vercel. Canonical URLs, the
sitemap, robots, structured data and social cards all read it.

## Develop

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck && npm run lint
npm test             # unit (Vitest)
npm run test:e2e     # Playwright, incl. axe accessibility scan of every route
```

Deploys to Vercel from `main`.

## License

Code: [MIT](LICENSE). The Archivo font is under the SIL Open Font License
(`app/_fonts/OFL-Archivo.txt`).
