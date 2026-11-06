"use client";

import clsx from "clsx";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import styles from "./States.module.scss";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={clsx(styles.empty, compact && styles.compact)}>
      {icon && <div className={styles.icon}>{icon}</div>}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className={clsx(styles.empty, styles.error)} role="alert">
      <div className={styles.icon}>
        <AlertTriangle />
      </div>
      <p className={styles.title}>{title}</p>
      {message && <p className={styles.description}>{message}</p>}
      {onRetry && (
        <div className={styles.action}>
          <Button size="sm" icon={<RefreshCw />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function LoadingState({ label = "Loading…", rows = 0 }: { label?: string; rows?: number }) {
  if (rows > 0) {
    return (
      <div className={styles.skeletons} aria-busy aria-label={label}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={styles.skeleton}>
            <span className={styles.skThumb} />
            <span className={styles.skLines}>
              <span />
              <span />
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.loading} role="status">
      <Spinner size={18} />
      <span>{label}</span>
    </div>
  );
}

export function InlineAlert({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "success"; children: ReactNode }) {
  return (
    <div className={clsx(styles.alert, styles[`alert-${tone}`])} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}
