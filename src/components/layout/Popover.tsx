"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Popover.module.scss";

export type PopoverPlacement = "below-end" | "below-start" | "right-end";

const GAP = 10;
const MARGIN = 8;

/**
 * Minimal anchored dropdown: closes on outside click and Escape.
 *
 * Rendered in a portal with fixed positioning, so it is never clipped by a
 * scrolling ancestor (the left rail scrolls, which used to hide the account and
 * notification menus that open to its right). The anchor is the element that
 * contains the <Popover> in the tree (usually a wrapper around the trigger).
 */
export function Popover({
  open,
  onClose,
  children,
  placement = "below-end",
  width = 340,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: PopoverPlacement;
  width?: number;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Position next to the anchor; keep it inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = markerRef.current?.parentElement;
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const r = anchor.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - MARGIN * 2);
      const h = pop.offsetHeight;
      let left: number;
      let top: number;
      if (placement === "right-end") {
        // Clear the rail's border, not just the trigger.
        left = r.right + GAP * 2;
        top = r.bottom - h;
      } else {
        left = placement === "below-start" ? r.left : r.right - w;
        top = r.bottom + GAP;
      }
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
      pop.style.width = `${w}px`;
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.style.visibility = "visible";
    };
    place();
    const observer = new ResizeObserver(place);
    if (popRef.current) observer.observe(popRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const anchor = markerRef.current?.parentElement;
      if (anchor?.contains(target) || popRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      <span ref={markerRef} hidden />
      {open &&
        createPortal(
          <div ref={popRef} className={styles.popover} style={{ width, visibility: "hidden" }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
