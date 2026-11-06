"use client";

/**
 * The viewer's location for the map and for distances. Privacy rules:
 *  - On entry we ask once per browser session (the browser's own permission
 *    prompt), unless the visitor already chose "Skip" or a manual place.
 *    Everywhere a distance would appear, a button lets them ask again. If the
 *    browser has blocked the site it can't re-prompt, so we explain how to
 *    unblock it instead, and pick the change up automatically.
 *  - Live updates (watchPosition) run only while the page is visible and stop
 *    as soon as it is hidden or unmounted. Small GPS jitter is ignored.
 *  - Coordinates never leave the device except as a rounded (~110 m) search
 *    centre, and are never stored. Only the visitor's choice and an optional
 *    manually chosen place are kept in localStorage.
 *  - When a member turns location sharing off in their profile, GPS is never used.
 */
import Link from "next/link";
import { LocateFixed, MapPin } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LatLng } from "@convex/lib/geo";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { PlaceSearch } from "@/components/map/PlaceSearch";
import { shouldAcceptFix, type Fix } from "@/lib/location";
import styles from "./LocationProvider.module.scss";

const STORAGE_KEY = "lendloop.location.v1";
const SESSION_ASKED_KEY = "lendloop.location.asked";

type Choice = "gps" | "manual" | "dismissed";

interface Stored {
  choice: Choice;
  manual?: { lat: number; lng: number; label: string };
}

export type LocationState =
  | { status: "init" }
  | { status: "prompt" }
  /** `prompting`: the browser's permission prompt is (probably) on screen. */
  | { status: "locating"; prompting: boolean }
  | {
      status: "ready";
      point: LatLng;
      source: "gps" | "manual";
      label: string | null;
      accuracy: number | null;
    }
  | {
      status: "denied" | "unavailable" | "unsupported" | "disabled" | "dismissed";
      message: string;
    };

type HelpMode = "blocked" | "disabled" | "unavailable";

interface LocationApi {
  state: LocationState;
  point: LatLng | null;
  /** True while the device position is followed live. */
  live: boolean;
  /** Ask for the device location. Opens unblock instructions when the browser has blocked it. */
  requestGps: () => void;
  setManual: (point: LatLng, label: string) => void;
  dismiss: () => void;
  reset: () => void;
}

const LocationContext = createContext<LocationApi | null>(null);

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); location still works for the session.
  }
}

/** Auto-ask at most once per browser session, so navigating around never re-triggers prompts. */
function claimSessionAsk(): boolean {
  try {
    if (window.sessionStorage.getItem(SESSION_ASKED_KEY)) return false;
    window.sessionStorage.setItem(SESSION_ASKED_KEY, "1");
    return true;
  } catch {
    return true;
  }
}

async function permissionState(): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return "unknown";
  }
}

const MESSAGES = {
  denied: "Location is blocked for this site in your browser.",
  unavailable: "We couldn't find your position. Check that location is on for your device.",
  unsupported: "Your browser doesn't support location. Search for a place instead.",
  disabled: "Location sharing is turned off in your profile.",
  dismissed: "Location is off. Turn it on to see real distances.",
} as const;

/** `sharingEnabled: null` = the member's profile setting is still loading; nothing happens until it is known. */
export function LocationProvider({ children, sharingEnabled }: { children: ReactNode; sharingEnabled: boolean | null }) {
  const [state, setState] = useState<LocationState>({ status: "init" });
  const [live, setLive] = useState(false);
  const [help, setHelp] = useState<HelpMode | null>(null);
  const [helpSearch, setHelpSearch] = useState(false);
  const inFlight = useRef(false);
  const watchId = useRef<number | null>(null);
  const lastFix = useRef<Fix | null>(null);
  /** The visitor wants GPS (not a manual place); used to resume tracking when the tab becomes visible. */
  const wantGps = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setLive(false);
  }, []);

  const acceptFix = useCallback((pos: GeolocationPosition) => {
    const next: Fix = {
      point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      accuracy: pos.coords.accuracy ?? null,
      at: Date.now(),
    };
    if (!shouldAcceptFix(lastFix.current, next)) return;
    lastFix.current = next;
    setState({
      status: "ready",
      point: next.point,
      source: "gps",
      label: null,
      accuracy: next.accuracy,
    });
  }, []);

  const handleError = useCallback(
    async (err: GeolocationPositionError, fromUser: boolean) => {
      // A manually chosen place stays in use if switching to GPS fails.
      const current = stateRef.current;
      const keepManual = current.status === "ready" && current.source === "manual";
      if (err.code !== err.PERMISSION_DENIED) {
        if (fromUser) setHelp("unavailable");
        // Keep the last known position if we have one; otherwise report it.
        if (lastFix.current || keepManual) return;
        setState({ status: "unavailable", message: MESSAGES.unavailable });
        return;
      }
      stopWatch();
      wantGps.current = false;
      lastFix.current = null;
      // Chrome reports a closed prompt as PERMISSION_DENIED while the permission is still "prompt".
      if ((await permissionState()) === "denied") {
        if (fromUser) setHelp("blocked");
        if (!keepManual) setState({ status: "denied", message: MESSAGES.denied });
      } else if (!keepManual) {
        writeStored({ choice: "dismissed" });
        setState({ status: "dismissed", message: MESSAGES.dismissed });
      }
    },
    [stopWatch],
  );

  const startWatch = useCallback(() => {
    if (watchId.current !== null || !("geolocation" in navigator)) return;
    watchId.current = navigator.geolocation.watchPosition(acceptFix, (err) => void handleError(err, false), {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 30_000,
    });
    setLive(true);
  }, [acceptFix, handleError]);

  const locate = useCallback(
    async (fromUser: boolean) => {
      if (inFlight.current) return;
      if (!("geolocation" in navigator)) {
        setState({ status: "unsupported", message: MESSAGES.unsupported });
        return;
      }
      inFlight.current = true;
      const permission = await permissionState();
      // Keep showing the current position (GPS or manual place) while a new fix is on its way.
      setState((prev) => (prev.status === "ready" ? prev : { status: "locating", prompting: permission === "prompt" }));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          inFlight.current = false;
          wantGps.current = true;
          writeStored({ choice: "gps" });
          setHelp(null);
          lastFix.current = null;
          acceptFix(pos);
          if (document.visibilityState === "visible") startWatch();
        },
        (err) => {
          inFlight.current = false;
          void handleError(err, fromUser);
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
      );
    },
    [acceptFix, handleError, startWatch],
  );

  // Initial resolution: silent when already granted, one prompt per session otherwise.
  useEffect(() => {
    if (sharingEnabled === null) return;
    let cancelled = false;
    const resolve = async () => {
      const stored = readStored();
      if (stored?.choice === "manual" && stored.manual) {
        setState({
          status: "ready",
          point: stored.manual,
          source: "manual",
          label: stored.manual.label,
          accuracy: null,
        });
        return;
      }
      if (!sharingEnabled) {
        setState({ status: "disabled", message: MESSAGES.disabled });
        return;
      }
      if (!("geolocation" in navigator)) {
        setState({ status: "unsupported", message: MESSAGES.unsupported });
        return;
      }
      const permission = await permissionState();
      if (cancelled) return;
      if (permission === "denied") setState({ status: "denied", message: MESSAGES.denied });
      else if (stored?.choice === "dismissed") setState({ status: "dismissed", message: MESSAGES.dismissed });
      else if (permission === "granted" || claimSessionAsk()) void locate(false);
      else setState({ status: "prompt" });
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [sharingEnabled, locate]);

  // Follow permission changes made in the browser's site settings (e.g. after "Allow").
  useEffect(() => {
    if (!sharingEnabled || typeof navigator === "undefined" || !navigator.permissions) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.onchange = () => {
          if (s.state === "granted" && readStored()?.choice !== "manual") void locate(false);
          if (s.state === "denied") {
            stopWatch();
            wantGps.current = false;
            setState({ status: "denied", message: MESSAGES.denied });
          }
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [sharingEnabled, locate, stopWatch]);

  // Live tracking only while the page is visible.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopWatch();
      else if (wantGps.current) startWatch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatch();
    };
  }, [startWatch, stopWatch]);

  const setManual = useCallback(
    (point: LatLng, label: string) => {
      wantGps.current = false;
      stopWatch();
      lastFix.current = null;
      writeStored({ choice: "manual", manual: { ...point, label } });
      setHelp(null);
      setState({
        status: "ready",
        point,
        source: "manual",
        label,
        accuracy: null,
      });
    },
    [stopWatch],
  );

  const dismiss = useCallback(() => {
    wantGps.current = false;
    stopWatch();
    writeStored({ choice: "dismissed" });
    setState({ status: "dismissed", message: MESSAGES.dismissed });
  }, [stopWatch]);

  const reset = useCallback(() => {
    wantGps.current = false;
    stopWatch();
    writeStored(null);
    setState(sharingEnabled !== false ? { status: "prompt" } : { status: "disabled", message: MESSAGES.disabled });
  }, [sharingEnabled, stopWatch]);

  const requestGps = useCallback(() => {
    if (sharingEnabled === false) {
      setHelp("disabled");
      return;
    }
    if (state.status === "unsupported") return;
    void locate(true);
  }, [locate, sharingEnabled, state.status]);

  const api = useMemo<LocationApi>(
    () => ({
      state,
      point: state.status === "ready" ? state.point : null,
      live,
      requestGps,
      setManual,
      dismiss,
      reset,
    }),
    [state, live, requestGps, setManual, dismiss, reset],
  );

  const closeHelp = () => {
    setHelp(null);
    setHelpSearch(false);
  };

  return (
    <LocationContext.Provider value={api}>
      {children}
      <Dialog
        open={help !== null}
        onClose={closeHelp}
        title={help === "disabled" ? "Location sharing is off" : help === "unavailable" ? "We couldn't find you" : "Location is blocked for this site"}
        description={
          help === "disabled"
            ? "You turned off location sharing in your profile, so LendLoop doesn't use your device location."
            : help === "unavailable"
              ? "Your browser allowed location, but your device couldn't work out where you are."
              : "Your browser remembers that you blocked location for LendLoop, so it won't ask again on its own. Allow it once and distances update automatically."
        }
        footer={
          help === "disabled" ? (
            <Link href="/profile" className={styles.linkButton} onClick={closeHelp}>
              Open profile settings
            </Link>
          ) : (
            <>
              <Button onClick={() => setHelpSearch((s) => !s)} icon={<MapPin />}>
                Choose a place instead
              </Button>
              <Button variant="primary" icon={<LocateFixed />} onClick={() => void locate(true)}>
                {help === "blocked" ? "I've allowed it, try again" : "Try again"}
              </Button>
            </>
          )
        }
      >
        {help === "blocked" && (
          <ol className={styles.steps}>
            <li>
              <strong>Chrome, Edge, Brave:</strong> click the icon at the left of the address bar (🔒 or ⚙︎) → <em>Site settings</em> or
              <em> Permissions</em> → <em>Location</em> → <em>Allow</em>.
            </li>
            <li>
              <strong>Firefox:</strong> click the location icon in the address bar → remove <em>Blocked</em> for Location.
            </li>
            <li>
              <strong>Safari (Mac):</strong> Safari → Settings → Websites → Location → set this site to <em>Allow</em>.
            </li>
            <li>
              <strong>Android:</strong> Chrome ⋮ → Settings → Site settings → Location → allow this site.
            </li>
            <li>
              <strong>iPhone/iPad:</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites → <em>While Using the App</em>.
            </li>
          </ol>
        )}
        {help === "unavailable" && (
          <p className={styles.hint}>Turn on location (GPS) in your device settings, move near a window or reconnect to Wi‑Fi, then try again.</p>
        )}
        {helpSearch && help !== "disabled" && (
          <div className={styles.search}>
            <PlaceSearch
              autoFocus
              onPick={(p) => {
                setManual({ lat: p.lat, lng: p.lng }, p.label);
                closeHelp();
              }}
            />
          </div>
        )}
      </Dialog>
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationApi {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used inside LocationProvider");
  return ctx;
}
