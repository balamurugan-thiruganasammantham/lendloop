"use client";

import clsx from "clsx";
import styles from "./Tabs.module.scss";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={clsx(styles.tab, item.key === value && styles.active)}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined && item.count > 0 && <span className={clsx(styles.count, "num")}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
