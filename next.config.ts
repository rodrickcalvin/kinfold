import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers.
 *
 * For a tool whose whole pitch is "the operator cannot read your data", the
 * browser-side guarantees matter just as much as the crypto: a script injected
 * into this origin could read a slice key the moment it is unwrapped in memory.
 * So the Content-Security-Policy here is deliberately tight.
 *
 * It currently relies on `'unsafe-inline'` for scripts because the App Router
 * emits inline bootstrap scripts without a nonce. The upgrade path is a
 * middleware that mints a per-request nonce and swaps these for
 * `'nonce-…' 'strict-dynamic'`; until then this still blocks external script
 * origins, framing, plugins, and form exfiltration.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // A family tree URL is not a secret, but it is not something to hand to
  // third-party crawlers either.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
