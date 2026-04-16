const pool = require('./db');

async function check() {
  const tables = ['informe_respuesta', 'formula_resultado', 'informe'];
  for (const t of tables) {
    console.log(`\n--- Indexes for ${t} ---`);
    const res = await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1 AND schemaname = 'ema'`, [t]);
    console.table(res.rows);
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
