const jwt = require("jsonwebtoken");
const axios = require("axios");
require("dotenv").config({ path: "./.env" });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT || 5432
});

async function getValidQuestions() {
  const r = await pool.query(
    "SELECT p.id_pregunta, p.tipo, p.opciones_json, p.obligatorio FROM ema.informe_pregunta p JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion WHERE s.id_plantilla = 10 AND p.obligatorio = true"
  );
  return r.rows;
}

async function test() {
  const secret = process.env.JWT_SECRET || process.env.SECRET || "secret";
  const token = jwt.sign({ id: 1, email: "admin@example.com", tipo_usuario: 1, permisos: [] }, secret, { expiresIn: '1h' });
  
  try {
    const q = await getValidQuestions();
    const respuestas = {};
    for (const reqQ of q) {
      if (reqQ.tipo === 'texto') respuestas[reqQ.id_pregunta] = 'test';
      else if (reqQ.tipo === 'numero') respuestas[reqQ.id_pregunta] = 1;
      else if (reqQ.tipo === 'select') respuestas[reqQ.id_pregunta] = {label: '1', value: '1'};
      else respuestas[reqQ.id_pregunta] = '1';
    }

    const res = await axios.post("http://localhost:4000/api/informes", {
      id_plantilla: 10,
      titulo: 'Test Private Full',
      respuestas
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("SUCCESS:", res.status, res.data);
  } catch(e) {
    console.error("FAILED:");
    console.error(e.response ? e.response.status : "No response status");
    console.error(e.response ? e.response.data : e.message);
  } finally {
    pool.end();
  }
}
test();
