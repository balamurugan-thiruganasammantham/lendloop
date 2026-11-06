"use client";

import clsx from "clsx";
import { Star } from "lucide-react";
import styles from "./Stars.module.scss";

export function Rating({ value, count, size = "sm" }: { value: number | null; count?: number; size?: "sm" | "md" }) {
  if (value === null) return <span className={clsx(styles.rating, styles.none)}>No reviews yet</span>;
  return (
    <span className={clsx(styles.rating, styles[size])} aria-label={`Rated ${value} out of 5${count ? ` from ${count} reviews` : ""}`}>
      <Star className={styles.filled} />
      <span className="num">{value.toFixed(1)}</span>
      {count !== undefined && <span className={styles.count}>({count})</span>}
    </span>
  );
}

export function StarInput({ value, onChange, label = "Rating" }: { value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div className={styles.input} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={clsx(styles.star, n <= value && styles.on)}
          onClick={() => onChange(n)}
        >
          <Star />
        </button>
      ))}
    </div>
  );
}
