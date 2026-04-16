const pool = require('./db');
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ema' AND table_name = 'informe_respuesta';")
  .then(r => console.log(r.rows))
  .finally(() => process.exit(0));
