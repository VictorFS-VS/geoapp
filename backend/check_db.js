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
    const r = await pool.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'ema' AND table_name = 'informe'");
    console.table(r.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
main();
