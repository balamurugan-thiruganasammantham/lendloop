"use client";

import { LocateFixed, MapPin } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { PlaceSearch } from "@/components/map/PlaceSearch";
import { useLocation } from "./LocationProvider";
import styles from "./LocationPrompt.module.scss";

/**
 * First-visit explanation shown over the map. The browser permission prompt
 * is only triggered when the user presses "Use my location".
 */
export function LocationPrompt() {
  const { state, requestGps, setManual, dismiss } = useLocation();
  const [manual, setManualMode] = useState(false);
  // Shown before we've asked, and next to the browser's own permission prompt while it is open.
  const waiting = state.status === "locating" && state.prompting;
  if (state.status !== "prompt" && !waiting) return null;
  return (
    <div className={styles.overlay}>
      <div className={styles.card} role="dialog" aria-labelledby="loc-title" aria-describedby="loc-desc">
        <div className={styles.icon}>
          <MapPin aria-hidden />
        </div>
        <h2 id="loc-title">{waiting ? "Allow location to see what's around you" : "See what's around you"}</h2>
        <p id="loc-desc">
          {waiting ? "Choose “Allow” in your browser's prompt. " : ""}
          LendLoop shows your live position on the map and how far each tool is from you. Your location stays on this device: it isn&apos;t stored, shared with
          other members, or tracked when the page is closed.
        </p>
        {manual ? (
          <div className={styles.manual}>
            <PlaceSearch autoFocus onPick={(p) => setManual({ lat: p.lat, lng: p.lng }, p.label)} />
            <button type="button" className={styles.link} onClick={() => setManualMode(false)}>
              Back
            </button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button variant="primary" icon={<LocateFixed />} onClick={requestGps} loading={waiting}>
              {waiting ? "Waiting for your browser…" : "Use my location"}
            </Button>
            <Button onClick={() => setManualMode(true)}>Choose a place</Button>
          </div>
        )}
        <button type="button" className={styles.link} onClick={dismiss}>
          Skip for now and browse all tools
        </button>
      </div>
    </div>
  );
}
