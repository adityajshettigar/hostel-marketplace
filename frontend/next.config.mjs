/** @type {import('next').NextConfig} */

/**
 * The gateway sends no CORS headers, so the browser cannot call it cross-origin
 * from :3000. Fix (frontend-side only): same-origin proxy. The browser calls
 * `/gw/...` on this app's own origin; Next rewrites (server-side) to the
 * gateway — which stays the ONLY service ingress. In Docker a build arg points
 * at http://gateway:4000 (compose network); outside Docker it defaults to
 * http://localhost:4000.
 */
const GATEWAY_ORIGIN =
  process.env.GATEWAY_ORIGIN ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

// Phase 9 (item 1): helmet-equivalent security headers. The strict CSP is
// scoped to API responses (which return JSON only); page routes get the
// clickjacking/MIME/referrer hardening without a CSP that would break Next's
// inline hydration scripts and Tailwind styles.
const BASE_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const API_SECURITY_HEADERS = [
  ...BASE_SECURITY_HEADERS,
  { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; img-src 'none'; script-src 'none'; style-src 'none'; object-src 'none'",
  },
];

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  async rewrites() {
    return [
      {
        source: "/gw/:path*",
        destination: `${GATEWAY_ORIGIN}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      { source: "/api/:path*", headers: API_SECURITY_HEADERS },
      { source: "/:path*", headers: BASE_SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;
