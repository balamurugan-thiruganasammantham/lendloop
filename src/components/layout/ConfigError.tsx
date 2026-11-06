import styles from "./ConfigError.module.scss";

/** Shown instead of crashing when required public configuration is missing. */
export function ConfigError({ missing }: { missing: string[] }) {
  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Configuration required</p>
        <h1>LendLoop isn&apos;t connected to its backend yet</h1>
        <p>Set the following environment variables in <code>.env.local</code> and restart the dev server:</p>
        <ul>
          {missing.map((m) => (
            <li key={m}>
              <code>{m}</code>
            </li>
          ))}
        </ul>
        <p className={styles.muted}>See README → Local development.</p>
      </div>
    </main>
  );
}
