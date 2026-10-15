# rohinpat

Personal site of Rohin Patel — software engineer at WHOOP on the A&A Shop team, running the in-app shop.

Live at **[rohinpat.vercel.app](https://rohinpat.vercel.app)**.

## Pages

- **/** — lock-screen hero, a synthesized heart-rate "signal lab", selected work as a film strip
- **/projects** — things I've made and places I've worked, one line each
- **/interests** — "Off hours": nine small interactive pieces (watch, light trails, blaugrana, vinyl, ridgelines, dither, shot chart, golf contours, keyboard)
- **/contact**, **/privacy**, **/terms**, **/cookies**

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Canvas 2D / SVG. No animation library, no
analytics, no cookies. Fonts (Archivo, DM Mono) are self-hosted via `next/font`.

## Editing content

| What | Where |
| --- | --- |
| Name, role, team, email, links | `lib/site.ts` |
| Projects and jobs | `lib/projects.ts` |
| Policy "last updated" date | `lib/legal.ts` |

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
