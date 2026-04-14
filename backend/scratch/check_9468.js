// scratch/check_9468.js
const pool = require("../db");

async function check() {
  try {
    const id = 9468;
    console.log(`Checking Informe ID: ${id}`);
    
    const fotos = await pool.query("SELECT * FROM ema.informe_foto WHERE id_informe = $1", [id]);
    console.log("--- EMA.INFORME_FOTO ---");
    console.table(fotos.rows.map(r => ({ id_foto: r.id_foto, id_pregunta: r.id_pregunta, ruta: r.ruta_archivo })));

    const resp = await pool.query("SELECT * FROM ema.informe_respuesta WHERE id_informe = $1 AND valor_texto LIKE '%proyectos%'", [id]);
    console.log("--- EMA.INFORME_RESPUESTA ---");
    console.table(resp.rows.map(r => ({ id_pregunta: r.id_pregunta, valor: r.valor_texto })));

    const tumba = await pool.query("SELECT * FROM ema.tumba WHERE id_documento = $1", [id]);
    console.log("--- EMA.TUMBA ---");
    console.table(tumba.rows.map(r => ({ id_tumba: r.id_tumba, url: r.url })));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
