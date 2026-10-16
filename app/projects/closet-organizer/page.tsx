import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CodeBlock from "@/components/writeup/CodeBlock";
import Cover, { MediaView } from "@/components/writeup/Cover";
import PipelineDiagram from "@/components/writeup/PipelineDiagram";
import { projectBySlug } from "@/lib/projects";

// Case study. Every factual sentence is checked against the repo at the
// commit below; code is quoted verbatim apart from "# …" elisions. Opinions
// and motivations are drafts for Rohin to confirm (see TODO(Rohin) notes).

const REPO = "https://github.com/RohinPat/Closet-Org";
const SHA = "a3ff9ae6778c163bc4e3f6e0aaa8ea561d40e543";
const src = (path: string, lines: string) => `${REPO}/blob/${SHA}/${path}#${lines}`;

export const metadata: Metadata = {
  title: "Closet Organizer",
  description:
    "How Closet Organizer works: one FastAPI backend, CLIP zero-shot tagging, per-pixel colour voting, a rule-based outfit recommender, and an Expo app.",
  alternates: { canonical: "/projects/closet-organizer" },
};

const CLIP_EXCERPT = `
category_prompts = [
    f"a photo of a {c.lower().replace('-', ' ')}, a clothing item"
    for c in self.CATEGORIES
]
style_prompts = [f"a {s.lower()} style clothing item" for s in self.STYLES]

with torch.no_grad():
    self.cat_features = self._encode_text(category_prompts)
    self.style_features = self._encode_text(style_prompts)

# … later, per photo:
with _inference_lock, torch.no_grad():
    img_features = self.model.encode_image(img_tensor)
    img_features = img_features / img_features.norm(dim=-1, keepdim=True)
    cat_logits = (100.0 * img_features @ self.cat_features.T).softmax(dim=-1)[0]
`;

const VOTE_EXCERPT = `
rng = np.random.default_rng(0)
if len(pixels) > 4000:
    pixels = pixels[rng.choice(len(pixels), 4000, replace=False)]

votes: Dict[str, int] = {}
for p in pixels:
    name = self._closest_color(p)
    votes[name] = votes.get(name, 0) + 1

total = sum(votes.values())
ordered = sorted(votes.items(), key=lambda kv: -kv[1])

picked: List[str] = []
for name, count in ordered:
    if count / total < 0.08 and picked:
        break
    picked.append(name)
    if len(picked) >= num_colors:
        break
`;

const AST_EXCERPT = `
def test_async_routes_actually_await() -> None:
    offenders = []
    for path in ROUTE_FILES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if not any(isinstance(n, (ast.Await, ast.AsyncFor, ast.AsyncWith)) for n in ast.walk(node)):
                offenders.append(f"{path.name}:{node.name} (line {node.lineno})")
    assert not offenders, (
        "async def handlers with no await block the event loop; use plain def: "
        + ", ".join(offenders)
    )
`;

const ROTATE_EXCERPT = `
# IMMEDIATE takes the write lock up front so two concurrent
# refreshes of the same token can't both succeed.
conn.execute("BEGIN IMMEDIATE")
row = conn.execute(
    "SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at "
    "FROM refresh_tokens WHERE token_hash = ?",
    (_hash(token),),
).fetchone()
# …
if row["rotated_at"] is not None:
    if now - row["rotated_at"] <= ROTATION_GRACE_SECONDS:
        conn.rollback()
        return "conflict", None, None
    conn.execute(
        "UPDATE refresh_tokens SET revoked_at = ? "
        "WHERE family_id = ? AND revoked_at IS NULL",
        (now, row["family_id"]),
    )
    conn.commit()
    return "reused", row["user_id"], None
`;

const FACTS: [string, React.ReactNode][] = [
  ["Surfaces", "An Expo app for iOS and Android, a plain web app, one FastAPI backend"],
  ["ML", "CLIP ViT-B/32 zero-shot, rembg (U²-Net) cutouts, per-pixel colour voting"],
  ["Data", "SQLite in WAL mode; photos on disk with WebP grid thumbnails"],
  ["Tests", "136 pytest functions, plus Playwright, Jest, Bandit and ShellCheck in CI"],
  ["Timeline", "A notebook in 2023, a first app in November 2025, rebuilt around CLIP in May 2026; still shipping"],
];

export default function ClosetOrganizerCaseStudy() {
  const entry = projectBySlug("closet-organizer");
  if (!entry) notFound();
  const extraMedia = entry.media?.slice(1) ?? [];
  const hasMedia = Boolean(entry.media?.length);

  return (
    <main className="paper relative pt-28 pb-24 px-4 md:px-10">
      <article>
        <header className="max-w-[56rem] mx-auto">
          <p className="mb-8 text-sm">
            <Link href="/projects" className="inline-flex items-center gap-1.5 py-1 muted hover:text-[var(--fg)] transition-colors">
              <span aria-hidden="true">←</span> Work
            </Link>
          </p>
          <h1 className="!mb-6">Closet Organizer</h1>
          <div className="grid md:grid-cols-[1fr_13rem] gap-x-12 gap-y-10 items-end">
          <div>
          <p className="text-xl md:text-2xl leading-snug max-w-[44ch] text-pretty">
            A wardrobe app, end to end. Photograph a piece of clothing and it comes back
            cut out, tagged and colour-named, and the app starts building outfits with it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--ink)] text-[var(--paper)] font-medium hover:bg-[var(--signal)] transition-colors"
            >
              Read the code on GitHub <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <span className="text-sm muted">Python, TypeScript, plain JS</span>
          </div>
          </div>
          {!hasMedia && <Cover entry={entry} compact />}
          </div>

          <dl className="mt-12 border-t border-[var(--border-strong)]">
            {FACTS.map(([k, v]) => (
              <div key={k} className="py-3.5 border-b border-[var(--border)] grid grid-cols-[5.5rem_1fr] sm:grid-cols-[8rem_1fr] gap-4 text-[0.9375rem] leading-snug">
                <dt className="muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </header>

        {hasMedia && (
          <div className="max-w-[56rem] mx-auto mt-12">
            <Cover entry={entry} />
          </div>
        )}

        <div className="prose mt-16">
          <h2 className="!mt-0">The problem</h2>
          {/* TODO(Rohin): confirm this is why you built it, in your words. */}
          <p>
            Every wardrobe app I tried wanted data entry: pick a category, a colour, a season,
            for every single item. Nobody keeps that up for more than a week.
          </p>
          <p>
            So the bar was one photo. Upload a picture of a shirt and get back what it is,
            what style it reads as, which season it suits and what colours it is. Then let
            the app turn a closet of those into outfits, on a phone or in a browser.
          </p>

          <h2>Constraints</h2>
          <ul>
            <li>
              <strong>No labelled data.</strong> There was no pile of tagged photos to train on,
              and making one by hand would have been the same chore the app exists to remove.
            </li>
            <li>
              <strong>A small server.</strong> Production is a single uvicorn worker on a small
              VM. The models have to load once, share memory, and be fine without a GPU.
            </li>
            <li>
              <strong>Three clients, one API.</strong> An Expo app for iOS and Android and a plain
              web app share the same backend and the same accounts.
            </li>
            <li>
              <strong>Real accounts, real obligations.</strong> Password reset, a privacy policy,
              and in-app account deletion, which the App Store and Google Play require.
            </li>
          </ul>

          <h2>Architecture</h2>
          <p>
            One process, two paths. Uploads run along the top: validate the file, cut out the
            garment, tag it, name its colours, store it. Suggestions run along the bottom: read
            the closet, score combinations, and optionally have a language model explain them.
          </p>
          <figure className="wide">
            <div className="schematic border border-[var(--border-strong)] rounded-md p-3 sm:p-5">
              <PipelineDiagram />
            </div>
          </figure>

          <h2>Tagging without training data</h2>
          <p>
            The first version, in November 2025, put ResNet50 in front of a new 18-way linear
            layer and never trained that layer. Its categories came back with confidence scores
            attached, but they were noise.
          </p>
          <p>
            The rebuild uses CLIP, which already knows what &ldquo;a photo of a sweater&rdquo;
            looks like. Each category becomes a sentence, the sentences are embedded once at
            startup, and a photo is assigned to whichever sentence it lands closest to. No
            training, and it runs on a CPU.
          </p>
          <CodeBlock
            code={CLIP_EXCERPT}
            file="backend/models/clothing_classifier.py"
            href={src("backend/models/clothing_classifier.py", "L106-L137")}
          />
          <p>
            The cost is that CLIP&apos;s idea of &ldquo;streetwear&rdquo; is the internet&apos;s,
            not yours. So when someone fixes a wrong tag, the correction is saved to its own
            table, and the classifier has a marked swap point for a fine-tuned model once there
            are enough of them to train on.
          </p>

          <h2>Naming colours the way people do</h2>
          <p>
            The first colour extractor averaged every pixel in the photo, background included,
            and picked the nearest of 14 RGB swatches. Average a navy shirt with the white duvet
            it&apos;s lying on and you get grey.
          </p>
          <p>
            Two changes fixed it. First, rembg removes the background, so only garment pixels
            count. Second, instead of clustering those pixels, every one of them votes:
          </p>
          <CodeBlock
            code={VOTE_EXCERPT}
            file="backend/models/clothing_classifier.py"
            href={src("backend/models/clothing_classifier.py", "L178-L197")}
          />
          <p>
            The docstring above it explains why not k-means: a centroid averages a garment&apos;s
            lit and shaded sides, and the average of a green shirt can desaturate into
            &ldquo;Gray&rdquo;. A vote never averages, so shadow can&apos;t drag the answer
            anywhere. Each pixel is named by hue first, with separate rules for dark, pale and
            near-grey pixels, because muted tones like olive and dusty pink sit closer to grey
            than to any saturated swatch in RGB. The fixed seed means the same photo always gets
            the same answer, and a second colour only counts if it holds at least 8% of the vote.
          </p>

          <h2>Keeping one worker responsive</h2>
          <p>
            Every route was declared <code>async def</code>, and none of them awaited anything.
            In FastAPI that means SQLite, CLIP, rembg and the call to Claude all ran on the event
            loop itself. With one worker in production, a single multi-photo upload froze every
            other request.
          </p>
          <p>
            The fix was almost boring: plain <code>def</code> handlers, so FastAPI runs them in
            its threadpool; thread-safe lazy loading, so two first uploads don&apos;t load CLIP
            twice; and one lock around inference, so peak memory stays flat on a small machine.
            The more interesting part is keeping it fixed. This test parses every route file and
            fails on any <code>async def</code> that never awaits:
          </p>
          <CodeBlock
            code={AST_EXCERPT}
            file="backend/tests/test_route_concurrency.py"
            href={src("backend/tests/test_route_concurrency.py", "L19-L31")}
          />
          <p>
            A second test swaps in a classifier that sleeps for a second and a half, starts an
            upload on one thread, and requires <code>/healthz</code> to answer in under a second
            on another. Both tests fail against the old code.
          </p>

          <h2>Sessions that notice a stolen token</h2>
          <p>
            People log in on a phone once and expect to stay logged in, so a copied token is the
            realistic threat. Current clients get one-hour access tokens. Refresh tokens last 30 days, are stored
            only as SHA-256 hashes, and work once: each refresh consumes the token and issues its
            successor in the same family, one family per login. If a token that has already been
            used comes back, somebody copied it, and the whole family is revoked.
          </p>
          <CodeBlock
            code={ROTATE_EXCERPT}
            file="backend/database/sessions.py"
            href={src("backend/database/sessions.py", "L61-L85")}
          />
          <p>
            Two details carry it. <code>BEGIN IMMEDIATE</code> takes SQLite&apos;s write lock
            before reading, so two simultaneous refreshes can&apos;t both win. And a 30-second
            grace window answers a second refresh right after the first with a conflict rather
            than a revocation, because two tabs racing each other isn&apos;t theft.
          </p>

          <h2>The model writes the words; the rules pick the clothes</h2>
          <p>
            The AI stylist takes a message like &ldquo;dinner tonight, it&apos;s cold&rdquo; and
            answers with three outfits. Keyword matching pulls out the occasion, season and vibe,
            and the same rule-based recommender as everywhere else picks the outfits. Only then
            does Claude (Haiku, through the Anthropic SDK) see them, and its job is to write a
            short message and one line of reasoning per outfit, constrained to a JSON schema.
          </p>
          <p>
            That split is the point. The model can&apos;t suggest a jacket you don&apos;t own,
            because it never chooses items. With no API key, an API error, or a reply that
            isn&apos;t valid JSON, the locally written copy ships instead and you still get your
            outfits.
          </p>

          <h2>Trade-offs</h2>
          <ul>
            <li>
              <strong>CLIP over a trained model.</strong> Useful on day one with zero data; its
              categories are generic. The swap point is there for when corrections pile up.
            </li>
            <li>
              <strong>SQLite over Postgres.</strong> One file to back up (nightly, along with the
              photos) and no database server to run. It ties the app to one machine, which is
              fine at this size.
            </li>
            <li>
              <strong>Rules over a learned recommender.</strong> Every score can be explained
              and unit-tested, and the search is bounded at 3,000 top–bottom pairs. The colour
              table is blunt: it knows navy goes with white, not why.
            </li>
            <li>
              <strong>One inference lock.</strong> Memory stays flat on a small VM; the price is
              that simultaneous uploads wait in line.
            </li>
            <li>
              <strong>Photos on local disk.</strong> Simple, and cheap to serve: photos have random
              names, so they're cached as immutable for a year. Object storage with signed URLs is the
              first thing on the list before the app outgrows one machine.
            </li>
          </ul>

          <h2>What I&apos;d do differently</h2>
          {/* TODO(Rohin): drafts built from the repo's own backlog (PROJECT.md).
              Rewrite in your voice, cut any you don't stand behind. */}
          <ul>
            <li>
              <strong>Take classification off the upload request.</strong> Today an upload waits
              for the cutout, CLIP and colour. A background job would let the photo appear
              immediately and fill in its tags a moment later.
            </li>
            <li>
              <strong>Index the embeddings.</strong> Duplicate detection compares every pair of
              items in a Python loop. That&apos;s fine for one closet and quadratic for anything
              bigger.
            </li>
            <li>
              <strong>Close the web token gap first.</strong> The web app keeps its refresh token
              in <code>localStorage</code>, where any XSS can read it. An httpOnly cookie, with
              CSRF protection, is the fix.
            </li>
            <li>
              <strong>Use the corrections.</strong> They&apos;re already recorded. Exporting them
              as training data is what makes a fine-tuned classifier worth building.
            </li>
          </ul>

          {extraMedia.length > 0 && (
            <>
              <h2>Screens</h2>
              {extraMedia.map((m) => (
                <figure key={m.src} className="wide">
                  <div className="overflow-hidden rounded-md bg-[var(--ink)]">
                    <MediaView media={m} />
                  </div>
                  {m.caption && <figcaption className="note">{m.caption}</figcaption>}
                </figure>
              ))}
            </>
          )}

          <hr />
          <p className="flex flex-wrap gap-x-8 gap-y-3 text-base">
            <a href={REPO} target="_blank" rel="noopener noreferrer">
              The code, on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <Link href="/projects">Everything else I&apos;ve made</Link>
          </p>
        </div>
      </article>
    </main>
  );
}
