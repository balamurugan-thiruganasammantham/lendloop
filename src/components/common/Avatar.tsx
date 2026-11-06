import clsx from "clsx";
import { initials } from "@/lib/format";
import styles from "./Avatar.module.scss";

export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  return (
    <span className={clsx(styles.avatar, className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars come from Clerk/arbitrary hosts
        <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
    </span>
  );
}
