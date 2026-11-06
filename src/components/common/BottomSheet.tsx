"use client";

import clsx from "clsx";
import { useCallback, useRef, useState, type ReactNode } from "react";
import styles from "./BottomSheet.module.scss";

export type SheetSnap = "peek" | "half" | "full";

function heights(peek: number): Record<SheetSnap, string> {
  return { peek: `${peek}px`, half: "48%", full: "calc(100% - 72px)" };
}

/** Mobile bottom sheet with three snap points; drag the handle or tap it. */
export function BottomSheet({
  snap,
  onSnapChange,
  header,
  children,
  peekHeight = 132,
}: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  header: ReactNode;
  children: ReactNode;
  peekHeight?: number;
}) {
  const HEIGHTS = heights(peekHeight);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startH: number } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    drag.current = { startY: e.clientY, startH: el.getBoundingClientRect().height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setDragHeight(Math.max(100, drag.current.startH + (drag.current.startY - e.clientY)));
  };
  const finish = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      const parent = ref.current?.parentElement;
      if (!d || !parent) return;
      const moved = Math.abs(d.startY - e.clientY);
      setDragHeight(null);
      if (moved < 6) {
        onSnapChange(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
        return;
      }
      const ratio = (d.startH + (d.startY - e.clientY)) / parent.getBoundingClientRect().height;
      onSnapChange(ratio > 0.72 ? "full" : ratio > 0.3 ? "half" : "peek");
    },
    [onSnapChange, snap],
  );

  return (
    <div
      ref={ref}
      className={clsx(styles.sheet, dragHeight !== null && styles.dragging)}
      style={{ height: dragHeight !== null ? `${dragHeight}px` : HEIGHTS[snap] }}
    >
      <div
        className={styles.handleArea}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        role="button"
        tabIndex={0}
        aria-label={snap === "full" ? "Collapse list" : "Expand list"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSnapChange(snap === "full" ? "peek" : "full");
          }
        }}
      >
        <span className={styles.handle} />
      </div>
      <div className={styles.header}>{header}</div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
