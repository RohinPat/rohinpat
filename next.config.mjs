/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pages retired when the site went from job hunt to portfolio.
  async redirects() {
    return [
      { source: "/experience", destination: "/projects", permanent: true },
      { source: "/skills", destination: "/projects", permanent: true },
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
    ];
  },
};

export default nextConfig;
