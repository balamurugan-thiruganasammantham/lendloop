"use client";

import clsx from "clsx";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Popover.module.scss";

export type PopoverPlacement = "below-end" | "below-start" | "right-end";

/** Minimal anchored dropdown: closes on outside click and Escape. */
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const parent = ref.current?.parentElement;
      if (parent && !parent.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={clsx(styles.popover, styles[placement])} style={{ width }}>
      {children}
    </div>
  );
}
