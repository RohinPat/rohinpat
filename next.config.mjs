/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Retired pages.
  async redirects() {
    return [
      { source: "/experience", destination: "/projects", permanent: true },
      { source: "/skills", destination: "/projects", permanent: true },
      // Terms and cookies were folded into one privacy page.
      { source: "/terms", destination: "/privacy#terms", permanent: true },
      { source: "/cookies", destination: "/privacy#cookies", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // the home screen's camera names colours on request; the later rule
        // wins, so only "/" may ask for the camera, and nothing may embed it
        source: "/",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // lab pairing: the laptop's webcam reads the phone's answer QR code (later rule wins)
        source: "/lab/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
