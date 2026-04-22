// migrations/20260312160000_add_montos_premio_to_expedientes.js

exports.up = async function (knex) {
  // Componentes base de montos (no se persiste subtotal/premio/total en esta iteracion)
  await knex.raw("ALTER TABLE ema.expedientes ADD COLUMN parte_a NUMERIC NULL");
  await knex.raw("ALTER TABLE ema.expedientes ADD COLUMN parte_b NUMERIC NULL");
  await knex.raw("ALTER TABLE ema.expedientes ADD COLUMN premio_aplica BOOLEAN NOT NULL DEFAULT FALSE");

  // Constraints: permitir NULL, exigir >= 0 cuando no sea NULL
  await knex.raw(`
    ALTER TABLE ema.expedientes
    ADD CONSTRAINT expedientes_parte_a_nonneg
    CHECK (parte_a IS NULL OR parte_a >= 0)
  `);

  await knex.raw(`
    ALTER TABLE ema.expedientes
    ADD CONSTRAINT expedientes_parte_b_nonneg
    CHECK (parte_b IS NULL OR parte_b >= 0)
  `);
};

exports.down = async function (knex) {
  // Quitar constraints si existen
  await knex.raw("ALTER TABLE ema.expedientes DROP CONSTRAINT IF EXISTS expedientes_parte_b_nonneg");
  await knex.raw("ALTER TABLE ema.expedientes DROP CONSTRAINT IF EXISTS expedientes_parte_a_nonneg");

  // Quitar columnas en orden inverso
  await knex.raw("ALTER TABLE ema.expedientes DROP COLUMN IF EXISTS premio_aplica");
  await knex.raw("ALTER TABLE ema.expedientes DROP COLUMN IF EXISTS parte_b");
  await knex.raw("ALTER TABLE ema.expedientes DROP COLUMN IF EXISTS parte_a");
};

