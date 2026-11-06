import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Clerk publishable keys encode the Frontend API host: pk_test_<base64("host$")>. */
function clerkFrontendApi(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;
  try {
    const encoded = key.split("_").slice(2).join("_");
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Extra hosts for a custom basemap (NEXT_PUBLIC_MAP_STYLE_URL / TILES / GLYPHS). */
function mapHosts(): string[] {
  return [process.env.NEXT_PUBLIC_MAP_STYLE_URL, process.env.NEXT_PUBLIC_MAP_TILES_URL, process.env.NEXT_PUBLIC_MAP_GLYPHS_URL]
    .map((u) => origin(u?.replace(/\{[^}]+\}/g, "x")))
    .filter((o): o is string => !!o);
}

function buildCsp(): string {
  const clerk = clerkFrontendApi();
  const convex = origin(process.env.NEXT_PUBLIC_CONVEX_URL);
  const convexWs = convex ? convex.replace(/^http/, "ws") : null;
  const clerkHosts = ["https://*.clerk.accounts.dev", "https://*.clerk.com", clerk].filter(Boolean).join(" ");
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""} ${clerkHosts} https://challenges.cloudflare.com`,
    "connect-src": [
      "'self'",
      clerkHosts,
      "https://*.convex.cloud wss://*.convex.cloud https://*.convex.site",
      convex,
      convexWs,
      "https://clerk-telemetry.com",
      // Clerk bot protection probes several ports on this host.
      "https://*.protect.clerk.com:*",
      // Basemap: Mapbox (styles, tiles, fonts, telemetry) and the OpenFreeMap fallback.
      "https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com",
      "https://tiles.openfreemap.org",
      ...mapHosts(),
    ]
      .filter(Boolean)
      .join(" "),
    // Map tiles, Clerk avatars and Convex storage images are served over HTTPS.
    "img-src": `'self' data: blob: https: ${isDev ? "http://127.0.0.1:* http://localhost:*" : ""}`,
    "style-src": "'self' 'unsafe-inline'",
    "font-src": "'self' data:",
    "frame-src": `https://challenges.cloudflare.com ${clerkHosts}`,
    // Mapbox GL and MapLibre run their tile workers from blob: / same-origin URLs.
    "worker-src": "'self' blob:",
    "child-src": "'self' blob:",
    "frame-ancestors": "'none'",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.replace(/\s+/g, " ").trim()}`)
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation only for this origin, and only after an explicit user action.
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  // The app is predominantly client-rendered with live Convex subscriptions,
  // so Cache Components/PPR add little and complicate request-time auth.
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  sassOptions: {
    loadPaths: [path.join(process.cwd(), "src/styles")],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.convex.cloud" },
      { protocol: "https", hostname: "img.clerk.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
