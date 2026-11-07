"use client";

import clsx from "clsx";
import { LocateFixed, LocateOff, Navigation } from "lucide-react";
import type { MouseEvent } from "react";
import { Spinner } from "@/components/common/Spinner";
import { APPROXIMATE_ACCURACY_M } from "@/lib/location";
import { useLocation } from "./LocationProvider";
import styles from "./LocationCta.module.scss";

/**
 * Shown wherever a distance would appear while we don't know the viewer's
 * position. Clicking asks for location again (or explains how to unblock it).
 *  - "pill": compact, sits where the distance pill goes on cards
 *  - "inline": a text button for sentences such as the detail panel
 */
export function LocationCta({ variant = "pill", className }: { variant?: "pill" | "inline"; className?: string }) {
  const { state, requestGps } = useLocation();
  if (state.status === "ready" || state.status === "unsupported" || state.status === "init") return null;
  const locating = state.status === "locating";
  const blocked = state.status === "denied";
  const off = state.status === "disabled";

  const short = locating ? "Locating…" : blocked ? "Allow location" : off ? "Location off" : "Show distance";
  const long = locating
    ? "Finding your location…"
    : blocked
      ? "Location is blocked. See how to allow it"
      : off
        ? "Location is off in your profile"
        : "Enable your location to see the actual distance";

  const onClick = (e: MouseEvent) => {
    // Cards are clickable too; this button must not also open the card.
    e.preventDefault();
    e.stopPropagation();
    requestGps();
  };

  return (
    <button
      type="button"
      className={clsx(variant === "pill" ? styles.pill : styles.inline, blocked && styles.blocked, className)}
      onClick={onClick}
      disabled={locating}
      title={long}
      aria-label={long}
    >
      {locating ? <Spinner size={12} /> : blocked || off ? <LocateOff aria-hidden /> : <LocateFixed aria-hidden />}
      <span>{variant === "pill" ? short : long}</span>
    </button>
  );
}

/** Header banner on the explore panel: explains why location helps, or shows where distances are measured from. */
export function LocationBanner() {
  const { state, requestGps, live } = useLocation();
  if (state.status === "init" || state.status === "unsupported") {
    return state.status === "unsupported" ? <p className={styles.note}>{state.message}</p> : null;
  }
  if (state.status === "ready") {
    if (state.source === "gps") {
      if (state.accuracy !== null && state.accuracy > APPROXIMATE_ACCURACY_M) {
        // Desktop browsers without Wi-Fi positioning fall back to an IP estimate (often the ISP's city).
        return (
          <p className={styles.status}>
            <span className={clsx(styles.liveDot, styles.liveDotPaused)} aria-hidden />
            Approximate location <span className="num">(±{Math.round(state.accuracy / 1000)} km)</span>
            <span className={styles.muted}> · your browser estimated it from your network. Not right? Search your area to set it.</span>
          </p>
        );
      }
      return (
        <p className={styles.status}>
          <span className={clsx(styles.liveDot, !live && styles.liveDotPaused)} aria-hidden />
          {live ? "Live location on" : "Using your location"}
          {state.accuracy !== null && <span> · accurate to ±{Math.max(5, Math.round(state.accuracy))} m</span>}
          <span className={styles.muted}> · distances update as you move</span>
        </p>
      );
    }
    return (
      <p className={styles.status}>
        <Navigation aria-hidden className={styles.statusIcon} />
        Distances from <strong>{(state.label ?? "the selected place").split(",")[0]}</strong>
        <button type="button" className={styles.textButton} onClick={requestGps}>
          Use my live location
        </button>
      </p>
    );
  }

  const locating = state.status === "locating";
  const blocked = state.status === "denied";
  const off = state.status === "disabled";
  return (
    <div className={clsx(styles.banner, blocked && styles.bannerBlocked)} role="status">
      <span className={styles.bannerIcon}>{blocked || off ? <LocateOff aria-hidden /> : <LocateFixed aria-hidden />}</span>
      <span className={styles.bannerText}>
        <strong>{blocked ? "Location is blocked" : off ? "Location sharing is off" : "See real distances"}</strong>
        <span>
          {blocked
            ? "Allow location for this site to see how far each tool is and what's closest to you."
            : off
              ? "Turn it on in your profile to see how far each tool is."
              : "Turn on your location to see how far each tool is and what's closest to you."}
        </span>
      </span>
      <button type="button" className={styles.bannerButton} onClick={requestGps} disabled={locating}>
        {locating ? <Spinner size={12} /> : null}
        {locating ? "Locating…" : blocked ? "How to allow" : off ? "Settings" : "Enable location"}
      </button>
    </div>
  );
}
