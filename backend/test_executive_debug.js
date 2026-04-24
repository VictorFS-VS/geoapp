/**
 * Debug script para testear el endpoint resumen-ejecutivo
 */
const axios = require("axios");

const API_URL = "http://localhost:4000/api";

async function testExecutiveResumen() {
  const id_proyecto = 279; // Usa el proyecto que mencionaste
  
  console.log("\n========== TESTING EXECUTIVE RESUMEN ==========\n");
  console.log("Testing with id_proyecto:", id_proyecto);
  
  try {
    const { data } = await axios.get(`${API_URL}/project-home/resumen-ejecutivo`, {
      params: { id_proyecto },
      headers: { 
        "Authorization": `Bearer dummy_token` // Ajusta según tu setup
      }
    });
    
    console.log("\n✅ Response received:");
    console.log(JSON.stringify(data, null, 2));
    
  } catch (err) {
    console.error("\n❌ Error calling endpoint:");
    console.error("Status:", err.response?.status);
    console.error("Data:", err.response?.data);
    console.error("Message:", err.message);
  }
}

testExecutiveResumen();
