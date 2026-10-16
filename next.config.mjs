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
          { key: "X-Frame-Options", value: "SAMEORIGIN" }, // the home "duo" frames the case study,
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
