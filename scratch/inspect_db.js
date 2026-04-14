const pool = require("./backend/db");
async function test() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ema' AND table_name = 'expedientes'");
    console.log(JSON.stringify(res.rows, null, 2));
    
    const res2 = await pool.query("SELECT codigo_exp, codigo_unico FROM ema.expedientes LIMIT 10");
    console.log("Sample Data:");
    console.log(JSON.stringify(res2.rows, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}
test();
