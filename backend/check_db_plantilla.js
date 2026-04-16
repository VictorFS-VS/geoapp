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
    const r = await pool.query("SELECT id_plantilla FROM ema.informe_plantilla LIMIT 1");
    console.log("Valid plantilla:", r.rows[0]);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
main();
