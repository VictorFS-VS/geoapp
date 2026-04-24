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
    const table = 'ema.expedientes';
    
    console.log(`Checking schema for ${table}...`);
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'ema' AND table_name = 'expedientes'
      ORDER BY ordinal_position;
    `);
    console.log("\nCOLUMNS:");
    console.table(cols.rows);

    const constraints = await pool.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE t.relname = 'expedientes' AND n.nspname = 'ema'
    `);
    console.log("\nCONSTRAINTS:");
    console.table(constraints.rows);

    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'ema' AND tablename = 'expedientes';
    `);
    console.log("\nINDEXES:");
    console.table(indexes.rows);

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
main();
