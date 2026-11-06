import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import styles from "./AuthFrame.module.scss";

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <aside className={styles.side}>
        <Logo />
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <p className={styles.tagline}>Borrow what you need. Lend what you don&apos;t.</p>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
