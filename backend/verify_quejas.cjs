const pool = require('./db.js');
pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='ema' AND table_name='quejas_reclamos'").then(res => { console.log(res.rows); process.exit(0); });
