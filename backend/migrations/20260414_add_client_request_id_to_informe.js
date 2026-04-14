// migrations/20260414_ensure_informe_client_request_id.js
/**
 * Asegura que ema.informe tenga client_request_id
 * y crea índice único parcial para idempotencia de envíos públicos.
 */

exports.up = async function (knex) {
  const hasTable = await knex.schema.withSchema("ema").hasTable("informe");

  if (!hasTable) {
    console.log("  ⚠️ Tabla ema.informe no existe. Se omite migration.");
    return;
  }

  const hasClientRequestId = await knex.schema
    .withSchema("ema")
    .hasColumn("informe", "client_request_id");

  if (!hasClientRequestId) {
    console.log("  ✅ Agregando columna client_request_id a ema.informe");
    await knex.schema.withSchema("ema").table("informe", (table) => {
      table
        .string("client_request_id", 120)
        .nullable()
        .comment("Id único del envío desde cliente para evitar duplicados");
    });
  }

  // Crear índice único parcial solo si no existe
  console.log("  ✅ Asegurando índice uq_informe_client_request_id");
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_informe_client_request_id
    ON ema.informe (client_request_id)
    WHERE client_request_id IS NOT NULL
  `);
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.withSchema("ema").hasTable("informe");

  if (!hasTable) return;

  console.log("  ✅ Eliminando índice uq_informe_client_request_id si existe");
  await knex.raw(`
    DROP INDEX IF EXISTS ema.uq_informe_client_request_id
  `);

  const hasClientRequestId = await knex.schema
    .withSchema("ema")
    .hasColumn("informe", "client_request_id");

  if (hasClientRequestId) {
    console.log("  ✅ Eliminando columna client_request_id de ema.informe");
    await knex.schema.withSchema("ema").table("informe", (table) => {
      table.dropColumn("client_request_id");
    });
  }
};