import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk session handling for every request. Access control is enforced where
 * resources are accessed (Clerk's recommended resource-based pattern):
 *  - app/(authenticated)/layout.tsx redirects signed-out visitors server-side;
 *  - API routes call auth() themselves;
 *  - every Convex function re-verifies the identity and authorisation.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
