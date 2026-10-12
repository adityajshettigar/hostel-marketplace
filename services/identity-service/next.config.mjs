/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      // Next.js App Router segment names cannot contain literal dots, so the
      // route handler lives at src/app/.well-known/jwks.json/route.ts which is
      // unreachable as-is; rewrite the canonical path onto it.
      {
        source: '/.well-known/jwks.json',
        destination: '/jwks-wellknown',
      },
    ];
  },
};

export default nextConfig;
