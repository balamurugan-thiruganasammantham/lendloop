// Remembers which version of the LendLoop workflows was last imported, in a small table
// (`lendloop_meta`) inside n8n's own Postgres database.
//
//   node workflow-marker.cjs check <hash>   exit 0 = already imported, 1 = changed/unknown, 2 = error
//   node workflow-marker.cjs set <hash>
//
// Used by start-with-workflows.sh so restarts (including Render waking a sleeping service)
// skip the slow import/publish CLI calls when nothing changed. Uses the `pg` driver that
// ships inside the n8n image; reads n8n's own DB_POSTGRESDB_* variables.
const { Client } = require("/usr/local/lib/node_modules/n8n/node_modules/pg");

const [command, hash] = process.argv.slice(2);
if (!["check", "set"].includes(command) || !hash) {
  console.error("usage: workflow-marker.cjs check|set <hash>");
  process.exit(2);
}

const env = process.env;
const ssl =
  env.DB_POSTGRESDB_SSL_ENABLED === "true"
    ? { rejectUnauthorized: env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED !== "false" }
    : undefined;
const schema = (env.DB_POSTGRESDB_SCHEMA || "public").replace(/[^a-zA-Z0-9_]/g, "");
const table = `"${schema}".lendloop_meta`;

const client = new Client({
  host: env.DB_POSTGRESDB_HOST,
  port: Number(env.DB_POSTGRESDB_PORT || 5432),
  database: env.DB_POSTGRESDB_DATABASE,
  user: env.DB_POSTGRESDB_USER,
  password: env.DB_POSTGRESDB_PASSWORD,
  ssl,
  connectionTimeoutMillis: 20_000,
});

(async () => {
  await client.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${table} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  if (command === "check") {
    const { rows } = await client.query(`SELECT value FROM ${table} WHERE key = 'workflows_hash'`);
    process.exitCode = rows[0]?.value === hash ? 0 : 1;
  } else {
    await client.query(
      `INSERT INTO ${table} (key, value) VALUES ('workflows_hash', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [hash],
    );
  }
  await client.end();
})().catch((error) => {
  console.error(`workflow marker: ${error.message}`);
  process.exitCode = 2;
});
