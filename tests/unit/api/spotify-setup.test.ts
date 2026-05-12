import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/spotify/setup/route";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  vi.unstubAllEnvs();
});

function makeReq(search = "") {
  return new NextRequest(`http://localhost/api/spotify/setup${search}`);
}

describe("GET /api/spotify/setup", () => {
  it("returns 'not configured' HTML when env vars missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Spotify not configured");
    expect(html).toContain("SPOTIFY_CLIENT_ID");
  });

  it("redirects to Spotify authorize when no code is present", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "my-id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "my-secret");
    const res = await GET(makeReq());
    expect([302, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("accounts.spotify.com/authorize");
    expect(location).toContain("client_id=my-id");
    expect(location).toContain("user-top-read");
    expect(location).toContain("redirect_uri=");
  });

  it("includes user-top-read scope in the auth URL", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    const res = await GET(makeReq());
    const location = res.headers.get("location") ?? "";
    expect(decodeURIComponent(location)).toContain("user-top-read");
  });

  it("exchanges a code for tokens and renders the refresh token", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({
          access_token: "access-xyz",
          refresh_token: "refresh-abc",
          expires_in: 3600,
          scope: "user-top-read",
        }),
      ),
    );

    const res = await GET(makeReq("?code=auth-code-here"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Done");
    expect(html).toContain("refresh-abc");
  });

  it("renders an error when Spotify rejects the code", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        new HttpResponse("invalid_grant", { status: 400 }),
      ),
    );
    const res = await GET(makeReq("?code=bad"));
    const html = await res.text();
    expect(html).toContain("Token exchange failed");
  });

  it("renders Spotify's error param when present", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    const res = await GET(makeReq("?error=access_denied"));
    const html = await res.text();
    expect(html).toContain("Auth error");
    expect(html).toContain("access_denied");
  });
});
