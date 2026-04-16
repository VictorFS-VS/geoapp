const jwt = require("jsonwebtoken");
const axios = require("axios");
require("dotenv").config({ path: "./.env" });

async function test() {
  const secret = process.env.JWT_SECRET || process.env.SECRET || "secret";
  const token = jwt.sign({ id: 1, email: "admin@example.com", tipo_usuario: 1, permisos: [] }, secret, { expiresIn: '1h' });
  
  try {
    const res = await axios.post("http://localhost:4000/api/informes", {
      id_plantilla: 10,
      titulo: 'Test Private',
      respuestas: {}
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("SUCCESS:", res.status, res.data);
  } catch(e) {
    console.error("FAILED:");
    console.error(e.response ? e.response.status : "No response status");
    console.error(e.response ? e.response.data : e.message);
  }
}
test();
