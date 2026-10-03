const { Client } = require("pg");

(async () => {
  if (!process.env.PORTAL_DB_URL) throw new Error("PORTAL_DB_URL lipsește.");
  const client = new Client({ connectionString: process.env.PORTAL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const tables = await client.query("select table_name from information_schema.tables where table_schema='public' order by table_name");
  const types = await client.query("select typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and typtype='e' order by typname");
  const migrations = await client.query("select version from supabase_migrations.schema_migrations order by version");
  const policies = await client.query("select tablename,policyname from pg_policies where schemaname='public' order by tablename,policyname");
  const functions = await client.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('bootstrap_portal','validate_request_update','append_business_audit','document_received','handle_new_user') order by proname");
  const triggers = await client.query("select event_object_table,trigger_name from information_schema.triggers where trigger_schema='public' order by event_object_table,trigger_name");
  const counts = {};
  for (const table of tables.rows.map((row) => row.table_name)) {
    const result = await client.query(`select count(*)::int as count from public.${table}`);
    counts[table] = result.rows[0].count;
  }
  console.log(JSON.stringify({ tables: tables.rows.map((row) => row.table_name), types: types.rows.map((row) => row.typname), migrations: migrations.rows.map((row) => row.version), policies: policies.rows, functions: functions.rows.map((row) => row.proname), triggers: triggers.rows, counts }));
  await client.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
