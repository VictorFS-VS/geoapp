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
    const r = await pool.query("INSERT INTO ema.informe (id_plantilla, id_proyecto, titulo) VALUES (1, null, 'Test') RETURNING *");
    console.log("Insert success:", r.rows[0]);
    await pool.query("DELETE FROM ema.informe WHERE id_informe = $1", [r.rows[0].id_informe]);
  } catch(e) {
    console.error("Insert error:", e.message);
  } finally {
    pool.end();
  }
}
main();
