import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/spotify/top-tracks/route";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  vi.unstubAllEnvs();
});

function stubCreds() {
  vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
  vi.stubEnv("SPOTIFY_REFRESH_TOKEN", "refresh");
}

function makeReq(search = "") {
  return new NextRequest(`http://localhost/api/spotify/top-tracks${search}`);
}

describe("GET /api/spotify/top-tracks", () => {
  it("returns { configured: false } when env vars are missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("returns simplified tracks on success", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/top/tracks", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("time_range")).toBe("medium_term");
        expect(url.searchParams.get("limit")).toBe("5");
        return HttpResponse.json({
          items: [
            {
              name: "CAN'T SAY",
              artists: [{ name: "Travis Scott" }],
              album: {
                name: "UTOPIA",
                images: [{ url: "https://i.scdn.co/x" }],
              },
              external_urls: { spotify: "https://open.spotify.com/track/x" },
            },
          ],
        });
      }),
    );

    const res = await GET(makeReq());
    const json = await res.json();
    expect(json).toMatchObject({
      configured: true,
      range: "medium_term",
      tracks: [
        {
          title: "CAN'T SAY",
          artist: "Travis Scott",
          album: "UTOPIA",
          albumArt: "https://i.scdn.co/x",
          url: "https://open.spotify.com/track/x",
        },
      ],
    });
  });

  it("respects the ?range= query param", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/top/tracks", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("time_range")).toBe("short_term");
        return HttpResponse.json({ items: [] });
      }),
    );

    const res = await GET(makeReq("?range=short_term"));
    expect(res.status).toBe(200);
    expect((await res.json()).range).toBe("short_term");
  });

  it("ignores an invalid range and falls back to medium_term", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/top/tracks", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("time_range")).toBe("medium_term");
        return HttpResponse.json({ items: [] });
      }),
    );
    const res = await GET(makeReq("?range=garbage"));
    expect((await res.json()).range).toBe("medium_term");
  });

  it("clamps ?limit= to [1, 20]", async () => {
    stubCreds();
    let received = "";
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/top/tracks", ({ request }) => {
        received = new URL(request.url).searchParams.get("limit") ?? "";
        return HttpResponse.json({ items: [] });
      }),
    );
    await GET(makeReq("?limit=999"));
    expect(received).toBe("20");
  });

  it("returns 502 on Spotify auth failure", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        new HttpResponse(null, { status: 401 }),
      ),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(502);
  });
});
