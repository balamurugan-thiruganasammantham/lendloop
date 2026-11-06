import type { AuthConfig } from "convex/server";

/**
 * Clerk issues JWTs (via the "convex" JWT template or Clerk's native Convex
 * integration) that Convex validates against this issuer. Set the variable on
 * the Convex deployment:
 *   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
