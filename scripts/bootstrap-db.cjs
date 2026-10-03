const { Client } = require("pg");

(async () => {
  const required = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} lipsește.`);
    return value;
  };
  const client = new Client({ connectionString: required("PORTAL_DB_URL"), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("insert into public.profiles(id,name,email) select id,coalesce(raw_user_meta_data->>'name',''),coalesce(email,'') from auth.users on conflict(id) do update set email=excluded.email");
    const result = await client.query("select public.bootstrap_portal($1,$2,$3) as firm_id", [required("PORTAL_ADMIN_EMAIL"), required("PORTAL_FIRM_NAME"), required("PORTAL_FIRM_CODE")]);
    await client.query("update public.app_settings set data=data||jsonb_build_object('global_admin_email',$1::text,'sharepoint_host',$2::text,'sharepoint_user',$3::text),updated_at=now() where audit_firm_id=$4::uuid", [required("PORTAL_ADMIN_EMAIL"), required("PORTAL_SHAREPOINT_HOST"), required("PORTAL_SHAREPOINT_USER"), result.rows[0].firm_id]);
    await client.query("commit");
    console.log(JSON.stringify({ ok: true, firm_id: result.rows[0].firm_id }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
