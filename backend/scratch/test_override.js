const pool = require('./db');

async function testOverride() {
    const idRegistro = 2; // From the user request URL
    const manual_override = true;
    const manual_comment = "Test comment";
    const resultado_consultor = "ALTA";
    const id_usuario_evaluador = 1; // Assuming 1 exists

    try {
        console.log("Starting update...");
        const resUpdate = await pool.query(
            `UPDATE ema.formula_resultado 
             SET manual_override = $1,
                 manual_comment = $2,
                 resultado_consultor = $3,
                 id_usuario_evaluador = $4,
                 fecha_manual_evaluacion = CURRENT_TIMESTAMP
             WHERE id_registro = $5
             RETURNING *`,
            [manual_override !== false, manual_comment, resultado_consultor, id_usuario_evaluador, idRegistro]
        );
        console.log("Update rowCount:", resUpdate.rowCount);
        
        const finalResult = await pool.query(
            `SELECT * FROM ema.formula_resultado WHERE id_registro = $1`,
            [idRegistro]
        );
        console.log("Final result rows:", finalResult.rowCount);
        process.exit(0);
    } catch (err) {
        console.error("Error detected:", err);
        process.exit(1);
    }
}

testOverride();
