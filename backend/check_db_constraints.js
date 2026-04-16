const { Pool } = require('pg');
require('dotenv').config({path: './.env'});
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT || 5432
});

async function main() {
  try {
    const q1 = await pool.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE t.relname = 'informe' AND n.nspname = 'ema'
    `);
    console.log("CONSTRAINTS:");
    console.table(q1.rows);

    const q2 = await pool.query(`
      SELECT trigger_name, event_manipulation, event_object_table, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema = 'ema' AND event_object_table = 'informe'
    `);
    console.log("TRIGGERS:");
    console.table(q2.rows);

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
main();
