"use client";

import clsx from "clsx";
import { LocateFixed, Maximize2, Minimize2, Minus, Navigation2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useMapContext } from "./MapView";
import styles from "./MapControls.module.scss";

/** Stacked zoom / north / fullscreen controls plus an optional locate button. */
export function MapControls({ onLocate, locating, className }: { onLocate?: () => void; locating?: boolean; className?: string }) {
  const { map, container } = useMapContext();
  const [bearing, setBearing] = useState(() => map.getBearing());
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onRotate = () => setBearing(map.getBearing());
    const onFs = () => setFullscreen(document.fullscreenElement !== null);
    map.on("rotate", onRotate);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      map.off("rotate", onRotate);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [map]);

  const toggleFullscreen = () => {
    const target = container.parentElement ?? container;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.requestFullscreen?.();
  };

  return (
    <div className={clsx(styles.controls, className)} onDoubleClick={(e) => e.stopPropagation()}>
      <div className={styles.group}>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => map.zoomIn()}>
          <Plus />
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => map.zoomOut()}>
          <Minus />
        </button>
        <button type="button" className={styles.extra} aria-label="Reset north" title="Reset north" onClick={() => map.easeTo({ bearing: 0, pitch: 0 })}>
          <Navigation2 style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
        <button type="button" className={styles.extra} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title="Full screen" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </button>
      </div>
      {onLocate && (
        <div className={styles.group}>
          <button type="button" aria-label="Recenter on my location" title="My location" onClick={onLocate} className={clsx(locating && styles.busy)}>
            <LocateFixed />
          </button>
        </div>
      )}
    </div>
  );
}
