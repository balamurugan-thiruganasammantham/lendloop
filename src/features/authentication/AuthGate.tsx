"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { LocationProvider } from "@/features/discovery/LocationProvider";
import { errorMessage } from "@/lib/errors";
import styles from "./AuthGate.module.scss";
import { ViewerContext } from "./ViewerContext";

function Splash({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.splash}>
      <Logo />
      {children ?? <Spinner size={18} label="Loading" />}
    </div>
  );
}

/**
 * Gate for the authenticated app:
 *  1. Clerk session present (proxy.ts also enforces this server-side).
 *  2. Convex accepted the Clerk JWT.
 *  3. Convex profile synchronised (users.ensureCurrent).
 *  4. Onboarding completed.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const router = useRouter();
  const pathname = usePathname();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const syncing = useRef(false);

  useEffect(() => {
    if (clerkLoaded && !isSignedIn) router.replace(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
  }, [clerkLoaded, isSignedIn, router, pathname]);

  useEffect(() => {
    if (!isAuthenticated || synced || syncing.current) return;
    syncing.current = true;
    ensureCurrent()
      .then(() => setSynced(true))
      .catch((e) => setSyncError(errorMessage(e)))
      .finally(() => {
        syncing.current = false;
      });
  }, [isAuthenticated, synced, ensureCurrent]);

  useEffect(() => {
    if (me && !me.onboarded && pathname !== "/onboarding") router.replace("/onboarding");
  }, [me, pathname, router]);

  if (!clerkLoaded || !isSignedIn) return <Splash />;
  if (isLoading) return <Splash />;
  if (!isAuthenticated) {
    return (
      <Splash>
        <div className={styles.problem}>
          <p className={styles.problemTitle}>We couldn&apos;t verify your session with the backend.</p>
          <p>
            You&apos;re signed in, but the LendLoop backend rejected the session token. If you&apos;re running locally,
            check the Clerk “convex” JWT template and the <code>CLERK_JWT_ISSUER_DOMAIN</code> Convex environment variable.
          </p>
          <Button size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </Splash>
    );
  }
  if (syncError) {
    return (
      <Splash>
        <div className={styles.problem}>
          <p className={styles.problemTitle}>Your profile couldn&apos;t be loaded.</p>
          <p>{syncError}</p>
          <Button
            size="sm"
            onClick={() => {
              setSyncError(null);
              setSynced(false);
            }}
          >
            Retry
          </Button>
        </div>
      </Splash>
    );
  }
  if (!synced || me === undefined || me === null) return <Splash />;
  if (!me.onboarded && pathname !== "/onboarding") return <Splash />;

  return (
    <ViewerContext.Provider value={me}>
      <LocationProvider sharingEnabled={me.locationSharing}>{children}</LocationProvider>
    </ViewerContext.Provider>
  );
}
