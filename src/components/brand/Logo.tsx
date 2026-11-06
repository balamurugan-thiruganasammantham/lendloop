import clsx from "clsx";
import Link from "next/link";
import styles from "./Logo.module.scss";

/** Wordmark: a loop glyph (two interlocking arcs) + name. */
export function Logo({ href = "/", compact, className }: { href?: string; compact?: boolean; className?: string }) {
  return (
    <Link href={href} className={clsx(styles.logo, className)} aria-label="LendLoop home">
      <svg viewBox="0 0 28 28" className={styles.mark} aria-hidden>
        <rect width="28" height="28" rx="8" fill="currentColor" />
        <path d="M9.5 17.5a4 4 0 1 1 4-4" stroke="#F7F7F4" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M18.5 10.5a4 4 0 1 1-4 4" stroke="#9BC3AC" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </svg>
      {!compact && <span className={styles.word}>LendLoop</span>}
    </Link>
  );
}
